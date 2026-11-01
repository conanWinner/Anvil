import { z } from '@hono/zod-openapi';
import { createHash } from 'node:crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import { SYSTEM3_CSV_PARSE_OPTIONS, validateSystem3CsvHeaders } from './csv-contract';
import {
  understandingSourcePointerSchema,
  type UnderstandingIssue,
  type UnderstandingSourcePointer,
} from './understanding/schemas';

/**
 * Machine-readable acceptance checks System 2 writes into a blueprint (plan 16). A contract is data:
 * `check.kind` is a closed list Anvil interprets, and it can never carry code, commands or paths.
 * Whatever Anvil cannot read stays visible as an `unsupported` criterion plus a source-linked Issue.
 */

export const VERIFICATION_CONTRACT_VERSION = 1;
export const VERIFICATION_CONTRACT_CODE_LANGUAGE = 'anvil-contract';

export const VERIFICATION_CONTRACT_LIMITS = {
  maxBytes: 256 * 1024,
  maxCriteria: 64,
  maxTables: 16,
  maxTableBytes: 32 * 1024,
  maxTableRows: 200,
  maxExpectedRows: 200,
} as const;

/** A plain CSV basename: the fixture is written under this name in a directory Anvil owns. */
const GOLDEN_TABLE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,155}\.csv$/u;

const goldenExpectedRowSchema = z
  .object({
    entity_id: z.string().min(1).max(200),
    target: z.union([z.literal(0), z.literal(1)]),
  })
  .strict();

export function parseGoldenTable(
  text: string,
  options: { to_line?: number } = {}
): { columns: string[]; rows: string[][] } {
  const records = parseCsv(text, { ...SYSTEM3_CSV_PARSE_OPTIONS, ...options });
  const [header, ...rows] = records;
  return { columns: validateSystem3CsvHeaders(header ?? []), rows };
}

