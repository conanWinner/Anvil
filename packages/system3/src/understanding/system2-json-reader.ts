import { createHash } from 'node:crypto';
import { z } from '@hono/zod-openapi';
import type { System3ManualReviewV2, System3RequirementV2 } from '../contracts';
import type { BlueprintExtractionResult } from './extractors';
import type { UnderstandingCoverageEntry, UnderstandingSourcePointer } from './schemas';

const sourceTextSchema = z.union([
  z.string(),
  z.object({ value: z.string(), source: z.string().optional() }),
]);

export const system2BlueprintExportSchema = z.object({
  schemaVersion: z.literal(1),
  problemProfile: z.object({
    businessGoal: sourceTextSchema.nullable(),
    technicalObjective: sourceTextSchema.nullable(),
    successCriteria: z.array(sourceTextSchema).default([]),
    constraints: z.array(sourceTextSchema).default([]),
    dataset: z
      .object({
        unitOfAnalysis: z.string().nullable().default(null),
        targetColumn: z.string().nullable().default(null),
        targetDefinition: z.string().nullable().default(null),
        expectedColumns: z.array(z.string()).default([]),
        constraints: z.array(z.string()).default([]),
      })
      .nullable()
      .default(null),
  }),
  requirementsContract: z.object({
    requirements: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        priority: z.string().nullable().default(null),
        source: z.string().nullable().default(null),
        statement: z.string(),
        acceptanceCriterion: z.string().default(''),
      })
    ),
  }),
  highLevelPipeline: z.object({
    stages: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          inputs: z.array(z.string()).default([]),
          outputs: z.array(z.string()).default([]),
          requirementIds: z.array(z.string()).default([]),
        })
      )
      .default([]),
  }),
  technologyStack: z.object({
    selections: z
      .array(
        z.object({
          name: z.string(),
          purpose: z.string().nullable().default(null),
          category: z.string().nullable().default(null),
          rationale: z.string().nullable().default(null),
          tradeoffs: z.array(z.string()).default([]),
          requirementIds: z.array(z.string()).default([]),
        })
      )
      .default([]),
  }),
  modularDesign: z.object({
    modules: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          responsibility: z.string().nullable().default(null),
          inputs: z.array(z.string()).default([]),
          outputs: z.array(z.string()).default([]),
          requirementIds: z.array(z.string()).default([]),
          dependencies: z.array(z.string()).default([]),
        })
      )
      .default([]),
  }),
  executionBlueprint: z.object({
    items: z
      .array(
        z.object({
          id: z.string().nullable().default(null),
          kind: z.enum(['folder', 'file', 'class', 'function', 'configuration', 'unknown']),
          name: z.string(),
          parameters: z.array(z.string()).default([]),
          returns: z.array(z.string()).default([]),
          moduleIds: z.array(z.string()).default([]),
          requirementIds: z.array(z.string()).default([]),
        })
      )
      .default([]),
  }),
  manualReviews: z.array(z.string()).default([]),
});

function valueOf(value: z.infer<typeof sourceTextSchema>): string {
  return typeof value === 'string' ? value : value.value;
}

function pointer(input: {
  sourceVersionId: string;
  filename: string;
  jsonPointer: string;
  value: unknown;
}): UnderstandingSourcePointer {
  return {
    sourceVersionId: input.sourceVersionId,
    filename: input.filename,
    headingPath: [],
    startLine: null,
    endLine: null,
    jsonPointer: input.jsonPointer,
    page: null,
    boundingBox: null,
    excerptHash: `sha256:${createHash('sha256').update(JSON.stringify(input.value)).digest('hex')}`,
  };
}

