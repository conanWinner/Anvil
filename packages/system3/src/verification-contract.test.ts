import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';
import { blueprintAnalysisSchema } from './contracts';
import { deriveExperimentPlan, hashExperimentPlan } from './experiment-plan';
import { readSystem2BlueprintJson, understandProjectSources } from './understanding';
import type { UnderstandingSourcePointer } from './understanding/schemas';
import {
  readVerificationContractValue,
  VERIFICATION_CONTRACT_LIMITS,
} from './verification-contract';

const pointer: UnderstandingSourcePointer = {
  sourceVersionId: 'source-1',
  filename: 'blueprint.md',
  headingPath: ['VERIFICATION CONTRACT'],
  startLine: 10,
  endLine: 20,
  jsonPointer: null,
  page: null,
  boundingBox: null,
  excerptHash: 'sha256:block',
};

const golden = {
  kind: 'golden_cases',
  tables: { 'orders.csv': 'order_id,score\no1,1\n' },
  expected: [{ entity_id: 'o1', target: 1 }],
};
const criterion = { id: 'FR-02.AC-01', requirementId: 'FR-02', statement: 'Nhãn đúng.' };

function read(
  criteria: unknown[],
  requirementIds = ['FR-02']
): ReturnType<typeof readVerificationContractValue> {
  return readVerificationContractValue({
    value: { contractVersion: 1, criteria },
    requirementIds,
    pointer,
  });
}

const sampleUrl = new URL(
  '../../web/public/samples/olist/review-risk-blueprint.md',
  import.meta.url
);

async function analyze(markdown: string): ReturnType<typeof understandProjectSources> {
  const bytes = new TextEncoder().encode(markdown);
  return understandProjectSources({
    sources: [
      {
        id: 'source-1',
        kind: 'blueprint',
        filename: 'blueprint.md',
        mediaType: 'text/markdown',
        contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        bytes,
      },
    ],
  });
}

async function sampleWithoutContract(): Promise<string> {
  const text = await readFile(sampleUrl, 'utf8');
  return text.slice(0, text.indexOf('## 7. VERIFICATION CONTRACT'));
}

