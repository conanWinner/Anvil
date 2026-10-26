import { z } from '@hono/zod-openapi';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExperimentSandbox } from './experiment-sandbox';
import type { MlRuntime } from './ml-runtime';

/** Directory holding Anvil's own evaluator (`anvil_eval.py`); never agent-written code. */
export const ANVIL_EVALUATOR_DIR = fileURLToPath(new URL('../runtime/python', import.meta.url));

export const experimentMetricSchema = z.enum([
  'roc_auc',
  'pr_auc',
  'f1',
  'recall',
  'precision',
  'accuracy',
]);
export type ExperimentMetric = z.infer<typeof experimentMetricSchema>;

export const experimentVariantIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u, 'Variant id must be lowercase letters, digits, - or _');

export const evaluationProtocolSchema = z.object({
  task: z.literal('binary_classification'),
  idColumn: z.string().min(1),
  targetColumn: z.string().min(1),
  positiveLabel: z.string().min(1),
  split: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('stratified_holdout'),
      testFraction: z.number().gt(0).lt(1),
      seed: z.number().int(),
    }),
    z.object({
      kind: z.literal('time_holdout'),
      testFraction: z.number().gt(0).lt(1),
      timeColumn: z.string().min(1),
    }),
  ]),
  primaryMetric: experimentMetricSchema,
  /** Minimum acceptable values; absent when System 2 left thresholds open. */
  thresholds: z.record(z.string(), z.number()).optional(),
});
export type EvaluationProtocol = z.infer<typeof evaluationProtocolSchema>;

export const splitSummarySchema = z.object({
  rows: z.number().int(),
  trainRows: z.number().int(),
  testRows: z.number().int(),
  trainPositiveRate: z.number(),
  testPositiveRate: z.number(),
  files: z.record(z.string(), z.string()),
});
export type SplitSummary = z.infer<typeof splitSummarySchema>;

const metricValuesSchema = z.record(experimentMetricSchema, z.number());

export const variantEvaluationSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('verified'),
    metrics: metricValuesSchema,
    reportedTrainingMetrics: z.record(z.string(), z.unknown()),
    predictionsHash: z.string(),
  }),
  z.object({ status: z.literal('missing'), error: z.string() }),
  z.object({ status: z.literal('invalid_predictions'), error: z.string() }),
]);
export type VariantEvaluation = z.infer<typeof variantEvaluationSchema>;

export const experimentEvaluationSchema = z.object({
  testRows: z.number().int(),
  variants: z.record(z.string(), variantEvaluationSchema),
});
export type ExperimentEvaluation = z.infer<typeof experimentEvaluationSchema>;

