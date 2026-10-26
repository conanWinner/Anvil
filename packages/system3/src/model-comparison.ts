import { createHash } from 'node:crypto';
import { z } from '@hono/zod-openapi';

const byteLengthAtMost = (value: string, maxBytes: number): boolean =>
  Buffer.byteLength(value, 'utf8') <= maxBytes;

const boundedText = (maxBytes: number, label: string): z.ZodString =>
  z
    .string()
    .refine(
      value => byteLengthAtMost(value, maxBytes),
      `${label} must be at most ${maxBytes} UTF-8 bytes`
    );

const modelRefSchema = z
  .string()
  .regex(/^router9\/[^\s/][^\s]*$/, 'Expected router9/<id>')
  .refine(
    value =>
      Array.from(value).every(character => {
        const code = character.charCodeAt(0);
        return code > 31 && (code < 127 || code > 159);
      }),
    'Model ref must not contain control characters'
  );

export const modelComparisonConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    models: z
      .array(modelRefSchema)
      .min(2)
      .max(4)
      .refine(models => new Set(models).size === models.length, 'Model refs must be distinct'),
    prompt: boundedText(32 * 1024, 'prompt').min(1),
    harness: boundedText(64 * 1024, 'harness').min(1),
    requirementIds: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(64)
      .refine(ids => new Set(ids).size === ids.length, 'Requirement IDs must be distinct'),
  })
  .strict();
export type ModelComparisonConfig = z.infer<typeof modelComparisonConfigSchema>;

export function parsePinnedModelComparisonConfig(
  bytes: Uint8Array,
  expectedContentHash: string
): ModelComparisonConfig {
  const actualHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (actualHash !== expectedContentHash) {
    throw new Error('Pinned model comparison configuration hash mismatch');
  }
  const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  return z.object({ modelComparison: modelComparisonConfigSchema }).strict().parse(json)
    .modelComparison;
}

export const modelComparisonCodeSchema = z
  .object({
    code: boundedText(64 * 1024, 'code').refine(
      value => value.length > 0,
      'code must not be empty'
    ),
  })
  .strict();
export type ModelComparisonCode = z.infer<typeof modelComparisonCodeSchema>;

export const modelComparisonHarnessOutputSchema = z
  .object({
    checks: z
      .array(
        z
          .object({
            requirementId: z.string().trim().min(1),
            passed: z.boolean(),
            detail: boundedText(2 * 1024, 'detail'),
          })
          .strict()
      )
      .max(64),
  })
  .strict();
export type ModelComparisonHarnessOutput = z.infer<typeof modelComparisonHarnessOutputSchema>;

export const modelComparisonStatusSchema = z.enum(['completed', 'failed', 'cancelled']);
export const modelComparisonUsageSchema = z.object({ status: z.literal('unknown') }).strict();

export const modelComparisonModelReportSchema = z
  .object({
    runId: z.string().min(1),
    model: modelRefSchema,
    inputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    promptHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    codeHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .nullable(),
    outputHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .nullable(),
    harnessHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    status: modelComparisonStatusSchema,
    error: z.string().nullable(),
    usage: modelComparisonUsageSchema,
    checks: z.array(modelComparisonHarnessOutputSchema.shape.checks.element).max(64).nullable(),
  })
  .strict();
export type ModelComparisonModelReport = z.infer<typeof modelComparisonModelReportSchema>;

export function sha256Hash(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function buildModelComparisonPrompt(input: {
  task: string;
  inputHash: string;
  prompt: string;
}): string {
  const inputHash = z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .parse(input.inputHash);
  const task = z.string().min(1).parse(input.task);
  const prompt = boundedText(32 * 1024, 'prompt')
    .min(1)
    .parse(input.prompt);
  return [
    prompt,
    '',
    'Return one JSON object matching {"code":"..."}; code must be a complete Python 3 solution for solution.py.',
    'The solution runs with Python standard library only. It must read /work/input.csv and write its result to stdout as one JSON value.',
    'The stdout JSON must be at most 64 KiB. Do not use tools, network access, or external dependencies.',
    'The separately supplied harness runs in its own sandbox. It receives /work/input.csv and /work/candidate-output.json, and emits only stdout JSON shaped as {"checks":[{"requirementId":"...","passed":true,"detail":"..."}]}.',
    'The harness does not import or execute generated solution code. Do not assume or describe harness internals beyond this contract.',
    `Approved problem:\n${task}`,
    `Pinned input SHA-256: ${inputHash}`,
  ].join('\n');
}

export function validateModelComparisonHarnessOutput(
  raw: unknown,
  requirementIds: readonly string[]
): ModelComparisonHarnessOutput {
  const output = modelComparisonHarnessOutputSchema.parse(raw);
  const expected = new Set(requirementIds);
  const seen = new Set<string>();
  for (const check of output.checks) {
    if (seen.has(check.requirementId)) {
      throw new Error(`Harness output has duplicate requirement ID '${check.requirementId}'`);
    }
    if (!expected.has(check.requirementId)) {
      throw new Error(`Harness output has unknown requirement ID '${check.requirementId}'`);
    }
    seen.add(check.requirementId);
  }
  const missing = requirementIds.filter(id => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`Harness output is missing requirement IDs: ${missing.join(', ')}`);
  }
  return output;
}

export function createModelComparisonReport(input: {
  runId: string;
  model: string;
  inputHash: string;
  prompt: string;
  code: string | null;
  candidateOutput: string | null;
  harness: string;
  status: z.infer<typeof modelComparisonStatusSchema>;
  error: string | null;
  harnessOutput?: unknown;
  requirementIds: readonly string[];
}): ModelComparisonModelReport {
  const checks =
    input.harnessOutput === undefined
      ? null
      : validateModelComparisonHarnessOutput(input.harnessOutput, input.requirementIds).checks;
  if (
    input.status === 'completed' &&
    (checks === null ||
      input.code === null ||
      input.candidateOutput === null ||
      input.error !== null)
  ) {
    throw new Error(
      'A completed model report requires code, candidate output, valid harness evidence, and no execution error'
    );
  }
  return modelComparisonModelReportSchema.parse({
    runId: input.runId,
    model: input.model,
    inputHash: input.inputHash,
    promptHash: sha256Hash(input.prompt),
    codeHash: input.code === null ? null : sha256Hash(input.code),
    outputHash: input.candidateOutput === null ? null : sha256Hash(input.candidateOutput),
    harnessHash: sha256Hash(input.harness),
    status: input.status,
    error: input.error,
    usage: { status: 'unknown' },
    checks,
  });
}
