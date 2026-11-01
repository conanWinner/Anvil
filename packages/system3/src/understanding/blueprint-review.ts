import { z } from '@hono/zod-openapi';
import { createHash } from 'node:crypto';
import type {
  UnderstandingDecisionBinding,
  UnderstandingIssue,
  UnderstandingSourcePointer,
} from './schemas';

/**
 * Screens a blueprint before anything is built. Code checks are exact; the model review only
 * proposes, and a proposal without a verbatim quote from the blueprint is dropped. Every finding
 * becomes a Decision: nothing is removed from or added to the requirements unless the user says so.
 */

const MAX_FINDINGS = 8;
const SANDBOX_RAM_GB = 2;
/** Libraries blueprints commonly name that the locked ML runtime does not install. */
const LIBRARIES_OUTSIDE_RUNTIME: readonly [RegExp, string][] = [
  [/\b(?:py)?torch\b/iu, 'PyTorch'],
  [/\btensorflow\b/iu, 'TensorFlow'],
  [/\bkeras\b/iu, 'Keras'],
  [/\bcatboost\b/iu, 'CatBoost'],
  [/\b(?:py)?spark\b/iu, 'Spark'],
  [/\bprophet\b/iu, 'Prophet'],
  [/\bstatsmodels\b/iu, 'statsmodels'],
];

const reviewOptionSchema = z.object({
  label: z.string().min(1).max(200),
  effect: z.enum(['remove_requirement', 'add_requirement', 'change']),
  /** What the code must do when this is chosen; given to the builder and the reviewer. */
  instruction: z.string().min(1).max(1_000),
  /** Only for `add_requirement`. */
  newRequirement: z
    .object({ statement: z.string().min(1).max(1_000), acceptanceCriterion: z.string().max(1_000) })
    .nullable(),
});

export const blueprintReviewFindingSchema = z.object({
  kind: z.enum(['contradiction', 'future_information', 'ambiguous', 'missing']),
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(1_500),
  /** Verbatim blueprint text; only a `missing` finding has nothing to quote. */
  exactQuote: z.string().max(1_000).nullable(),
  requirementId: z.string().max(40).nullable(),
  options: z.array(reviewOptionSchema).min(1).max(3),
});
export type BlueprintReviewFinding = z.infer<typeof blueprintReviewFindingSchema>;

export const blueprintReviewOutputSchema = z.object({
  findings: z.array(blueprintReviewFindingSchema).max(MAX_FINDINGS),
});

