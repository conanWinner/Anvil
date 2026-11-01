import { z } from '@hono/zod-openapi';
import { createHash } from 'node:crypto';
import type { BlueprintAnalysis } from './contracts';
import {
  evaluationProtocolSchema,
  experimentMetricSchema,
  experimentVariantIdSchema,
  type EvaluationProtocol,
  type ExperimentMetric,
} from './experiment-evaluation';
import { blueprintDecisionSchema, understandingSourcePointerSchema } from './understanding/schemas';
import { verificationContractSchema } from './verification-contract';

/**
 * Column contract of the modeling table produced by the data-preparation stage. Fixing the names
 * lets Anvil split and score any project without project-specific evaluator code.
 */
export const MODELING_TABLE_COLUMNS = {
  id: 'entity_id',
  target: 'target',
  time: 'cutoff_time',
} as const;

export const experimentVariantSchema = z.object({
  id: experimentVariantIdSchema,
  name: z.string().min(1),
  role: z.enum(['baseline', 'candidate']),
  /** System 2 marked this option as its primary recommendation. */
  recommended: z.boolean(),
  requirementIds: z.array(z.string()),
  rationale: z.string().nullable(),
  sourcePointers: z.array(understandingSourcePointerSchema).min(1),
});
export type ExperimentVariant = z.infer<typeof experimentVariantSchema>;

export const experimentTechniqueSchema = z.object({
  id: experimentVariantIdSchema,
  name: z.string().min(1),
  /** Optional techniques start disabled; the user opts in when approving the plan. */
  optional: z.boolean(),
  requirementIds: z.array(z.string()),
  sourcePointers: z.array(understandingSourcePointerSchema).min(1),
});
export type ExperimentTechnique = z.infer<typeof experimentTechniqueSchema>;

export const experimentPlanGapSchema = z.object({
  id: z.enum(['no_variants', 'unsupported_task', 'no_primary_metric', 'no_thresholds']),
  /** Blocking gaps stop compilation until the blueprint or a Decision resolves them. */
  blocking: z.boolean(),
  message: z.string().min(1),
});
export type ExperimentPlanGap = z.infer<typeof experimentPlanGapSchema>;

export const experimentPlanSchema = z.object({
  schemaVersion: z.literal(1),
  variants: z.array(experimentVariantSchema),
  techniques: z.array(experimentTechniqueSchema),
  protocol: evaluationProtocolSchema.nullable(),
  /** Metrics System 2 asked to report, in the order it named them. */
  reportedMetrics: z.array(experimentMetricSchema),
  gaps: z.array(experimentPlanGapSchema),
  /** Copied from the blueprint when it has one; absent otherwise, keeping older plan hashes valid. */
  verificationContract: verificationContractSchema.optional(),
  /** The user's answers to the blueprint review; absent when there were none, like the contract. */
  blueprintDecisions: z.array(blueprintDecisionSchema).optional(),
});
export type ExperimentPlan = z.infer<typeof experimentPlanSchema>;

const MODEL_TRAINING = /^(?:model training|huấn luyện(?: mô hình)?)\s*[-–:]\s*(.+)$/iu;
const TECHNIQUE =
  /(imbalance|smote|segmentation|clustering|k-means|interpretation|shap|feature selection|mất cân bằng|phân cụm)/iu;
const METRIC_PATTERNS: readonly [ExperimentMetric, RegExp][] = [
  ['roc_auc', /\b(?:roc[- ]?auc|auc[- ]?roc)\b/iu],
  ['pr_auc', /\b(?:pr[- ]?auc|average precision)\b/iu],
  ['f1', /\bf1(?:[- ]?score)?\b/iu],
  ['recall', /\brecall\b/iu],
  ['precision', /\bprecision\b/iu],
  ['accuracy', /\baccuracy\b/iu],
];
const THRESHOLD =
  /\b(roc[- ]?auc|auc[- ]?roc|pr[- ]?auc|f1(?:[- ]?score)?|recall|precision|accuracy)\s*(?:≥|>=|tối thiểu|at least)\s*(0?\.\d+|1(?:\.0+)?)/giu;

function slug(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '_')
      .replace(/^_+|_+$/gu, '')
      .slice(0, 64) || 'variant'
  );
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let suffix = 2; used.has(id); suffix += 1) id = `${base.slice(0, 60)}_${suffix.toString()}`;
  used.add(id);
  return id;
}