describe('readVerificationContractValue', () => {
  test('keeps golden_cases and manual criteria with a pointer to each one', () => {
    const { contract, issues } = read([
      { ...criterion, check: golden },
      { ...criterion, id: 'FR-02.AC-02', check: { kind: 'manual' } },
    ]);
    expect(issues).toEqual([]);
    expect(contract?.criteria.map(item => item.check.kind)).toEqual(['golden_cases', 'manual']);
    expect(contract?.criteria[1]?.sourcePointers[0]?.jsonPointer).toBe('/criteria/1');
  });

  test('an unknown kind stays visible as unsupported with a warning that has a source', () => {
    const { contract, issues } = read([{ ...criterion, check: { kind: 'model_class' } }]);
    expect(contract?.criteria[0]?.check).toMatchObject({
      kind: 'unsupported',
      declaredKind: 'model_class',
    });
    expect(issues[0]).toMatchObject({ severity: 'warning', kind: 'unsupported_content' });
    expect(issues[0]?.sourcePointers[0]?.startLine).toBe(10);
  });

  test('a field this version cannot honour is not dropped: `level: optional` needs a revision', () => {
    const { contract, issues } = read([{ ...criterion, level: 'optional', check: golden }]);
    expect(contract?.criteria[0]?.check.kind).toBe('unsupported');
    expect(issues[0]).toMatchObject({ severity: 'revision_required' });
    expect(issues[0]?.detail).toContain('level');
  });

  test('duplicate criterion ids and unknown requirement ids cannot run', () => {
    const duplicate = read([
      { ...criterion, check: golden },
      { ...criterion, check: golden },
    ]);
    expect(duplicate.contract?.criteria.map(item => item.check.kind)).toEqual([
      'unsupported',
      'unsupported',
    ]);
    expect(duplicate.issues.map(item => item.kind)).toEqual([
      'duplicate_identifier',
      'duplicate_identifier',
    ]);
    const unknown = read([{ ...criterion, requirementId: 'FR-99', check: golden }]);
    expect(unknown.contract?.criteria[0]?.check.kind).toBe('unsupported');
    expect(unknown.issues[0]).toMatchObject({
      kind: 'invalid_reference',
      severity: 'revision_required',
    });
  });

  test.each([
    ['a path as table name', { ...golden, tables: { '../orders.csv': 'a\n1\n' } }],
    ['a nested table name', { ...golden, tables: { 'x/orders.csv': 'a\n1\n' } }],
    ['a non-CSV table name', { ...golden, tables: { 'orders.py': 'a\n1\n' } }],
    ['a table without rows', { ...golden, tables: { 'orders.csv': 'a,b\n' } }],
    ['uneven CSV rows', { ...golden, tables: { 'orders.csv': 'a,b\n1\n' } }],
    [
      'a table over the byte limit counted in bytes, not characters',
      {
        ...golden,
        tables: {
          'orders.csv': `a\n${'é'.repeat(VERIFICATION_CONTRACT_LIMITS.maxTableBytes / 2 + 1)}\n`,
        },
      },
    ],
    [
      'repeated expected ids',
      {
        ...golden,
        expected: [
          { entity_id: 'o1', target: 1 },
          { entity_id: 'o1', target: 0 },
        ],
      },
    ],
    ['a target that is not 0 or 1', { ...golden, expected: [{ entity_id: 'o1', target: 2 }] }],
    ['a command smuggled in the check', { ...golden, command: 'rm -rf /' }],
  ])('rejects %s with a revision Issue', (_name, check) => {
    const { contract, issues } = read([{ ...criterion, check }]);
    expect(contract?.criteria[0]?.check.kind).toBe('unsupported');
    expect(issues[0]?.severity).toBe('revision_required');
    expect(issues[0]?.sourcePointers.length).toBe(1);
  });

  test('limits the number of criteria and rejects workflow placeholders with an explicit Issue', () => {
    const tooMany = read(
      Array.from({ length: VERIFICATION_CONTRACT_LIMITS.maxCriteria + 1 }, (_, index) => ({
        ...criterion,
        id: `C-${index.toString()}`,
        check: { kind: 'manual' },
      }))
    );
    expect(tooMany.contract).toBeNull();
    expect(tooMany.issues[0]?.severity).toBe('revision_required');
    const placeholder = read([{ ...criterion, statement: 'Dùng $node.output', check: golden }]);
    expect(placeholder.contract).toBeNull();
    expect(placeholder.issues[0]?.detail).toContain('Giới hạn định dạng hiện tại');
  });
});

