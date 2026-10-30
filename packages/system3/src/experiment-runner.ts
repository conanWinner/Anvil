import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  evaluateExperimentPredictions,
  rankExperimentVariants,
  type EvaluationProtocol,
  type ExperimentEvaluation,
  type VariantSuggestion,
} from './experiment-evaluation';
import {
  findIgnoredOverrides,
  readReportedParams,
  type VariantParamOverrides,
  type VariantParams,
  type VariantTrial,
} from './experiment-params';
import type { ExperimentProgress } from './experiment-progress';
import { runExperimentSandbox } from './experiment-sandbox';
import type { MlRuntime } from './ml-runtime';
import { inspectSandboxOutput } from './sandbox-process';

/** TW-06B: run every approved variant on the full split, then let Anvil score them (TW-07 input). */

export interface VariantRun {
  variant: string;
  status: 'completed' | 'failed' | 'resource_limit';
  exitCode: number;
  durationMs: number;
  /** Tail of the run's output for the report; full logs stay in the run folder. */
  logTail: string;
  /** Parameters the run reported using. */
  params?: VariantParams | null;
}

export interface ExperimentRunResult {
  runs: VariantRun[];
  evaluation: ExperimentEvaluation;
  /** Scores on Anvil's validation set; null for a build made before it kept one. */
  validation: ExperimentEvaluation | null;
  suggestion: VariantSuggestion;
  outputDir: string;
}

const KILLED_BY_SIGNAL = 137;

/** Results of an earlier run of the same build, kept for variants this run does not repeat. */
export interface CarriedVariantResults {
  runs: VariantRun[];
  predictionsDir: string;
  reportedDir: string;
}

interface VariantRunInput {
  runtime: MlRuntime;
  projectDir: string;
  agentDataDir: string;
  holdoutDir: string;
  variantIds: readonly string[];
  workDir: string;
  timeoutMs: number;
  signal: AbortSignal;
  /** Variants run at once; the sandbox also caps this at the host's slots. Default 1. */
  parallelism?: number;
  carryOver?: CarriedVariantResults;
  /** Parameters to change per variant; anything else keeps the code's defaults. */
  variantParams?: VariantParamOverrides;
  onVariant?: (run: VariantRun) => void;
  /** Traces each variant run and the scoring step as they start and finish. */
  progress?: ExperimentProgress;
}

const COLLECTED_OUTPUTS = [
  ['predictions', 'csv'],
  ['validation_predictions', 'csv'],
  ['reported', 'json'],
] as const;

