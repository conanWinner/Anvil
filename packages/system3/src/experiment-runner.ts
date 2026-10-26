import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  evaluateExperimentPredictions,
  rankExperimentVariants,
  type EvaluationProtocol,
  type ExperimentEvaluation,
  type VariantSuggestion,
} from './experiment-evaluation';
import { runExperimentSandbox } from './experiment-sandbox';
import type { MlRuntime } from './ml-runtime';

/** TW-06B: run every approved variant on the full split, then let Anvil score them (TW-07 input). */

export interface VariantRun {
  variant: string;
  status: 'completed' | 'failed' | 'resource_limit';
  exitCode: number;
  durationMs: number;
  /** Tail of the run's output for the report; full logs stay in the run folder. */
  logTail: string;
}

export interface ExperimentRunResult {
  runs: VariantRun[];
  evaluation: ExperimentEvaluation;
  suggestion: VariantSuggestion;
  outputDir: string;
}

const KILLED_BY_SIGNAL = 137;

export async function runExperimentVariants(input: {
  runtime: MlRuntime;
  projectDir: string;
  agentDataDir: string;
  holdoutDir: string;
  protocol: EvaluationProtocol;
  variantIds: readonly string[];
  workDir: string;
  timeoutMs: number;
  signal: AbortSignal;
  onVariant?: (run: VariantRun) => void;
}): Promise<ExperimentRunResult> {
  const outputDir = join(input.workDir, 'runs');
  await rm(outputDir, { recursive: true, force: true });
  const runs: VariantRun[] = [];
  for (const variant of input.variantIds) {
    const variantOut = join(outputDir, variant);
    await mkdir(variantOut, { recursive: true });
    const result = await runExperimentSandbox({
      profile: 'experiment',
      runtime: input.runtime,
      projectDir: input.projectDir,
      dataDir: input.agentDataDir,
      outputDir: variantOut,
      script: 'train_variant.py',
      args: ['--variant', variant],
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });
    // The sandbox kills runs that hit their memory or time budget; that is a capacity result,
    // not evidence that the variant is worse.
    const hitLimit =
      result.exitCode !== 0 &&
      (result.exitCode === KILLED_BY_SIGNAL || result.durationMs >= input.timeoutMs - 1_000);
    const run: VariantRun = {
      variant,
      status: result.exitCode === 0 ? 'completed' : hitLimit ? 'resource_limit' : 'failed',
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      logTail: `${result.stderr}\n${result.stdout}`.trim().slice(-4_000),
    };
    runs.push(run);
    input.onVariant?.(run);
  }

  // Each variant wrote into its own folder; gather predictions for one evaluator pass.
  const predictionsDir = join(input.workDir, 'collected', 'predictions');
  const reportedDir = join(input.workDir, 'collected', 'reported');
  await rm(join(input.workDir, 'collected'), { recursive: true, force: true });
  await Promise.all([
    mkdir(predictionsDir, { recursive: true }),
    mkdir(reportedDir, { recursive: true }),
  ]);
  for (const run of runs) {
    if (run.status !== 'completed') continue;
    for (const [folder, extension, target] of [
      ['predictions', 'csv', predictionsDir],
      ['reported', 'json', reportedDir],
    ] as const) {
      const source = Bun.file(join(outputDir, run.variant, folder, `${run.variant}.${extension}`));
      if (await source.exists())
        await Bun.write(join(target, `${run.variant}.${extension}`), source);
    }
  }
  const evaluation = await evaluateExperimentPredictions({
    runtime: input.runtime,
    variants: input.variantIds,
    holdoutDir: input.holdoutDir,
    predictionsDir,
    reportedDir,
    workDir: join(input.workDir, 'evaluation'),
    signal: input.signal,
  });
  const suggestion = rankExperimentVariants({
    protocol: input.protocol,
    evaluation,
    durations: Object.fromEntries(runs.map(run => [run.variant, run.durationMs])),
  });
  return { runs, evaluation, suggestion, outputDir };
}
