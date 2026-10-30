import { createHash, randomUUID } from 'node:crypto';
import type {
  BlueprintAnalysis,
  System3ApprovalManifest,
  System3ApprovedBundleBinding,
  System3CapabilityDescriptor,
  System3ExecutionPlan,
  System3ReusableArtifact,
  System3RuntimeBindingSlot,
  System3WorkflowBundleActivityId,
  System3WorkflowBundleDefinition,
  System3WorkflowBundleSnapshot,
} from './contracts';
import type { System3SourceRecord } from './store';
import { modelComparisonConfigSchema, type ModelComparisonConfig } from './model-comparison';
import { experimentPinSchema, type ExperimentPin } from './experiment-config';
import { deriveExperimentPlan, hashExperimentPlan, type ExperimentPlan } from './experiment-plan';
import type { System3ReadinessContractBody } from './contracts';
import { customerChurnCapabilityDescriptors } from './capabilities';
import { system3PhaseOrder, type System3PhaseId } from './invalidation';
import {
  buildCustomerChurnDeliveryWorkflows,
  buildCustomerChurnExecutionWorkflows,
  buildCustomerChurnVerificationWorkflows,
  buildReadinessContractWorkflow,
  buildUnderstandProjectWorkflow,
} from './templates';

const capabilityRegistry = customerChurnCapabilityDescriptors;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** A UUID-shaped, deterministic snapshot identity derived from immutable input. */
function snapshotId(value: unknown): string {
  const hex = createHash('sha256').update(canonicalJson(value)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function hashSystem3Definition(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

const workflowBundleActivities = ['TW-06', 'TW-07', 'TW-09'] as const;

const bindingMarker = (name: string): string => `$BINDING.${name}`;

function workflowBundleError(detail: string): Error {
  return new Error(`recompile_required: ${detail}`);
}

function asWorkflowRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function workflowBundleDefinition(input: {
  activityId: System3WorkflowBundleActivityId;
  executionMode: 'full' | 'experiment' | 'delivery';
  root: { name: string; outputs?: Record<string, string>; output_schema?: Record<string, unknown> };
  definitions: readonly {
    name: string;
    nodes: readonly Record<string, unknown>[];
    input_schema?: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
    outputs?: Record<string, string>;
  }[];
  runtimeBindings: readonly System3RuntimeBindingSlot[];
  capabilityRegistry: readonly System3CapabilityDescriptor[];
  runtimeProfile: System3ExecutionPlan['runtimeProfile'];
}): System3WorkflowBundleDefinition {
  const dependencies: Record<string, string[]> = {};
  const inputMappings: Record<string, unknown> = {};
  const outputMappings: Record<string, unknown> = {};
  const outputSchemas: Record<string, unknown> = {};
  const timeouts: Record<string, number> = {};
  for (const workflow of input.definitions) {
    inputMappings[workflow.name] = workflow.input_schema ?? {};
    outputMappings[workflow.name] = workflow.outputs ?? {};
    outputSchemas[workflow.name] = workflow.output_schema ?? {};
    for (const node of workflow.nodes) {
      const nodeId = node.id;
      if (typeof nodeId !== 'string') continue;
      const path = `${workflow.name}/${nodeId}`;
      dependencies[path] = Array.isArray(node.depends_on)
        ? node.depends_on.filter((value): value is string => typeof value === 'string')
        : [];
      if (typeof node.timeout === 'number') timeouts[path] = node.timeout;
    }
  }
  const executorIds = new Set<string>();
  for (const workflow of input.definitions) {
    for (const node of workflow.nodes) {
      const action = node.action;
      if (action === null || typeof action !== 'object') continue;
      const executor = (action as Record<string, unknown>).executor;
      if (typeof executor === 'string') executorIds.add(executor);
    }
  }
  const capabilities = input.capabilityRegistry.filter(capability =>
    executorIds.has(capability.id)
  );
  const permissions = [
    ...new Set(capabilities.flatMap(capability => capability.permissions)),
  ].sort();
  return {
    schemaVersion: 3,
    compilerVersion: 'system3-compiler@3',
    activityId: input.activityId,
    executionMode: input.executionMode,
    rootWorkflow: input.root.name,
    workflows: input.definitions.map(asWorkflowRecord),
    runtimeBindings: [...input.runtimeBindings],
    capabilityRegistry: capabilities.map(capability => ({ ...capability })),
    permissions,
    runtimeProfile: { ...input.runtimeProfile },
    dependencies,
    inputMappings,
    outputMappings,
    outputSchemas,
    timeouts,
  };
}

interface ProjectedWorkflowDefinition {
  name: string;
  nodes: readonly Record<string, unknown>[];
}

type ProjectedPhase = System3ExecutionPlan['phases'][number];

function projectWorkflowPhases(input: {
  workflows: readonly ProjectedWorkflowDefinition[];
  capabilities: readonly System3CapabilityDescriptor[];
  runtimeProfile: System3ExecutionPlan['runtimeProfile'];
}): ProjectedPhase[] {
  const capabilities = new Map(input.capabilities.map(capability => [capability.id, capability]));
  const phases = new Map<
    string,
    {
      workflow: string;
      nodePath: string[];
      permissions: Set<string>;
      timeoutMs: number;
      dependencies: Record<string, string[]>;
      executors: Record<string, string>;
    }
  >();
  for (const workflow of input.workflows) {
    for (const node of workflow.nodes) {
      const nodeId = node.id;
      const action = node.action;
      if (typeof nodeId !== 'string' || action === null || typeof action !== 'object') continue;
      const executor = (action as Record<string, unknown>).executor;
      if (typeof executor !== 'string') continue;
      const capability = capabilities.get(executor);
      if (capability === undefined) continue;
      const phase = phases.get(capability.phaseId) ?? {
        workflow: workflow.name,
        nodePath: [],
        permissions: new Set<string>(),
        timeoutMs: 0,
        dependencies: {},
        executors: {},
      };
      const path = `${workflow.name}/${nodeId}`;
      phase.nodePath.push(path);
      phase.executors[path] = executor;
      phase.dependencies[path] = Array.isArray(node.depends_on)
        ? node.depends_on.filter((value): value is string => typeof value === 'string')
        : [];
      phase.timeoutMs += typeof node.timeout === 'number' ? node.timeout : capability.timeoutMs;
      for (const permission of capability.permissions) phase.permissions.add(permission);
      phases.set(capability.phaseId, phase);
    }
  }
  const order = ['understanding', 'readiness', 'build', 'experiment', 'delivery'];
  return order.flatMap(phaseId => {
    const phase = phases.get(phaseId);
    if (phase === undefined) return [];
    return [
      {
        phaseId,
        workflow: phase.workflow,
        nodePath: phase.nodePath,
        permissions: [...phase.permissions].sort(),
        timeoutMs: phase.timeoutMs,
        resourceProfile: { ...input.runtimeProfile },
        dependencies: phase.dependencies,
        executors: phase.executors,
      },
    ];
  });
}

/** Readable plan projection derived from the exact stored bundle definitions. */
export function projectSystem3WorkflowBundlePhases(input: {
  workflowBundles: readonly System3WorkflowBundleSnapshot[];
  runtimeProfile: System3ExecutionPlan['runtimeProfile'];
}): ProjectedPhase[] {
  return projectWorkflowPhases({
    workflows: input.workflowBundles.flatMap(bundle =>
      bundle.definition.workflows.map(
        workflow => workflow as unknown as ProjectedWorkflowDefinition
      )
    ),
    capabilities: input.workflowBundles.flatMap(bundle => bundle.definition.capabilityRegistry),
    runtimeProfile: input.runtimeProfile,
  });
}

/**
 * Creates the three immutable executable definitions that an Approval Manifest
 * can bind. Runtime-only values are represented by typed markers and are never
 * resolved from a mutable template catalog after approval.
 */
export function compileSystem3WorkflowBundles(input: {
  projectId: string;
  compilationId: string;
  projectName: string;
  targetColumn: string | null;
  datasetSource: { id: string; contentHash: string };
  plan: System3ExecutionPlan;
  analysis: BlueprintAnalysis;
  runtimeProfile: System3ExecutionPlan['runtimeProfile'];
  capabilityRegistry: readonly System3CapabilityDescriptor[];
  rerunScope: {
    executionMode: 'full' | 'experiment' | 'delivery';
    reusedArtifacts: readonly System3ReusableArtifact[];
  };
  /** Required when `plan.experiment` is set: the derived plan and the pinned sources it reads. */
  experimentInputs?: {
    plan: ExperimentPlan;
    blueprintSource: { id: string; contentHash: string };
    datasetSources: readonly { id: string; contentHash: string }[];
  };
}): System3WorkflowBundleSnapshot[] {
  if (input.plan.experiment && !input.experimentInputs)
    throw new Error('Experiment plans need their derived plan and pinned sources to compile');
  const execution = buildCustomerChurnExecutionWorkflows({
    projectId: input.projectId,
    executionId: bindingMarker('executionId'),
    compilationId: input.compilationId,
    definitionHash: hashSystem3Definition(input.plan),
    projectName: input.projectName,
    targetColumn: input.targetColumn,
    datasetSource: input.datasetSource,
    plan: input.plan as unknown as Record<string, unknown>,
    analysis: input.analysis,
    ...(input.plan.modelComparison
      ? {
          modelComparison: {
            config: input.plan.modelComparison,
            inputHash: hashSystem3Definition(input.plan.inputSnapshot),
          },
        }
      : {}),
    ...(input.plan.experiment && input.experimentInputs
      ? { experiment: { pin: input.plan.experiment, ...input.experimentInputs } }
      : {}),
    rerunScope: input.rerunScope,
  });
  const runtimeArtifact = {
    storageKey: bindingMarker('artifactStorageKey'),
    contentHash: bindingMarker('artifactContentHash'),
    sourceExecutionId: bindingMarker('sourceExecutionId'),
  };
  const verification = buildCustomerChurnVerificationWorkflows({
    projectId: input.projectId,
    analysis: input.analysis,
    artifact: runtimeArtifact,
    ...(input.plan.modelComparison
      ? {
          modelComparison: {
            config: input.plan.modelComparison,
            inputHash: hashSystem3Definition(input.plan.inputSnapshot),
            datasetHash: input.datasetSource.contentHash,
          },
        }
      : {}),
    ...(input.plan.experiment && input.experimentInputs
      ? {
          experiment: {
            // TW-07 reports on every approved requirement, not only those the contract mentions.
            requirements:
              input.analysis.schemaVersion === 2
                ? input.analysis.requirements.map(requirement => ({
                    id: requirement.id,
                    acceptanceCriterion: requirement.acceptanceCriterion,
                    sourcePointers: requirement.sourcePointers,
                  }))
                : [],
            ...(input.experimentInputs.plan.verificationContract
              ? { verificationContract: input.experimentInputs.plan.verificationContract }
              : {}),
          },
        }
      : {}),
  });
  const delivery = buildCustomerChurnDeliveryWorkflows({
    projectId: input.projectId,
    executionId: bindingMarker('executionId'),
    artifact: runtimeArtifact,
    evidenceMap: bindingMarker('evidenceMap') as unknown as Record<string, unknown>,
    gate: bindingMarker('gate') as unknown as Record<string, unknown>,
  });
  const artifactBindings: System3RuntimeBindingSlot[] = [
    { name: 'artifactStorageKey', type: 'string' },
    { name: 'artifactContentHash', type: 'sha256' },
    { name: 'sourceExecutionId', type: 'uuid' },
  ];
  const definitions: readonly {
    activityId: System3WorkflowBundleActivityId;
    root: {
      name: string;
      outputs?: Record<string, string>;
      output_schema?: Record<string, unknown>;
    };
    definitions: readonly {
      name: string;
      nodes: readonly Record<string, unknown>[];
      input_schema?: Record<string, unknown>;
      output_schema?: Record<string, unknown>;
      outputs?: Record<string, string>;
    }[];
    runtimeBindings: readonly System3RuntimeBindingSlot[];
  }[] = [
    {
      activityId: 'TW-06',
      ...execution,
      // Experiment mode binds the build-or-run choice at execution time (plan 13 §10).
      runtimeBindings: [
        { name: 'executionId', type: 'uuid' },
        ...(input.plan.experiment ? [{ name: 'experimentRun', type: 'object' } as const] : []),
      ],
    },
    { activityId: 'TW-07', ...verification, runtimeBindings: artifactBindings },
    {
      activityId: 'TW-09',
      ...delivery,
      runtimeBindings: [
        ...artifactBindings,
        { name: 'executionId', type: 'uuid' },
        { name: 'evidenceMap', type: 'object' },
        { name: 'gate', type: 'object' },
      ],
    },
  ];
  return definitions.map(value => {
    const definition = workflowBundleDefinition({
      activityId: value.activityId,
      executionMode: input.rerunScope.executionMode,
      root: value.root,
      definitions: value.definitions,
      runtimeBindings: value.runtimeBindings,
      capabilityRegistry: input.capabilityRegistry,
      runtimeProfile: input.runtimeProfile,
    });
    const definitionHash = hashSystem3Definition(definition);
    return {
      id: snapshotId({
        projectId: input.projectId,
        compilationId: input.compilationId,
        activityId: value.activityId,
        definitionHash,
      }),
      projectId: input.projectId,
      compilationId: input.compilationId,
      activityId: value.activityId,
      schemaVersion: 3,
      compilerVersion: 'system3-compiler@3',
      templateId: 'customer-churn-reference@1',
      executionMode: input.rerunScope.executionMode,
      definition,
      definitionHash,
    };
  });
}

function validRuntimeBinding(slot: System3RuntimeBindingSlot, value: unknown): boolean {
  if (slot.type === 'string') return typeof value === 'string' && value.length > 0;
  if (slot.type === 'object')
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (slot.type === 'uuid') {
    return (
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    );
  }
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/i.test(value);
}

function replaceRuntimeBinding(
  value: unknown,
  bindings: Readonly<Record<string, unknown>>
): unknown {
  if (typeof value === 'string' && value.startsWith('$BINDING.')) {
    const name = value.slice('$BINDING.'.length);
    return bindings[name];
  }
  if (Array.isArray(value)) return value.map(item => replaceRuntimeBinding(item, bindings));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        replaceRuntimeBinding(item, bindings),
      ])
    );
  }
  return value;
}