async function runEvaluator(input: {
  runtime: MlRuntime;
  command: 'split' | 'sample' | 'evaluate';
  dataDir: string;
  outputDir: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<void> {
  const result = await runExperimentSandbox({
    profile: 'experiment',
    runtime: input.runtime,
    projectDir: ANVIL_EVALUATOR_DIR,
    dataDir: input.dataDir,
    outputDir: input.outputDir,
    script: 'anvil_eval.py',
    args: [input.command],
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });
  if (result.exitCode !== 0)
    throw new Error(
      `Anvil evaluator '${input.command}' failed: ${result.stderr.trim() || `exit ${result.exitCode.toString()}`}`
    );
}

/**
 * Splits a modeling table (one row per entity, with id and target) once, before any variant code
 * runs. Agents receive `agentDataDir` only; held-out labels stay in `holdoutDir`.
 */
export async function splitModelingTable(input: {
  runtime: MlRuntime;
  tablePath: string;
  protocol: EvaluationProtocol;
  workDir: string;
  signal: AbortSignal;
}): Promise<{ agentDataDir: string; holdoutDir: string; summary: SplitSummary }> {
  const protocol = evaluationProtocolSchema.parse(input.protocol);
  const dataDir = join(input.workDir, 'split-input');
  const outputDir = join(input.workDir, 'split');
  await mkdir(dataDir, { recursive: true });
  await Promise.all([
    copyFile(input.tablePath, join(dataDir, 'table.csv')),
    writeFile(join(dataDir, 'protocol.json'), JSON.stringify(protocol)),
  ]);
  await runEvaluator({
    runtime: input.runtime,
    command: 'split',
    dataDir,
    outputDir,
    timeoutMs: 10 * 60_000,
    signal: input.signal,
  });
  const summary = splitSummarySchema.parse(
    JSON.parse(await readFile(join(outputDir, 'split.json'), 'utf8')) as unknown
  );
  return {
    agentDataDir: join(outputDir, 'agent'),
    holdoutDir: join(outputDir, 'holdout'),
    summary,
  };
}

/** Stratified smoke sample of the agent data (both classes kept); for smoke runs only. */
export async function sampleAgentData(input: {
  runtime: MlRuntime;
  agentDataDir: string;
  protocol: EvaluationProtocol;
  trainRows: number;
  testRows: number;
  outputDir: string;
  workDir: string;
  signal: AbortSignal;
}): Promise<void> {
  const dataDir = join(input.workDir, 'sample-input');
  await mkdir(dataDir, { recursive: true });
  await Promise.all([
    copyFile(join(input.agentDataDir, 'train.csv'), join(dataDir, 'train.csv')),
    copyFile(join(input.agentDataDir, 'test_features.csv'), join(dataDir, 'test_features.csv')),
    writeFile(
      join(dataDir, 'protocol.json'),
      JSON.stringify({
        idColumn: input.protocol.idColumn,
        targetColumn: input.protocol.targetColumn,
        trainRows: input.trainRows,
        testRows: input.testRows,
      })
    ),
  ]);
  await runEvaluator({
    runtime: input.runtime,
    command: 'sample',
    dataDir,
    outputDir: input.outputDir,
    timeoutMs: 5 * 60_000,
    signal: input.signal,
  });
}

/**
 * Recomputes held-out metrics for every variant from `<predictionsDir>/<variant>.csv`
 * (`id,score[,label]`). Training metrics agents report are carried along unverified.
 */
export async function evaluateExperimentPredictions(input: {
  runtime: MlRuntime;
  variants: readonly string[];
  holdoutDir: string;
  predictionsDir: string;
  reportedDir?: string;
  workDir: string;
  signal: AbortSignal;
}): Promise<ExperimentEvaluation> {
  const variants = input.variants.map(variant => experimentVariantIdSchema.parse(variant));
  if (new Set(variants).size !== variants.length) throw new Error('Variant ids must be unique');
  const dataDir = join(input.workDir, 'evaluate-input');
  const outputDir = join(input.workDir, 'evaluate');
  await Promise.all(
    ['holdout', 'predictions', 'reported'].map(dir =>
      mkdir(join(dataDir, dir), { recursive: true })
    )
  );
  await copyFile(
    join(input.holdoutDir, 'test_labels.csv'),
    join(dataDir, 'holdout', 'test_labels.csv')
  );
  // Copy only the expected files: agent output folders may hold anything else.
  const present = async (dir: string | undefined): Promise<Set<string>> =>
    dir === undefined ? new Set() : new Set(await readdir(dir).catch(() => []));
  const [predictionFiles, reportedFiles] = await Promise.all([
    present(input.predictionsDir),
    present(input.reportedDir),
  ]);
  for (const variant of variants) {
    if (predictionFiles.has(`${variant}.csv`))
      await copyFile(
        join(input.predictionsDir, `${variant}.csv`),
        join(dataDir, 'predictions', `${variant}.csv`)
      );
    if (input.reportedDir !== undefined && reportedFiles.has(`${variant}.json`))
      await copyFile(
        join(input.reportedDir, `${variant}.json`),
        join(dataDir, 'reported', `${variant}.json`)
      );
  }
  await writeFile(join(dataDir, 'protocol.json'), JSON.stringify({ variants }));
  await runEvaluator({
    runtime: input.runtime,
    command: 'evaluate',
    dataDir,
    outputDir,
    timeoutMs: 10 * 60_000,
    signal: input.signal,
  });
  return experimentEvaluationSchema.parse(
    JSON.parse(await readFile(join(outputDir, 'evaluation.json'), 'utf8')) as unknown
  );
}

export interface RankedVariant {
  variant: string;
  rank: number;
  primary: number;
  meetsThresholds: boolean | null;
  durationMs: number | null;
}

export interface VariantSuggestion {
  ranking: RankedVariant[];
  /** Suggested variant; the user still decides. Null when nothing was verified. */
  suggested: string | null;
  reasons: (
    | 'highest_primary_metric'
    | 'meets_thresholds'
    | 'no_variant_meets_thresholds'
    | 'no_better_than_chance'
  )[];
  /** Variants within `NEAR_BEST` of the best primary metric that ran faster. */
  fasterAlternatives: string[];
  unverified: string[];
}

const NEAR_BEST = 0.01;
/** Ranking metrics where 0.5 is a coin flip; a best score this close says the models learned nothing. */
const CHANCE_LEVEL: Partial<Record<ExperimentMetric, number>> = { roc_auc: 0.55 };

/** Ranks verified variants by the protocol's primary metric; a suggestion, never a decision. */
export function rankExperimentVariants(input: {
  protocol: EvaluationProtocol;
  evaluation: ExperimentEvaluation;
  durations?: Readonly<Record<string, number>>;
}): VariantSuggestion {
  const { primaryMetric, thresholds } = input.protocol;
  const verified: Omit<RankedVariant, 'rank'>[] = [];
  const unverified: string[] = [];
  for (const [variant, result] of Object.entries(input.evaluation.variants)) {
    if (result.status !== 'verified') {
      unverified.push(variant);
      continue;
    }
    const metrics = result.metrics;
    const thresholdEntries = Object.entries(thresholds ?? {});
    verified.push({
      variant,
      primary: metrics[primaryMetric] ?? Number.NEGATIVE_INFINITY,
      meetsThresholds:
        thresholdEntries.length === 0
          ? null
          : thresholdEntries.every(([metric, minimum]) => {
              const value = metrics[metric as ExperimentMetric];
              return value !== undefined && value >= minimum;
            }),
      durationMs: input.durations?.[variant] ?? null,
    });
  }
  verified.sort(
    (a, b) =>
      b.primary - a.primary ||
      (a.durationMs ?? Number.POSITIVE_INFINITY) - (b.durationMs ?? Number.POSITIVE_INFINITY) ||
      a.variant.localeCompare(b.variant)
  );
  const ranking = verified.map((item, index) => ({ ...item, rank: index + 1 }));
  const best = ranking[0];
  if (best === undefined)
    return { ranking, suggested: null, reasons: [], fasterAlternatives: [], unverified };
  const reasons: VariantSuggestion['reasons'] = ['highest_primary_metric'];
  if (best.meetsThresholds === true) reasons.push('meets_thresholds');
  if (ranking.every(item => item.meetsThresholds === false))
    reasons.push('no_variant_meets_thresholds');
  const chance = CHANCE_LEVEL[primaryMetric];
  if (chance !== undefined && best.primary <= chance) reasons.push('no_better_than_chance');
  const fasterAlternatives = ranking
    .slice(1)
    .filter(
      item =>
        best.primary - item.primary <= NEAR_BEST &&
        item.durationMs !== null &&
        best.durationMs !== null &&
        item.durationMs < best.durationMs
    )
    .map(item => item.variant);
  return { ranking, suggested: best.variant, reasons, fasterAlternatives, unverified };
}
