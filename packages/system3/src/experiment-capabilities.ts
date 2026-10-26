import { z } from '@hono/zod-openapi';
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import {
  buildExperimentCodebase,
  hashProjectFiles,
  type ExperimentGenerate,
} from './experiment-builder';
import { experimentConfigSchema } from './experiment-config';
import {
  evaluateExperimentPredictions,
  experimentEvaluationSchema,
  experimentMetricSchema,
  rankExperimentVariants,
  splitSummarySchema,
  type ExperimentEvaluation,
} from './experiment-evaluation';
import { experimentPlanSchema } from './experiment-plan';
import { reviewResponseSchema } from './experiment-builder';
import { runExperimentVariants } from './experiment-runner';
import { ML_RUNTIME_LOCK_PATH, resolveMlRuntime } from './ml-runtime';
import type { PinnedUnderstandingSource } from './understanding';

/**
 * Workflow actions for experiment mode (plan 13): TW-06 build + run + package and TW-07
 * independent re-scoring. Inputs are pinned by the approved plan; nothing reads "latest" sources.
 */

export interface ExperimentCapabilityContext {
  runId: string;
  artifactsDir: string;
  signal: AbortSignal;
}

export interface ExperimentCapabilityPort {
  readSourceVersion(
    projectId: string,
    sourceVersionId: string
  ): Promise<PinnedUnderstandingSource | null>;
  generateStructured(input: {
    projectId: string;
    model: string;
    prompt: string;
    schema: Record<string, unknown>;
    maxResponseBytes: number;
    signal: AbortSignal;
  }): Promise<unknown>;
}

const pinnedSourceSchema = z.object({
  id: z.string().min(1),
  contentHash: z.string().startsWith('sha256:'),
});

export const experimentExecuteInputSchema = z.object({
  projectId: z.string().uuid(),
  config: experimentConfigSchema,
  plan: experimentPlanSchema,
  variantIds: z.array(z.string().min(1)).min(1),
  blueprintSource: pinnedSourceSchema,
  datasetSources: z.array(pinnedSourceSchema).min(1),
});

export const experimentVerifyInputSchema = z.object({
  projectDir: z.string().min(1),
  experiment: z.object({
    kind: z.literal('experiment'),
    evaluation: experimentEvaluationSchema,
    variantIds: z.array(z.string().min(1)).min(1),
  }),
});

/** What the results page shows; stored in the verification evidence map (kind `experiment`). */
export const experimentEvidenceViewSchema = z.object({
  kind: z.literal('experiment'),
  primaryMetric: experimentMetricSchema,
  variants: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.enum(['baseline', 'candidate']),
      recommended: z.boolean(),
      status: z.enum(['verified', 'missing', 'invalid_predictions']),
      metrics: z.record(z.string(), z.number()).nullable(),
      error: z.string().nullable(),
      runStatus: z.enum(['completed', 'failed', 'resource_limit']).nullable(),
      durationMs: z.number().nullable(),
    })
  ),
  suggestion: z.object({
    suggested: z.string().nullable(),
    reasons: z.array(z.string()),
    fasterAlternatives: z.array(z.string()),
    thresholds: z.record(z.string(), z.number()).nullable(),
  }),
  review: z.object({
    verdict: z.enum(['pass', 'changes_required']),
    summary: z.string(),
    findings: z.array(
      z.object({
        severity: z.enum(['blocking', 'warning']),
        file: z.string().nullable(),
        message: z.string(),
      })
    ),
  }),
  split: z.object({
    rows: z.number(),
    trainRows: z.number(),
    testRows: z.number(),
    trainPositiveRate: z.number(),
    testPositiveRate: z.number(),
    warnings: z.array(z.string()),
  }),
  agents: z.object({ builder: z.string(), reviewer: z.string() }),
  mismatches: z.array(z.string()),
});
export type ExperimentEvidenceView = z.infer<typeof experimentEvidenceViewSchema>;

const runRecordSchema = z.object({
  variant: z.string(),
  status: z.enum(['completed', 'failed', 'resource_limit']),
  durationMs: z.number(),
});