function metricOf(text: string): ExperimentMetric | null {
  return METRIC_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/** Metrics in order of first mention across the given texts. */
function mentionedMetrics(texts: readonly string[]): ExperimentMetric[] {
  const found: { metric: ExperimentMetric; at: number; order: number }[] = [];
  texts.forEach((text, order) => {
    for (const [metric, pattern] of METRIC_PATTERNS) {
      const match = pattern.exec(text);
      if (match && !found.some(item => item.metric === metric))
        found.push({ metric, at: match.index, order });
    }
  });
  return found.sort((a, b) => a.order - b.order || a.at - b.at).map(item => item.metric);
}

/**
 * Derives the experiment matrix and evaluation protocol from a System 2 analysis. It reads only
 * what TW-02 extracted with source pointers; anything missing becomes a gap, never a guess.
 */
export function deriveExperimentPlan(analysis: BlueprintAnalysis): ExperimentPlan {
  if (analysis.schemaVersion !== 2)
    return {
      schemaVersion: 1,
      variants: [],
      techniques: [],
      protocol: null,
      reportedMetrics: [],
      gaps: [
        {
          id: 'no_variants',
          blocking: true,
          message: 'Bản hiểu cũ không có bảng công nghệ; hãy phân tích lại blueprint.',
        },
      ],
    };

  const variantIds = new Set<string>();
  const techniqueIds = new Set<string>();
  const variants: ExperimentVariant[] = [];
  const techniques: ExperimentTechnique[] = [];
  for (const technology of analysis.technologyStack) {
    const model = MODEL_TRAINING.exec(technology.name.trim());
    if (model?.[1] !== undefined) {
      const recommended = /recommend|khuyến nghị|đề xuất chính/iu.test(model[1]);
      const name = model[1].replace(/\s*\([^)]*\)\s*$/u, '').trim();
      variants.push({
        id: uniqueId(slug(name), variantIds),
        name,
        role: /logistic|baseline/iu.test(name) ? 'baseline' : 'candidate',
        recommended,
        requirementIds: technology.requirementIds,
        rationale: technology.rationale,
        sourcePointers: technology.sourcePointers,
      });
    } else if (TECHNIQUE.test(technology.name)) {
      const name = technology.name.trim();
      techniques.push({
        id: uniqueId(slug(name), techniqueIds),
        name,
        optional:
          technology.requirementIds.length === 0 ||
          /optional|tùy chọn/iu.test(`${name} ${technology.rationale ?? ''}`),
        requirementIds: technology.requirementIds,
        sourcePointers: technology.sourcePointers,
      });
    }
  }

  const successCriteria = analysis.problemProfile.successCriteria.map(item => item.value);
  const requirementTexts = analysis.requirements.map(
    item => `${item.statement} ${item.acceptanceCriterion}`
  );
  const reportedMetrics = mentionedMetrics([...successCriteria, ...requirementTexts]);
  const primaryMetric = mentionedMetrics(successCriteria)[0] ?? reportedMetrics[0] ?? null;

  const thresholds: Partial<Record<ExperimentMetric, number>> = {};
  for (const text of successCriteria) {
    for (const match of text.matchAll(THRESHOLD)) {
      const metric = metricOf(match[1] ?? '');
      if (metric !== null) thresholds[metric] = Number(match[2]);
    }
  }

  const allText = [
    analysis.technicalObjective ?? '',
    analysis.targetDefinition ?? '',
    ...requirementTexts,
    ...analysis.technologyStack.map(item => item.name),
  ].join('\n');
  const classification =
    analysis.targetDefinition !== null || /classif|phân loại|churn/iu.test(allText);
  const timeAware = /time[- ]?series|temporal|chuỗi thời gian|theo thời gian/iu.test(allText);

  const gaps: ExperimentPlanGap[] = [];
  if (variants.length === 0)
    gaps.push({
      id: 'no_variants',
      blocking: true,
      message:
        'Blueprint chưa nêu phương án mô hình nào trong bảng công nghệ ("Model Training - …").',
    });
  if (!classification)
    gaps.push({
      id: 'unsupported_task',
      blocking: true,
      message: 'Hiện chỉ hỗ trợ bài toán phân loại nhị phân có cột mục tiêu rõ ràng.',
    });
  if (primaryMetric === null)
    gaps.push({
      id: 'no_primary_metric',
      blocking: true,
      message: 'Blueprint chưa nêu metric đánh giá (ROC-AUC, F1, Recall, …).',
    });
  if (Object.keys(thresholds).length === 0)
    gaps.push({
      id: 'no_thresholds',
      blocking: false,
      message:
        'Blueprint chưa đặt ngưỡng metric; kết quả chỉ so sánh tương đối giữa các phương án.',
    });

  const protocol: EvaluationProtocol | null =
    classification && primaryMetric !== null
      ? {
          task: 'binary_classification',
          idColumn: MODELING_TABLE_COLUMNS.id,
          targetColumn: MODELING_TABLE_COLUMNS.target,
          positiveLabel: '1',
          split: timeAware
            ? { kind: 'time_holdout', testFraction: 0.2, timeColumn: MODELING_TABLE_COLUMNS.time }
            : { kind: 'stratified_holdout', testFraction: 0.2, seed: 42 },
          primaryMetric,
          ...(Object.keys(thresholds).length > 0 ? { thresholds } : {}),
        }
      : null;

  return experimentPlanSchema.parse({
    schemaVersion: 1,
    variants,
    techniques,
    protocol,
    reportedMetrics,
    gaps,
    ...(analysis.verificationContract
      ? { verificationContract: analysis.verificationContract }
      : {}),
    ...(analysis.blueprintDecisions ? { blueprintDecisions: analysis.blueprintDecisions } : {}),
  });
}

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical((value as Record<string, unknown>)[key])])
    );
  return value;
}

/** Stable hash of a derived plan; approval pins it so a changed blueprint needs a new review. */
export function hashExperimentPlan(plan: ExperimentPlan): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonical(plan)))
    .digest('hex')}`;
}
