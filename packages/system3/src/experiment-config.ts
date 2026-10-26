import { z } from '@hono/zod-openapi';
import { createHash } from 'node:crypto';
import { experimentVariantIdSchema } from './experiment-evaluation';

/** Pinned as a constraints Source Version named `experiment-config.json`. */
export const EXPERIMENT_CONFIG_FILENAME = 'experiment-config.json';

const modelRefSchema = z.string().regex(/^router9\/[^\s/][^\s]*$/u, 'Use a router9/<model-id> ref');

export const experimentConfigSchema = z.object({
  schemaVersion: z.literal(1),
  /** Writes the codebase (file contents only, no tools). */
  builderModel: modelRefSchema,
  /** Reviews the codebase before full runs; may equal the builder model (separate session). */
  reviewerModel: modelRefSchema,
  /** Subset of plan variants to run; omitted means every variant the blueprint names. */
  variantIds: z.array(experimentVariantIdSchema).min(1).max(12).optional(),
  maxFixRounds: z.number().int().min(1).max(6).default(4),
  maxReviewRounds: z.number().int().min(0).max(4).default(3),
  variantTimeoutMinutes: z.number().int().min(1).max(30).default(25),
});
export type ExperimentConfig = z.infer<typeof experimentConfigSchema>;

export function parsePinnedExperimentConfig(
  bytes: Uint8Array,
  contentHash: string
): ExperimentConfig {
  const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (actual !== contentHash) throw new Error('Pinned experiment config hash does not match');
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  const body =
    typeof parsed === 'object' && parsed !== null && 'experiment' in parsed
      ? parsed.experiment
      : parsed;
  return experimentConfigSchema.parse(body);
}

/** What an approved plan pins for experiment mode; changing any of it needs a new approval. */
export const experimentPinSchema = z.object({
  config: experimentConfigSchema,
  variantIds: z.array(experimentVariantIdSchema).min(1),
  /** Hash of the derived experiment plan (variants, techniques, protocol). */
  planHash: z.string().startsWith('sha256:'),
  runtimeLockHash: z.string().startsWith('sha256:'),
  datasetSourceVersionIds: z.array(z.string().min(1)).min(1),
  /** Readable projection of the pinned plan for the approval screen (derived, hash-covered). */
  summary: z.object({
    variants: z.array(
      z.object({
        id: experimentVariantIdSchema,
        name: z.string(),
        role: z.enum(['baseline', 'candidate']),
        recommended: z.boolean(),
      })
    ),
    primaryMetric: z.string(),
    thresholds: z.record(z.string(), z.number()).nullable(),
    split: z.string(),
    gaps: z.array(z.string()),
  }),
});
export type ExperimentPin = z.infer<typeof experimentPinSchema>;