/** Binds only declared typed slots; it cannot change executable graph shape. */
export function bindSystem3WorkflowBundle(
  bundle: System3WorkflowBundleSnapshot,
  bindings: Readonly<Record<string, unknown>>
): {
  definition: System3WorkflowBundleDefinition;
  runtimeBindings: Readonly<Record<string, unknown>>;
} {
  const declared = new Map(bundle.definition.runtimeBindings.map(slot => [slot.name, slot]));
  for (const slot of bundle.definition.runtimeBindings) {
    if (!(slot.name in bindings)) throw new Error(`Missing runtime binding '${slot.name}'`);
    if (!validRuntimeBinding(slot, bindings[slot.name])) {
      throw new Error(`Invalid runtime binding '${slot.name}'`);
    }
  }
  for (const name of Object.keys(bindings)) {
    if (!declared.has(name)) throw new Error(`Unexpected runtime binding '${name}'`);
  }
  return {
    definition: replaceRuntimeBinding(
      bundle.definition,
      bindings
    ) as System3WorkflowBundleDefinition,
    runtimeBindings: { ...bindings },
  };
}

/** Fail-closed approval, plan, snapshot, and bundle hash lineage preflight. */
export function verifyApprovedWorkflowBundle(input: {
  projectId: string;
  compilationId: string;
  plan: System3ExecutionPlan;
  definitionHash: string;
  approvalManifest: System3ApprovalManifest;
  bundle: System3WorkflowBundleSnapshot;
  activityId: System3WorkflowBundleActivityId;
}): System3WorkflowBundleSnapshot {
  if (
    input.plan.schemaVersion !== 3 ||
    input.plan.compilerVersion !== 'system3-compiler@3' ||
    input.approvalManifest.schemaVersion !== 3 ||
    input.approvalManifest.workflowBundleBindings === undefined
  ) {
    throw workflowBundleError('legacy compilation or approval has no approved workflow bundles');
  }
  if (hashSystem3Definition(input.plan) !== input.definitionHash) {
    throw workflowBundleError('execution plan hash does not match its approved definition');
  }
  if (input.approvalManifest.definitionHash !== input.definitionHash) {
    throw workflowBundleError('approval manifest does not bind this execution plan');
  }
  if (
    input.approvalManifest.projectId !== input.projectId ||
    input.approvalManifest.compilationId !== input.compilationId ||
    input.approvalManifest.compilerVersion !== input.plan.compilerVersion
  ) {
    throw workflowBundleError('approval manifest lineage is invalid');
  }
  if (
    input.bundle.projectId !== input.projectId ||
    input.bundle.compilationId !== input.compilationId ||
    input.bundle.activityId !== input.activityId ||
    input.bundle.definition.activityId !== input.activityId ||
    input.bundle.executionMode !== input.bundle.definition.executionMode ||
    input.bundle.schemaVersion !== 3 ||
    input.bundle.compilerVersion !== 'system3-compiler@3' ||
    hashSystem3Definition(input.bundle.definition) !== input.bundle.definitionHash
  ) {
    throw workflowBundleError('workflow bundle lineage or hash is invalid');
  }
  const bindings = input.approvalManifest.workflowBundleBindings;
  const expected = bindings.find(binding => binding.activityId === input.activityId);
  const validActivities = new Set(bindings.map(binding => binding.activityId));
  if (
    bindings.length !== workflowBundleActivities.length ||
    validActivities.size !== workflowBundleActivities.length ||
    workflowBundleActivities.some(activityId => !validActivities.has(activityId)) ||
    expected?.bundleSnapshotId !== input.bundle.id ||
    expected.bundleHash !== input.bundle.definitionHash ||
    expected.schemaVersion !== 3
  ) {
    throw workflowBundleError('approval manifest workflow bundle binding is invalid');
  }
  return input.bundle;
}

