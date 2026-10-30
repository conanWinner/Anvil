import { z } from '@hono/zod-openapi';

export const understandingSourcePointerSchema = z.object({
  sourceVersionId: z.string().min(1),
  filename: z.string().min(1),
  headingPath: z.array(z.string()),
  startLine: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable(),
  jsonPointer: z.string().nullable(),
  page: z.number().int().positive().nullable(),
  boundingBox: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative(),
    })
    .nullable(),
  excerptHash: z.string().startsWith('sha256:'),
});
export type UnderstandingSourcePointer = z.infer<typeof understandingSourcePointerSchema>;

export const understandingValueStatusSchema = z.enum([
  'confirmed',
  'declared_unverified',
  'assumption',
  'conflict',
  'missing',
  'blocked',
  'stale',
]);
export type UnderstandingValueStatus = z.infer<typeof understandingValueStatusSchema>;

export const understandingChapterSchema = z.enum([
  'problem_profile',
  'requirements_contract',
  'high_level_pipeline',
  'technology_stack',
  'modular_design',
  'execution_blueprint',
]);
export type UnderstandingChapter = z.infer<typeof understandingChapterSchema>;

export const understandingComponentKindSchema = z.enum([
  'heading',
  'paragraph',
  'list',
  'table',
  'code',
  'blockquote',
  'unsupported',
]);
export type UnderstandingComponentKind = z.infer<typeof understandingComponentKindSchema>;

export const understandingCoverageStatusSchema = z.enum([
  'extracted',
  'ignored_with_reason',
  'unsupported',
  'unclassified',
]);
export type UnderstandingCoverageStatus = z.infer<typeof understandingCoverageStatusSchema>;

export const understandingCoverageEntrySchema = z.object({
  componentId: z.string().min(1),
  kind: understandingComponentKindSchema,
  chapter: understandingChapterSchema.nullable(),
  headingPath: z.array(z.string()),
  status: understandingCoverageStatusSchema,
  reason: z.string().min(1),
  sourcePointer: understandingSourcePointerSchema,
});
export type UnderstandingCoverageEntry = z.infer<typeof understandingCoverageEntrySchema>;

const blueprintReviewOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  effect: z.enum(['keep', 'remove_requirement', 'add_requirement', 'change']),
  /** What the generated code must do when this is chosen; null for `keep`. */
  instruction: z.string().nullable(),
  newRequirement: z.object({ statement: z.string(), acceptanceCriterion: z.string() }).nullable(),
});

const decisionBindingVariants = [
  z.object({
    kind: z.literal('dataset_target_column'),
    allowedValues: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal('blueprint_review'),
    findingId: z.string().min(1),
    title: z.string().min(1),
    origin: z.enum(['code', 'model']),
    quote: z.string().nullable(),
    requirementId: z.string().nullable(),
    options: z.array(blueprintReviewOptionSchema).min(1),
  }),
] as const;

export const understandingIssueSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'manual_review',
    'missing_required_field',
    'conflict',
    'invalid_reference',
    'duplicate_identifier',
    'unsupported_content',
    'unclassified_content',
    'dataset_mismatch',
    'semantic_assistance',
    'blueprint_review',
  ]),
  severity: z.enum(['warning', 'revision_required', 'blocking']),
  title: z.string().min(1),
  detail: z.string().min(1),
  requiresDecision: z.boolean(),
  decisionBinding: z.discriminatedUnion('kind', decisionBindingVariants).nullable().optional(),
  sourcePointers: z.array(understandingSourcePointerSchema),
});
export type UnderstandingIssue = z.infer<typeof understandingIssueSchema>;

export const understandingDecisionBindingSchema = z.discriminatedUnion(
  'kind',
  decisionBindingVariants
);

/** A blueprint review the user answered; pinned into the plan and given to the build models. */
export const blueprintDecisionSchema = z.object({
  findingId: z.string().min(1),
  title: z.string().min(1),
  quote: z.string().nullable(),
  requirementId: z.string().nullable(),
  answer: z.string().min(1),
  effect: z.enum(['keep', 'remove_requirement', 'add_requirement', 'change']),
  instruction: z.string().nullable(),
});
export type BlueprintDecision = z.infer<typeof blueprintDecisionSchema>;
export type UnderstandingDecisionBinding = z.infer<typeof understandingDecisionBindingSchema>;

export const datasetDeclarationSchema = z.object({
  availability: z.literal('declared_unverified'),
  unitOfAnalysis: z.string().nullable(),
  targetColumn: z.string().nullable(),
  targetDefinition: z.string().nullable(),
  expectedColumns: z.array(z.string()),
  constraints: z.array(z.string()),
  sourcePointers: z.array(understandingSourcePointerSchema),
});
export type DatasetDeclaration = z.infer<typeof datasetDeclarationSchema>;

