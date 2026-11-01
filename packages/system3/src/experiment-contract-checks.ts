import { parse as parseCsv } from 'csv-parse/sync';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SYSTEM3_CSV_PARSE_OPTIONS } from './csv-contract';
import { ANVIL_EVALUATOR_DIR } from './experiment-evaluation';
import { canonical, MODELING_TABLE_COLUMNS } from './experiment-plan';
import { runExperimentSandbox, type ExperimentSandboxResult } from './experiment-sandbox';
import type { MlRuntime } from './ml-runtime';
import type { UnderstandingSourcePointer } from './understanding/schemas';
import {
  parseGoldenTable,
  type GoldenCasesCheck,
  type VerificationContract,
  type VerificationCriterion,
} from './verification-contract';

/**
 * Anvil's own execution of a verification contract. The fixture and expected rows come from the
 * approved plan and are written to a directory Anvil owns, outside anything agent code can write.
 * Generated code only runs in the sandbox; the host reads its output as data.
 */

export const CONTRACT_CHECKER_VERSION = 'system3-contract-checks@1';

const SANDBOX_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
/** Fixtures hold at most 200 rows per table, so a correct table on one is far smaller than this. */
const MAX_OUTPUT_ROWS = 2_000;
const LISTED_DIFFERENCES = 20;
const KILLED_BY_SIGNAL = 137;

const KIND_SCOPE = {
  golden_cases: {
    claim:
      'prepare_data.py cho đúng tập entity_id và target trên ca mẫu đã duyệt, chạy trong sandbox.',
    limitation:
      'Chỉ đúng trên các dòng của ca mẫu; agent thấy ca mẫu này. Không chứng minh đúng trên toàn bộ dữ liệu, không kiểm tra feature hay leakage.',
  },
  manual: {
    claim: 'Không có kiểm tra tự động.',
    limitation: 'Cần người xem xét; ý kiến của agent review không được tính là bằng chứng.',
  },
  unsupported: {
    claim: 'Không có kiểm tra tự động.',
    limitation: 'Anvil không chạy điều kiện này; xem lý do và sửa blueprint nếu cần.',
  },
} as const;

export type ContractCheckStatus = 'passed' | 'failed' | 'not_verified' | 'blocked';
/** Why a check did not pass: only `code` and `output` say something about the generated code. */
export type ContractFailureClass = 'code' | 'output' | 'environment' | 'resource_limit' | null;

export interface GoldenDifferences {
  missing: string[];
  extra: string[];
  duplicate: string[];
  wrongTarget: { entityId: string; expected: number; actual: string }[];
  /** Total differences, including any beyond the listed ones. */
  total: number;
}

export interface ContractCheckResult {
  criterionId: string;
  requirementId: string;
  kind: VerificationCriterion['check']['kind'];
  status: ContractCheckStatus;
  failureClass: ContractFailureClass;
  reason: string;
  claim: string;
  limitation: string;
  fixtureHash: string | null;
  differences: GoldenDifferences | null;
  sourcePointers: UnderstandingSourcePointer[];
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function hashVerificationContract(contract: VerificationContract): string {
  return sha256(JSON.stringify(canonical(contract)));
}

function fixtureHash(check: GoldenCasesCheck): string {
  return sha256(JSON.stringify(canonical(check)));
}

/** Reads a CSV's header row without loading the file: pinned data can be large. */
async function csvHeader(path: string): Promise<string[]> {
  const file = Bun.file(path);
  const head = await file.slice(0, 1024 * 1024).text();
  const records = parseCsv(head, {
    ...SYSTEM3_CSV_PARSE_OPTIONS,
    to_line: 1,
    relax_column_count: true,
  });
  return records[0] ?? [];
}

/** Fixture tables must match the pinned raw files: same file names, same columns. */
export async function findGoldenFixtureProblems(
  contract: VerificationContract,
  rawDataDir: string
): Promise<string[]> {
  const rawNames = (await readdir(rawDataDir)).filter(name => name.endsWith('.csv')).sort();
  const problems: string[] = [];
  for (const criterion of contract.criteria) {
    if (criterion.check.kind !== 'golden_cases') continue;
    const { tables } = criterion.check;
    const label = criterion.id;
    for (const name of rawNames) {
      if (tables[name] === undefined) {
        problems.push(`${label}: ca mẫu thiếu bảng ${name}.`);
        continue;
      }
      const expected = (await csvHeader(join(rawDataDir, name))).join(',');
      const actual = parseGoldenTable(tables[name]).columns.join(',');
      if (expected !== actual)
        problems.push(`${label}: cột của ${name} khác dữ liệu thật (${expected} ≠ ${actual}).`);
    }
    for (const name of Object.keys(tables)) {
      if (!rawNames.includes(name))
        problems.push(`${label}: ca mẫu có bảng ${name} không có trong dữ liệu đã ghim.`);
    }
  }
  return problems;
}

function targetValue(raw: string): 0 | 1 | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return value === 0 || value === 1 ? value : null;
}

