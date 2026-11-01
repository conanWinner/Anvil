import { z } from '@hono/zod-openapi';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { createInterface } from 'node:readline';
import {
  contractCheckFeedback,
  findGoldenFixtureProblems,
  runContractChecks,
} from './experiment-contract-checks';
import { sampleAgentData, splitModelingTable, type SplitSummary } from './experiment-evaluation';
import { MODELING_TABLE_COLUMNS, type ExperimentPlan } from './experiment-plan';
import {
  chooseProbeOverride,
  PARAMS_REPORT_KEY,
  readReportedParams,
  type VariantParams,
} from './experiment-params';
import { ExperimentProgress, type ExperimentProgressEvent } from './experiment-progress';
import { runExperimentSandbox, type ExperimentSandboxResult } from './experiment-sandbox';
import type { MlRuntime } from './ml-runtime';
import { inspectSandboxOutput } from './sandbox-process';
import { VERIFICATION_CONTRACT_CODE_LANGUAGE } from './verification-contract';

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
  /** Set when a concern is about something the blueprint requires: the user decides, not the code. */
  question: z.string().max(4_000).nullable().default(null),
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
  required: ['verdict', 'summary', 'findings', 'question'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'changes_required'] },
    summary: { type: 'string' },
    question: { type: ['string', 'null'] },
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

type BuildStage = 'prepare' | 'variants' | 'review';

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
  /** Receives every step as it starts and finishes; a private trace is kept when omitted. */
  progress?: ExperimentProgress;
}

export type ExperimentBuildResult =
  | {
      status: 'ready';
      split: { agentDataDir: string; holdoutDir: string; summary: SplitSummary };
      review: ReviewResponse;
      files: Record<string, string>;
      /** Each variant's default parameters, as its code reported them on the smoke run. */
      variantParams: Record<string, VariantParams>;
      events: ExperimentProgressEvent[];
    }
  | { status: 'failed'; stage: BuildStage; reason: string; events: ExperimentProgressEvent[] }
  | {
      /** The builder could not follow the blueprint as written; a person must decide. */
      status: 'needs_decision';
      stage: BuildStage;
      question: string;
      events: ExperimentProgressEvent[];
    };

function describeSplit(summary: SplitSummary): string {
  const percent = (rate: number): string => `${(rate * 100).toFixed(1)}%`;
  return [
    `${summary.rows.toString()} dòng → ${summary.trainRows.toString()} train / ${(summary.validationRows ?? 0).toString()} validation / ${summary.testRows.toString()} kiểm tra`,
    `lớp dương ${percent(summary.trainPositiveRate)} / ${percent(summary.testPositiveRate)}`,
    ...summary.warnings,
  ].join('\n');
}

function describeFiles(notes: string, files: BuilderResponse['files']): string {
  const listed = files.map(
    file => `- ${file.path} (${file.content.split('\n').length.toString()} dòng)`
  );
  return [notes.trim(), '', ...listed].join('\n').trim();
}

function describeReview(review: ReviewResponse): string {
  return [
    review.summary.trim(),
    ...review.findings.map(
      finding =>
        `- [${finding.severity}] ${finding.file ? `${finding.file}: ` : ''}${finding.message}`
    ),
    ...(review.question ? [`Câu hỏi cho bạn: ${review.question}`] : []),
  ]
    .join('\n')
    .trim();
}

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