export function readSystem2BlueprintJson(input: {
  json: string;
  sourceVersionId: string;
  filename: string;
}): { extraction: BlueprintExtractionResult; coverage: UnderstandingCoverageEntry[] } {
  const parsed = system2BlueprintExportSchema.parse(JSON.parse(input.json) as unknown);
  const problemPointer = pointer({
    ...input,
    jsonPointer: '/problemProfile',
    value: parsed.problemProfile,
  });
  const requirementPointer = pointer({
    ...input,
    jsonPointer: '/requirementsContract',
    value: parsed.requirementsContract,
  });
  const pipelinePointer = pointer({
    ...input,
    jsonPointer: '/highLevelPipeline',
    value: parsed.highLevelPipeline,
  });
  const stackPointer = pointer({
    ...input,
    jsonPointer: '/technologyStack',
    value: parsed.technologyStack,
  });
  const modulePointer = pointer({
    ...input,
    jsonPointer: '/modularDesign',
    value: parsed.modularDesign,
  });
  const executionPointer = pointer({
    ...input,
    jsonPointer: '/executionBlueprint',
    value: parsed.executionBlueprint,
  });
  const requirements: System3RequirementV2[] = parsed.requirementsContract.requirements.map(
    (requirement, index) => {
      const itemPointer = pointer({
        ...input,
        jsonPointer: `/requirementsContract/requirements/${String(index)}`,
        value: requirement,
      });
      return {
        ...requirement,
        sourcePointer: `${input.filename}#/requirementsContract/requirements/${String(index)}`,
        sourcePointers: [itemPointer],
      };
    }
  );
  const manualReviews: System3ManualReviewV2[] = parsed.manualReviews.map((text, index) => {
    const itemPointer = pointer({
      ...input,
      jsonPointer: `/manualReviews/${String(index)}`,
      value: text,
    });
    return {
      id: `manual-review-json-${String(index + 1)}`,
      text,
      sourcePointer: `${input.filename}#/manualReviews/${String(index)}`,
      sourcePointers: [itemPointer],
    };
  });
  const sourced = (
    value: z.infer<typeof sourceTextSchema>,
    source: UnderstandingSourcePointer
  ): NonNullable<BlueprintExtractionResult['problemProfile']['businessGoal']> => ({
    value: valueOf(value),
    status: 'declared_unverified' as const,
    sourcePointers: [source],
  });
  const extraction: BlueprintExtractionResult = {
    businessGoal:
      parsed.problemProfile.businessGoal === null
        ? null
        : valueOf(parsed.problemProfile.businessGoal),
    technicalObjective:
      parsed.problemProfile.technicalObjective === null
        ? null
        : valueOf(parsed.problemProfile.technicalObjective),
    targetDefinition: parsed.problemProfile.dataset?.targetDefinition ?? null,
    runtime: {
      cpuOnly: parsed.problemProfile.constraints.some(value =>
        /CPU-only|CPU only|không có GPU/iu.test(valueOf(value))
      ),
      ramGb: ((): number | null => {
        const text = parsed.problemProfile.constraints.map(valueOf).join(' ');
        const match = /(?:RAM\s*[≤<]?\s*|)(\d+)\s*GB(?:\s*RAM|)/iu.exec(text);
        return match?.[1] ? Number.parseInt(match[1], 10) : null;
      })(),
    },
    requirements,
    modules: parsed.modularDesign.modules.map(module => module.id),
    manualReviews,
    problemProfile: {
      businessGoal:
        parsed.problemProfile.businessGoal === null
          ? null
          : sourced(parsed.problemProfile.businessGoal, problemPointer),
      technicalObjective:
        parsed.problemProfile.technicalObjective === null
          ? null
          : sourced(parsed.problemProfile.technicalObjective, problemPointer),
      successCriteria: parsed.problemProfile.successCriteria.map(value =>
        sourced(value, problemPointer)
      ),
      constraints: parsed.problemProfile.constraints.map(value => sourced(value, problemPointer)),
    },
    datasetDeclaration:
      parsed.problemProfile.dataset === null
        ? null
        : {
            availability: 'declared_unverified',
            ...parsed.problemProfile.dataset,
            sourcePointers: [problemPointer],
          },
    pipeline: parsed.highLevelPipeline.stages.map(stage => ({
      ...stage,
      sourcePointers: [pipelinePointer],
    })),
    technologyStack: parsed.technologyStack.selections.map(selection => ({
      ...selection,
      sourcePointers: [stackPointer],
    })),
    moduleDesign: parsed.modularDesign.modules.map(module => ({
      ...module,
      sourcePointers: [modulePointer],
    })),
    executionBlueprint: parsed.executionBlueprint.items.map(item => ({
      ...item,
      sourcePointers: [executionPointer],
    })),
  };
  const chapters = [
    ['problem_profile', problemPointer],
    ['requirements_contract', requirementPointer],
    ['high_level_pipeline', pipelinePointer],
    ['technology_stack', stackPointer],
    ['modular_design', modulePointer],
    ['execution_blueprint', executionPointer],
  ] as const;
  return {
    extraction,
    coverage: chapters.map(([chapter, source]) => ({
      componentId: `${input.sourceVersionId}:${chapter}`,
      kind: 'paragraph',
      chapter,
      headingPath: [],
      status: 'extracted',
      reason: 'Đã đọc từ hợp đồng JSON System 2 có phiên bản.',
      sourcePointer: source,
    })),
  };
}
