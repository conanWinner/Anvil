import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadConfig, type Codebase } from '@anvil/core';
import * as codebaseDb from '@anvil/core/db/codebases';
import * as workflowDb from '@anvil/core/db/workflows';
import type { WorkflowRun } from '@anvil/workflows/schemas/workflow-run';
import type { WorkflowIntakeDraft } from '@anvil/core/db/workflow-intakes';
import { findMarkdownFilesRecursive } from '@anvil/core/utils/commands';
import { getWorkflowIntakesPath } from '@anvil/paths';
import type { WorkflowDefinition, WorkflowIntakeField } from '@anvil/workflows/schemas/workflow';
import { discoverWorkflowsWithConfig } from '@anvil/workflows/workflow-discovery';
import { intakePrompt } from './workflow-intake-chat';

export function toApiWorkflowIntakeDraft(draft: WorkflowIntakeDraft): {
  id: string;
  codebaseId: string;
  workflowName: string;
  definitionHash: string;
  status: WorkflowIntakeDraft['status'];
  values: Record<string, unknown>;
  currentField: string | null;
  validationErrors: string[];
  startedRunId: string | null;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: draft.id,
    codebaseId: draft.codebase_id,
    workflowName: draft.workflow_name,
    definitionHash: draft.definition_hash,
    status: draft.status,
    values: draft.values,
    currentField: draft.current_field,
    validationErrors: draft.validation_errors,
    startedRunId: draft.started_run_id,
    createdAt: draft.created_at,
    updatedAt: draft.updated_at,
  };
}

export async function resolveWorkflowIntake(
  codebaseId: string,
  workflowName: string
): Promise<{ codebase: Codebase; workflow: WorkflowDefinition; definitionHash: string } | null> {
  const codebase = await codebaseDb.getCodebase(codebaseId);
  if (!codebase) return null;
  const discovered = await discoverWorkflowsWithConfig(codebase.default_cwd, loadConfig);
  const entry = discovered.workflows.find(item => item.workflow.name === workflowName);
  if (!entry?.workflow.intake) return null;
  const definitionHash = createHash('sha256').update(JSON.stringify(entry.workflow)).digest('hex');
  return { codebase, workflow: entry.workflow, definitionHash };
}

export async function validateWorkflowIntakeValues(
  workflow: Pick<WorkflowDefinition, 'input_schema' | 'intake'>,
  values: Record<string, unknown>,
  projectCwd: string,
  codebaseId: string
): Promise<string[]> {
  const required = Array.isArray(workflow.input_schema?.required)
    ? workflow.input_schema.required.filter((field): field is string => typeof field === 'string')
    : [];
  const errors = required
    .filter(field => values[field] === undefined || values[field] === null)
    .map(field => `Thiếu đầu vào bắt buộc: ${field}`);
  const fields = workflow.intake?.fields ?? [];
  if (fields.length === 0) errors.push('Workflow intake phải có ít nhất một field');

  for (const field of fields) {
    const value = values[field.input];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const inputPath = record.path;
    if (typeof inputPath !== 'string' || inputPath.trim().length === 0) continue;
    if (field.control !== 'file' && field.control !== 'dataset') continue;
    try {
      const uploaded = record.kind === 'uploaded';
      const allowedRoot = await realpath(
        uploaded ? join(getWorkflowIntakesPath(), codebaseId) : projectCwd
      );
      const resolved = await realpath(resolve(allowedRoot, inputPath));
      const pathWithinRoot = relative(allowedRoot, resolved);
      if (
        pathWithinRoot === '..' ||
        pathWithinRoot.startsWith(`..${sep}`) ||
        isAbsolute(pathWithinRoot)
      ) {
        errors.push(
          uploaded
            ? `${field.input} không nằm trong kho Intake được quản lý`
            : `${field.input} phải nằm trong project; với file bên ngoài, hãy dùng nút đính kèm`
        );
        continue;
      }
      const entry = await stat(resolved);
      if (field.control === 'file' && !entry.isFile()) {
        errors.push(`${field.input} phải trỏ tới một file`);
      }
    } catch {
      errors.push(
        record.kind === 'uploaded'
          ? `${field.input} không tồn tại trong kho Intake được quản lý`
          : `${field.input} không tồn tại trong thư mục project`
      );
    }
  }
  return errors;
}