export function resolveSystem3ExecutionMode(
  affectedPhases: readonly System3PhaseId[]
): 'full' | 'experiment' | 'delivery' {
  if (
    affectedPhases.some(phase =>
      (['understanding', 'readiness', 'data', 'features'] as const).includes(
        phase as 'understanding'
      )
    )
  ) {
    return 'full';
  }
  return affectedPhases.includes('experiments') ? 'experiment' : 'delivery';
}

export function validateSystem3CapabilityPolicy(
  plan: System3ExecutionPlan,
  availableCapabilities: readonly System3CapabilityDescriptor[]
): void {
  const available = new Map(
    availableCapabilities.map(capability => [`${capability.id}@${capability.version}`, capability])
  );
  for (const required of plan.capabilityRegistry) {
    const current = available.get(`${required.id}@${required.version}`);
    if (!current)
      throw new Error(`Required capability '${required.id}@${required.version}' is unavailable`);
    if (hashSystem3Definition(current) !== hashSystem3Definition(required)) {
      throw new Error(`Capability policy changed for '${required.id}@${required.version}'`);
    }
    if (current.credentialRequirements.length > 0) {
      throw new Error(
        `Capability '${current.id}' requires unsupported credentials: ${current.credentialRequirements.join(', ')}`
      );
    }
    const phase = plan.phases.find(candidate => candidate.phaseId === current.phaseId);
    if (!phase)
      throw new Error(`Capability '${current.id}' references unknown phase '${current.phaseId}'`);
    const allowed = new Set(phase.permissions);
    const denied = current.permissions.filter(permission => !allowed.has(permission));
    if (denied.length > 0) {
      throw new Error(
        `Capability '${current.id}' requests permissions outside its phase: ${denied.join(', ')}`
      );
    }
  }
}

