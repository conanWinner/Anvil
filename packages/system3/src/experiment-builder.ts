import { z } from '@hono/zod-openapi';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { createInterface } from 'node:readline';
import { sampleAgentData, splitModelingTable, type SplitSummary } from './experiment-evaluation';
import { MODELING_TABLE_COLUMNS, type ExperimentPlan } from './experiment-plan';
import { runExperimentSandbox, type ExperimentSandboxResult } from './experiment-sandbox';
import type { MlRuntime } from './ml-runtime';

/**
 * TW-06A: an LLM builder writes the experiment codebase as file contents only (no host tools);
 * Anvil runs everything in the experiment sandbox and feeds failures back; a second model reviews
 * the code before any full experiment run.
 */

const FILE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,159}$/u;
const MAX_FILES = 40;
const MAX_FILE_BYTES = 200 * 1024;
const MAX_TOTAL_BYTES = 600 * 1024;
const FEEDBACK_LIMIT = 6_000;
const SMOKE_TRAIN_ROWS = 3_000;
const SMOKE_TEST_ROWS = 500;
const GENERATION_RETRIES = 2;

export const builderFileSchema = z.object({
  path: z.string().regex(FILE_PATH),
  content: z.string().max(MAX_FILE_BYTES),
});

export const builderResponseSchema = z.object({
  files: z.array(builderFileSchema).max(MAX_FILES),
  notes: z.string().max(4_000),
  /** Set when the blueprint cannot be implemented as written; the user must decide. */
  question: z.string().max(4_000).nullable(),
});
export type BuilderResponse = z.infer<typeof builderResponseSchema>;

export const reviewFindingSchema = z.object({
  severity: z.enum(['blocking', 'warning']),
  file: z.string().nullable(),
  message: z.string().min(1).max(2_000),
});

export const reviewResponseSchema = z.object({
  verdict: z.enum(['pass', 'changes_required']),
  summary: z.string().max(4_000),
  findings: z.array(reviewFindingSchema).max(50),
});
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;

/** JSON Schemas handed to the provider for SDK-enforced structured output. */
export const BUILDER_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'notes', 'question'],
  properties: {
    question: { type: ['string', 'null'] },
    files: {
      type: 'array',
      maxItems: MAX_FILES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'content'],
        properties: { path: { type: 'string' }, content: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
  },
} as const;

export const REVIEW_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'changes_required'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'message'],
        properties: {
          severity: { type: 'string', enum: ['blocking', 'warning'] },
          file: { type: ['string', 'null'] },
          message: { type: 'string' },
        },
      },
    },
  },
} as const;

export type ExperimentGenerate = (input: {
  role: 'builder' | 'reviewer';
  prompt: string;
  schema: typeof BUILDER_OUTPUT_JSON_SCHEMA | typeof REVIEW_OUTPUT_JSON_SCHEMA;
  signal: AbortSignal;
}) => Promise<unknown>;

export interface BuildEvent {
  stage: 'prepare' | 'variants' | 'review';
  round: number;
  kind: 'generated' | 'check_passed' | 'check_failed' | 'review';
  detail: string;
}

export interface ExperimentBuildInput {
  /** Raw System 2 blueprint text (Markdown or JSON export) given to both models. */
  blueprint: string;
  plan: ExperimentPlan;
  /** Variant ids the user kept in the approved plan. */
  variantIds: readonly string[];
  /** Pinned raw data files, read-only at /work/data during data preparation. */
  rawDataDir: string;
  /** Empty directory that becomes the generated codebase. */
  projectDir: string;
  /** Scratch space for sandbox outputs, split and smoke data. */
  workDir: string;
  runtime: MlRuntime;
  generate: ExperimentGenerate;
  maxFixRounds: number;
  maxReviewRounds: number;
  /** Return a ready build with the last review's blocking findings instead of failing. */
  reportUnresolvedReview?: boolean;
  signal: AbortSignal;
  onEvent?: (event: BuildEvent) => void;
}

