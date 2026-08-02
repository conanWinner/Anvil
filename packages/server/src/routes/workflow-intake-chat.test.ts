import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { WorkflowIntakeField } from '@anvil/workflows/schemas/workflow';
import {
  buildIntakeStartCommand,
  defaultApprovalPolicy,
  extractIntakePath,
  intakeSummary,
  isIntakeConfirmation,
  nextIntakeField,
  parseIntakeAnswer,
  requestedIntakeEdit,
  storeManagedIntakeAttachment,
} from './workflow-intake-chat';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true })));
});

const fields: WorkflowIntakeField[] = [
  { input: 'blueprint', control: 'file', prompt: 'Blueprint?' },
  { input: 'dataset', control: 'dataset', prompt: 'Dataset?' },
  { input: 'requirements', control: 'textarea', prompt: 'Requirements?' },
  { input: 'approval', control: 'approval_policy', prompt: 'Approval?' },
];

describe('workflow intake chat state', () => {
  test('stores an immutable hash-addressed copy of an external file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'anvil-intake-upload-'));
    temporaryDirectories.push(root);
    const bytes = Buffer.from('# External System 2\n');
    const stored = await storeManagedIntakeAttachment({
      root,
      codebaseId: 'project-1',
      draftId: 'draft-1',
      originalName: '../System 2.md',
      bytes,
    });
    expect(stored.safeName).toBe('System_2.md');
    expect(stored.path).toContain(join('project-1', 'draft-1', stored.sha256));
    expect(await readFile(stored.path, 'utf8')).toBe('# External System 2\n');
  });

  test('confirmed intake starts fresh even when an older failed run exists', () => {
    expect(buildIntakeStartCommand('system3-master', 'encoded', 'Start confirmed intake')).toBe(
      '/workflow run system3-master --force --inputs-json encoded Start confirmed intake'
    );
  });

  test('collects three conversational fields and applies approval default', () => {
    const values: Record<string, unknown> = {};
    expect(nextIntakeField(fields, values)?.input).toBe('blueprint');
    values.blueprint = parseIntakeAnswer(fields[0]!, 'docs/system2.md');
    expect(nextIntakeField(fields, values, 'blueprint')?.input).toBe('dataset');
    values.dataset = parseIntakeAnswer(fields[1]!, 'không');
    expect(values.dataset).toEqual({ mode: 'not_provided' });
    values.requirements = parseIntakeAnswer(fields[2]!, 'không');
    expect(nextIntakeField(fields, values, 'requirements')).toBeNull();
    expect(values.approval).toEqual(defaultApprovalPolicy());
  });

  test('recognizes confirmation and edit without invoking an AI model', () => {
    expect(isIntakeConfirmation('Xác nhận')).toBeTrue();
    expect(isIntakeConfirmation('maybe')).toBeFalse();
    expect(requestedIntakeEdit('/edit dataset')).toBe('dataset');
    expect(requestedIntakeEdit('edit dataset')).toBeNull();
  });

  test('extracts a project path from a natural-language answer', () => {
    expect(extractIntakePath('docs/system2.md đây nhe bạn', 'file')).toBe('docs/system2.md');
    expect(extractIntakePath('file là `fixtures/system2-minimal.md` nhé', 'file')).toBe(
      'fixtures/system2-minimal.md'
    );
    expect(extractIntakePath('dataset ở fixtures/dataset.csv đó', 'dataset')).toBe(
      'fixtures/dataset.csv'
    );
  });

  test('renders a review summary from typed values', () => {
    const summary = intakeSummary('Review', fields, {
      blueprint: { kind: 'project_file', path: 'docs/system2.md' },
      dataset: { mode: 'not_provided' },
      requirements: { notes: 'CPU only' },
      approval: defaultApprovalPolicy(),
    });
    expect(summary).toContain('docs/system2.md');
    expect(summary).toContain('not_provided');
    expect(summary).toContain('Xác nhận');
  });

  test('shows an uploaded file name instead of its managed absolute path', () => {
    const summary = intakeSummary('Review', fields, {
      blueprint: {
        kind: 'uploaded',
        original_name: 'system2-blueprint.md',
        path: '/home/user/.anvil/intakes/internal-hash-system2-blueprint.md',
      },
      dataset: { mode: 'not_provided' },
      requirements: { notes: '' },
      approval: defaultApprovalPolicy(),
    });
    expect(summary).toContain('system2-blueprint.md (đã tải lên)');
    expect(summary).not.toContain('/home/user/.anvil/intakes');
  });
});