/** Exact comparison of a modeling table against the expected rows. Pure, so it needs no sandbox. */
export function compareGoldenOutput(
  csvText: string,
  expected: GoldenCasesCheck['expected']
): { differences: GoldenDifferences } | { unreadable: string } {
  let header: string[];
  let rows: string[][];
  try {
    // Stop parsing one row past the limit: the text comes from generated code.
    const parsed = parseGoldenTable(csvText, { to_line: MAX_OUTPUT_ROWS + 2 });
    header = parsed.columns;
    rows = parsed.rows;
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
  if (rows.length > MAX_OUTPUT_ROWS)
    return { unreadable: `Bảng có hơn ${MAX_OUTPUT_ROWS.toString()} dòng trên ca mẫu nhỏ.` };
  const idIndex = header.indexOf(MODELING_TABLE_COLUMNS.id);
  const targetIndex = header.indexOf(MODELING_TABLE_COLUMNS.target);
  if (idIndex < 0 || targetIndex < 0)
    return {
      unreadable: `Bảng phải có cột ${MODELING_TABLE_COLUMNS.id} và ${MODELING_TABLE_COLUMNS.target}; đang có: ${header.join(', ')}`,
    };
  const seen = new Map<string, { count: number; firstTarget: string }>();
  for (const row of rows) {
    const id = row[idIndex] ?? '';
    const entry = seen.get(id);
    if (entry) entry.count += 1;
    else seen.set(id, { count: 1, firstTarget: row[targetIndex] ?? '' });
  }
  const wanted = new Map(expected.map(row => [row.entity_id, row.target]));
  const missing = [...wanted.keys()].filter(id => !seen.has(id));
  const extra = [...seen.keys()].filter(id => !wanted.has(id));
  const duplicate = [...seen.entries()].filter(([, entry]) => entry.count > 1).map(([id]) => id);
  const wrongTarget: GoldenDifferences['wrongTarget'] = [];
  for (const [id, want] of wanted) {
    const entry = seen.get(id);
    if (entry && targetValue(entry.firstTarget) !== want)
      wrongTarget.push({ entityId: id, expected: want, actual: entry.firstTarget });
  }
  return {
    differences: {
      missing: missing.slice(0, LISTED_DIFFERENCES),
      extra: extra.slice(0, LISTED_DIFFERENCES),
      duplicate: duplicate.slice(0, LISTED_DIFFERENCES),
      wrongTarget: wrongTarget.slice(0, LISTED_DIFFERENCES),
      total: missing.length + extra.length + duplicate.length + wrongTarget.length,
    },
  };
}

/** Output of generated code is untrusted: a symlink could point at any file on the host. */
async function readOutputTable(path: string): Promise<string | { problem: string }> {
  const info = await lstat(path).catch(() => null);
  if (info === null) return { problem: 'prepare_data.py không ghi /work/out/modeling_table.csv.' };
  if (!info.isFile()) return { problem: 'modeling_table.csv phải là file thường.' };
  if (info.size > MAX_OUTPUT_BYTES) return { problem: 'modeling_table.csv quá lớn với ca mẫu.' };
  return readFile(path, 'utf8');
}

function hitResourceLimit(result: ExperimentSandboxResult): boolean {
  return result.exitCode === KILLED_BY_SIGNAL || result.durationMs >= SANDBOX_TIMEOUT_MS - 1_000;
}

function describeDifferences(differences: GoldenDifferences): string {
  const parts = [
    differences.missing.length > 0 ? `thiếu entity_id: ${differences.missing.join(', ')}` : null,
    differences.extra.length > 0 ? `thừa entity_id: ${differences.extra.join(', ')}` : null,
    differences.duplicate.length > 0
      ? `trùng entity_id: ${differences.duplicate.join(', ')}`
      : null,
    differences.wrongTarget.length > 0
      ? `sai target: ${differences.wrongTarget
          .map(item => `${item.entityId} cần ${item.expected.toString()}, có "${item.actual}"`)
          .join('; ')}`
      : null,
  ];
  return parts.filter(part => part !== null).join('. ');
}

async function runGoldenCases(input: {
  criterion: VerificationCriterion;
  check: GoldenCasesCheck;
  runtime: MlRuntime;
  projectDir: string;
  workDir: string;
  signal: AbortSignal;
}): Promise<
  Pick<ContractCheckResult, 'status' | 'failureClass' | 'reason' | 'differences' | 'fixtureHash'>
> {
  const base = { differences: null, fixtureHash: fixtureHash(input.check) };
  const root = join(input.workDir, randomUUID());
  const dataDir = join(root, 'fixture');
  const outputDir = join(root, 'out');
  await mkdir(dataDir, { recursive: true });
  await Promise.all(
    Object.entries(input.check.tables).map(([name, text]) => writeFile(join(dataDir, name), text))
  );

  // Anvil's own script first: if it cannot run, no verdict about the generated code is possible.
  const environment = (
    detail: string
  ): typeof base & {
    status: 'blocked';
    failureClass: 'environment';
    reason: string;
  } => ({
    ...base,
    status: 'blocked',
    failureClass: 'environment',
    reason: `Môi trường không chạy được kiểm tra, đây không phải kết luận về code: ${detail}`,
  });
  const inSandbox = async (
    run: Parameters<typeof runExperimentSandbox>[0]
  ): Promise<ExperimentSandboxResult | { thrown: string }> => {
    try {
      return await runExperimentSandbox(run);
    } catch (error) {
      input.signal.throwIfAborted();
      return { thrown: error instanceof Error ? error.message : String(error) };
    }
  };
  const probe = await inSandbox({
    profile: 'check',
    runtime: input.runtime,
    projectDir: ANVIL_EVALUATOR_DIR,
    dataDir,
    outputDir: join(root, 'probe'),
    script: 'anvil_eval.py',
    args: ['probe'],
    timeoutMs: SANDBOX_TIMEOUT_MS,
    signal: input.signal,
  });
  if ('thrown' in probe) return environment(probe.thrown);
  if (probe.exitCode !== 0)
    return environment(probe.stderr.trim() || `exit ${probe.exitCode.toString()}`);

  const run = await inSandbox({
    profile: 'check',
    runtime: input.runtime,
    projectDir: input.projectDir,
    dataDir,
    outputDir,
    script: 'prepare_data.py',
    timeoutMs: SANDBOX_TIMEOUT_MS,
    signal: input.signal,
  });
  if ('thrown' in run) return environment(run.thrown);
  if (run.exitCode !== 0) {
    const tail = `${run.stderr}\n${run.stdout}`.trim().slice(-2_000);
    if (hitResourceLimit(run))
      return {
        ...base,
        status: 'blocked',
        failureClass: 'resource_limit',
        reason: `prepare_data.py chạm giới hạn RAM hoặc thời gian của sandbox trên ca mẫu.\n${tail}`,
      };
    return {
      ...base,
      status: 'failed',
      failureClass: 'code',
      reason: `prepare_data.py lỗi trên ca mẫu (exit ${run.exitCode.toString()}).\n${tail}`,
    };
  }
  const table = await readOutputTable(join(outputDir, 'modeling_table.csv'));
  if (typeof table !== 'string')
    return { ...base, status: 'failed', failureClass: 'output', reason: table.problem };
  const compared = compareGoldenOutput(table, input.check.expected);
  if ('unreadable' in compared)
    return { ...base, status: 'failed', failureClass: 'output', reason: compared.unreadable };
  if (compared.differences.total > 0)
    return {
      ...base,
      status: 'failed',
      failureClass: 'output',
      differences: compared.differences,
      reason: `Kết quả khác đáp án đã duyệt: ${describeDifferences(compared.differences)}.`,
    };
  return {
    ...base,
    status: 'passed',
    failureClass: null,
    differences: compared.differences,
    reason: `Đúng ${input.check.expected.length.toString()} entity_id và target trên ca mẫu.`,
  };
}

/** Runs every criterion. Manual and unsupported ones are always `not_verified`. */
export async function runContractChecks(input: {
  contract: VerificationContract;
  runtime: MlRuntime;
  projectDir: string;
  workDir: string;
  signal: AbortSignal;
}): Promise<ContractCheckResult[]> {
  const results: ContractCheckResult[] = [];
  for (const criterion of input.contract.criteria) {
    const { check } = criterion;
    const common = {
      criterionId: criterion.id,
      requirementId: criterion.requirementId,
      kind: check.kind,
      ...KIND_SCOPE[check.kind],
      sourcePointers: criterion.sourcePointers,
    };
    if (check.kind === 'golden_cases') {
      results.push({
        ...common,
        ...(await runGoldenCases({
          criterion,
          check,
          runtime: input.runtime,
          projectDir: input.projectDir,
          workDir: input.workDir,
          signal: input.signal,
        })),
      });
      continue;
    }
    results.push({
      ...common,
      status: 'not_verified',
      failureClass: null,
      reason: check.kind === 'manual' ? 'Điều kiện cần người xem xét.' : check.problem,
      fixtureHash: null,
      differences: null,
    });
  }
  return results;
}

/**
 * What the builder can act on, or null when nothing needs its attention. An environment problem
 * throws: sending it to the builder would spend fix rounds on something code cannot change.
 */
export function contractCheckFeedback(results: readonly ContractCheckResult[]): string | null {
  const environment = results.filter(item => item.failureClass === 'environment');
  if (environment.length > 0)
    throw new Error(environment.map(item => `${item.criterionId}: ${item.reason}`).join('\n'));
  const fixable = results.filter(
    item => item.status === 'failed' || item.failureClass === 'resource_limit'
  );
  if (fixable.length === 0) return null;
  return [
    'Anvil ran prepare_data.py on the approved golden fixture and it did not match. Fix the business rule itself; never special-case these rows:',
    ...fixable.map(
      item => `- ${item.criterionId} (requirement ${item.requirementId}): ${item.reason}`
    ),
  ].join('\n');
}

export type RequirementEvidenceStatus =
  | 'criteria_passed'
  | 'failed'
  | 'blocked'
  | 'not_verified'
  | 'removed_by_decision';

export interface RequirementForEvidence {
  id: string;
  acceptanceCriterion: string;
  sourcePointers: UnderstandingSourcePointer[];
}

export interface RequirementEvidence {
  requirementId: string;
  status: RequirementEvidenceStatus;
  /** Ids of the approved criteria mapped to this requirement; empty when none are. */
  criteria: string[];
  reason: string;
  acceptanceCriterion: string;
  sourcePointers: UnderstandingSourcePointer[];
}

function countBy<T extends string>(values: readonly T[], value: T): number {
  return values.filter(item => item === value).length;
}

/**
 * The denominator is every requirement of the approved basis, whether or not the contract mentions
 * it. A requirement is never reported as met: passing its approved criteria does not cover the rest
 * of its acceptance text, so `verified` stays 0 until a contract can declare complete coverage.
 */
export function buildRequirementEvidence(
  requirements: readonly RequirementForEvidence[],
  results: readonly ContractCheckResult[],
  /** Requirements the user removed in the blueprint review; still counted, never "not checked". */
  removedRequirementIds: readonly string[] = []
): {
  declaredChecks: {
    total: number;
    passed: number;
    failed: number;
    notVerified: number;
    blocked: number;
  };
  requirementCoverage: {
    status: 'not_verified';
    total: number;
    verified: 0;
    criteriaPassed: number;
    failed: number;
    blocked: number;
    notVerified: number;
    removed: number;
    note: string;
  };
  requirements: RequirementEvidence[];
} {
  const rows = requirements.map((requirement): RequirementEvidence => {
    const mine = results.filter(item => item.requirementId === requirement.id);
    const statuses = mine.map(item => item.status);
    const passed = countBy(statuses, 'passed');
    const base = {
      requirementId: requirement.id,
      criteria: mine.map(item => item.criterionId),
      acceptanceCriterion: requirement.acceptanceCriterion,
      sourcePointers: requirement.sourcePointers,
    };
    if (removedRequirementIds.includes(requirement.id))
      return {
        ...base,
        status: 'removed_by_decision',
        reason: 'Người dùng đã bỏ yêu cầu này khi rà soát blueprint.',
      };
    if (mine.length === 0)
      return {
        ...base,
        status: 'not_verified',
        reason: 'Hợp đồng kiểm chứng không có điều kiện nào cho yêu cầu này.',
      };
    const scope = `${passed.toString()}/${mine.length.toString()} điều kiện đã duyệt đạt.`;
    if (statuses.includes('failed'))
      return { ...base, status: 'failed', reason: `${scope} Có điều kiện không đạt.` };
    if (statuses.includes('blocked'))
      return { ...base, status: 'blocked', reason: `${scope} Có điều kiện chưa chạy được.` };
    if (passed < mine.length)
      return { ...base, status: 'not_verified', reason: `${scope} Còn điều kiện chưa kiểm chứng.` };
    return {
      ...base,
      status: 'criteria_passed',
      reason: `${scope} Chỉ xác nhận các điều kiện này; phần còn lại của yêu cầu và điều kiện nghiệm thu chưa được ánh xạ nên yêu cầu chưa được xác nhận đầy đủ.`,
    };
  });
  const checkStatuses = results.map(item => item.status);
  const rowStatuses = rows.map(row => row.status);
  return {
    declaredChecks: {
      total: results.length,
      passed: countBy(checkStatuses, 'passed'),
      failed: countBy(checkStatuses, 'failed'),
      notVerified: countBy(checkStatuses, 'not_verified'),
      blocked: countBy(checkStatuses, 'blocked'),
    },
    requirementCoverage: {
      status: 'not_verified',
      total: rows.length,
      verified: 0,
      criteriaPassed: countBy(rowStatuses, 'criteria_passed'),
      failed: countBy(rowStatuses, 'failed'),
      blocked: countBy(rowStatuses, 'blocked'),
      notVerified: countBy(rowStatuses, 'not_verified'),
      removed: countBy(rowStatuses, 'removed_by_decision'),
      note: 'Đếm trên mọi yêu cầu của basis đã duyệt. criteriaPassed chỉ nghĩa là các điều kiện đã duyệt đều đạt, không phải yêu cầu đã được đáp ứng đầy đủ.',
    },
    requirements: rows,
  };
}