describe('reading a contract from a blueprint', () => {
  test('Markdown: the sample blueprint pins its FR-02 contract into the plan and its hash', async () => {
    const markdown = await readFile(sampleUrl, 'utf8');
    const { analysis } = await analyze(markdown);
    expect(analysis.extractionQuality.status).toBe('passed');
    expect(analysis.verificationContract?.criteria.map(item => item.id)).toEqual(['FR-02.AC-01']);
    expect(
      analysis.verificationContract?.criteria[0]?.sourcePointers[0]?.startLine
    ).toBeGreaterThan(90);
    // Survives the schema every pinned analysis goes through.
    const reparsed = blueprintAnalysisSchema.parse(JSON.parse(JSON.stringify(analysis)));
    const plan = deriveExperimentPlan(reparsed);
    expect(plan.verificationContract).toEqual(analysis.verificationContract);
    // Changing the contract changes the approved basis.
    const { analysis: changed } = await analyze(markdown.replace('"target": 1', '"target": 0'));
    expect(hashExperimentPlan(deriveExperimentPlan(changed))).not.toBe(hashExperimentPlan(plan));
  });

  test('a blueprint without a contract has no new key, so its old plan hash stays valid', async () => {
    const { analysis } = await analyze(await sampleWithoutContract());
    expect('verificationContract' in analysis).toBe(false);
    const plan = deriveExperimentPlan(analysis);
    expect('verificationContract' in plan).toBe(false);
    // Hash of the same plan computed without the field at all (as baseline a988571 did).
    const { verificationContract: _ignored, ...withoutField } = plan;
    expect(hashExperimentPlan(plan)).toBe(hashExperimentPlan(withoutField));
    const reparsed = blueprintAnalysisSchema.parse(JSON.parse(JSON.stringify(analysis)));
    expect(hashExperimentPlan(deriveExperimentPlan(reparsed))).toBe(hashExperimentPlan(plan));
  });

  test.each([
    ['bad JSON', '```anvil-contract\n{not json\n```\n'],
    [
      'a misspelt fence under the heading',
      '## VERIFICATION CONTRACT\n\n```anvil_contract\n{}\n```\n',
    ],
    ['a block nested in a list', '- item\n\n  ```anvil-contract\n  {}\n  ```\n'],
    [
      'two blocks',
      `\`\`\`anvil-contract\n${JSON.stringify({ contractVersion: 1, criteria: [{ ...criterion, check: { kind: 'manual' } }] })}\n\`\`\`\n\n\`\`\`anvil-contract\n{}\n\`\`\`\n`,
    ],
    ['a newer contract version', '```anvil-contract\n{"contractVersion":2,"criteria":[]}\n```\n'],
  ])('Markdown: %s becomes a revision Issue instead of vanishing', async (_name, block) => {
    const { analysis } = await analyze(`${await sampleWithoutContract()}\n${block}`);
    expect(analysis.verificationContract).toBeUndefined();
    const issue = analysis.extractionQuality.issues.find(item =>
      item.title.includes('Hợp đồng kiểm chứng')
    );
    expect(issue?.severity).toBe('revision_required');
    expect(issue?.sourcePointers[0]?.startLine).not.toBeNull();
    expect(analysis.extractionQuality.status).toBe('revision_required');
  });

  const jsonExport = {
    schemaVersion: 2,
    problemProfile: { businessGoal: 'Goal', technicalObjective: 'Objective' },
    requirementsContract: {
      requirements: [
        { id: 'FR-02', kind: 'FR', statement: 'Target', acceptanceCriterion: 'Đúng nhãn' },
      ],
    },
    highLevelPipeline: {},
    technologyStack: {},
    modularDesign: {},
    executionBlueprint: {},
  };

  test('JSON: version 2 reads the contract with a JSON pointer', () => {
    const { contract } = readSystem2BlueprintJson({
      json: JSON.stringify({
        ...jsonExport,
        verificationContract: {
          contractVersion: 1,
          criteria: [{ ...criterion, check: golden }],
        },
      }),
      sourceVersionId: 'source-1',
      filename: 'blueprint.json',
    });
    expect(contract.issues).toEqual([]);
    expect(contract.contract?.criteria[0]?.sourcePointers[0]?.jsonPointer).toBe(
      '/verificationContract/criteria/0'
    );
  });

  test('JSON: version 1 still reads, and a contract in it is reported rather than dropped', () => {
    const plain = readSystem2BlueprintJson({
      json: JSON.stringify({ ...jsonExport, schemaVersion: 1 }),
      sourceVersionId: 'source-1',
      filename: 'blueprint.json',
    });
    expect(plain.contract).toEqual({ contract: null, issues: [] });
    const withContract = readSystem2BlueprintJson({
      json: JSON.stringify({
        ...jsonExport,
        schemaVersion: 1,
        verificationContract: { contractVersion: 1, criteria: [] },
      }),
      sourceVersionId: 'source-1',
      filename: 'blueprint.json',
    });
    expect(withContract.contract.contract).toBeNull();
    expect(withContract.contract.issues[0]?.severity).toBe('revision_required');
  });
});