async function confined(path: string, root: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const candidate = await realpath(path);
  const rel = relative(canonicalRoot, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(canonicalRoot, rel) !== candidate)
    throw new Error('Experiment artifact escaped its run root');
  return candidate;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function materializeSource(
  port: ExperimentCapabilityPort,
  projectId: string,
  pinned: z.infer<typeof pinnedSourceSchema>,
  dir: string
): Promise<PinnedUnderstandingSource> {
  const source = await port.readSourceVersion(projectId, pinned.id);
  if (!source) throw new Error(`Pinned Source Version '${pinned.id}' does not exist`);
  if (source.contentHash !== pinned.contentHash)
    throw new Error(`Pinned Source Version '${pinned.id}' hash does not match the approved plan`);
  const name = basename(source.filename);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/u.test(name))
    throw new Error(`Source filename '${source.filename}' is not a safe data file name`);
  await writeFile(join(dir, name), source.bytes, { flag: 'wx' });
  return source;
}

const REPRODUCE_SH = `#!/bin/sh
# Re-run one experiment variant offline with the locked runtime (see REPRODUCING.md).
# Usage: sh reproduce.sh <variant-id> <python-of-locked-venv>
set -eu
variant="$1"; python="$2"
here=$(cd "$(dirname "$0")" && pwd)
out=$(mktemp -d)
bwrap --die-with-parent --unshare-all --ro-bind / / \\
  --ro-bind "$here/code" /work/project --ro-bind "$here/data/agent" /work/data \\
  --bind "$out" /work/out --chdir /work/project \\
  "$python" -I -B train_variant.py --variant "$variant"
echo "$out/predictions/$variant.csv"
`;

const REPRODUCING_MD = `# Reproducing these experiments

Layout: \`code/\` is the generated codebase (data preparation + one script per variant run),
\`data/agent/\` is exactly what variant code saw (training rows and test features without labels),
\`data/holdout/\` holds the held-out labels Anvil used to score predictions, and \`results/\` holds
predictions, Anvil's evaluation, the review report and the build log.

1. Create the runtime: \`uv venv --python python3.12 venv && uv pip sync --python venv/bin/python --require-hashes runtime/requirements-ml.lock\`.
2. Re-run a variant: \`sh reproduce.sh <variant-id> $(pwd)/venv/bin/python\` (Linux with bubblewrap; no network, no provider call).
3. Compare the new predictions with \`results/predictions/<variant-id>.csv\`; official metrics are in \`results/evaluation.json\`.

The modeling table can be rebuilt from the original raw files with \`code/prepare_data.py\` (raw data mounted at /work/data, output in /work/out).
`;