export const BLUEPRINT_REVIEW_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      maxItems: MAX_FINDINGS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'detail', 'exactQuote', 'requirementId', 'options'],
        properties: {
          kind: {
            type: 'string',
            enum: ['contradiction', 'future_information', 'ambiguous', 'missing'],
          },
          title: { type: 'string' },
          detail: { type: 'string' },
          exactQuote: { type: ['string', 'null'] },
          requirementId: { type: ['string', 'null'] },
          options: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'effect', 'instruction', 'newRequirement'],
              properties: {
                label: { type: 'string' },
                effect: {
                  type: 'string',
                  enum: ['remove_requirement', 'add_requirement', 'change'],
                },
                instruction: { type: 'string' },
                newRequirement: {
                  type: ['object', 'null'],
                  additionalProperties: false,
                  required: ['statement', 'acceptanceCriterion'],
                  properties: {
                    statement: { type: 'string' },
                    acceptanceCriterion: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export function blueprintReviewPrompt(input: {
  blueprint: string;
  datasetFiles: readonly string[];
  /** Column names per data file, so options can name real columns. */
  datasetColumns?: Readonly<Record<string, readonly string[]>>;
}): string {
  return `You screen a System 2 experiment blueprint BEFORE any code is written. A person reads your findings and decides; you never change the blueprint yourself. Report only real problems: an empty list is a good answer.

Report a finding for:
- \`contradiction\`: two requirements that cannot both hold.
- \`future_information\`: a feature that needs information not available at the moment the model is meant to predict. This includes a feature computed, blanked or filtered by comparing against a value created with or after the label (for example the review date): which rows are blank then reveals that value. Using such a value only to DEFINE the target is fine.
- \`ambiguous\`: a requirement that two competent engineers would implement differently, with different results.
- \`missing\`: something the experiment cannot be judged without and the blueprint never says, such as when the prediction is made, or how the target is defined.

Do not report style, wording, optional improvements or anything you would merely do differently.

For each finding:
- \`exactQuote\` must be copied character for character from the blueprint, kept short, and be null only for \`missing\`. A quote that is not in the blueprint gets the finding discarded.
- \`requirementId\` is the requirement it concerns (for example FR-03), or null.
- \`options\` are the concrete ways to resolve it, best first, at most 3. Do not add a "keep as is" option: Anvil always adds one. Use effect \`remove_requirement\` to drop the requirement named by \`requirementId\`, \`add_requirement\` with \`newRequirement\` to add one, and \`change\` otherwise. \`instruction\` says exactly what the code must do if that option is chosen.
- Every option must be complete: choosing it must leave nothing to decide. Name the exact column or value (for example "predict at order_purchase_timestamp", never "pick a fixed prediction time"). If there are several reasonable values, make each one its own option.

Write \`title\`, \`detail\`, \`label\` and \`statement\` in Vietnamese. Write \`instruction\` so an engineer can follow it without seeing the rest of this finding.

Data files attached to this project:
${
  input.datasetFiles
    .map(file => {
      const columns = input.datasetColumns?.[file];
      return `- ${file}${columns ? `: ${columns.join(', ')}` : ''}`;
    })
    .join('\n') || '(none listed)'
}

## Blueprint
${input.blueprint}`;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function reviewIssue(input: {
  key: string;
  origin: 'code' | 'model';
  title: string;
  detail: string;
  quote: string | null;
  requirementId: string | null;
  options: Extract<UnderstandingDecisionBinding, { kind: 'blueprint_review' }>['options'];
  sourcePointers: readonly UnderstandingSourcePointer[];
}): UnderstandingIssue {
  const findingId = createHash('sha256').update(input.key).digest('hex').slice(0, 12);
  return {
    id: `blueprint-review-${findingId}`,
    kind: 'blueprint_review',
    severity: 'warning',
    title: input.title,
    detail: input.detail,
    requiresDecision: true,
    decisionBinding: {
      kind: 'blueprint_review',
      findingId,
      title: input.title,
      origin: input.origin,
      quote: input.quote,
      requirementId: input.requirementId,
      options: input.options,
    },
    sourcePointers: [...input.sourcePointers],
  };
}

const KEEP_OPTION = {
  value: 'keep',
  label: 'Giữ nguyên, tôi chấp nhận rủi ro',
  effect: 'keep',
  instruction: null,
  newRequirement: null,
} as const;

/**
 * Keeps the proposals that can be checked against the blueprint. A dropped finding stays dropped:
 * a model that cannot quote its evidence must not put a question in front of a person.
 */
export function findingsToIssues(input: {
  findings: readonly BlueprintReviewFinding[];
  blueprint: string;
  requirementIds: readonly string[];
  sourcePointers: readonly UnderstandingSourcePointer[];
}): UnderstandingIssue[] {
  const text = normalizeWhitespace(input.blueprint);
  const seen = new Set<string>();
  const issues: UnderstandingIssue[] = [];
  for (const finding of input.findings) {
    const quote = finding.exactQuote === null ? null : normalizeWhitespace(finding.exactQuote);
    if (quote === null ? finding.kind !== 'missing' : quote === '' || !text.includes(quote))
      continue;
    const requirementId =
      finding.requirementId !== null && input.requirementIds.includes(finding.requirementId)
        ? finding.requirementId
        : null;
    const key = `${finding.kind}:${requirementId ?? ''}:${quote ?? finding.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const options = finding.options.flatMap((option, index) =>
      // Removing needs a requirement to remove, and adding needs its text.
      (option.effect === 'remove_requirement' && requirementId === null) ||
      (option.effect === 'add_requirement' && option.newRequirement === null)
        ? []
        : [{ ...option, value: `option-${(index + 1).toString()}` }]
    );
    issues.push(
      reviewIssue({
        key,
        origin: 'model',
        title: finding.title,
        detail: finding.detail,
        quote,
        requirementId,
        options: [...options, KEEP_OPTION],
        sourcePointers: input.sourcePointers,
      })
    );
  }
  return issues;
}

/** Checks that need no model: the blueprint against the files and the sandbox that actually exist. */
export function screenBlueprintConstraints(input: {
  blueprint: string;
  datasetFiles: readonly string[];
  ramGb: number | null;
  sourcePointers: readonly UnderstandingSourcePointer[];
}): UnderstandingIssue[] {
  const issues: UnderstandingIssue[] = [];
  const named = new Set(
    [...input.blueprint.matchAll(/\b[\w.-]+\.csv\b/gu)].map(match => match[0].toLowerCase())
  );
  const attached = new Set(input.datasetFiles.map(file => file.toLowerCase()));
  const absent = [...named].filter(file => !attached.has(file));
  if (input.datasetFiles.length > 0 && absent.length > 0)
    issues.push(
      reviewIssue({
        key: `absent-files:${absent.join(',')}`,
        origin: 'code',
        title: 'Blueprint nhắc tới bảng dữ liệu chưa được đính kèm',
        detail: `Các tệp này có trong blueprint nhưng không có trong dự án: ${absent.join(', ')}.`,
        quote: null,
        requirementId: null,
        options: [
          {
            value: 'option-1',
            label: 'Làm với các bảng đang có, bỏ phần cần bảng thiếu',
            effect: 'change',
            instruction: `The files ${absent.join(', ')} are not available. Implement the blueprint with the attached files only and leave out what needs the missing ones; say what was left out in notes.`,
            newRequirement: null,
          },
          KEEP_OPTION,
        ],
        sourcePointers: input.sourcePointers,
      })
    );
  const libraries = LIBRARIES_OUTSIDE_RUNTIME.filter(([pattern]) =>
    pattern.test(input.blueprint)
  ).map(([, name]) => name);
  if (libraries.length > 0)
    issues.push(
      reviewIssue({
        key: `libraries:${libraries.join(',')}`,
        origin: 'code',
        title: 'Blueprint dùng thư viện ngoài môi trường chạy',
        detail: `Sandbox không có mạng và không cài được thêm: ${libraries.join(', ')}.`,
        quote: null,
        requirementId: null,
        options: [
          {
            value: 'option-1',
            label: 'Thay bằng thư viện có sẵn gần nhất',
            effect: 'change',
            instruction: `${libraries.join(', ')} cannot be installed. Use the closest available library and name the replacement in notes.`,
            newRequirement: null,
          },
          KEEP_OPTION,
        ],
        sourcePointers: input.sourcePointers,
      })
    );
  if (input.ramGb !== null && input.ramGb > SANDBOX_RAM_GB)
    issues.push(
      reviewIssue({
        key: `ram:${input.ramGb.toString()}`,
        origin: 'code',
        title: 'Blueprint giả định nhiều RAM hơn sandbox',
        detail: `Blueprint tính cho ${input.ramGb.toString()} GB, mỗi phương án chỉ có ${SANDBOX_RAM_GB.toString()} GB.`,
        quote: null,
        requirementId: null,
        options: [
          {
            value: 'option-1',
            label: `Làm vừa trong ${SANDBOX_RAM_GB.toString()} GB, thu nhỏ khi cần`,
            effect: 'change',
            instruction: `Each variant has ${SANDBOX_RAM_GB.toString()} GB, not ${input.ramGb.toString()} GB. Fit within it, for example by limiting tuning or sampling, and state any reduction in notes.`,
            newRequirement: null,
          },
          KEEP_OPTION,
        ],
        sourcePointers: input.sourcePointers,
      })
    );
  return issues;
}