export const datasetColumnProfileSchema = z.object({
  name: z.string(),
  inferredType: z.enum(['empty', 'boolean', 'integer', 'number', 'datetime', 'string']),
  missingCount: z.number().int().nonnegative(),
  distinctCount: z.number().int().nonnegative(),
  /** True when tracking stopped at a limit: `distinctCount` is a lower bound, not exact. */
  distinctCountCapped: z.boolean().optional(),
});
export type DatasetColumnProfile = z.infer<typeof datasetColumnProfileSchema>;

export const datasetProfileV2Schema = z.object({
  filename: z.string(),
  sourceVersionId: z.string().min(1),
  rowCount: z.number().int().nonnegative(),
  columnCount: z.number().int().nonnegative(),
  columns: z.array(datasetColumnProfileSchema),
  targetColumn: z.string().nullable(),
  targetExists: z.boolean(),
  targetDistribution: z.record(z.string(), z.number().int().nonnegative()),
  targetOtherCount: z.number().int().nonnegative(),
  duplicateRowCount: z.number().int().nonnegative(),
  invalidRowCount: z.number().int().nonnegative(),
  rowFingerprint: z.string().startsWith('sha256:').optional(),
  limits: z
    .object({
      maxRows: z.number().int().positive(),
      maxColumns: z.number().int().positive(),
      maxRecordBytes: z.number().int().positive(),
      maxDistinctValuesPerColumn: z.number().int().positive(),
      maxTrackedDistinctValues: z.number().int().positive(),
    })
    .optional(),
});
export type DatasetProfileV2 = z.infer<typeof datasetProfileV2Schema>;

export const datasetUnderstandingSchema = z.object({
  availability: z.enum(['not_linked', 'linked', 'inaccessible']),
  declaration: datasetDeclarationSchema.nullable(),
  profile: datasetProfileV2Schema.nullable(),
  comparisonStatus: z.enum(['not_checked', 'matched', 'mismatch']),
  issues: z.array(understandingIssueSchema),
});
export type DatasetUnderstanding = z.infer<typeof datasetUnderstandingSchema>;

const sourcedTextSchema = z.object({
  value: z.string(),
  status: understandingValueStatusSchema,
  sourcePointers: z.array(understandingSourcePointerSchema).min(1),
});

export const problemProfileV2Schema = z.object({
  businessGoal: sourcedTextSchema.nullable(),
  technicalObjective: sourcedTextSchema.nullable(),
  successCriteria: z.array(sourcedTextSchema),
  constraints: z.array(sourcedTextSchema),
});

export const pipelineStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  requirementIds: z.array(z.string()),
  sourcePointers: z.array(understandingSourcePointerSchema).min(1),
});

export const technologySelectionSchema = z.object({
  name: z.string(),
  purpose: z.string().nullable(),
  category: z.string().nullable(),
  rationale: z.string().nullable(),
  tradeoffs: z.array(z.string()),
  requirementIds: z.array(z.string()),
  sourcePointers: z.array(understandingSourcePointerSchema).min(1),
});

export const moduleDesignSchema = z.object({
  id: z.string(),
  name: z.string(),
  responsibility: z.string().nullable(),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  requirementIds: z.array(z.string()),
  dependencies: z.array(z.string()),
  sourcePointers: z.array(understandingSourcePointerSchema).min(1),
});

export const codeDesignItemSchema = z.object({
  id: z.string().nullable(),
  kind: z.enum(['folder', 'file', 'class', 'function', 'configuration', 'unknown']),
  name: z.string(),
  parameters: z.array(z.string()),
  returns: z.array(z.string()),
  moduleIds: z.array(z.string()),
  requirementIds: z.array(z.string()),
  sourcePointers: z.array(understandingSourcePointerSchema).min(1),
});

export const extractionQualitySchema = z.object({
  status: z.enum(['passed', 'decision_required', 'revision_required', 'blocked']),
  parserVersion: z.string(),
  extractionPolicyVersion: z.string(),
  headingAliasVersion: z.string(),
  totalComponents: z.number().int().nonnegative(),
  extractedComponents: z.number().int().nonnegative(),
  ignoredComponents: z.number().int().nonnegative(),
  unsupportedComponents: z.number().int().nonnegative(),
  unclassifiedComponents: z.number().int().nonnegative(),
  missingChapters: z.array(understandingChapterSchema),
  issues: z.array(understandingIssueSchema),
  coverage: z.array(understandingCoverageEntrySchema),
});
export type ExtractionQuality = z.infer<typeof extractionQualitySchema>;

export const understandingReportSchema = z.object({
  id: z.enum([
    'project-overview',
    'requirements-report',
    'dataset-understanding',
    'dataset-profile',
    'open-issues-and-decisions',
    'source-change-report',
    'extraction-quality-report',
  ]),
  title: z.string(),
  markdown: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type UnderstandingReport = z.infer<typeof understandingReportSchema>;