export function compileCustomerChurnReference(input: {
  /** A new compilation may reuse sources but is still its own immutable basis. */
  compilationId?: string;
  /** Keeps persisted snapshot identities isolated between System 3 projects. */
  projectId?: string;
  projectVersion?: number;
  knowledgeSnapshotId: string;
  readinessContract?: { id: string; contractHash: string };
  readinessContractBody?: System3ReadinessContractBody;
  sources: readonly System3SourceRecord[];
  analysis: BlueprintAnalysis;
  modelComparison?: ModelComparisonConfig;
  experiment?: ExperimentPin;
  rerunScope?: {
    impactManifestIds?: readonly string[];
    impactManifestId?: string;
    affectedPhases: readonly System3PhaseId[];
    reusableArtifact?: System3ReusableArtifact;
  };
  availableCapabilities?: readonly System3CapabilityDescriptor[];
}): {
  plan: System3ExecutionPlan;
  definitionHash: string;
  capabilityRegistryHash: string;
  workflowBundles: System3WorkflowBundleSnapshot[];
} {
  const latestByLineage = new Map<string, System3SourceRecord>();
  for (const source of input.sources) {
    const current = latestByLineage.get(source.sourceId);
    if (current === undefined || source.version > current.version)
      latestByLineage.set(source.sourceId, source);
  }
  const activeSources = [...latestByLineage.values()].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.sourceId.localeCompare(right.sourceId)
  );
  const primaryDatasetSources = activeSources.filter(
    source => source.kind === 'dataset' && source.role === 'primary'
  );
  const sourceIds = activeSources.map(source => source.id);
  const sourceHashes = activeSources.map(source => source.contentHash);
  if (!activeSources.some(source => source.kind === 'blueprint')) {
    throw new Error('Compilation requires a blueprint source');
  }
  if (primaryDatasetSources.length === 0) {
    throw new Error('Compilation requires one primary dataset Source Version (data_required)');
  }
  if (primaryDatasetSources.length > 1) {
    throw new Error('Compilation found multiple primary dataset Source Versions');
  }
  const datasetSource = primaryDatasetSources[0];
  if (!datasetSource) throw new Error('Primary dataset Source Version is unavailable');
  const modelComparison = input.modelComparison
    ? modelComparisonConfigSchema.parse(input.modelComparison)
    : undefined;
  const experiment = input.experiment ? experimentPinSchema.parse(input.experiment) : undefined;
  const readinessBody = input.readinessContractBody;
  const comparisonBody =
    readinessBody?.schemaVersion === 3 && 'modelComparison' in readinessBody
      ? readinessBody
      : undefined;
  const experimentBody =
    readinessBody?.schemaVersion === 3 && 'experiment' in readinessBody ? readinessBody : undefined;
  if (comparisonBody && !modelComparison) {
    throw new Error('Comparison Readiness Contract requires its pinned model comparison config');
  }
  if (experimentBody && !experiment) {
    throw new Error('Experiment Readiness Contract requires its pinned experiment config');
  }
  if (modelComparison && experiment) {
    throw new Error('A plan cannot combine model comparison and experiment mode');
  }
  let experimentInputs:
    | {
        plan: ExperimentPlan;
        blueprintSource: { id: string; contentHash: string };
        datasetSources: { id: string; contentHash: string }[];
      }
    | undefined;
  if (experiment) {
    const datasetSources = activeSources.filter(source => source.kind === 'dataset');
    const blueprintSources = activeSources.filter(source => source.kind === 'blueprint');
    const experimentPlan = deriveExperimentPlan(input.analysis);
    if (
      !experimentBody ||
      hashSystem3Definition(experimentBody.experiment) !== hashSystem3Definition(experiment) ||
      experimentBody.knowledgeSnapshotId !== input.knowledgeSnapshotId ||
      (input.projectVersion !== undefined &&
        experimentBody.projectVersion !== input.projectVersion - 1) ||
      canonicalJson([...experiment.datasetSourceVersionIds].sort()) !==
        canonicalJson(datasetSources.map(source => source.id).sort()) ||
      hashExperimentPlan(experimentPlan) !== experiment.planHash
    ) {
      throw new Error('Experiment mode requires a matching pinned experiment Readiness Contract');
    }
    if (experimentPlan.gaps.some(gap => gap.blocking) || experimentPlan.protocol === null)
      throw new Error('Experiment plan still has blocking gaps');
    const blueprintSource = blueprintSources[0];
    if (blueprintSources.length !== 1 || !blueprintSource)
      throw new Error('Experiment mode needs exactly one blueprint Source Version');
    if (
      input.rerunScope &&
      (resolveSystem3ExecutionMode(input.rerunScope.affectedPhases) !== 'full' ||
        input.rerunScope.reusableArtifact)
    )
      throw new Error(
        'Experiment mode supports full execution only; scoped reruns are not supported.'
      );
    experimentInputs = {
      plan: experimentPlan,
      blueprintSource: { id: blueprintSource.id, contentHash: blueprintSource.contentHash },
      datasetSources: datasetSources.map(source => ({
        id: source.id,
        contentHash: source.contentHash,
      })),
    };
  }
  if (modelComparison) {
    if (
      comparisonBody === undefined ||
      hashSystem3Definition(comparisonBody.modelComparison) !==
        hashSystem3Definition(modelComparison) ||
      comparisonBody.knowledgeSnapshotId !== input.knowledgeSnapshotId ||
      comparisonBody.datasetSourceVersionId !== primaryDatasetSources[0]?.id ||
      (input.projectVersion !== undefined &&
        comparisonBody.projectVersion !== input.projectVersion - 1) ||
      canonicalJson(comparisonBody.requirementIds) !==
        canonicalJson(modelComparison.requirementIds) ||
      comparisonBody.runtime.cpuOnly !== input.analysis.runtime.cpuOnly ||
      comparisonBody.runtime.ramGb !== input.analysis.runtime.ramGb
    ) {
      throw new Error('Model comparison requires a matching pinned comparison Readiness Contract');
    }
    if (
      input.rerunScope &&
      (resolveSystem3ExecutionMode(input.rerunScope.affectedPhases) !== 'full' ||
        input.rerunScope.reusableArtifact)
    ) {
      throw new Error(
        'Model comparison supports full execution only; scoped reruns are not supported.'
      );
    }
    const requirementIds = new Set(input.analysis.requirements.map(requirement => requirement.id));
    const unknownRequirementIds = modelComparison.requirementIds.filter(
      id => !requirementIds.has(id)
    );
    if (unknownRequirementIds.length > 0) {
      throw new Error(
        `Model comparison references unknown requirement IDs: ${unknownRequirementIds.join(', ')}`
      );
    }
  }
  const availableCapabilities = input.availableCapabilities ?? capabilityRegistry;
  const availableKeys = new Set(
    availableCapabilities.map(capability => `${capability.id}@${capability.version}`)
  );
  const unresolved = capabilityRegistry.filter(
    capability => !availableKeys.has(`${capability.id}@${capability.version}`)
  );
  if (unresolved.length > 0) {
    throw new Error(
      `Compilation has unresolved required capabilities: ${unresolved
        .map(capability => `${capability.id}@${capability.version}`)
        .join(', ')}`
    );
  }
  const resourceProfile = {
    cpuOnly: input.analysis.runtime.cpuOnly,
    ramGb: input.analysis.runtime.ramGb,
  };
  const projectIdentity = input.projectId ?? input.knowledgeSnapshotId;
  const compilationId =
    input.compilationId ??
    snapshotId({
      projectIdentity,
      knowledgeSnapshotId: input.knowledgeSnapshotId,
      sourceIds,
      sourceHashes,
      modelComparison: modelComparison ?? null,
      ...(experiment ? { experiment } : {}),
      compilerVersion: 'system3-compiler@3',
    });
  const runtimeProfileHash = hashSystem3Definition(resourceProfile);
  const runtimeProfileVersionId = snapshotId({ projectIdentity, resourceProfile });
  const productWorkflowVersionId = snapshotId({
    projectIdentity,
    template: 'customer-churn-reference@1',
  });
  const inputSnapshotId = snapshotId({
    knowledgeSnapshotId: input.knowledgeSnapshotId,
    sourceIds,
    sourceHashes,
  });
  const executionMode = input.rerunScope
    ? resolveSystem3ExecutionMode(input.rerunScope.affectedPhases)
    : 'full';
  if (executionMode !== 'full' && !input.rerunScope?.reusableArtifact) {
    throw new Error(`Scoped ${executionMode} execution requires an approved reusable artifact`);
  }
  const reusableSourceVersionIds = input.rerunScope?.reusableArtifact?.sourceVersionIds;
  if (executionMode !== 'full' && !reusableSourceVersionIds?.length) {
    throw new Error('Scoped artifact reuse requires immutable source dependency lineage');
  }
  const reusableSourceVersionIdSet = new Set(reusableSourceVersionIds);
  const executionDependencySourceIds = activeSources
    .filter(source => source.kind === 'blueprint' || source.kind === 'dataset')
    .map(source => source.id);
  if (
    executionMode === 'delivery' &&
    (reusableSourceVersionIdSet.size !== reusableSourceVersionIds?.length ||
      reusableSourceVersionIdSet.size !== executionDependencySourceIds.length ||
      executionDependencySourceIds.some(sourceId => !reusableSourceVersionIdSet.has(sourceId)))
  ) {
    throw new Error('Delivery result reuse requires an equivalent Source Version basis');
  }
  const skippedPhases =
    executionMode === 'full'
      ? []
      : system3PhaseOrder.filter(phase => !input.rerunScope?.affectedPhases.includes(phase));
  const impactManifestIds = input.rerunScope
    ? [
        ...(input.rerunScope.impactManifestIds ?? []),
        ...(input.rerunScope.impactManifestId ? [input.rerunScope.impactManifestId] : []),
      ].filter((value, index, values) => values.indexOf(value) === index)
    : [];
  if (input.rerunScope && impactManifestIds.length === 0) {
    throw new Error('Scoped rerun requires at least one Impact Manifest');
  }
  const rerunScope: System3ExecutionPlan['rerunScope'] = input.rerunScope
    ? {
        mode: 'scoped',
        executionMode,
        impactManifestId: impactManifestIds[0] ?? null,
        impactManifestIds,
        affectedPhases: [...input.rerunScope.affectedPhases],
        skippedPhases,
        reusedArtifacts: input.rerunScope.reusableArtifact
          ? [input.rerunScope.reusableArtifact]
          : [],
      }
    : {
        mode: 'full',
        executionMode: 'full',
        impactManifestId: null,
        impactManifestIds: [],
        affectedPhases: [...system3PhaseOrder],
        skippedPhases: [],
        reusedArtifacts: [],
      };
  const controlWorkflows: ProjectedWorkflowDefinition[] = [
    buildUnderstandProjectWorkflow({
      projectId: projectIdentity,
      inputSnapshotId,
      ...(modelComparison ? { modelComparison } : {}),
      sources: activeSources.map(source => ({
        id: source.id,
        kind: source.kind,
        filename: source.filename,
        mediaType: source.mediaType,
        contentHash: source.contentHash,
      })),
    }),
    buildReadinessContractWorkflow({
      analysis: input.analysis,
      ...(modelComparison ? { modelComparison } : {}),
      ...(experiment ? { experiment } : {}),
      decisions: [],
      knowledgeSnapshotId: input.knowledgeSnapshotId,
      projectVersion: input.projectVersion ?? 1,
      datasetSourceVersionId: datasetSource.id,
      requiredCapabilityIds: capabilityRegistry
        .filter(capability => ['build', 'experiment', 'delivery'].includes(capability.phaseId))
        .map(capability => capability.id),
      availableCapabilityIds: availableCapabilities.map(capability => capability.id),
    }),
  ];
  const provisionalPlan: System3ExecutionPlan = {
    schemaVersion: 3,
    compilerVersion: 'system3-compiler@3',
    templateId: 'customer-churn-reference@1',
    productWorkflowVersionId,
    inputSnapshotId,
    capabilityRegistrySnapshotId: snapshotId({ projectIdentity, capabilityRegistry }),
    compilationBasisId: snapshotId({
      compilationId,
      modelComparison: modelComparison ?? null,
      compilerVersion: 'system3-compiler@3',
    }),
    executionPlanSnapshotId: snapshotId({
      compilationId,
      rerunScope,
      modelComparison: modelComparison ?? null,
    }),
    runtimeProfileVersionId,
    runtimeProfileHash,
    runtimeProfile: resourceProfile,
    inputSnapshot: { sourceIds, sourceHashes },
    ...(modelComparison ? { modelComparison } : {}),
    ...(experiment ? { experiment } : {}),
    knowledgeSnapshotId: input.knowledgeSnapshotId,
    ...(input.readinessContract ? { readinessContract: input.readinessContract } : {}),
    capabilityRegistry: capabilityRegistry.map(capability => ({ ...capability })),
    rerunScope,
    phases: [],
  };
  const provisionalBundles = compileSystem3WorkflowBundles({
    projectId: projectIdentity,
    compilationId,
    projectName: 'Customer Churn',
    targetColumn:
      input.analysis.dataset?.targetColumn ?? (modelComparison || experiment ? null : 'target'),
    datasetSource: { id: datasetSource.id, contentHash: datasetSource.contentHash },
    plan: provisionalPlan,
    analysis: input.analysis,
    runtimeProfile: resourceProfile,
    capabilityRegistry,
    rerunScope: {
      executionMode,
      reusedArtifacts: rerunScope.reusedArtifacts,
    },
    ...(experimentInputs ? { experimentInputs } : {}),
  });
  const provisionalPhases = projectWorkflowPhases({
    workflows: [
      ...controlWorkflows,
      ...provisionalBundles.flatMap(bundle =>
        bundle.definition.workflows.map(
          workflow => workflow as unknown as ProjectedWorkflowDefinition
        )
      ),
    ],
    capabilities: capabilityRegistry,
    runtimeProfile: resourceProfile,
  });
  const usedCapabilityIds = new Set(
    provisionalPhases.flatMap(phase => Object.values(phase.executors ?? {}))
  );
  const compiledCapabilities = capabilityRegistry.filter(capability =>
    usedCapabilityIds.has(capability.id)
  );
  const capabilityRegistryHash = hashSystem3Definition(compiledCapabilities);
  const capabilityRegistrySnapshotId = snapshotId({ projectIdentity, compiledCapabilities });
  const compilationBasisId = snapshotId({
    compilationId,
    productWorkflowVersionId,
    inputSnapshotId,
    capabilityRegistrySnapshotId,
    runtimeProfileVersionId,
    readinessContract: input.readinessContract ?? null,
    modelComparison: modelComparison ?? null,
    ...(experiment ? { experiment } : {}),
    compilerVersion: 'system3-compiler@3',
  });
  const executionPlanSnapshotId = snapshotId({
    compilationId,
    compilationBasisId,
    rerunScope,
    modelComparison: modelComparison ?? null,
  });
  const plan: System3ExecutionPlan = {
    ...provisionalPlan,
    capabilityRegistrySnapshotId,
    compilationBasisId,
    executionPlanSnapshotId,
    capabilityRegistry: compiledCapabilities.map(capability => ({ ...capability })),
    phases: provisionalPhases,
  };
  const workflowBundles = compileSystem3WorkflowBundles({
    projectId: projectIdentity,
    compilationId,
    projectName: 'Customer Churn',
    targetColumn:
      input.analysis.dataset?.targetColumn ?? (modelComparison || experiment ? null : 'target'),
    datasetSource: { id: datasetSource.id, contentHash: datasetSource.contentHash },
    plan,
    analysis: input.analysis,
    runtimeProfile: resourceProfile,
    capabilityRegistry: compiledCapabilities,
    rerunScope: {
      executionMode,
      reusedArtifacts: rerunScope.reusedArtifacts,
    },
    ...(experimentInputs ? { experimentInputs } : {}),
  });
  const projectedPhases = projectWorkflowPhases({
    workflows: [
      ...controlWorkflows,
      ...workflowBundles.flatMap(bundle =>
        bundle.definition.workflows.map(
          workflow => workflow as unknown as ProjectedWorkflowDefinition
        )
      ),
    ],
    capabilities: compiledCapabilities,
    runtimeProfile: resourceProfile,
  });
  if (canonicalJson(projectedPhases) !== canonicalJson(plan.phases)) {
    throw new Error('Workflow bundle phase projection changed during compilation');
  }
  validateSystem3CapabilityPolicy(plan, availableCapabilities);
  return {
    plan,
    definitionHash: hashSystem3Definition(plan),
    capabilityRegistryHash,
    workflowBundles,
  };
}

