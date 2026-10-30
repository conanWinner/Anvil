import { z } from '@hono/zod-openapi';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import {
  buildExperimentCodebase,
  hashProjectFiles,
  listProjectFiles,
  type ExperimentGenerate,
} from './experiment-builder';
import { experimentConfigSchema } from './experiment-config';
import {
  buildRequirementEvidence,
  CONTRACT_CHECKER_VERSION,
  hashVerificationContract,
  runContractChecks,
  type ContractCheckResult,
} from './experiment-contract-checks';
import {
  evaluateExperimentPredictions,
  experimentEvaluationSchema,
  experimentMetricSchema,
  experimentVariantIdSchema,
  rankExperimentVariants,
  splitSummarySchema,
  type ExperimentEvaluation,
} from './experiment-evaluation';
import {
  findOverrideProblems,
  variantParamOverridesSchema,
  variantParamsSchema,
  variantTrialSchema,
  type VariantParamOverrides,
  type VariantParams,
  type VariantTrial,
} from './experiment-params';
import { experimentPlanSchema, hashExperimentPlan } from './experiment-plan';
import { ExperimentProgress, type ExperimentProgressEvent } from './experiment-progress';
import { reviewResponseSchema } from './experiment-builder';
import {
  runExperimentVariants,
  tuneExperimentVariants,
  type CarriedVariantResults,
} from './experiment-runner';
import { experimentHostSlots } from './experiment-sandbox';
import { ML_RUNTIME_LOCK_PATH, resolveMlRuntime } from './ml-runtime';
import { extractProjectArchive } from './project-archive';
import type { PinnedUnderstandingSource } from './understanding';
import { understandingSourcePointerSchema } from './understanding/schemas';
import { verificationContractSchema, type VerificationContract } from './verification-contract';

/**
 * Workflow actions for experiment mode (plan 13): TW-06 build + run + package and TW-07
 * independent re-scoring. Inputs are pinned by the approved plan; nothing reads "latest" sources.
 */

/** Vietnamese names of the build stages, as the run trace shows them. */
const BUILD_STAGE_LABELS = {
  prepare: 'chuẩn bị dữ liệu',
  variants: 'code phương án',
  review: 'review code',
} as const;

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
  readArtifact(projectId: string, storageKey: string): Promise<Uint8Array>;
  /**
   * Stores one trace event for the workflow run as it happens. Must not throw: the trace is for
   * people watching the run, and a failed write must not fail the experiment.
   */
  recordProgress?(runId: string, event: ExperimentProgressEvent): void;
}

const pinnedSourceSchema = z.object({
  id: z.string().min(1),
  contentHash: z.string().startsWith('sha256:'),
});

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const artifactRefSchema = z.object({
  executionId: z.string().uuid(),
  storageKey: z.string().min(1),
  contentHash: sha256Schema,
});

/**
 * Runtime choice bound into the approved TW-06 bundle (plan 13 §10). `build` writes and checks the
 * code only; `tune` tries parameters and scores them on the validation set only; `run` runs a subset
 * of the approved variants from a build package and opens the test score. None can change the plan,
 * data or agents — those still need a new approval.
 */
export const experimentRunSchema = z.discriminatedUnion('stage', [
  z.object({ stage: z.literal('build') }),
  z.object({
    stage: z.literal('tune'),
    buildArtifact: artifactRefSchema,
    variantIds: z.array(experimentVariantIdSchema).min(1).max(12),
    parallelism: z.number().int().min(1).max(16),
    variantParams: variantParamOverridesSchema,
  }),
  z.object({
    stage: z.literal('run'),
    buildArtifact: artifactRefSchema,
    variantIds: z.array(experimentVariantIdSchema).min(1).max(12),
    parallelism: z.number().int().min(1).max(16),
    /** An earlier run of the same build whose results are kept for variants not run again. */
    carryOver: artifactRefSchema.nullable(),
    /** Absent when every variant keeps its defaults. */
    variantParams: variantParamOverridesSchema.optional(),
  }),
]);
export type ExperimentRun = z.infer<typeof experimentRunSchema>;

