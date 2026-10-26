import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  buildModelComparisonPrompt,
  createModelComparisonReport,
  modelComparisonCodeSchema,
  modelComparisonConfigSchema,
  parsePinnedModelComparisonConfig,
  validateModelComparisonHarnessOutput,
} from './model-comparison';

const config = {
  schemaVersion: 1 as const,
  models: ['router9/cx/gpt-6-luna', 'router9/cx/gpt-5.6-luna'],
  prompt: 'Write a parser.',
  harness: 'bounded python harness',
  requirementIds: ['REQ-1', 'REQ-2'],
};
const inputHash = `sha256:${'a'.repeat(64)}`;
const harnessOutput = {
  checks: [
    { requirementId: 'REQ-1', passed: true, detail: 'ok' },
    { requirementId: 'REQ-2', passed: false, detail: 'failed' },
  ],
};

test('validates bounded comparison config and structured code output', () => {
  expect(modelComparisonConfigSchema.parse(config)).toEqual(config);
  expect(
    modelComparisonConfigSchema.safeParse({ ...config, models: ['router9/a', 'router9/a'] }).success
  ).toBe(false);
  expect(modelComparisonCodeSchema.safeParse({ code: 'print(1)' }).success).toBe(true);
  expect(modelComparisonCodeSchema.safeParse({ code: '' }).success).toBe(false);
});

test('parses comparison config only from bytes matching the pinned content hash', () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ modelComparison: config }));
  const expectedHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  expect(parsePinnedModelComparisonConfig(bytes, expectedHash)).toEqual(config);
  expect(() => parsePinnedModelComparisonConfig(bytes, inputHash)).toThrow(
    'Pinned model comparison configuration hash mismatch'
  );
});

test('builds a no-tools prompt bound to task and input hash', () => {
  const prompt = buildModelComparisonPrompt({
    task: 'Parse CSV',
    inputHash,
    prompt: config.prompt,
  });
  expect(prompt).toContain('Parse CSV');
  expect(prompt).toContain(inputHash);
  expect(prompt).toContain('Do not use tools');
});

test('requires exact harness requirement coverage before completed report', () => {
  expect(validateModelComparisonHarnessOutput(harnessOutput, config.requirementIds)).toEqual(
    harnessOutput
  );
  expect(() =>
    validateModelComparisonHarnessOutput(
      { checks: [harnessOutput.checks[0], harnessOutput.checks[0]] },
      config.requirementIds
    )
  ).toThrow('duplicate requirement ID');
  expect(() =>
    validateModelComparisonHarnessOutput(
      { checks: [harnessOutput.checks[0]] },
      config.requirementIds
    )
  ).toThrow('missing requirement IDs');
  expect(() =>
    validateModelComparisonHarnessOutput(
      {
        checks: [
          harnessOutput.checks[0],
          { requirementId: 'REQ-unknown', passed: true, detail: 'unexpected' },
        ],
      },
      config.requirementIds
    )
  ).toThrow('unknown requirement ID');
  expect(() =>
    createModelComparisonReport({
      runId: 'run-1',
      model: config.models[0]!,
      inputHash,
      prompt: 'actual generation prompt with pinned task context',
      code: 'print(1)',
      candidateOutput: '{"answer":1}',
      harness: config.harness,
      status: 'completed',
      error: null,
      requirementIds: config.requirementIds,
    })
  ).toThrow('valid harness evidence');
  const report = createModelComparisonReport({
    runId: 'run-1',
    model: config.models[0]!,
    inputHash,
    prompt: 'actual generation prompt with pinned task context',
    code: 'print(1)',
    candidateOutput: '{"answer":1}',
    harness: config.harness,
    status: 'completed',
    error: null,
    harnessOutput,
    requirementIds: config.requirementIds,
  });
  expect(report.usage).toEqual({ status: 'unknown' });
  expect(report.checks).toEqual(harnessOutput.checks);
});