export async function listProjectFiles(
  projectDir: string,
  prefix = ''
): Promise<Record<string, string>> {
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
- A field counts as known at the prediction moment unless a timestamp in the data shows it was created later. Having no timestamp is not evidence of leakage and is not a reason to ask.
- Never remove or weaken a feature, step or model the blueprint explicitly requires just to satisfy review or sandbox feedback. If feedback conflicts with a blueprint requirement, return no files and ask in \`question\` (name the requirement ID and the conflict).

Language: the user reads your \`notes\`, review \`summary\`, findings and \`question\` in a Vietnamese interface, so write them in Vietnamese (never another language). Keep code, identifiers and code comments in English.

How this works: you cannot run code or open files yourself. The headers and sample rows above are what the data looks like; Anvil runs your code in the sandbox and sends back any error or contract violation for you to fix. So never ask about file access, verification or permission — write the best code you can and let Anvil's run check it. Reasonable implementation choices the blueprint leaves open (e.g. how to aggregate several payments per order) are yours to make; mention them in \`notes\`.`;

/** Answers to the blueprint review. They replace the blueprint text they are about. */
function decisionsBlock(input: ExperimentBuildInput): string {
  const decisions = input.plan.blueprintDecisions ?? [];
  if (decisions.length === 0) return '';
  const lines = decisions.map(decision => {
    const about = decision.requirementId ?? decision.title;
    if (decision.effect === 'keep')
      return `- ${about}: the user chose to keep the blueprint as written, knowing "${decision.title}". Do not raise it again.`;
    return `- ${about}: ${decision.instruction ?? decision.answer}`;
  });
  return `\n## User decisions about this blueprint\nThe user already decided these. They override the blueprint text they concern; follow them and do not ask about them again.\n${lines.join('\n')}\n`;
}

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
${decisionsBlock(input)}${Object.keys(files).length > 0 ? `\n## Current files\n${filesBlock(files)}` : ''}
${feedback ? `\n## Fix this problem from the last run\n${feedback}` : ''}

If the blueprint has an \`${VERIFICATION_CONTRACT_CODE_LANGUAGE}\` block, Anvil also runs prepare_data.py on its golden tables as /work/data (same file names and columns as the raw data) and compares \`${MODELING_TABLE_COLUMNS.id}\` and \`${MODELING_TABLE_COLUMNS.target}\` exactly. Implement the rule generally: never detect or special-case the fixture.

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
\`python train_variant.py --variant <id> [--params '<json object>']\`

Variants to support:
${variantList(input.plan, input.variantIds)}

Data (read-only):
- /work/data/train.csv — training rows with the \`${MODELING_TABLE_COLUMNS.target}\` column.
- /work/data/validation_features.csv — validation rows WITHOUT the target, used by Anvil to compare parameter choices.
- /work/data/test_features.csv — held-out rows WITHOUT the target. Labels are hidden from you; do not try to recover them.

Each run must write:
- /work/out/predictions/<id>.csv with columns \`id,score,label\`: \`id\` = ${MODELING_TABLE_COLUMNS.id} of every test row exactly once, \`score\` = predicted probability of class 1 in [0, 1], \`label\` = 0/1 decision.
- /work/out/validation_predictions/<id>.csv in the same format, one row per validation row.
- /work/out/reported/<id>.json with your training-side numbers (e.g. cross-validation ${protocol?.primaryMetric ?? 'metrics'} per fold, train_seconds) and a \`${PARAMS_REPORT_KEY}\` object. These numbers are informational; Anvil computes the official validation and test metrics itself.

Parameters: keep each variant's training and model hyper-parameters in one flat dict of defaults (number, string, boolean or null values; for example n_estimators, max_depth, learning_rate, cv_folds).
- \`--params\` is a JSON object of overrides for this run. Apply every override to the code that really trains the model. Exit with a non-zero status naming the parameter if an override is not a parameter of this variant; never ignore it.
- \`${PARAMS_REPORT_KEY}\` must hold the complete dict actually used for this run, overrides included. Leave out values computed from the data unless overriding them works the same way.
- Do not fold seeds of Anvil's split, feature choices or the target into this dict.
Fit and tune only on train.csv${protocol?.split.kind === 'time_holdout' ? ` using time-ordered cross-validation on \`${MODELING_TABLE_COLUMNS.time}\`` : ''}. Never fit anything on test_features.csv except producing predictions. Exclude \`${MODELING_TABLE_COLUMNS.id}\`${protocol?.split.kind === 'time_holdout' ? ` and \`${MODELING_TABLE_COLUMNS.time}\`` : ''} from the model features.

${SANDBOX_RULES}

## Agent data (header and first rows)
${agentData}