/** Runs the variants in their sandboxes and gathers each one's outputs into one folder. */
async function runAndCollect(
  input: VariantRunInput
): Promise<{ runs: VariantRun[]; outputDir: string; collectedDir: string }> {
  const outputDir = join(input.workDir, 'runs');
  await rm(outputDir, { recursive: true, force: true });
  const runVariant = async (variant: string): Promise<VariantRun> => {
    const variantOut = join(outputDir, variant);
    await mkdir(variantOut, { recursive: true });
    const finish = input.progress?.start({
      stage: 'run',
      action: 'variant_run',
      variantId: variant,
      detail: `Giới hạn ${Math.round(input.timeoutMs / 60_000).toString()} phút`,
    });
    const overrides = input.variantParams?.[variant] ?? {};
    let result: Awaited<ReturnType<typeof runExperimentSandbox>>;
    try {
      result = await runExperimentSandbox({
        profile: 'experiment',
        runtime: input.runtime,
        projectDir: input.projectDir,
        dataDir: input.agentDataDir,
        outputDir: variantOut,
        script: 'train_variant.py',
        args: [
          '--variant',
          variant,
          ...(Object.keys(overrides).length > 0 ? ['--params', JSON.stringify(overrides)] : []),
        ],
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      });
    } catch (error) {
      finish?.('failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
    // The sandbox kills runs that hit their memory or time budget; that is a capacity result,
    // not evidence that the variant is worse.
    const hitLimit =
      result.exitCode !== 0 &&
      (result.exitCode === KILLED_BY_SIGNAL || result.durationMs >= input.timeoutMs - 1_000);
    const params = await readReportedParams(variantOut, variant);
    const ignored = result.exitCode === 0 ? findIgnoredOverrides(overrides, params) : [];
    const run: VariantRun = {
      variant,
      status:
        ignored.length > 0
          ? 'failed'
          : result.exitCode === 0
            ? 'completed'
            : hitLimit
              ? 'resource_limit'
              : 'failed',
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      // A run that ignored a requested value would score a different model than the one recorded.
      logTail: [
        `${result.stderr}\n${result.stdout}`.trim().slice(-4_000),
        ...(ignored.length > 0
          ? [`Anvil rejected this run: it did not use the requested ${ignored.join(', ')}.`]
          : []),
      ]
        .filter(part => part.length > 0)
        .join('\n'),
      params,
    };
    finish?.(
      run.status === 'completed' ? 'passed' : 'failed',
      [
        run.status === 'resource_limit'
          ? 'Dừng vì chạm giới hạn RAM hoặc thời gian của sandbox.'
          : `exit code ${run.exitCode.toString()}`,
        run.logTail,
      ]
        .filter(part => part.length > 0)
        .join('\n')
    );
    input.onVariant?.(run);
    return run;
  };
  const fresh = new Map<string, VariantRun>();
  const pending = [...input.variantIds];
  const workers = Array.from(
    { length: Math.max(1, Math.min(input.parallelism ?? 1, pending.length)) },
    async () => {
      for (let variant = pending.shift(); variant !== undefined; variant = pending.shift())
        fresh.set(variant, await runVariant(variant));
    }
  );
  await Promise.all(workers);
  const carried = (input.carryOver?.runs ?? []).filter(run => !fresh.has(run.variant));
  const runs = [
    ...carried,
    ...input.variantIds.flatMap(variant => {
      const run = fresh.get(variant);
      return run ? [run] : [];
    }),
  ];

  // Each variant wrote into its own folder; gather predictions for one evaluator pass.
  const collectedDir = join(input.workDir, 'collected');
  await rm(collectedDir, { recursive: true, force: true });
  await Promise.all(
    COLLECTED_OUTPUTS.map(([folder]) => mkdir(join(collectedDir, folder), { recursive: true }))
  );
  for (const run of runs) {
    if (run.status !== 'completed') continue;
    const fromCarry = !fresh.has(run.variant) && input.carryOver;
    for (const [folder, extension] of COLLECTED_OUTPUTS) {
      const target = join(collectedDir, folder);
      const filename = `${run.variant}.${extension}`;
      const carriedDir = fromCarry
        ? {
            predictions: fromCarry.predictionsDir,
            validation_predictions: join(fromCarry.predictionsDir, '..', folder),
            reported: fromCarry.reportedDir,
          }[folder]
        : '';
      const [root, relative] = fromCarry
        ? [carriedDir, filename]
        : [join(outputDir, run.variant), `${folder}/${filename}`];
      const state = await inspectSandboxOutput(root, relative);
      if (state === 'regular')
        await Bun.write(join(target, filename), Bun.file(join(root, relative)));
      // Left uncopied, so scoring reports this variant's predictions as missing.
      else if (state === 'unsafe')
        run.logTail = `${run.logTail}\nAnvil ignored ${relative}: it must be a regular file, not a link.`;
    }
  }
  return { runs, outputDir, collectedDir };
}

/** Whether this build has Anvil's validation labels; builds made before it kept them do not. */
async function hasValidationLabels(holdoutDir: string): Promise<boolean> {
  return access(join(holdoutDir, 'validation_labels.csv')).then(
    () => true,
    () => false
  );
}

function scoreValidation(
  input: VariantRunInput,
  collectedDir: string,
  variants: readonly string[]
): Promise<ExperimentEvaluation> {
  return evaluateExperimentPredictions({
    runtime: input.runtime,
    variants,
    holdoutDir: input.holdoutDir,
    labels: 'validation',
    predictionsDir: join(collectedDir, 'validation_predictions'),
    reportedDir: join(collectedDir, 'reported'),
    workDir: join(input.workDir, 'evaluation-validation'),
    signal: input.signal,
  });
}

/**
 * A tuning round: runs the variants and scores them on the validation set only. The test labels are
 * not read here, so people can compare parameter choices without spending the held-out test set.
 */
export async function tuneExperimentVariants(
  input: VariantRunInput & { round: number }
): Promise<VariantTrial[]> {
  const { runs, collectedDir } = await runAndCollect(input);
  const variants = runs.map(run => run.variant);
  const score = (): Promise<ExperimentEvaluation> => scoreValidation(input, collectedDir, variants);
  const validation = input.progress
    ? await input.progress.track(
        {
          stage: 'run',
          action: 'evaluate',
          detail: `${variants.length.toString()} phương án · chỉ trên tập validation`,
        },
        score
      )
    : await score();
  return runs.map(run => {
    const result = validation.variants[run.variant];
    return {
      round: input.round,
      variant: run.variant,
      status: run.status,
      params: run.params ?? null,
      requested: input.variantParams?.[run.variant] ?? {},
      validationMetrics: result?.status === 'verified' ? result.metrics : null,
      durationMs: run.durationMs,
    };
  });
}

export async function runExperimentVariants(
  input: VariantRunInput & { protocol: EvaluationProtocol }
): Promise<ExperimentRunResult> {
  const { runs, outputDir, collectedDir } = await runAndCollect(input);
  const variants = runs.map(run => run.variant);
  const evaluate = (): Promise<ExperimentEvaluation> =>
    evaluateExperimentPredictions({
      runtime: input.runtime,
      variants,
      holdoutDir: input.holdoutDir,
      predictionsDir: join(collectedDir, 'predictions'),
      reportedDir: join(collectedDir, 'reported'),
      workDir: join(input.workDir, 'evaluation'),
      signal: input.signal,
    });
  const evaluation = input.progress
    ? await input.progress.track(
        { stage: 'run', action: 'evaluate', detail: `${variants.length.toString()} phương án` },
        evaluate,
        value => {
          const verified = Object.values(value.variants).filter(
            item => item.status === 'verified'
          ).length;
          return {
            status: verified > 0 ? 'passed' : 'failed',
            detail: `${verified.toString()}/${variants.length.toString()} phương án có dự đoán hợp lệ`,
          };
        }
      )
    : await evaluate();
  const suggestion = rankExperimentVariants({
    protocol: input.protocol,
    evaluation,
    durations: Object.fromEntries(runs.map(run => [run.variant, run.durationMs])),
  });
  const validation = (await hasValidationLabels(input.holdoutDir))
    ? await scoreValidation(input, collectedDir, variants)
    : null;
  return { runs, evaluation, validation, suggestion, outputDir };
}