/** TW-06: build the codebase with the builder/reviewer models, run every variant, score, package. */
export async function executeExperiment(
  raw: Readonly<Record<string, unknown>>,
  context: ExperimentCapabilityContext,
  port: ExperimentCapabilityPort
): Promise<{
  projectDir: string;
  testResult: Record<string, unknown>;
  dataResult: Record<string, unknown>;
  experiment: Record<string, unknown>;
}> {
  const input = experimentExecuteInputSchema.parse(raw);
  const protocol = input.plan.protocol;
  if (protocol === null) throw new Error('Approved experiment plan has no evaluation protocol');
  const root = join(context.artifactsDir, 'experiment');
  const rawDir = join(root, 'raw');
  await mkdir(rawDir, { recursive: true });
  const blueprint = await materializeSource(port, input.projectId, input.blueprintSource, root);
  for (const source of input.datasetSources)
    await materializeSource(port, input.projectId, source, rawDir);
  const runtime = await resolveMlRuntime();

  const generate: ExperimentGenerate = ({ role, prompt, schema, signal }) =>
    port.generateStructured({
      projectId: input.projectId,
      model: role === 'builder' ? input.config.builderModel : input.config.reviewerModel,
      prompt,
      schema: schema as unknown as Record<string, unknown>,
      maxResponseBytes: 900 * 1024,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]),
    });
  const projectDir = join(root, 'project');
  const build = await buildExperimentCodebase({
    blueprint: new TextDecoder().decode(blueprint.bytes),
    plan: input.plan,
    variantIds: input.variantIds,
    rawDataDir: rawDir,
    projectDir,
    workDir: join(root, 'build'),
    runtime,
    generate,
    maxFixRounds: input.config.maxFixRounds,
    maxReviewRounds: input.config.maxReviewRounds,
    signal: context.signal,
  });
  await writeJson(join(root, 'build.json'), build);
  if (build.status === 'needs_decision')
    throw new Error(
      `Cần bạn quyết định trước khi tiếp tục (${build.stage}): ${build.question.slice(0, 2_000)}`
    );
  if (build.status !== 'ready')
    throw new Error(`Experiment build stopped at ${build.stage}: ${build.reason.slice(0, 2_000)}`);

  const run = await runExperimentVariants({
    runtime,
    projectDir,
    agentDataDir: build.split.agentDataDir,
    holdoutDir: build.split.holdoutDir,
    protocol,
    variantIds: input.variantIds,
    workDir: join(root, 'runs'),
    timeoutMs: input.config.variantTimeoutMinutes * 60_000,
    signal: context.signal,
  });

  // Self-contained package: verification and delivery only ever read this immutable folder.
  const packageDir = join(root, 'package', 'generated_project');
  await mkdir(join(packageDir, 'results'), { recursive: true });
  await Promise.all([
    cp(projectDir, join(packageDir, 'code'), { recursive: true }),
    cp(build.split.agentDataDir, join(packageDir, 'data', 'agent'), { recursive: true }),
    cp(build.split.holdoutDir, join(packageDir, 'data', 'holdout'), { recursive: true }),
    cp(join(root, 'runs', 'collected'), join(packageDir, 'results'), { recursive: true }),
    mkdir(join(packageDir, 'runtime'), { recursive: true }),
  ]);
  const codeHash = hashProjectFiles(build.files);
  const experiment = {
    status: run.suggestion.ranking.length > 0 ? 'passed' : 'failed',
    kind: 'experiment',
    variantIds: input.variantIds,
    primaryMetric: protocol.primaryMetric,
    evaluation: run.evaluation,
    suggestion: run.suggestion,
    runs: run.runs,
    review: build.review,
    codeHash,
    runtimeLockHash: runtime.lockHash,
    builderModel: input.config.builderModel,
    reviewerModel: input.config.reviewerModel,
  };
  const testResult = {
    exitCode: run.runs.some(item => item.status === 'completed') ? 0 : 1,
    kind: 'experiment',
  };
  const dataResult = { status: 'passed', split: build.split.summary, protocol };
  await Promise.all([
    writeJson(join(packageDir, 'results', 'evaluation.json'), run.evaluation),
    writeJson(join(packageDir, 'results', 'suggestion.json'), run.suggestion),
    writeJson(join(packageDir, 'results', 'runs.json'), run.runs),
    writeJson(join(packageDir, 'results', 'review.json'), build.review),
    writeJson(join(packageDir, 'results', 'build-events.json'), build.events),
    writeJson(join(packageDir, 'results', 'split.json'), build.split.summary),
    writeJson(join(packageDir, 'results', 'plan.json'), {
      plan: input.plan,
      protocol,
      config: input.config,
    }),
    writeFile(
      join(packageDir, 'runtime', 'requirements-ml.lock'),
      await readFile(ML_RUNTIME_LOCK_PATH)
    ),
    writeFile(join(packageDir, 'reproduce.sh'), REPRODUCE_SH),
    writeFile(join(packageDir, 'REPRODUCING.md'), REPRODUCING_MD),
    mkdir(join(packageDir, 'reports'), { recursive: true }),
  ]);
  // Same report files the baseline pipeline writes, so existing persistence keeps working.
  await Promise.all([
    writeJson(join(packageDir, 'reports', 'test-results.json'), testResult),
    writeJson(join(packageDir, 'reports', 'data_run.json'), dataResult),
    writeJson(join(packageDir, 'reports', 'experiment_results.json'), experiment),
  ]);
  return { projectDir: packageDir, testResult, dataResult, experiment };
}