export function createApprovalManifest(input: {
  compilationId: string;
  projectId: string;
  plan: System3ExecutionPlan;
  definitionHash: string;
  capabilityRegistryHash: string;
  workflowBundles?: readonly System3WorkflowBundleSnapshot[];
  approvedBy?: string;
}): System3ApprovalManifest {
  const workflowBundleBindings: System3ApprovedBundleBinding[] | undefined =
    input.plan.schemaVersion === 3
      ? approvalWorkflowBundleBindings(input.projectId, input.compilationId, input.workflowBundles)
      : undefined;
  return {
    schemaVersion: workflowBundleBindings === undefined ? 2 : 3,
    compilationId: input.compilationId,
    projectId: input.projectId,
    productWorkflowVersionId: input.plan.productWorkflowVersionId,
    inputSnapshotId: input.plan.inputSnapshotId,
    capabilityRegistrySnapshotId: input.plan.capabilityRegistrySnapshotId,
    compilationBasisId: input.plan.compilationBasisId,
    executionPlanSnapshotId: input.plan.executionPlanSnapshotId,
    runtimeProfileVersionId: input.plan.runtimeProfileVersionId,
    compilerVersion: input.plan.compilerVersion,
    approvedBy: input.approvedBy ?? 'system3-web',
    approvedAt: new Date().toISOString(),
    templateId: input.plan.templateId,
    inputSnapshot: input.plan.inputSnapshot,
    knowledgeSnapshotId: input.plan.knowledgeSnapshotId,
    ...(input.plan.readinessContract ? { readinessContract: input.plan.readinessContract } : {}),
    capabilityRegistryHash: input.capabilityRegistryHash,
    definitionHash: input.definitionHash,
    executionPlanHash: hashSystem3Definition(input.plan),
    runtimeProfile: input.plan.runtimeProfile,
    ...(workflowBundleBindings ? { workflowBundleBindings } : {}),
  };
}