export const experimentExecuteInputSchema = z.object({
  projectId: z.string().uuid(),
  config: experimentConfigSchema,
  plan: experimentPlanSchema,
  variantIds: z.array(z.string().min(1)).min(1),
  blueprintSource: pinnedSourceSchema,
  datasetSources: z.array(pinnedSourceSchema).min(1),
  /** Absent in bundles approved before the build/run split. */
  run: experimentRunSchema.optional(),
});

export const experimentVerifyInputSchema = z.object({
  projectDir: z.string().min(1),
  experiment: z.object({
    kind: z.literal('experiment'),
    evaluation: experimentEvaluationSchema,
    /** Absent for builds made before Anvil kept a validation set. */
    validation: experimentEvaluationSchema.nullable().optional(),
    variantIds: z.array(z.string().min(1)).min(1),
  }),
  /** Absent in bundles approved before plan 16: their denominator is unknown, not zero. */
  requirements: z
    .array(
      z.object({
        id: z.string(),
        acceptanceCriterion: z.string(),
        sourcePointers: z.array(understandingSourcePointerSchema),
      })
    )
    .optional(),
  verificationContract: verificationContractSchema.optional(),
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
      /** Parameters the run reported using; absent on results recorded before they were kept. */
      params: variantParamsSchema.nullable().optional(),
      validationMetrics: z.record(z.string(), z.number()).nullable().optional(),
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
    validationRows: z.number().optional(),
    testRows: z.number(),
    trainPositiveRate: z.number(),
    testPositiveRate: z.number(),
    warnings: z.array(z.string()),
  }),
  agents: z.object({ builder: z.string(), reviewer: z.string() }),
  mismatches: z.array(z.string()),
  /** Parameter settings tried on the validation set before the test score was opened. */
  tuningTrials: z.number().int().nonnegative().optional(),
});
export type ExperimentEvidenceView = z.infer<typeof experimentEvidenceViewSchema>;