function sameMetrics(left: ExperimentEvaluation, right: ExperimentEvaluation): string[] {
  const problems: string[] = [];
  for (const [variant, recorded] of Object.entries(left.variants)) {
    const again = right.variants[variant];
    if (again?.status !== recorded.status) {
      problems.push(`${variant}: status ${recorded.status} vs ${again?.status ?? 'missing'}`);
      continue;
    }
    if (recorded.status !== 'verified' || again.status !== 'verified') continue;
    for (const [metric, value] of Object.entries(recorded.metrics)) {
      const other = again.metrics[metric as keyof typeof again.metrics];
      if (other === undefined || Math.abs(other - value) > 1e-9)
        problems.push(`${variant}.${metric}: ${String(value)} vs ${String(other)}`);
    }
  }
  return problems;
}

/** TW-07: re-score the packaged predictions independently and build the evidence map. */
export async function verifyExperiment(
  raw: Readonly<Record<string, unknown>>,
  context: ExperimentCapabilityContext
): Promise<{ evidenceMap: Record<string, unknown> }> {
  const input = experimentVerifyInputSchema.parse(raw);
  const packageDir = await confined(input.projectDir, resolve(context.artifactsDir, '../../..'));
  const runtime = await resolveMlRuntime();
  const evaluation = await evaluateExperimentPredictions({
    runtime,
    variants: input.experiment.variantIds,
    holdoutDir: join(packageDir, 'data', 'holdout'),
    predictionsDir: join(packageDir, 'results', 'predictions'),
    reportedDir: join(packageDir, 'results', 'reported'),
    workDir: join(context.artifactsDir, 'verification', 'experiment'),
    signal: context.signal,
  });
  const mismatches = sameMetrics(input.experiment.evaluation, evaluation);
  const readJson = async (name: string): Promise<unknown> =>
    JSON.parse(await readFile(join(packageDir, 'results', name), 'utf8')) as unknown;
  const split = splitSummarySchema.parse(await readJson('split.json'));
  const runs = z.array(runRecordSchema).parse(await readJson('runs.json'));
  const review = reviewResponseSchema.parse(await readJson('review.json'));
  const pinned = z
    .object({
      plan: experimentPlanSchema,
      config: z.object({ builderModel: z.string(), reviewerModel: z.string() }),
    })
    .parse(await readJson('plan.json'));
  const protocol = pinned.plan.protocol;
  if (protocol === null) throw new Error('Packaged experiment plan has no protocol');
  // The suggestion is recomputed from the independent re-scoring, not copied from the run.
  const suggestion = rankExperimentVariants({
    protocol,
    evaluation,
    durations: Object.fromEntries(runs.map(run => [run.variant, run.durationMs])),
  });
  const verifiedVariants = Object.values(evaluation.variants).filter(
    item => item.status === 'verified'
  ).length;
  const passed = mismatches.length === 0 && verifiedVariants > 0;
  const view: ExperimentEvidenceView = experimentEvidenceViewSchema.parse({
    kind: 'experiment',
    primaryMetric: protocol.primaryMetric,
    variants: input.experiment.variantIds.map(id => {
      const variant = pinned.plan.variants.find(item => item.id === id);
      const result = evaluation.variants[id];
      const run = runs.find(item => item.variant === id);
      return {
        id,
        name: variant?.name ?? id,
        role: variant?.role ?? 'candidate',
        recommended: variant?.recommended ?? false,
        status: result?.status ?? 'missing',
        metrics: result?.status === 'verified' ? result.metrics : null,
        error: result && result.status !== 'verified' ? result.error : null,
        runStatus: run?.status ?? null,
        durationMs: run?.durationMs ?? null,
      };
    }),
    suggestion: {
      suggested: suggestion.suggested,
      reasons: suggestion.reasons,
      fasterAlternatives: suggestion.fasterAlternatives,
      thresholds: protocol.thresholds ?? null,
    },
    review,
    split,
    agents: { builder: pinned.config.builderModel, reviewer: pinned.config.reviewerModel },
    mismatches,
  });
  const evidenceMap = {
    schemaVersion: 1,
    ...view,
    status: passed ? 'passed' : 'failed',
    executionStatus: passed ? 'passed' : 'failed',
    requirementCoverage: { status: 'not_verified', verified: 0, total: 0 },
    verifiedVariants,
  };
  await mkdir(join(context.artifactsDir, 'verification'), { recursive: true });
  await writeJson(
    join(context.artifactsDir, 'verification', 'experiment-evidence.json'),
    evidenceMap
  );
  return { evidenceMap };
}