function approvalWorkflowBundleBindings(
  projectId: string,
  compilationId: string,
  workflowBundles: readonly System3WorkflowBundleSnapshot[] | undefined
): System3ApprovedBundleBinding[] {
  if (workflowBundles?.length !== workflowBundleActivities.length) {
    throw workflowBundleError('approval requires exactly three workflow bundle snapshots');
  }
  const byActivity = new Map(workflowBundles.map(bundle => [bundle.activityId, bundle]));
  if (
    byActivity.size !== workflowBundleActivities.length ||
    workflowBundleActivities.some(activityId => !byActivity.has(activityId))
  ) {
    throw workflowBundleError('approval requires TW-06, TW-07 and TW-09 workflow bundles');
  }
  return workflowBundleActivities.map(activityId => {
    const bundle = byActivity.get(activityId);
    if (
      bundle?.projectId !== projectId ||
      bundle.compilationId !== compilationId ||
      bundle.schemaVersion !== 3 ||
      bundle.compilerVersion !== 'system3-compiler@3' ||
      bundle.definition.activityId !== activityId ||
      hashSystem3Definition(bundle.definition) !== bundle.definitionHash
    ) {
      throw workflowBundleError(`invalid ${activityId} workflow bundle snapshot`);
    }
    return {
      activityId,
      bundleSnapshotId: bundle.id,
      bundleHash: bundle.definitionHash,
      schemaVersion: 3,
    };
  });
}

export function newCompilationId(): string {
  return randomUUID();
}