export async function buildWorkflowIntakePrompt(
  field: WorkflowIntakeField,
  projectCwd: string
): Promise<string> {
  if (field.control !== 'file') return intakePrompt(field);
  const markdownFiles = await findMarkdownFilesRecursive(projectCwd, '', { maxDepth: 3 });
  const suggestions = markdownFiles
    .map(item => item.relativePath)
    .sort((left, right) => {
      const leftRelevant = /system2|blueprint/i.test(left) ? 0 : 1;
      const rightRelevant = /system2|blueprint/i.test(right) ? 0 : 1;
      return leftRelevant - rightRelevant || left.localeCompare(right);
    })
    .slice(0, 5);
  return intakePrompt(field, suggestions);
}

export function intakeMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

export async function fingerprintIntakePath(
  projectCwd: string,
  inputPath: string,
  codebaseId: string,
  uploaded: boolean
): Promise<Record<string, unknown>> {
  const allowedRoot = await realpath(
    uploaded ? join(getWorkflowIntakesPath(), codebaseId) : projectCwd
  );
  const resolvedPath = await realpath(resolve(allowedRoot, inputPath));
  const relativePath = relative(allowedRoot, resolvedPath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Intake path escapes its allowed root: ${inputPath}`);
  }
  const entry = await stat(resolvedPath);
  if (entry.isFile()) {
    const contents = await readFile(resolvedPath);
    return {
      kind: 'file',
      path: relativePath,
      storage: uploaded ? 'managed_intake' : 'project',
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      mime: intakeMimeType(relativePath),
      sha256: createHash('sha256').update(contents).digest('hex'),
    };
  }
  if (!entry.isDirectory()) throw new Error(`Unsupported intake path: ${inputPath}`);

  const inventory: { path: string; size: number; mtimeMs: number }[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of entries) {
      const logicalPath = join(directory, child.name);
      const canonicalPath = await realpath(logicalPath);
      const canonicalRelative = relative(allowedRoot, canonicalPath);
      if (
        canonicalRelative === '..' ||
        canonicalRelative.startsWith(`..${sep}`) ||
        isAbsolute(canonicalRelative)
      ) {
        throw new Error(`Dataset entry escapes the project: ${relativePath}`);
      }
      const childStat = await stat(canonicalPath);
      if (childStat.isDirectory()) await visit(canonicalPath);
      else if (childStat.isFile()) {
        inventory.push({
          path: relative(resolvedPath, logicalPath),
          size: childStat.size,
          mtimeMs: childStat.mtimeMs,
        });
      }
    }
  };
  await visit(resolvedPath);
  inventory.sort((left, right) => left.path.localeCompare(right.path));
  return {
    kind: 'directory',
    path: relativePath,
    fileCount: inventory.length,
    inventory,
    fingerprint: createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
  };
}

export async function buildIntakeProvenance(
  values: Record<string, unknown>,
  projectCwd: string,
  codebaseId: string
): Promise<Record<string, unknown>> {
  const provenance: Record<string, unknown> = {};
  for (const [input, value] of Object.entries(values)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const inputPath = record.path;
    if (typeof inputPath !== 'string' || inputPath.trim() === '') continue;
    provenance[input] = await fingerprintIntakePath(
      projectCwd,
      inputPath,
      codebaseId,
      record.kind === 'uploaded'
    );
  }
  return provenance;
}

export async function waitForIntakeRun(options: {
  parentConversationId: string;
  codebaseId: string;
  workflowName: string;
  inputs: Record<string, unknown>;
  excludedRunIds?: ReadonlySet<string>;
}): Promise<WorkflowRun | null> {
  const expectedInputs = JSON.stringify(options.inputs);
  for (let attempt = 0; attempt < 200; attempt++) {
    const runs = await workflowDb.listWorkflowRuns({
      parentConversationId: options.parentConversationId,
      codebaseId: options.codebaseId,
      rootOnly: true,
      limit: 20,
    });
    const run = runs.find(
      item =>
        item.workflow_name === options.workflowName &&
        !options.excludedRunIds?.has(item.id) &&
        JSON.stringify(item.metadata.inputs ?? {}) === expectedInputs
    );
    if (run) return run;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }
  return null;
}