const goldenCasesCheckSchema = z
  .object({
    kind: z.literal('golden_cases'),
    tables: z.record(
      z.string().regex(GOLDEN_TABLE_NAME, 'Table name must be a plain .csv basename'),
      z.string().min(1)
    ),
    expected: z
      .array(goldenExpectedRowSchema)
      .min(1)
      .max(VERIFICATION_CONTRACT_LIMITS.maxExpectedRows),
  })
  .strict()
  .superRefine((check, context) => {
    const names = Object.keys(check.tables);
    if (names.length === 0 || names.length > VERIFICATION_CONTRACT_LIMITS.maxTables)
      context.addIssue({
        code: 'custom',
        path: ['tables'],
        message: `Need 1 to ${VERIFICATION_CONTRACT_LIMITS.maxTables.toString()} tables`,
      });
    for (const name of names) {
      const text = check.tables[name] ?? '';
      if (Buffer.byteLength(text) > VERIFICATION_CONTRACT_LIMITS.maxTableBytes) {
        context.addIssue({
          code: 'custom',
          path: ['tables', name],
          message: `Table exceeds ${VERIFICATION_CONTRACT_LIMITS.maxTableBytes.toString()} bytes`,
        });
        continue;
      }
      try {
        const { rows } = parseGoldenTable(text);
        if (rows.length === 0 || rows.length > VERIFICATION_CONTRACT_LIMITS.maxTableRows)
          context.addIssue({
            code: 'custom',
            path: ['tables', name],
            message: `Need 1 to ${VERIFICATION_CONTRACT_LIMITS.maxTableRows.toString()} data rows`,
          });
      } catch (error) {
        context.addIssue({
          code: 'custom',
          path: ['tables', name],
          message: `Unreadable CSV: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    const ids = check.expected.map(row => row.entity_id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: 'custom',
        path: ['expected'],
        message: 'Each entity_id may appear once in expected',
      });
  });

const manualCheckSchema = z.object({ kind: z.literal('manual') }).strict();

const authoredCheckSchema = z.discriminatedUnion('kind', [
  goldenCasesCheckSchema,
  manualCheckSchema,
]);

const unsupportedCheckSchema = z.object({
  kind: z.literal('unsupported'),
  /** The `kind` the source declared, kept for the person reading the Evidence. */
  declaredKind: z.string().nullable(),
  problem: z.string().min(1),
});

/** Set only by Anvil's reader, for a criterion it kept but cannot run. */
export const verificationCheckSchema = z.discriminatedUnion('kind', [
  goldenCasesCheckSchema,
  manualCheckSchema,
  unsupportedCheckSchema,
]);
export type VerificationCheck = z.infer<typeof verificationCheckSchema>;
export type GoldenCasesCheck = z.infer<typeof goldenCasesCheckSchema>;

/** Fields a criterion may carry in this contract version; anything else must not be guessed at. */
const AUTHORED_CRITERION_KEYS = new Set(['id', 'requirementId', 'statement', 'check']);

const authoredCriterionHeadSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u),
  requirementId: z.string().min(1).max(64),
  statement: z.string().min(1).max(2_000),
});

export const verificationCriterionSchema = authoredCriterionHeadSchema.extend({
  check: verificationCheckSchema,
  sourcePointers: z.array(understandingSourcePointerSchema).min(1),
});
export type VerificationCriterion = z.infer<typeof verificationCriterionSchema>;

export const verificationContractSchema = z.object({
  contractVersion: z.literal(VERIFICATION_CONTRACT_VERSION),
  criteria: z.array(verificationCriterionSchema).min(1),
});
export type VerificationContract = z.infer<typeof verificationContractSchema>;

const authoredEnvelopeSchema = z
  .object({
    contractVersion: z.literal(VERIFICATION_CONTRACT_VERSION),
    criteria: z.array(z.unknown()).min(1).max(VERIFICATION_CONTRACT_LIMITS.maxCriteria),
  })
  .strict();

export interface VerificationContractReadResult {
  contract: VerificationContract | null;
  issues: UnderstandingIssue[];
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function contractIssue(input: {
  key: string;
  kind: UnderstandingIssue['kind'];
  severity: UnderstandingIssue['severity'];
  title: string;
  detail: string;
  pointer: UnderstandingSourcePointer;
}): UnderstandingIssue {
  return {
    id: `verification-contract-${createHash('sha256').update(input.key).digest('hex').slice(0, 12)}`,
    kind: input.kind,
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    requiresDecision: false,
    sourcePointers: [input.pointer],
  };
}

function describeZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map(item => `${item.path.join('.') || '(gốc)'}: ${item.message}`)
    .join('; ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates an already-parsed contract value against the blueprint's requirement ids. */
export function readVerificationContractValue(input: {
  value: unknown;
  requirementIds: readonly string[];
  pointer: UnderstandingSourcePointer;
}): VerificationContractReadResult {
  const invalid = (detail: string): VerificationContractReadResult => ({
    contract: null,
    issues: [
      contractIssue({
        key: `envelope:${input.pointer.excerptHash}`,
        kind: 'unsupported_content',
        severity: 'revision_required',
        title: 'Hợp đồng kiểm chứng không đọc được',
        detail,
        pointer: input.pointer,
      }),
    ],
  });
  if (Buffer.byteLength(JSON.stringify(input.value) ?? '') > VERIFICATION_CONTRACT_LIMITS.maxBytes)
    return invalid(
      `Hợp đồng vượt giới hạn ${VERIFICATION_CONTRACT_LIMITS.maxBytes.toString()} byte.`
    );
  // The pinned plan travels through workflow action inputs, which substitute `$name.output` text.
  if (/\$[A-Za-z_]/u.test(JSON.stringify(input.value) ?? ''))
    return invalid(
      'Giới hạn định dạng hiện tại: hợp đồng chưa được chứa chuỗi dạng $tên vì trùng cú pháp biến của workflow. Anvil không tự bỏ nội dung; hãy sửa nguồn.'
    );
  const envelope = authoredEnvelopeSchema.safeParse(input.value);
  if (!envelope.success) return invalid(describeZodError(envelope.error));

  const known = new Set(input.requirementIds);
  const issues: UnderstandingIssue[] = [];
  const heads = envelope.data.criteria.map(raw => authoredCriterionHeadSchema.safeParse(raw));
  const idCounts = new Map<string, number>();
  for (const head of heads) {
    if (head.success) idCounts.set(head.data.id, (idCounts.get(head.data.id) ?? 0) + 1);
  }
  const criteria: VerificationCriterion[] = [];
  envelope.data.criteria.forEach((raw, index) => {
    const pointer: UnderstandingSourcePointer = {
      ...input.pointer,
      jsonPointer: `${input.pointer.jsonPointer ?? ''}/criteria/${index.toString()}`,
      excerptHash: sha256(JSON.stringify(raw) ?? ''),
    };
    const head = heads[index];
    if (!head?.success) {
      issues.push(
        contractIssue({
          key: `criterion:${pointer.excerptHash}:${index.toString()}`,
          kind: 'unsupported_content',
          severity: 'revision_required',
          title: 'Điều kiện kiểm chứng thiếu mã, yêu cầu hoặc nội dung',
          detail: head ? describeZodError(head.error) : 'Không đọc được điều kiện.',
          pointer,
        })
      );
      return;
    }
    const { id, requirementId, statement } = head.data;
    const keep = (
      problem: string,
      declaredKind: string | null,
      issue: Pick<UnderstandingIssue, 'kind' | 'severity' | 'title'>
    ): void => {
      issues.push(
        contractIssue({
          key: `${issue.kind}:${id}:${index.toString()}`,
          ...issue,
          detail: problem,
          pointer,
        })
      );
      criteria.push({
        id,
        requirementId,
        statement,
        check: { kind: 'unsupported', declaredKind, problem },
        sourcePointers: [pointer],
      });
    };
    const rawCheck = isRecord(raw) ? raw.check : undefined;
    const declaredKind =
      isRecord(rawCheck) && typeof rawCheck.kind === 'string' ? rawCheck.kind : null;
    const unknownKeys = isRecord(raw)
      ? Object.keys(raw).filter(key => !AUTHORED_CRITERION_KEYS.has(key))
      : [];
    if (unknownKeys.length > 0) {
      // For example `level: optional`: ignoring it would silently change what the author meant.
      keep(
        `Phiên bản hợp đồng này chưa hỗ trợ trường: ${unknownKeys.join(', ')}. Anvil không chạy điều kiện để tránh hiểu sai ý nguồn.`,
        declaredKind,
        {
          kind: 'unsupported_content',
          severity: 'revision_required',
          title: `Điều kiện ${id} có trường chưa hỗ trợ`,
        }
      );
      return;
    }
    if ((idCounts.get(id) ?? 0) > 1) {
      keep(`Mã điều kiện ${id} xuất hiện nhiều lần; không chạy cả hai.`, declaredKind, {
        kind: 'duplicate_identifier',
        severity: 'revision_required',
        title: `Mã điều kiện ${id} bị trùng`,
      });
      return;
    }
    if (!known.has(requirementId)) {
      keep(`Không tìm thấy ${requirementId} trong Hợp đồng yêu cầu.`, declaredKind, {
        kind: 'invalid_reference',
        severity: 'revision_required',
        title: `Điều kiện ${id} trỏ tới yêu cầu không tồn tại`,
      });
      return;
    }
    const check = authoredCheckSchema.safeParse(rawCheck);
    if (check.success) {
      criteria.push({ id, requirementId, statement, check: check.data, sourcePointers: [pointer] });
      return;
    }
    if (declaredKind !== 'golden_cases' && declaredKind !== 'manual') {
      // A kind from a newer contract format must not block the project: it stays not_verified.
      keep(`Anvil chưa hỗ trợ loại kiểm tra ${declaredKind ?? '(không có)'}.`, declaredKind, {
        kind: 'unsupported_content',
        severity: 'warning',
        title: `Điều kiện ${id} dùng loại kiểm tra chưa hỗ trợ`,
      });
      return;
    }
    keep(describeZodError(check.error), declaredKind, {
      kind: 'unsupported_content',
      severity: 'revision_required',
      title: `Điều kiện ${id} sai định dạng`,
    });
  });
  return {
    contract:
      criteria.length === 0 ? null : { contractVersion: VERIFICATION_CONTRACT_VERSION, criteria },
    issues,
  };
}

export function readVerificationContractText(input: {
  text: string;
  requirementIds: readonly string[];
  pointer: UnderstandingSourcePointer;
}): VerificationContractReadResult {
  let value: unknown;
  try {
    value = JSON.parse(input.text) as unknown;
  } catch (error) {
    return {
      contract: null,
      issues: [
        contractIssue({
          key: `json:${input.pointer.excerptHash}`,
          kind: 'unsupported_content',
          severity: 'revision_required',
          title: 'Hợp đồng kiểm chứng không phải JSON hợp lệ',
          detail: error instanceof Error ? error.message : 'Không đọc được JSON.',
          pointer: input.pointer,
        }),
      ],
    };
  }
  return readVerificationContractValue({ ...input, value });
}

/** Reported when a source signals a contract that the reader could not take in. */
export function misplacedVerificationContractIssue(input: {
  detail: string;
  pointer: UnderstandingSourcePointer;
}): UnderstandingIssue {
  return contractIssue({
    key: `misplaced:${input.pointer.excerptHash}`,
    kind: 'unsupported_content',
    severity: 'revision_required',
    title: 'Hợp đồng kiểm chứng không đọc được',
    detail: input.detail,
    pointer: input.pointer,
  });
}
