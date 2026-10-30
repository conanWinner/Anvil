import { z } from '@hono/zod-openapi';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { experimentVariantIdSchema } from './experiment-evaluation';
import { inspectSandboxOutput } from './sandbox-process';

/**
 * Training and model parameters of a variant. They are data handed to the generated code, never
 * code, and stay inside the sandbox limits; changing them needs no new approval. The split, metric
 * and thresholds are not parameters: those come from the blueprint and do need one.
 */

/** Key inside `reported/<variant>.json` holding the parameters a run really used. */
export const PARAMS_REPORT_KEY = 'params';

export const variantParamValueSchema = z
  .union([z.number().finite(), z.string().max(200), z.boolean()])
  .nullable();

export const variantParamsSchema = z
  .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]{0,63}$/u), variantParamValueSchema)
  .refine(params => Object.keys(params).length <= 40, 'A variant has at most 40 parameters');
export type VariantParams = z.infer<typeof variantParamsSchema>;

export const variantParamOverridesSchema = z.record(experimentVariantIdSchema, variantParamsSchema);
export type VariantParamOverrides = z.infer<typeof variantParamOverridesSchema>;

/** One tuning run of one variant; only validation scores, never the held-out test score. */
export const variantTrialSchema = z.object({
  round: z.number().int().positive(),
  variant: experimentVariantIdSchema,
  status: z.enum(['completed', 'failed', 'resource_limit']),
  /** The parameters this run used; null when the run reported none. */
  params: variantParamsSchema.nullable(),
  validationMetrics: z.record(z.string(), z.number()).nullable(),
  durationMs: z.number(),
});
export type VariantTrial = z.infer<typeof variantTrialSchema>;

/** Parameters a run reported, or null when the report is absent, a link, unreadable or malformed. */
export async function readReportedParams(
  outputDir: string,
  variant: string
): Promise<VariantParams | null> {
  const relativePath = `reported/${variant}.json`;
  if ((await inspectSandboxOutput(outputDir, relativePath)) !== 'regular') return null;
  try {
    const report = JSON.parse(await readFile(join(outputDir, relativePath), 'utf8')) as unknown;
    if (report === null || typeof report !== 'object') return null;
    const parsed = variantParamsSchema.safeParse(
      (report as Record<string, unknown>)[PARAMS_REPORT_KEY]
    );
    return parsed.success ? parsed.data : null;
  } catch {
    // Agent output: an unreadable report is the same as no report.
    return null;
  }
}

/**
 * A value different from the default that the parameter should accept, used to prove overrides take
 * effect. Values of 0 and 1 are skipped: they are often the edge of a parameter's valid range.
 */
export function chooseProbeOverride(defaults: VariantParams): VariantParams | null {
  const numbers = Object.entries(defaults).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === 'number' && entry[1] !== 0 && entry[1] !== 1
  );
  const whole = numbers.find(([, value]) => Number.isInteger(value) && value >= 2);
  if (whole) return { [whole[0]]: whole[1] + 1 };
  const fraction = numbers.find(([, value]) => value > 0);
  return fraction ? { [fraction[0]]: fraction[1] / 2 } : null;
}

/** Problems with requested overrides, checked against the defaults the build reported. */
export function findOverrideProblems(
  defaults: Readonly<Record<string, VariantParams>>,
  overrides: VariantParamOverrides
): string[] {
  const problems: string[] = [];
  for (const [variant, values] of Object.entries(overrides)) {
    const known = defaults[variant];
    if (known === undefined) {
      if (Object.keys(values).length > 0)
        problems.push(`Phương án ${variant} không có tham số để đổi`);
      continue;
    }
    for (const [name, value] of Object.entries(values)) {
      if (!Object.hasOwn(known, name)) {
        problems.push(`Phương án ${variant} không có tham số ${name}`);
        continue;
      }
      const expected = known[name];
      if (expected !== null && value !== null && typeof expected !== typeof value)
        problems.push(`Tham số ${name} của ${variant} phải có kiểu ${typeof expected}`);
    }
  }
  return problems;
}

/** Requested overrides the run did not report using. */
export function findIgnoredOverrides(
  requested: VariantParams,
  reported: VariantParams | null
): string[] {
  return Object.entries(requested)
    .filter(([name, value]) => reported?.[name] !== value)
    .map(([name]) => name);
}