const runRecordSchema = z.object({
  variant: z.string(),
  status: z.enum(['completed', 'failed', 'resource_limit']),
  durationMs: z.number(),
  params: variantParamsSchema.nullable().optional(),
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

/**
 * Mirrors the `experiment` profile of `experiment-sandbox.ts`: variant code sees only `/usr`, the
 * locked venv, the code (read-only), the data it saw during the run (read-only) and one output
 * directory. No home directory, no `data/holdout`, no host environment, no network.
 */
export const REPRODUCE_SH = `#!/bin/sh
# Re-run one experiment variant offline in a sandbox like Anvil's (see REPRODUCING.md).
# Usage: sh reproduce.sh <variant-id> <python-of-locked-venv> [<params-json>]
set -eu
fail() { echo "reproduce.sh: $*" >&2; exit 1; }
[ "$#" -eq 2 ] || [ "$#" -eq 3 ] || fail "usage: sh reproduce.sh <variant-id> <python-of-locked-venv> [<params-json>]"
variant="$1"
params="\${3:-}"
command -v bwrap >/dev/null 2>&1 || fail "bubblewrap (bwrap) is required; variant code is never run unsandboxed"
here=$(cd "$(dirname "$0")" && pwd)
[ -d "$here/code" ] && [ -d "$here/data/agent" ] || fail "run from an unpacked delivery package (code/ and data/agent/ missing)"
venv=$(cd "$(dirname "$2")/.." && pwd) || fail "python path $2 is not inside a venv"
python="$venv/bin/$(basename "$2")"
[ -x "$python" ] || fail "$python is not executable"
# A venv links to its base interpreter; mount that read-only too when it lives outside /usr.
base=$("$python" -I -c 'import sys; print(sys.base_prefix)') || fail "could not start $python"
set -- --ro-bind "$venv" "$venv"
case "$base" in /usr | /usr/*) ;; *) set -- "$@" --ro-bind "$base" "$base" ;; esac
out=$(mktemp -d)
mkdir -p "$out/predictions" "$out/validation_predictions" "$out/reported"
limits=""
if command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope --quiet true >/dev/null 2>&1; then
  limits="systemd-run --user --scope --quiet -p MemoryMax=2G -p MemorySwapMax=0 -p CPUQuota=200% -p TasksMax=64 --"
else
  echo "reproduce.sh: no systemd user manager; running without memory/CPU caps" >&2
fi
# $limits is intentionally unquoted: it is empty or a fixed word list.
# shellcheck disable=SC2086
$limits timeout 1800 bwrap --die-with-parent --new-session --unshare-all --clearenv --cap-drop ALL \\
  --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \\
  --proc /proc --dev /dev --tmpfs /tmp \\
  "$@" \\
  --tmpfs /work --ro-bind "$here/code" /work/project --ro-bind "$here/data/agent" /work/data \\
  --bind "$out" /work/out --remount-ro / \\
  --setenv PATH /usr/bin:/bin --setenv HOME /tmp --setenv LANG C.UTF-8 \\
  --setenv MPLBACKEND Agg --setenv MPLCONFIGDIR /tmp/matplotlib --setenv PYTHONHASHSEED 0 \\
  --setenv OMP_NUM_THREADS 2 --setenv OPENBLAS_NUM_THREADS 2 --setenv MKL_NUM_THREADS 2 \\
  --setenv NUMBA_CACHE_DIR /tmp/numba --chdir /work/project \\
  "$python" -I -B train_variant.py --variant "$variant" \${params:+--params "$params"}
echo "$out/predictions/$variant.csv"
`;

const REPRODUCING_MD = `# Reproducing these experiments

Layout: \`code/\` is the generated codebase (data preparation + one script per variant run),
\`data/agent/\` is exactly what variant code saw (training rows, and validation and test features without labels),
\`data/holdout/\` holds the validation and held-out labels Anvil used to score predictions, and \`results/\` holds
predictions, Anvil's evaluation, the review report and the build log.

1. Create the runtime: \`uv venv --python python3.12 venv && uv pip sync --python venv/bin/python --require-hashes runtime/requirements-ml.lock\`.
2. Re-run a variant: \`sh reproduce.sh <variant-id> $(pwd)/venv/bin/python '<params-json>'\` (Linux with bubblewrap; no network, no provider call). \`<params-json>\` is that variant's entry in \`results/params.json\`; leave it out when the entry is empty.
   The script refuses to run without \`bwrap\`. Like Anvil's own sandbox, variant code sees only \`/usr\`,
   the venv (and its base Python) read-only, \`code/\` at /work/project and \`data/agent/\` at /work/data
   read-only, and a fresh output directory at /work/out. Your home directory, \`data/holdout/\` and your
   environment variables are not visible. The run is capped at 30 minutes, and at 2 GB RAM / 2 CPUs when a
   systemd user manager is available (otherwise it warns and runs uncapped).
3. Compare the new predictions with \`results/predictions/<variant-id>.csv\`; official metrics are in \`results/evaluation.json\`.

The modeling table can be rebuilt from the original raw files with \`code/prepare_data.py\` (raw data mounted at /work/data, output in /work/out).
`;

/** Recorded in a build package's `reports/experiment_results.json`. */
const builtExperimentSchema = z.object({
  kind: z.literal('experiment_build'),
  planHash: sha256Schema,
  codeHash: sha256Schema,
  builderModel: z.string(),
  reviewerModel: z.string(),
  /** Absent on builds made before parameters could be changed. */
  variantParams: z.record(z.string(), variantParamsSchema).optional(),
});

interface BuiltExperiment {
  codeDir: string;
  agentDataDir: string;
  holdoutDir: string;
  review: z.infer<typeof reviewResponseSchema>;
  events: unknown;
  split: z.infer<typeof splitSummarySchema>;
  codeHash: string;
  variantParams: Record<string, VariantParams>;
  trials: VariantTrial[];
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function extractArtifact(
  port: ExperimentCapabilityPort,
  projectId: string,
  ref: z.infer<typeof artifactRefSchema>,
  destination: string,
  signal: AbortSignal
): Promise<string> {
  const bytes = await port.readArtifact(projectId, ref.storageKey);
  const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (actual !== ref.contentHash)
    throw new Error(`Artifact of execution ${ref.executionId} failed its content hash check`);
  await extractProjectArchive(bytes, destination, signal);
  // Extraction writes owner-only files; sandboxed runs read them as an unprivileged user.
  const chmod = Bun.spawn(['chmod', '-R', 'a+rX', destination], { stderr: 'pipe' });
  if ((await chmod.exited) !== 0)
    throw new Error(
      `Could not open extracted artifact: ${await new Response(chmod.stderr).text()}`
    );
  return destination;
}

/** Shared tail of every package: runtime lock, reproduction notes and the baseline report files. */
async function writePackageFiles(
  packageDir: string,
  reports: { testResult: unknown; dataResult: unknown; experiment: unknown }
): Promise<void> {
  await mkdir(join(packageDir, 'reports'), { recursive: true });
  await mkdir(join(packageDir, 'runtime'), { recursive: true });
  await Promise.all([
    writeFile(
      join(packageDir, 'runtime', 'requirements-ml.lock'),
      await readFile(ML_RUNTIME_LOCK_PATH)
    ),
    writeFile(join(packageDir, 'reproduce.sh'), REPRODUCE_SH),
    writeFile(join(packageDir, 'REPRODUCING.md'), REPRODUCING_MD),
    // Same report files the baseline pipeline writes, so existing persistence keeps working.
    writeJson(join(packageDir, 'reports', 'test-results.json'), reports.testResult),
    writeJson(join(packageDir, 'reports', 'data_run.json'), reports.dataResult),
    writeJson(join(packageDir, 'reports', 'experiment_results.json'), reports.experiment),
  ]);
}

type ExecuteInput = z.infer<typeof experimentExecuteInputSchema>;
interface ExecuteOutput {
  projectDir: string;
  testResult: Record<string, unknown>;
  dataResult: Record<string, unknown>;
  experiment: Record<string, unknown>;
}

/** TW-06A: the builder/reviewer models write and smoke-test the codebase on the pinned data. */
async function buildStage(
  input: ExecuteInput,
  root: string,
  context: ExperimentCapabilityContext,
  port: ExperimentCapabilityPort,
  progress: ExperimentProgress
): Promise<BuiltExperiment> {
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
  const codeDir = join(root, 'project');
  const build = await buildExperimentCodebase({
    blueprint: new TextDecoder().decode(blueprint.bytes),
    plan: input.plan,
    variantIds: input.variantIds,
    rawDataDir: rawDir,
    projectDir: codeDir,
    workDir: join(root, 'build'),
    runtime,
    generate,
    maxFixRounds: input.config.maxFixRounds,
    maxReviewRounds: input.config.maxReviewRounds,
    reportUnresolvedReview: input.run?.stage === 'build',
    signal: context.signal,
    progress,
  });
  await writeJson(join(root, 'build.json'), build);
  if (build.status === 'needs_decision')
    throw new Error(
      `Cần bạn quyết định trước khi tiếp tục (bước ${BUILD_STAGE_LABELS[build.stage]}): ${build.question.slice(0, 2_000)}`
    );
  if (build.status !== 'ready')
    throw new Error(
      `Agent đã dùng hết số vòng sửa ở bước ${BUILD_STAGE_LABELS[build.stage]} mà code vẫn lỗi. Lỗi cuối:\n${build.reason.slice(0, 2_000)}`
    );
  return {
    codeDir,
    agentDataDir: build.split.agentDataDir,
    holdoutDir: build.split.holdoutDir,
    review: build.review,
    events: build.events,
    split: build.split.summary,
    codeHash: hashProjectFiles(build.files),
    variantParams: build.variantParams,
    trials: [],
  };
}

/** Copies the built code and split into a self-contained package folder. */
async function packageBuild(
  input: ExecuteInput,
  built: BuiltExperiment,
  packageDir: string
): Promise<void> {
  await mkdir(join(packageDir, 'results'), { recursive: true });
  await Promise.all([
    cp(built.codeDir, join(packageDir, 'code'), { recursive: true }),
    cp(built.agentDataDir, join(packageDir, 'data', 'agent'), { recursive: true }),
    cp(built.holdoutDir, join(packageDir, 'data', 'holdout'), { recursive: true }),
    writeJson(join(packageDir, 'results', 'review.json'), built.review),
    writeJson(join(packageDir, 'results', 'build-events.json'), built.events),
    writeJson(join(packageDir, 'results', 'split.json'), built.split),
    writeJson(join(packageDir, 'results', 'trials.json'), built.trials),
    writeJson(join(packageDir, 'results', 'plan.json'), {
      plan: input.plan,
      protocol: input.plan.protocol,
      config: input.config,
    }),
  ]);
}

/** What a build package reports: read back when a later stage opens it, and shown to the user. */
async function writeBuildPackage(
  input: ExecuteInput,
  built: BuiltExperiment,
  packageDir: string
): Promise<ExecuteOutput> {
  await packageBuild(input, built, packageDir);
  const experiment = {
    status: 'built',
    kind: 'experiment_build',
    variantIds: input.variantIds,
    planHash: hashExperimentPlan(input.plan),
    codeHash: built.codeHash,
    runtimeLockHash: (await resolveMlRuntime()).lockHash,
    builderModel: input.config.builderModel,
    reviewerModel: input.config.reviewerModel,
    review: built.review,
    split: built.split,
    hostSlots: experimentHostSlots(),
    variantParams: built.variantParams,
    trials: built.trials,
  };
  const testResult = { exitCode: 0, kind: 'experiment_build' };
  const dataResult = { status: 'passed', split: built.split, protocol: input.plan.protocol };
  await writePackageFiles(packageDir, { testResult, dataResult, experiment });
  return { projectDir: packageDir, testResult, dataResult, experiment };
}

/** One tuning round; the result is the same build package with the new trials added. */
async function tuneStage(
  input: ExecuteInput,
  built: BuiltExperiment,
  options: {
    variantIds: readonly string[];
    parallelism: number;
    variantParams: VariantParamOverrides;
  },
  root: string,
  context: ExperimentCapabilityContext,
  progress: ExperimentProgress
): Promise<ExecuteOutput> {
  const trials = await tuneExperimentVariants({
    runtime: await resolveMlRuntime(),
    projectDir: built.codeDir,
    agentDataDir: built.agentDataDir,
    holdoutDir: built.holdoutDir,
    variantIds: options.variantIds,
    variantParams: options.variantParams,
    round: Math.max(0, ...built.trials.map(trial => trial.round)) + 1,
    workDir: join(root, 'runs'),
    timeoutMs: input.config.variantTimeoutMinutes * 60_000,
    parallelism: options.parallelism,
    signal: context.signal,
    progress,
  });
  return writeBuildPackage(
    input,
    { ...built, trials: [...built.trials, ...trials] },
    join(root, 'package', 'generated_project')
  );
}

/** TW-06B: run variants of a built codebase, score them with the held-out labels, package. */
async function runStage(
  input: ExecuteInput,
  built: BuiltExperiment,
  options: {
    variantIds: readonly string[];
    parallelism: number;
    carryOver: CarriedVariantResults | null;
    variantParams?: VariantParamOverrides;
  },
  root: string,
  context: ExperimentCapabilityContext,
  progress: ExperimentProgress
): Promise<ExecuteOutput> {
  const protocol = input.plan.protocol;
  if (protocol === null) throw new Error('Approved experiment plan has no evaluation protocol');
  const runtime = await resolveMlRuntime();
  const config = input.config;
  const run = await runExperimentVariants({
    runtime,
    projectDir: built.codeDir,
    agentDataDir: built.agentDataDir,
    holdoutDir: built.holdoutDir,
    protocol,
    variantIds: options.variantIds,
    workDir: join(root, 'runs'),
    timeoutMs: config.variantTimeoutMinutes * 60_000,
    parallelism: options.parallelism,
    ...(options.carryOver ? { carryOver: options.carryOver } : {}),
    ...(options.variantParams ? { variantParams: options.variantParams } : {}),
    signal: context.signal,
    progress,
  });
  // Report variants in the approved order, whether run now or carried over.
  const ran = new Set(run.runs.map(item => item.variant));
  const variantIds = input.variantIds.filter(id => ran.has(id));

  // Self-contained package: verification and delivery only ever read this immutable folder.
  const packageDir = join(root, 'package', 'generated_project');
  await packageBuild(input, built, packageDir);
  await cp(join(root, 'runs', 'collected'), join(packageDir, 'results'), { recursive: true });
  const experiment = {
    status: run.suggestion.ranking.length > 0 ? 'passed' : 'failed',
    kind: 'experiment',
    variantIds,
    primaryMetric: protocol.primaryMetric,
    evaluation: run.evaluation,
    validation: run.validation,
    tuningTrials: built.trials.length,
    suggestion: run.suggestion,
    runs: run.runs,
    review: built.review,
    codeHash: built.codeHash,
    runtimeLockHash: runtime.lockHash,
    builderModel: config.builderModel,
    reviewerModel: config.reviewerModel,
    rerun: options.variantIds.length < variantIds.length ? [...options.variantIds] : null,
  };
  const testResult = {
    exitCode: run.runs.some(item => item.status === 'completed') ? 0 : 1,
    kind: 'experiment',
  };
  const dataResult = { status: 'passed', split: built.split, protocol };
  await Promise.all([
    writeJson(join(packageDir, 'results', 'evaluation.json'), run.evaluation),
    writeJson(join(packageDir, 'results', 'suggestion.json'), run.suggestion),
    writeJson(join(packageDir, 'results', 'runs.json'), run.runs),
    writeJson(join(packageDir, 'results', 'validation_evaluation.json'), run.validation),
    writeJson(
      join(packageDir, 'results', 'params.json'),
      Object.fromEntries(
        run.runs.map(item => [item.variant, options.variantParams?.[item.variant] ?? {}])
      )
    ),
  ]);
  await writePackageFiles(packageDir, { testResult, dataResult, experiment });
  return { projectDir: packageDir, testResult, dataResult, experiment };
}

/** Re-opens a build package and checks it belongs to this approved plan. */
async function openBuildPackage(input: ExecuteInput, dir: string): Promise<BuiltExperiment> {
  const reported = builtExperimentSchema.parse(
    await readJsonFile(join(dir, 'reports', 'experiment_results.json'))
  );
  if (
    reported.planHash !== hashExperimentPlan(input.plan) ||
    reported.builderModel !== input.config.builderModel ||
    reported.reviewerModel !== input.config.reviewerModel
  )
    throw new Error('The build package was made for a different approved plan');
  return {
    codeDir: join(dir, 'code'),
    agentDataDir: join(dir, 'data', 'agent'),
    holdoutDir: join(dir, 'data', 'holdout'),
    review: reviewResponseSchema.parse(await readJsonFile(join(dir, 'results', 'review.json'))),
    events: await readJsonFile(join(dir, 'results', 'build-events.json')),
    split: splitSummarySchema.parse(await readJsonFile(join(dir, 'results', 'split.json'))),
    codeHash: reported.codeHash,
    variantParams: reported.variantParams ?? {},
    // Builds made before tuning have no trials file.
    trials: z
      .array(variantTrialSchema)
      .parse(await readJsonFile(join(dir, 'results', 'trials.json')).catch(() => [])),
  };
}

/** Results of an earlier run package, usable only when it ran the same code on the same split. */
async function openCarryOver(
  built: BuiltExperiment,
  dir: string,
  approved: readonly string[]
): Promise<CarriedVariantResults> {
  const reported = z
    .object({ kind: z.literal('experiment'), codeHash: sha256Schema })
    .parse(await readJsonFile(join(dir, 'reports', 'experiment_results.json')));
  const sameLabels = (await readFile(join(dir, 'data', 'holdout', 'test_labels.csv'))).equals(
    await readFile(join(built.holdoutDir, 'test_labels.csv'))
  );
  if (reported.codeHash !== built.codeHash || !sameLabels)
    throw new Error('The earlier run used different code or a different split');
  const runs = z
    .array(runRecordSchema.extend({ exitCode: z.number(), logTail: z.string() }))
    .parse(await readJsonFile(join(dir, 'results', 'runs.json')))
    .filter(run => approved.includes(run.variant));
  return {
    runs,
    predictionsDir: join(dir, 'results', 'predictions'),
    reportedDir: join(dir, 'results', 'reported'),
  };
}

/**
 * TW-06 for experiment mode. With a `run` binding it performs one stage (build, or run from a
 * build package); without one (bundles approved before plan 13 §10) it builds and runs at once.
 */
export async function executeExperiment(
  raw: Readonly<Record<string, unknown>>,
  context: ExperimentCapabilityContext,
  port: ExperimentCapabilityPort
): Promise<ExecuteOutput> {
  const input = experimentExecuteInputSchema.parse(raw);
  if (input.plan.protocol === null)
    throw new Error('Approved experiment plan has no evaluation protocol');
  const root = join(context.artifactsDir, 'experiment');
  await mkdir(root, { recursive: true });
  const stage = input.run;
  const record = port.recordProgress?.bind(port);
  const progress = new ExperimentProgress(
    record
      ? (event): void => {
          record(context.runId, event);
        }
      : undefined
  );

  if (stage?.stage === 'run' || stage?.stage === 'tune') {
    const outside = stage.variantIds.filter(id => !input.variantIds.includes(id));
    if (outside.length > 0)
      throw new Error(`Variants outside the approved plan: ${outside.join(', ')}`);
    const slots = experimentHostSlots();
    if (stage.parallelism > slots)
      throw new Error(
        `This host can run ${slots.toString()} variant(s) at once; ${stage.parallelism.toString()} requested`
      );
    const buildDir = await extractArtifact(
      port,
      input.projectId,
      stage.buildArtifact,
      join(root, 'build-package'),
      context.signal
    );
    const built = await openBuildPackage(input, buildDir);
    const problems = findOverrideProblems(built.variantParams, stage.variantParams ?? {});
    if (problems.length > 0) throw new Error(problems.join('; '));
    if (stage.stage === 'tune') {
      if (built.split.validationRows === undefined)
        throw new Error(
          'Gói code này được tạo trước khi Anvil giữ tập validation; hãy viết lại code'
        );
      return tuneStage(
        input,
        built,
        {
          variantIds: stage.variantIds,
          parallelism: stage.parallelism,
          variantParams: stage.variantParams,
        },
        root,
        context,
        progress
      );
    }
    const carryOver = stage.carryOver
      ? await openCarryOver(
          built,
          await extractArtifact(
            port,
            input.projectId,
            stage.carryOver,
            join(root, 'carry-over'),
            context.signal
          ),
          input.variantIds
        )
      : null;
    return runStage(
      input,
      built,
      {
        variantIds: stage.variantIds,
        parallelism: stage.parallelism,
        carryOver,
        ...(stage.variantParams ? { variantParams: stage.variantParams } : {}),
      },
      root,
      context,
      progress
    );
  }

  const built = await buildStage(input, root, context, port, progress);
  if (stage?.stage !== 'build')
    return runStage(
      input,
      built,
      { variantIds: input.variantIds, parallelism: 1, carryOver: null },
      root,
      context,
      progress
    );

  return writeBuildPackage(input, built, join(root, 'package', 'generated_project'));
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

/**
 * Re-runs the approved contract on the packaged code. The contract comes from the approved bundle;
 * the package must agree with it and with its recorded code hash, or the check would prove nothing.
 */
async function verifyContractFromPackage(input: {
  contract: VerificationContract;
  packagedContract: VerificationContract | undefined;
  packageDir: string;
  workDir: string;
  signal: AbortSignal;
}): Promise<{ results: ContractCheckResult[]; contractHash: string; codeHash: string }> {
  const contractHash = hashVerificationContract(input.contract);
  if (
    input.packagedContract === undefined ||
    hashVerificationContract(input.packagedContract) !== contractHash
  )
    throw new Error('The package was built for a different verification contract');
  const codeDir = join(input.packageDir, 'code');
  const codeHash = hashProjectFiles(await listProjectFiles(codeDir));
  const reported = z
    .object({ codeHash: sha256Schema })
    .parse(await readJsonFile(join(input.packageDir, 'reports', 'experiment_results.json')));
  if (reported.codeHash !== codeHash)
    throw new Error('The packaged code does not match the code hash recorded when it was built');
  // A private copy: extraction writes owner-only files and the sandbox runs unprivileged.
  const sandboxCode = join(input.workDir, 'code');
  await mkdir(input.workDir, { recursive: true });
  await cp(codeDir, sandboxCode, { recursive: true });
  const chmod = Bun.spawn(['chmod', '-R', 'a+rX', sandboxCode], { stderr: 'pipe' });
  if ((await chmod.exited) !== 0)
    throw new Error(`Could not open packaged code: ${await new Response(chmod.stderr).text()}`);
  return {
    results: await runContractChecks({
      contract: input.contract,
      runtime: await resolveMlRuntime(),
      projectDir: sandboxCode,
      workDir: join(input.workDir, 'runs'),
      signal: input.signal,
    }),
    contractHash,
    codeHash,
  };
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
  const validationRecorded = input.experiment.validation ?? null;
  const validation = validationRecorded
    ? await evaluateExperimentPredictions({
        runtime,
        variants: input.experiment.variantIds,
        holdoutDir: join(packageDir, 'data', 'holdout'),
        labels: 'validation',
        predictionsDir: join(packageDir, 'results', 'validation_predictions'),
        reportedDir: join(packageDir, 'results', 'reported'),
        workDir: join(context.artifactsDir, 'verification', 'experiment-validation'),
        signal: context.signal,
      })
    : null;
  const mismatches = [
    ...sameMetrics(input.experiment.evaluation, evaluation),
    ...(validationRecorded && validation
      ? sameMetrics(validationRecorded, validation).map(item => `validation ${item}`)
      : []),
  ];
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
  const scoringPassed = mismatches.length === 0 && verifiedVariants > 0;
  const contract = input.verificationContract
    ? await verifyContractFromPackage({
        contract: input.verificationContract,
        packagedContract: pinned.plan.verificationContract,
        packageDir,
        workDir: join(context.artifactsDir, 'verification', 'contract'),
        signal: context.signal,
      })
    : null;
  const contractResults = contract?.results ?? [];
  // `not_verified` does not stop delivery yet (plan 16 §5); a wrong result or an unrun check does.
  const passed =
    scoringPassed &&
    contractResults.every(item => item.status !== 'failed' && item.status !== 'blocked');
  const coverage = input.requirements
    ? buildRequirementEvidence(
        input.requirements,
        contractResults,
        (pinned.plan.blueprintDecisions ?? []).flatMap(decision =>
          decision.effect === 'remove_requirement' && decision.requirementId !== null
            ? [decision.requirementId]
            : []
        )
      )
    : null;
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
        params: run?.params ?? null,
        validationMetrics:
          validation?.variants[id]?.status === 'verified'
            ? (validation.variants[id].metrics as Record<string, number>)
            : null,
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
    tuningTrials: z.array(variantTrialSchema).parse(await readJson('trials.json').catch(() => []))
      .length,
  });
  const evidenceMap = {
    schemaVersion: 1,
    ...view,
    status: passed ? 'passed' : 'failed',
    executionStatus: passed ? 'passed' : 'failed',
    scoringStatus: scoringPassed ? 'passed' : 'failed',
    requirementCoverage: coverage?.requirementCoverage ?? {
      status: 'not_verified',
      verified: 0,
      total: null,
      note: 'Kế hoạch được duyệt trước khi có danh sách yêu cầu trong Verify nên không biết mẫu số.',
    },
    ...(coverage
      ? { declaredChecks: coverage.declaredChecks, requirements: coverage.requirements }
      : {}),
    ...(contract
      ? {
          contractChecks: contractResults,
          contractBasis: {
            checkerVersion: CONTRACT_CHECKER_VERSION,
            contractHash: contract.contractHash,
            codeHash: contract.codeHash,
          },
        }
      : {}),
    verifiedVariants,
  };
  await mkdir(join(context.artifactsDir, 'verification'), { recursive: true });
  await writeJson(
    join(context.artifactsDir, 'verification', 'experiment-evidence.json'),
    evidenceMap
  );
  return { evidenceMap };
}
