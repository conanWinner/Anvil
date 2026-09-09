import { describe, expect, test } from 'bun:test';
import {
  SYSTEM3_SOURCE_POLICIES,
  System3SourceValidationError,
  validateSystem3Source,
} from './source-intake';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('System 3 Source Intake validation', () => {
  test('accepts each supported source family and returns a reproducible hash', () => {
    const cases = [
      { kind: 'blueprint' as const, filename: 'project.md', body: '# Project' },
      { kind: 'dataset' as const, filename: 'customers.csv', body: 'id,target\n1,0' },
      { kind: 'constraints' as const, filename: 'policy.yaml', body: 'network: false' },
      { kind: 'data_dictionary' as const, filename: 'columns.json', body: '{"id":"Customer ID"}' },
      { kind: 'user_brief' as const, filename: 'request.txt', body: 'Build a churn model.' },
      {
        kind: 'supporting_document' as const,
        filename: 'notes.md',
        body: '# Additional notes',
      },
    ];

    for (const input of cases) {
      const first = validateSystem3Source({ ...input, bytes: bytes(input.body) });
      const second = validateSystem3Source({ ...input, bytes: bytes(input.body) });
      expect(first.contentHash).toBe(second.contentHash);
      expect(first.contentHash).toStartWith('sha256:');
      expect(first.report.outcome).toBe('accepted');
      expect(first.report.checks.every(check => check.status === 'passed')).toBe(true);
    }
  });

  test('accepts a passive PDF and rejects active PDF content', () => {
    const accepted = validateSystem3Source({
      kind: 'supporting_document',
      filename: 'notes.pdf',
      bytes: bytes('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF'),
    });
    expect(accepted.mediaType).toBe('application/pdf');

    expect(() =>
      validateSystem3Source({
        kind: 'supporting_document',
        filename: 'unsafe.pdf',
        bytes: bytes('%PDF-1.7\n/JavaScript 1 0 R\n%%EOF'),
      })
    ).toThrow(System3SourceValidationError);
  });

  test('rejects invalid extension, malformed structure, binary text and empty files', () => {
    const inputs = [
      { kind: 'dataset' as const, filename: 'data.json', value: bytes('{}'), status: 415 },
      { kind: 'constraints' as const, filename: 'rules.json', value: bytes('{'), status: 422 },
      {
        kind: 'user_brief' as const,
        filename: 'brief.txt',
        value: new Uint8Array([65, 0, 66]),
        status: 422,
      },
      { kind: 'blueprint' as const, filename: 'empty.md', value: new Uint8Array(), status: 400 },
    ] as const;

    for (const input of inputs) {
      try {
        validateSystem3Source({ kind: input.kind, filename: input.filename, bytes: input.value });
        throw new Error('Expected validation to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(System3SourceValidationError);
        expect((error as System3SourceValidationError).status).toBe(input.status);
        expect((error as System3SourceValidationError).report.outcome).toBe('rejected');
      }
    }
  });

  test('uses the shared CSV contract for BOM, quotes, multiline fields and row width', () => {
    expect(() =>
      validateSystem3Source({
        kind: 'dataset',
        filename: 'edge.csv',
        bytes: bytes('\uFEFF"customer,id",target,note\n1,yes,"first\nline"\n2,,""\n'),
      })
    ).not.toThrow();

    for (const body of [
      'id,target,target\n1,yes,no\n',
      'id,target\n1\n',
      'id,target\n1,"unterminated\n',
    ]) {
      expect(() =>
        validateSystem3Source({ kind: 'dataset', filename: 'invalid.csv', bytes: bytes(body) })
      ).toThrow(System3SourceValidationError);
    }
  });

  test('rejects files larger than the source-kind policy', () => {
    const oversized = new Uint8Array(SYSTEM3_SOURCE_POLICIES.constraints.maxBytes + 1);
    try {
      validateSystem3Source({ kind: 'constraints', filename: 'rules.md', bytes: oversized });
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(System3SourceValidationError);
      expect((error as System3SourceValidationError).status).toBe(413);
    }
  });
});