## Blueprint
${input.blueprint}
${decisionsBlock(input)}
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
- Data leakage (target or future information in features, fitting preprocessing on validation or test rows, using validation or test rows for tuning).
- A parameter reported under \`${PARAMS_REPORT_KEY}\` that does not reach the model or training step it names, or an override that is silently ignored. A null value that means "compute this automatically" is not an ignored override.
- Target definition that does not match the blueprint.
- A requested variant missing or implemented as a different algorithm.
- (The output contract — files, columns, row counts — was already checked by running the code in the sandbox; do not report it.)
- Anything that would make results non-reproducible (missing seeds) or exceed the sandbox limits.
- Degenerate data: a target that is (almost) constant in train or test, so models cannot learn or be evaluated meaningfully. Check the split statistics below.
- Code that hides failures (e.g. returning constant predictions when training data is unusable).
Use WARNING for deviations that do not invalidate results. Verdict \`pass\` only when there is no blocking finding.

Evaluation contract fixed by Anvil (do NOT ask the code to change it):
- Anvil splits the modeling table and keeps the validation and held-out test labels; the code never sees them.
- Anvil computes every official validation and test metric (ROC-AUC, PR-AUC, F1, recall, …) from the prediction files. Code must only produce predictions and may report training/cross-validation numbers.
- Blueprint sentences such as "report metrics on the test set" are satisfied by Anvil's evaluation.
Only flag leakage with concrete evidence (a specific column or step that uses information created after the label).
A feature computed, blanked or filtered by comparing against a value created with or after the label (for example the review date) leaks through that comparison, including through which rows are blank. This concerns features only: using such a value to define the target as the blueprint says (for example to pick which review gives the label) is not leakage. When the blueprint itself requires that comparison for a feature, it is never a blocking finding: ask in \`question\`.
Every blocking finding must name the concrete line, column or step that is wrong; if you cannot point to one, it is not a finding. Never list something you conclude is fine: leave it out, and leave out anything the user decisions above settle.
Never block on something the blueprint explicitly requires (a listed feature, target rule or model). If you believe a blueprint requirement itself is risky (for example a required feature that may leak), do not report it as blocking: put one short question for the user in \`question\` naming the requirement ID, the risk and the options — the user decides on blueprint changes, not the code. Otherwise set \`question\` to null. Order-time attributes such as prices, freight, payment type, installments or product attributes are known at purchase time. A field with no timestamp showing it was created later is not a leak.

${decisionsBlock(input)}
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

/** Reads the pinned data mount and writes the output mount, as every generated script must. */
const SANDBOX_CHECK_SCRIPT = `import os
names = os.listdir('/work/data')
assert names, 'the pinned data mount is empty'
with open('/work/out/check.txt', 'w') as handle:
    handle.write(','.join(sorted(names)))
