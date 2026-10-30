import { describe, expect, test } from 'bun:test';
import {
  findingsToIssues,
  screenBlueprintConstraints,
  type BlueprintReviewFinding,
} from './blueprint-review';
import { applyUnderstandingDecisionAnswers } from './decision-resolution';
import type { BlueprintAnalysis } from '../contracts';
import type { UnderstandingDecisionBinding, UnderstandingIssue } from './schemas';

type AnalysisV2 = Extract<BlueprintAnalysis, { schemaVersion: 2 }>;

const BLUEPRINT = `| FR-03 | Feature: độ trễ giao hàng, chỉ tính khi ngày giao trước thời điểm tạo đánh giá. |
Đọc dữ liệu từ orders.csv và reviews.csv, chạy bằng scikit-learn.`;

function finding(overrides: Partial<BlueprintReviewFinding> = {}): BlueprintReviewFinding {
  return {
    kind: 'future_information',
    title: 'Cột trống làm lộ thời điểm đánh giá',
    detail: 'Không biết thời điểm này lúc dự đoán.',
    exactQuote: 'chỉ tính khi ngày giao trước thời điểm tạo đánh giá',
    requirementId: 'FR-03',
    options: [
      {
        label: 'Bỏ hai feature giao hàng',
        effect: 'remove_requirement',
        instruction: 'Do not build delivery features.',
        newRequirement: null,
      },
    ],
    ...overrides,
  };
}

const issuesFrom = (findings: BlueprintReviewFinding[]): UnderstandingIssue[] =>
  findingsToIssues({
    findings,
    blueprint: BLUEPRINT,
    requirementIds: ['FR-03'],
    sourcePointers: [],
  });

function binding(
  issue: UnderstandingIssue | undefined
): Extract<UnderstandingDecisionBinding, { kind: 'blueprint_review' }> {
  if (issue?.decisionBinding?.kind !== 'blueprint_review') throw new Error('not a review');
  return issue.decisionBinding;
}

describe('findingsToIssues', () => {
  test('turns a quoted finding into a decision that always offers to keep the blueprint', () => {
    const [issue] = issuesFrom([finding()]);
    expect(issue?.requiresDecision).toBe(true);
    expect(binding(issue).options.map(option => option.effect)).toEqual([
      'remove_requirement',
      'keep',
    ]);
  });

  test('drops a finding whose quote is not in the blueprint', () => {
    expect(issuesFrom([finding({ exactQuote: 'một câu model tự nghĩ ra' })])).toEqual([]);
  });

  test('matches a quote across different line breaks and spaces', () => {
    expect(
      issuesFrom([
        finding({ exactQuote: 'chỉ tính khi   ngày giao\ntrước thời điểm tạo đánh giá' }),
      ])
    ).toHaveLength(1);
  });

  test('only a missing-information finding may come without a quote', () => {
    expect(issuesFrom([finding({ exactQuote: null })])).toEqual([]);
    expect(issuesFrom([finding({ kind: 'missing', exactQuote: null })])).toHaveLength(1);
  });

  test('drops options that could not be carried out', () => {
    const [unknownRequirement] = issuesFrom([finding({ requirementId: 'FR-99' })]);
    expect(binding(unknownRequirement).options.map(option => option.effect)).toEqual(['keep']);
    const [noText] = issuesFrom([
      finding({
        kind: 'missing',
        exactQuote: null,
        options: [
          { label: 'Thêm', effect: 'add_requirement', instruction: 'Add.', newRequirement: null },
        ],
      }),
    ]);
    expect(binding(noText).options.map(option => option.effect)).toEqual(['keep']);
  });

  test('reports the same finding once', () => {
    expect(issuesFrom([finding(), finding({ title: 'Cùng vấn đề' })])).toHaveLength(1);
  });
});

describe('screenBlueprintConstraints', () => {
  const screen = (
    overrides: Partial<Parameters<typeof screenBlueprintConstraints>[0]> = {}
  ): string[] =>
    screenBlueprintConstraints({
      blueprint: BLUEPRINT,
      datasetFiles: ['orders.csv', 'reviews.csv'],
      ramGb: 2,
      sourcePointers: [],
      ...overrides,
    }).map(issue => issue.title);

  test('finds nothing when the blueprint matches the files and the sandbox', () => {
    expect(screen()).toEqual([]);
  });

  test('reports a table that is named but not attached', () => {
    expect(screen({ datasetFiles: ['orders.csv'] })[0]).toContain('chưa được đính kèm');
  });

  test('reports a library the sandbox cannot install, and RAM above the sandbox', () => {
    expect(screen({ blueprint: `${BLUEPRINT} Dùng PyTorch.` })[0]).toContain('thư viện');
    expect(screen({ ramGb: 8 })[0]).toContain('RAM');
  });
});

describe('applying answers', () => {
  const pointer = {
    sourceVersionId: 'v1',
    filename: 'b.md',
    headingPath: [],
    startLine: 1,
    endLine: 1,
    jsonPointer: null,
    page: null,
    boundingBox: null,
    excerptHash: 'sha256:x',
  };
  const analysis = {
    schemaVersion: 2,
    requirements: [
      {
        id: 'FR-03',
        kind: 'FR',
        priority: null,
        source: null,
        statement: 's',
        acceptanceCriterion: 'a',
        sourcePointer: 'p',
        sourcePointers: [pointer],
      },
    ],
  } as unknown as AnalysisV2;
  const review = binding(
    issuesFrom([
      finding({
        options: [
          {
            label: 'Bỏ hai feature giao hàng',
            effect: 'remove_requirement',
            instruction: 'Do not build delivery features.',
            newRequirement: null,
          },
          {
            label: 'Thêm mốc dự đoán',
            effect: 'add_requirement',
            instruction: 'Predict at purchase time.',
            newRequirement: { statement: 'Dự đoán lúc đặt hàng', acceptanceCriterion: 'Có mốc' },
          },
        ],
      }),
    ])[0]
  );
  const answer = (value: string | null, status: 'pending' | 'answered' = 'answered'): AnalysisV2 =>
    applyUnderstandingDecisionAnswers(analysis, [
      { binding: review, status, answer: value },
    ]) as AnalysisV2;

  test('a pending finding changes nothing', () => {
    const resolved = answer(null, 'pending');
    expect(resolved.blueprintDecisions).toBeUndefined();
    expect(resolved.requirements).toHaveLength(1);
  });

  test('records the choice without touching the requirement or the original analysis', () => {
    const resolved = answer('option-1');
    expect(resolved.blueprintDecisions?.[0]).toMatchObject({
      requirementId: 'FR-03',
      effect: 'remove_requirement',
      instruction: 'Do not build delivery features.',
    });
    expect(resolved.requirements).toHaveLength(1);
    expect(analysis.blueprintDecisions).toBeUndefined();
  });

  test('an added requirement says where it came from', () => {
    const added = answer('option-2').requirements[1];
    expect(added?.id).toStartWith('ADD-');
    expect(added?.source).toContain('Người dùng');
    expect(analysis.requirements).toHaveLength(1);
  });

  test('rejects an answer outside the recorded options', () => {
    expect(() => answer('option-9')).toThrow('outside the recorded finding');
  });
});