export type ExperimentBuildResult =
  | {
      status: 'ready';
      split: { agentDataDir: string; holdoutDir: string; summary: SplitSummary };
      review: ReviewResponse;
      files: Record<string, string>;
      events: BuildEvent[];
    }
  | { status: 'failed'; stage: BuildEvent['stage']; reason: string; events: BuildEvent[] }
  | {
      /** The builder could not follow the blueprint as written; a person must decide. */
      status: 'needs_decision';
      stage: BuildEvent['stage'];
      question: string;
      events: BuildEvent[];
    };

function clip(text: string, limit = FEEDBACK_LIMIT): string {
  return text.length <= limit ? text : `…${text.slice(text.length - limit)}`;
}

function safeRelative(path: string): string {
  const normalized = normalize(path);
  if (isAbsolute(normalized) || normalized.startsWith('..') || normalized.includes('/../'))
    throw new Error(`Generated file path escapes the project: ${path}`);
  return normalized;
}

async function writeGeneratedFiles(
  projectDir: string,
  files: BuilderResponse['files']
): Promise<void> {
  let total = 0;
  for (const file of files) {
    total += Buffer.byteLength(file.content);
    if (total > MAX_TOTAL_BYTES) throw new Error('Generated codebase exceeds its size limit');
    const target = join(projectDir, safeRelative(file.path));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

async function listProjectFiles(projectDir: string, prefix = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(join(projectDir, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, await listProjectFiles(projectDir, relative));
    else if (entry.isFile()) files[relative] = await readFile(join(projectDir, relative), 'utf8');
  }
  return files;
}

export function hashProjectFiles(files: Record<string, string>): string {
  const hash = createHash('sha256');
  for (const path of Object.keys(files).sort()) hash.update(`${path}\0${files[path]}\0`);
  return `sha256:${hash.digest('hex')}`;
}

/** Header plus a few rows of every CSV in a folder, so models see real column names and values. */
async function describeCsvFolder(dir: string, rows = 3): Promise<string> {
  const parts: string[] = [];
  for (const name of (await readdir(dir)).filter(item => item.endsWith('.csv')).sort()) {
    const lines: string[] = [];
    const reader = createInterface({ input: createReadStream(join(dir, name)) });
    for await (const line of reader) {
      lines.push(line.slice(0, 400));
      if (lines.length > rows) break;
    }
    reader.close();
    const size = (await stat(join(dir, name))).size;
    parts.push(`### ${name} (${Math.round(size / 1024).toString()} KiB)\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

function filesBlock(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([path, content]) => `--- ${path}\n${content}`)
    .join('\n\n');
}

function variantList(plan: ExperimentPlan, ids: readonly string[]): string {
  return plan.variants
    .filter(variant => ids.includes(variant.id))
    .map(
      variant =>
        `- \`${variant.id}\`: ${variant.name}${variant.role === 'baseline' ? ' (baseline)' : ''}`
    )
    .join('\n');
}

const SANDBOX_RULES = `Runtime rules (enforced by the sandbox):
- Python 3.12 with only: numpy, pandas, scipy, scikit-learn, xgboost, lightgbm, imbalanced-learn, shap, matplotlib, joblib, pyarrow.
- No network, no package installation, no GPU. Memory 2 GB, 2 CPU threads (use n_jobs=2 at most).
- The project folder (/work/project) and /work/data are read-only. Write only under /work/out.
- Use fixed random seeds. Keep hyper-parameter search small: each variant must finish in under 20 minutes.

Scope rules (the user owns these decisions):
- Never change the blueprint's target definition, positive class, entity population, time window or evaluation metric, even if the data makes them hard (e.g. extreme class imbalance).
- If the blueprint's problem definition is contradictory or impossible with the given data, return no files and put a short, specific question for the user in \`question\` (what is wrong, with numbers, and the options you see). Otherwise set \`question\` to null.

How this works: you cannot run code or open files yourself. The headers and sample rows above are what the data looks like; Anvil runs your code in the sandbox and sends back any error or contract violation for you to fix. So never ask about file access, verification or permission — write the best code you can and let Anvil's run check it. Reasonable implementation choices the blueprint leaves open (e.g. how to aggregate several payments per order) are yours to make; mention them in \`notes\`.`;

function preparePrompt(
  input: ExperimentBuildInput,
  rawData: string,
  feedback: string | null,
  files: Record<string, string>
): string {
  const protocol = input.plan.protocol;
  const timeColumn =
    protocol?.split.kind === 'time_holdout'
      ? `- \`${MODELING_TABLE_COLUMNS.time}\`: the observation cutoff timestamp of each row (ISO 8601). Anvil splits train/test by this column.\n`
      : '';
  return `You implement the DATA PREPARATION stage of a System 2 experiment blueprint.

Write \`prepare_data.py\` (and optional helper modules under \`src/\`). It reads the raw CSV files from /work/data and writes ONE modeling table to /work/out/modeling_table.csv with exactly one row per entity and these columns:
- \`${MODELING_TABLE_COLUMNS.id}\`: unique entity id (string).
- \`${MODELING_TABLE_COLUMNS.target}\`: 1 for the positive class, 0 otherwise, following the blueprint's target definition.
${timeColumn}- Feature columns described by the blueprint (feature engineering stages). Avoid leakage: features may only use information available before the target is determined.

Do NOT split data and do NOT train models in this stage: Anvil splits the table and holds out test labels itself.

${SANDBOX_RULES}

## Raw data in /work/data
${rawData}

## Blueprint
${input.blueprint}
${Object.keys(files).length > 0 ? `\n## Current files\n${filesBlock(files)}` : ''}
${feedback ? `\n## Fix this problem from the last run\n${feedback}` : ''}

Return every file you create or change (full content). Return only files, no explanations outside \`notes\`.`;
}

function variantsPrompt(
  input: ExperimentBuildInput,
  agentData: string,
  feedback: string | null,
  files: Record<string, string>
): string {
  const protocol = input.plan.protocol;
  return `You implement the MODEL EXPERIMENT stage of a System 2 experiment blueprint.

Write \`train_variant.py\` (and optional helper modules under \`src/\`) that runs ONE variant per call:
\`python train_variant.py --variant <id>\`

Variants to support:
${variantList(input.plan, input.variantIds)}

Data (read-only):
- /work/data/train.csv — training rows with the \`${MODELING_TABLE_COLUMNS.target}\` column.
- /work/data/test_features.csv — held-out rows WITHOUT the target. Labels are hidden from you; do not try to recover them.

Each run must write:
- /work/out/predictions/<id>.csv with columns \`id,score,label\`: \`id\` = ${MODELING_TABLE_COLUMNS.id} of every test row exactly once, \`score\` = predicted probability of class 1 in [0, 1], \`label\` = 0/1 decision.
- /work/out/reported/<id>.json with your training-side numbers (e.g. cross-validation ${protocol?.primaryMetric ?? 'metrics'} per fold, train_seconds). These are informational; Anvil computes the official test metrics itself.
Tune and validate only on train.csv${protocol?.split.kind === 'time_holdout' ? ` using time-ordered cross-validation on \`${MODELING_TABLE_COLUMNS.time}\`` : ''}. Never fit anything on test_features.csv except producing predictions. Exclude \`${MODELING_TABLE_COLUMNS.id}\`${protocol?.split.kind === 'time_holdout' ? ` and \`${MODELING_TABLE_COLUMNS.time}\`` : ''} from the model features.

${SANDBOX_RULES}

## Agent data (header and first rows)
${agentData}

## Blueprint
${input.blueprint}

## Current files
${filesBlock(files)}
${feedback ? `\n## Fix this problem from the last run\n${feedback}` : ''}

Return every file you create or change (full content). Keep prepare_data.py unchanged unless the feedback requires it.`;
}

function reviewPrompt(
  input: ExperimentBuildInput,
  files: Record<string, string>,
  checks: string
): string {
  return `You review an experiment codebase generated from a System 2 blueprint before Anvil runs it on the full data. Be concrete and strict about correctness; ignore style.

Report a BLOCKING finding for:
- Data leakage (target or future information in features, fitting preprocessing on test rows, using test rows for tuning).
- Target definition that does not match the blueprint.
- A requested variant missing or implemented as a different algorithm.
- (The output contract — files, columns, row counts — was already checked by running the code in the sandbox; do not report it.)
- Anything that would make results non-reproducible (missing seeds) or exceed the sandbox limits.
- Degenerate data: a target that is (almost) constant in train or test, so models cannot learn or be evaluated meaningfully. Check the split statistics below.
- Code that hides failures (e.g. returning constant predictions when training data is unusable).
Use WARNING for deviations that do not invalidate results. Verdict \`pass\` only when there is no blocking finding.

Evaluation contract fixed by Anvil (do NOT ask the code to change it):
- Anvil splits the modeling table and keeps the held-out test labels; the code never sees them.
- Anvil computes every official test metric (ROC-AUC, PR-AUC, F1, recall, …) from predictions/<id>.csv. Code must only produce predictions and may report training/cross-validation numbers.
- Blueprint sentences such as "report metrics on the test set" are satisfied by Anvil's evaluation.
Only flag leakage with concrete evidence (a specific column or step that uses information created after the label).
Every blocking finding must name the concrete line, column or step that is wrong; if you cannot point to one, it is not a finding.
Never block on something the blueprint explicitly requires (a listed feature, target rule or model). If you believe a blueprint requirement itself is risky, report a WARNING that names the requirement ID — the user decides on blueprint changes, not the code. Order-time attributes such as prices, freight, payment type, installments or product attributes are known at purchase time.

Variants requested:
${variantList(input.plan, input.variantIds)}

${SANDBOX_RULES}

## Sandbox checks and data statistics
${checks}

## Blueprint
${input.blueprint}

## Codebase
${filesBlock(files)}`;
}

async function runChecked(run: () => Promise<ExperimentSandboxResult>): Promise<string | null> {
  const result = await run();
  if (result.exitCode === 0) return null;
  return clip(
    `exit code ${result.exitCode.toString()}\nstderr:\n${result.stderr}\nstdout:\n${result.stdout}`
  );
}

export async function buildExperimentCodebase(
  input: ExperimentBuildInput
): Promise<ExperimentBuildResult> {
  const events: BuildEvent[] = [];
  const emit = (event: BuildEvent): void => {
    events.push(event);
    input.onEvent?.(event);
  };
  if (input.plan.protocol === null) throw new Error('Experiment plan has no evaluation protocol');
  const protocol = input.plan.protocol;
  const unknown = input.variantIds.filter(id => !input.plan.variants.some(item => item.id === id));
  if (input.variantIds.length === 0 || unknown.length > 0)
    throw new Error(`Approved variants are empty or unknown: ${unknown.join(', ')}`);
  await mkdir(input.projectDir, { recursive: true });
  const rawData = await describeCsvFolder(input.rawDataDir);

  class NeedsDecision extends Error {
    constructor(
      readonly stage: BuildEvent['stage'],
      readonly question: string
    ) {
      super(question);
    }
  }
  const generate = async (
    role: 'builder' | 'reviewer',
    prompt: string
  ): Promise<BuilderResponse | ReviewResponse> => {
    // Best-effort structured output can arrive truncated or malformed; retry a bounded number of
    // times with a reminder. Aborts and errors after the last attempt propagate.
    let lastError: unknown;
    for (let attempt = 0; attempt <= GENERATION_RETRIES; attempt += 1) {
      input.signal.throwIfAborted();
      try {
        const raw = await input.generate({
          role,
          prompt:
            attempt === 0
              ? prompt
              : `${prompt}\n\nYour previous answer was not complete, valid JSON for the required schema. Return the complete JSON object only.`,
          schema: role === 'builder' ? BUILDER_OUTPUT_JSON_SCHEMA : REVIEW_OUTPUT_JSON_SCHEMA,
          signal: input.signal,
        });
        return parseResponse(role, prompt, raw);
      } catch (error) {
        if (input.signal.aborted || error instanceof NeedsDecision) throw error;
        lastError = error;
      }
    }
    throw lastError;
  };
  const parseResponse = (
    role: 'builder' | 'reviewer',
    prompt: string,
    raw: unknown
  ): BuilderResponse | ReviewResponse => {
    if (role === 'reviewer') return reviewResponseSchema.parse(raw);
    const response = builderResponseSchema.parse(raw);
    if (response.question !== null && response.question.trim().length > 0)
      throw new NeedsDecision(
        prompt.includes('DATA PREPARATION') ? 'prepare' : 'variants',
        response.question.trim()
      );
    if (response.files.length === 0) throw new Error('Builder returned no files and no question');
    return response;
  };

  // Stage 1: data preparation until the modeling table satisfies Anvil's split.
  // Closures below update the split; a holder object keeps TypeScript's narrowing honest.
  const state: { split: Awaited<ReturnType<typeof splitModelingTable>> | null } = { split: null };
  const runPrepare = async (tag: string): Promise<string | null> => {
    const outputDir = join(input.workDir, `prepare-${tag}`);
    await rm(outputDir, { recursive: true, force: true });
    const failure = await runChecked(() =>
      runExperimentSandbox({
        profile: 'experiment',
        runtime: input.runtime,
        projectDir: input.projectDir,
        dataDir: input.rawDataDir,
        outputDir,
        script: 'prepare_data.py',
        timeoutMs: 15 * 60_000,
        signal: input.signal,
      })
    );
    if (failure !== null) return failure;
    try {
      state.split = await splitModelingTable({
        runtime: input.runtime,
        tablePath: join(outputDir, 'modeling_table.csv'),
        protocol,
        workDir: join(input.workDir, `split-${tag}`),
        signal: input.signal,
      });
      return null;
    } catch (error) {
      return clip(
        `prepare_data.py ran, but the modeling table is not usable: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
  const prepare = async (initialFeedback: string | null): Promise<string | null> => {
    let feedback = initialFeedback;
    for (let round = 1; round <= input.maxFixRounds; round += 1) {
      const response = (await generate(
        'builder',
        preparePrompt(input, rawData, feedback, await listProjectFiles(input.projectDir))
      )) as BuilderResponse;
      await writeGeneratedFiles(input.projectDir, response.files);
      emit({ stage: 'prepare', round, kind: 'generated', detail: response.notes });
      feedback = await runPrepare(round.toString());
      if (feedback === null) {
        emit({ stage: 'prepare', round, kind: 'check_passed', detail: 'Modeling table split' });
        return null;
      }
      emit({ stage: 'prepare', round, kind: 'check_failed', detail: feedback });
    }
    return feedback ?? 'Data preparation did not converge';
  };

  // Stage 2: variant code until every variant produces valid predictions on smoke data.
  const smokeVariants = async (): Promise<string | null> => {
    if (state.split === null) return 'No split available';
    const smokeData = join(input.workDir, 'smoke-data');
    await rm(smokeData, { recursive: true, force: true });
    await sampleAgentData({
      runtime: input.runtime,
      agentDataDir: state.split.agentDataDir,
      protocol,
      trainRows: SMOKE_TRAIN_ROWS,
      testRows: SMOKE_TEST_ROWS,
      outputDir: smokeData,
      workDir: join(input.workDir, 'smoke-sample'),
      signal: input.signal,
    });
    const expectedRows =
      (await readFile(join(smokeData, 'test_features.csv'), 'utf8')).trim().split('\n').length - 1;
    for (const variant of input.variantIds) {
      const outputDir = join(input.workDir, 'smoke-out', variant);
      await rm(outputDir, { recursive: true, force: true });
      const failure = await runChecked(() =>
        runExperimentSandbox({
          profile: 'experiment',
          runtime: input.runtime,
          projectDir: input.projectDir,
          dataDir: smokeData,
          outputDir,
          script: 'train_variant.py',
          args: ['--variant', variant],
          timeoutMs: 5 * 60_000,
          signal: input.signal,
        })
      );
      if (failure !== null)
        return `Variant ${variant} failed on a ${SMOKE_TRAIN_ROWS.toString()}-row sample:\n${failure}`;
      const predictions = await readFile(
        join(outputDir, 'predictions', `${variant}.csv`),
        'utf8'
      ).catch(() => null);
      if (predictions === null)
        return `Variant ${variant} wrote no /work/out/predictions/${variant}.csv`;
      const [header, ...rows] = predictions.trim().split('\n');
      if (header?.replace(/\s/gu, '') !== 'id,score,label' || rows.length !== expectedRows)
        return `Variant ${variant} predictions must have header id,score,label and ${expectedRows.toString()} rows (got header "${header ?? ''}" and ${rows.length.toString()} rows)`;
    }
    return null;
  };
  const variants = async (initialFeedback: string | null): Promise<string | null> => {
    let feedback = initialFeedback;
    const agentData = state.split === null ? '' : await describeCsvFolder(state.split.agentDataDir);
    for (let round = 1; round <= input.maxFixRounds; round += 1) {
      const response = (await generate(
        'builder',
        variantsPrompt(input, agentData, feedback, await listProjectFiles(input.projectDir))
      )) as BuilderResponse;
      await writeGeneratedFiles(input.projectDir, response.files);
      emit({ stage: 'variants', round, kind: 'generated', detail: response.notes });
      feedback = await smokeVariants();
      if (feedback === null) {
        emit({
          stage: 'variants',
          round,
          kind: 'check_passed',
          detail: 'All variants ran on smoke data',
        });
        return null;
      }
      emit({ stage: 'variants', round, kind: 'check_failed', detail: feedback });
    }
    return feedback ?? 'Variant code did not converge';
  };

  try {
    const prepareFailure = await prepare(null);
    if (prepareFailure !== null)
      return { status: 'failed', stage: 'prepare', reason: prepareFailure, events };
    const variantFailure = await variants(null);
    if (variantFailure !== null)
      return { status: 'failed', stage: 'variants', reason: variantFailure, events };

    // Stage 3: independent review; blocking findings go back to the builder a bounded number of times.
    for (let round = 1; ; round += 1) {
      const files = await listProjectFiles(input.projectDir);
      const review = (await generate(
        'reviewer',
        reviewPrompt(
          input,
          files,
          `Data preparation produced a modeling table that Anvil split as: ${JSON.stringify(state.split?.summary ?? null)}. Every variant produced valid predictions on a stratified sample.`
        )
      )) as ReviewResponse;
      const blocking = review.findings.filter(finding => finding.severity === 'blocking');
      emit({
        stage: 'review',
        round,
        kind: 'review',
        detail: `${review.verdict}: ${blocking.length.toString()} blocking, ${(review.findings.length - blocking.length).toString()} warnings`,
      });
      if (review.verdict === 'pass' && blocking.length === 0) {
        if (state.split === null) throw new Error('Split missing after a successful build');
        return { status: 'ready', split: state.split, review, files, events };
      }
      // With a separate run step, unresolved findings go to the person who chooses whether to
      // run (the code already passed its smoke test); otherwise the build stops here.
      if (round > input.maxReviewRounds && input.reportUnresolvedReview === true) {
        if (state.split === null) throw new Error('Split missing after a successful build');
        return { status: 'ready', split: state.split, review, files, events };
      }
      if (round > input.maxReviewRounds)
        return {
          status: 'failed',
          stage: 'review',
          reason: `Review still has blocking findings after ${input.maxReviewRounds.toString()} fix rounds:\n${blocking.map(item => `- ${item.file ?? 'general'}: ${item.message}`).join('\n')}`,
          events,
        };
      // Route each finding to the stage that owns the file: data-preparation fixes go through the
      // preparation prompt (and invalidate the split), the rest through the variant prompt.
      const describe = (items: typeof blocking): string =>
        clip(
          `The reviewer found blocking problems; fix all of them:\n${items.map(item => `- ${item.file ?? 'general'}: ${item.message}`).join('\n')}`
        );
      const preparationFindings = blocking.filter(item =>
        (item.file ?? '').includes('prepare_data')
      );
      const variantFindings = blocking.filter(item => !preparationFindings.includes(item));
      if (preparationFindings.length > 0) {
        const prepareFailure = await prepare(describe(preparationFindings));
        if (prepareFailure !== null)
          return { status: 'failed', stage: 'prepare', reason: prepareFailure, events };
      }
      const smokeFailure = variantFindings.length > 0 ? null : await smokeVariants();
      if (variantFindings.length > 0 || smokeFailure !== null) {
        const fixFailure = await variants(
          variantFindings.length > 0 ? describe(variantFindings) : smokeFailure
        );
        if (fixFailure !== null)
          return { status: 'failed', stage: 'variants', reason: fixFailure, events };
      }
    }
  } catch (error) {
    if (error instanceof NeedsDecision) {
      emit({
        stage: error.stage,
        round: 0,
        kind: 'generated',
        detail: `Question: ${error.question}`,
      });
      return { status: 'needs_decision', stage: error.stage, question: error.question, events };
    }
    throw error;
  }
}