`;

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
  const progress = input.progress ?? new ExperimentProgress();
  const events = progress.events;
  if (input.plan.protocol === null) throw new Error('Experiment plan has no evaluation protocol');
  const protocol = input.plan.protocol;
  const unknown = input.variantIds.filter(id => !input.plan.variants.some(item => item.id === id));
  if (input.variantIds.length === 0 || unknown.length > 0)
    throw new Error(`Approved variants are empty or unknown: ${unknown.join(', ')}`);
  await mkdir(input.projectDir, { recursive: true });
  const rawData = await describeCsvFolder(input.rawDataDir);

  class BuilderHasNoChanges extends Error {
    constructor() {
      super('Builder returned no files and no question');
    }
  }

  class NeedsDecision extends Error {
    constructor(
      readonly stage: BuildStage,
      readonly question: string
    ) {
      super(question);
    }
  }
  /** One builder call as a traced step: the notes and written files are its outcome. */
  const buildRound = async (
    stage: 'prepare' | 'variants',
    round: number,
    prompt: string
  ): Promise<void> => {
    const finish = progress.start({ stage, action: 'generate', round });
    try {
      const response = (await generate('builder', prompt)) as BuilderResponse;
      await writeGeneratedFiles(input.projectDir, response.files);
      finish('passed', describeFiles(response.notes, response.files));
    } catch (error) {
      finish(
        error instanceof NeedsDecision ? 'passed' : 'failed',
        error instanceof NeedsDecision
          ? 'Agent trả về câu hỏi thay vì viết code.'
          : error instanceof Error
            ? error.message
            : String(error)
      );
      throw error;
    }
  };
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
    if (response.files.length === 0) throw new BuilderHasNoChanges();
    return response;
  };

  // A sandbox that cannot run at all (no systemd manager, unwritable output) is an environment
  // problem, not a code bug: stop before the first builder call instead of spending fix rounds.
  const checkSandbox = async (): Promise<void> => {
    const checkDir = join(input.workDir, 'sandbox-check');
    const projectDir = join(checkDir, 'project');
    await rm(checkDir, { recursive: true, force: true });
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'check.py'), SANDBOX_CHECK_SCRIPT);
    const finish = progress.start({ stage: 'prepare', action: 'sandbox_check' });
    let failure: string | null;
    try {
      failure = await runChecked(() =>
        runExperimentSandbox({
          profile: 'check',
          runtime: input.runtime,
          projectDir,
          dataDir: input.rawDataDir,
          outputDir: join(checkDir, 'out'),
          script: 'check.py',
          timeoutMs: 60_000,
          signal: input.signal,
        })
      );
    } catch (error) {
      finish('failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
    if (failure !== null) {
      finish('failed', failure);
      throw new Error(
        `Sandbox không chạy được trên máy này nên Anvil dừng trước khi gọi agent. Kiểm tra systemd, bubblewrap và quyền thư mục ANVIL_HOME rồi chạy lại.\n${failure}`
      );
    }
    finish('passed', 'Sandbox đọc được dữ liệu đã ghim và ghi được thư mục kết quả.');
  };
  await checkSandbox();
  const contract = input.plan.verificationContract;
  if (contract) {
    // A fixture that does not look like the pinned data is a contract defect, not a code bug.
    const problems = await findGoldenFixtureProblems(contract, input.rawDataDir);
    if (problems.length > 0)
      throw new Error(
        `Hợp đồng kiểm chứng không khớp dữ liệu đã ghim nên Anvil dừng trước khi gọi agent; cần sửa blueprint:\n${problems.join('\n')}`
      );
  }
  /**
   * Runs the approved checks on the current code. Returns builder feedback, or null when nothing
   * failed. An environment problem stops the build: no code change could fix it.
   */
  const checkContract = async (stage: BuildStage, round: number): Promise<string | null> => {
    if (!contract) return null;
    const finish = progress.start({ stage, action: 'contract_check', round });
    try {
      const results = await runContractChecks({
        contract,
        runtime: input.runtime,
        projectDir: input.projectDir,
        workDir: join(input.workDir, 'contract-checks'),
        signal: input.signal,
      });
      const feedback = contractCheckFeedback(results);
      finish(
        feedback === null ? 'passed' : 'failed',
        feedback ??
          `${results.filter(item => item.status === 'passed').length.toString()} điều kiện đạt trên ca mẫu đã duyệt.`
      );
      return feedback === null ? null : clip(feedback);
    } catch (error) {
      finish('failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  // Stage 1: data preparation until the modeling table satisfies Anvil's split.
  // Closures below update the split; a holder object keeps TypeScript's narrowing honest.
  const state: {
    split: Awaited<ReturnType<typeof splitModelingTable>> | null;
    /** Every file present when the current split was made: the code it could have come from. */
    preparationFiles: Record<string, string>;
    variantParams: Record<string, VariantParams>;
  } = { split: null, preparationFiles: {}, variantParams: {} };
  /**
   * Whether the split may no longer come from the current code. A golden pass cannot answer this:
   * edited data code can agree on the fixture and still produce a different table.
   */
  const preparationChanged = async (): Promise<boolean> => {
    const current = await listProjectFiles(input.projectDir);
    return Object.entries(state.preparationFiles).some(([path, text]) => current[path] !== text);
  };
  const runPrepare = async (round: number): Promise<string | null> => {
    const tag = round.toString();
    // Small fixture first: a wrong rule should not cost a full-data run.
    const contractFailure = await checkContract('prepare', round);
    if (contractFailure !== null) return contractFailure;
    const codeBeforeRun = await listProjectFiles(input.projectDir);
    const outputDir = join(input.workDir, `prepare-${tag}`);
    await rm(outputDir, { recursive: true, force: true });
    const finishRun = progress.start({ stage: 'prepare', action: 'prepare_data', round });
    let failure: string | null;
    try {
      failure = await runChecked(() =>
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
    } catch (error) {
      finishRun('failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
    if (failure !== null) {
      finishRun('failed', failure);
      return failure;
    }
    finishRun('passed');
    const finishSplit = progress.start({ stage: 'prepare', action: 'split', round });
    try {
      state.split = await splitModelingTable({
        runtime: input.runtime,
        tablePath: join(outputDir, 'modeling_table.csv'),
        protocol,
        workDir: join(input.workDir, `split-${tag}`),
        signal: input.signal,
      });
      state.preparationFiles = codeBeforeRun;
      finishSplit('passed', describeSplit(state.split.summary));
      return null;
    } catch (error) {
      const message = clip(
        `prepare_data.py ran, but the modeling table is not usable: ${error instanceof Error ? error.message : String(error)}`
      );
      finishSplit('failed', message);
      return message;
    }
  };
  const prepare = async (initialFeedback: string | null): Promise<string | null> => {
    let feedback = initialFeedback;
    for (let round = 1; round <= input.maxFixRounds; round += 1) {
      await buildRound(
        'prepare',
        round,
        preparePrompt(input, rawData, feedback, await listProjectFiles(input.projectDir))
      );
      feedback = await runPrepare(round);
      if (feedback === null) return null;
    }
    return feedback ?? 'Data preparation did not converge';
  };

  // Stage 2: variant code until every variant produces valid predictions on smoke data.
  const smokeVariants = async (round: number): Promise<string | null> => {
    const finish = progress.start({
      stage: 'variants',
      action: 'smoke',
      round,
      detail: `${input.variantIds.length.toString()} phương án · mẫu ${SMOKE_TRAIN_ROWS.toString()} train / ${SMOKE_TEST_ROWS.toString()} kiểm tra`,
    });
    try {
      const failure = await smokeAll();
      finish(
        failure === null ? 'passed' : 'failed',
        failure ??
          `${input.variantIds.length.toString()} phương án chạy được và ghi đủ dự đoán trên mẫu.`
      );
      return failure;
    } catch (error) {
      finish('failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  const smokeAll = async (): Promise<string | null> => {
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
    const rowsOf = async (file: string): Promise<number> =>
      (await readFile(join(smokeData, file), 'utf8')).trim().split('\n').length - 1;
    const expectedRows = await rowsOf('test_features.csv');
    const expectedValidationRows = await rowsOf('validation_features.csv');
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
      for (const [folder, rowCount] of [
        ['predictions', expectedRows],
        ['validation_predictions', expectedValidationRows],
      ] as const) {
        const state = await inspectSandboxOutput(outputDir, `${folder}/${variant}.csv`);
        if (state === 'missing')
          return `Variant ${variant} wrote no /work/out/${folder}/${variant}.csv`;
        if (state === 'unsafe')
          return `Variant ${variant}: /work/out/${folder}/${variant}.csv must be a regular file, not a link`;
        const predictions = await readFile(join(outputDir, folder, `${variant}.csv`), 'utf8');
        const [header, ...rows] = predictions.trim().split('\n');
        if (header?.replace(/\s/gu, '') !== 'id,score,label' || rows.length !== rowCount)
          return `Variant ${variant} ${folder} must have header id,score,label and ${rowCount.toString()} rows (got header "${header ?? ''}" and ${rows.length.toString()} rows)`;
      }
      const defaults = await readReportedParams(outputDir, variant);
      if (defaults === null || Object.keys(defaults).length === 0)
        return `Variant ${variant} must write a non-empty flat "${PARAMS_REPORT_KEY}" object of number, string, boolean or null values to /work/out/reported/${variant}.json`;
      const paramsFailure = await checkParams(variant, defaults, smokeData);
      if (paramsFailure !== null) return paramsFailure;
      state.variantParams[variant] = defaults;
    }
    return null;
  };
  /** Overrides must take effect and unknown names must fail; a run cannot silently ignore them. */
  const checkParams = async (
    variant: string,
    defaults: VariantParams,
    smokeData: string
  ): Promise<string | null> => {
    const run = (overrides: VariantParams, outputDir: string): Promise<ExperimentSandboxResult> =>
      runExperimentSandbox({
        profile: 'experiment',
        runtime: input.runtime,
        projectDir: input.projectDir,
        dataDir: smokeData,
        outputDir,
        script: 'train_variant.py',
        args: ['--variant', variant, '--params', JSON.stringify(overrides)],
        timeoutMs: 5 * 60_000,
        signal: input.signal,
      });
    const rejected = await run(
      { anvil_unknown_parameter: 1 },
      join(input.workDir, 'smoke-params', `${variant}-unknown`)
    );
    if (rejected.exitCode === 0)
      return `Variant ${variant} accepted the unknown parameter "anvil_unknown_parameter" passed with --params; it must exit with a non-zero status`;
    const probe = chooseProbeOverride(defaults);
    if (probe === null) return null;
    const outputDir = join(input.workDir, 'smoke-params', `${variant}-probe`);
    const failure = await runChecked(() => run(probe, outputDir));
    if (failure !== null)
      return `Variant ${variant} failed with --params '${JSON.stringify(probe)}':\n${failure}`;
    const reported = await readReportedParams(outputDir, variant);
    const [name, value] = Object.entries(probe)[0] ?? [];
    if (name === undefined || reported?.[name] !== value)
      return `Variant ${variant} was run with --params '${JSON.stringify(probe)}' but reported ${JSON.stringify(reported)} under "${PARAMS_REPORT_KEY}"; report the values actually used`;
    return null;
  };
  const variants = async (initialFeedback: string | null): Promise<string | null> => {
    let feedback = initialFeedback;
    const agentData = state.split === null ? '' : await describeCsvFolder(state.split.agentDataDir);
    for (let round = 1; round <= input.maxFixRounds; round += 1) {
      await buildRound(
        'variants',
        round,
        variantsPrompt(input, agentData, feedback, await listProjectFiles(input.projectDir))
      );
      feedback = await smokeVariants(round);
      if (feedback === null) return null;
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
    let builderDisagrees = false;
    for (let round = 1; ; round += 1) {
      const files = await listProjectFiles(input.projectDir);
      const review = await progress.track(
        { stage: 'review', action: 'review', round },
        async () =>
          (await generate(
            'reviewer',
            reviewPrompt(
              input,
              files,
              `Data preparation produced a modeling table that Anvil split as: ${JSON.stringify(state.split?.summary ?? null)}. Every variant produced valid predictions on a stratified sample.`
            )
          )) as ReviewResponse,
        value => ({
          status:
            value.verdict === 'pass' &&
            value.findings.every(finding => finding.severity !== 'blocking')
              ? 'passed'
              : 'failed',
          detail: describeReview(value),
        })
      );
      // A concern about a blueprint requirement is the user's call; fixing it in code would just
      // trade one requirement for another (seen live: a required delivery feature removed, then
      // re-added on the next review).
      if (review.question !== null && review.question.trim().length > 0)
        throw new NeedsDecision('review', review.question.trim());
      const blocking = review.findings.filter(finding => finding.severity === 'blocking');
      // With a separate run step, unresolved findings go to the person who chooses whether to
      // run (the code already passed its smoke test); otherwise the build stops here.
      if (
        (review.verdict === 'pass' && blocking.length === 0) ||
        ((round > input.maxReviewRounds || builderDisagrees) &&
          input.reportUnresolvedReview === true)
      ) {
        if (state.split === null) throw new Error('Split missing after a successful build');
        // Variant or review fixes may have touched data code since the last check.
        const contractFailure = await checkContract('review', round);
        const stale = contractFailure === null && (await preparationChanged());
        if (contractFailure === null && !stale)
          return {
            status: 'ready',
            split: state.split,
            review,
            files,
            variantParams: state.variantParams,
            events,
          };
        // One extra pass lets a stale split be rebuilt after the last review round.
        if (round > input.maxReviewRounds + (stale ? 1 : 0))
          return {
            status: 'failed',
            stage: 'prepare',
            reason:
              contractFailure ??
              'Data preparation code kept changing after its split was made; the split cannot be tied to the final code.',
            events,
          };
        // Rebuilding a stale split needs no builder call unless the rebuild itself fails.
        const rebuildFailure = stale ? await runPrepare(round) : contractFailure;
        const prepareFailure = rebuildFailure === null ? null : await prepare(rebuildFailure);
        if (prepareFailure !== null)
          return { status: 'failed', stage: 'prepare', reason: prepareFailure, events };
        const smokeFailure = await smokeVariants(0);
        if (smokeFailure !== null) {
          const fixFailure = await variants(smokeFailure);
          if (fixFailure !== null)
            return { status: 'failed', stage: 'variants', reason: fixFailure, events };
        }
        continue;
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
      try {
        if (preparationFindings.length > 0) {
          const prepareFailure = await prepare(describe(preparationFindings));
          if (prepareFailure !== null)
            return { status: 'failed', stage: 'prepare', reason: prepareFailure, events };
        }
        // Round 0: a re-check after data preparation changed, not a builder fix round.
        const smokeFailure = variantFindings.length > 0 ? null : await smokeVariants(0);
        if (variantFindings.length > 0 || smokeFailure !== null) {
          const fixFailure = await variants(
            variantFindings.length > 0 ? describe(variantFindings) : smokeFailure
          );
          if (fixFailure !== null)
            return { status: 'failed', stage: 'variants', reason: fixFailure, events };
        }
      } catch (error) {
        // The code already works; a builder with nothing to change means the reviewer and the
        // builder disagree, and that goes to the person choosing whether to run.
        if (!(error instanceof BuilderHasNoChanges) || input.reportUnresolvedReview !== true)
          throw error;
        builderDisagrees = true;
      }
    }
  } catch (error) {
    if (error instanceof NeedsDecision) {
      // The builder asks while writing code (prepare, variants); the reviewer asks at review.
      progress.start({
        stage: error.stage,
        action: 'question',
        detail: error.question,
      })('failed');
      return { status: 'needs_decision', stage: error.stage, question: error.question, events };
    }
    throw error;
  }
}
