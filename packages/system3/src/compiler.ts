import { createHash, randomUUID } from 'node:crypto';
import type {
  BlueprintAnalysis,
  System3ApprovalManifest,
  System3CapabilityDescriptor,
  System3ExecutionPlan,
  System3ReusableArtifact,
} from './contracts';
import type { System3SourceRecord } from './store';
import { customerChurnCapabilityDescriptors } from './capabilities';
import { system3PhaseOrder, type System3PhaseId } from './invalidation';

const capabilityRegistry = customerChurnCapabilityDescriptors;

const phasePlans = [
  {
    phaseId: 'understanding',
    workflow: 'system3-understand-project',
    nodePath: [
      'verify-input-snapshot',
      'extract-blueprint',
      'profile-dataset',
      'compose-overview',
      'create-decisions',
    ],
    permissions: ['source:read', 'artifact:write'],
    timeoutMs: 60_000,
  },
  {
    phaseId: 'readiness',
    workflow: 'system3-readiness-contract',
    nodePath: ['evaluate-gates', 'resolve-decisions', 'finalize-contract'],
    permissions: ['source:read', 'artifact:write'],
    timeoutMs: 60_000,
  },
  {
    phaseId: 'build',
    workflow: 'system3-baseline-build',
    nodePath: ['materialize-approved-plan', 'scaffold-project', 'validate-project'],
    permissions: ['source:read', 'artifact:read', 'artifact:write', 'process:python'],
    timeoutMs: 180_000,
  },
  {
    phaseId: 'experiment',
    workflow: 'system3-baseline-experiment',
    nodePath: ['validate-dataset', 'run-tests', 'run-data-pipeline', 'run-baseline'],
    permissions: ['artifact:read', 'artifact:write', 'process:python', 'process:tar'],
    timeoutMs: 420_000,
  },
  {
    phaseId: 'delivery',
    workflow: 'system3-verify-deliver',
    nodePath: [
      'validate-artifact-schemas',
      'build-evidence-map',
      'evaluate-baseline-gate',
      'package',
      'delivery-manifest',
    ],
    permissions: ['artifact:read', 'artifact:write', 'process:tar'],
    timeoutMs: 180_000,
  },
] as const;

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
  knowledgeSnapshotId: string;
  readinessContract?: { id: string; contractHash: string };
  sources: readonly System3SourceRecord[];
  analysis: BlueprintAnalysis;
  rerunScope?: {
    impactManifestIds?: readonly string[];
    impactManifestId?: string;
    affectedPhases: readonly System3PhaseId[];
    reusableArtifact?: System3ReusableArtifact;
  };
  availableCapabilities?: readonly System3CapabilityDescriptor[];
}): { plan: System3ExecutionPlan; definitionHash: string; capabilityRegistryHash: string } {
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
  const sourceIds = activeSources.map(source => source.id);
  const sourceHashes = activeSources.map(source => source.contentHash);
  if (!activeSources.some(source => source.kind === 'blueprint')) {
    throw new Error('Compilation requires a blueprint source');
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
  const capabilityRegistryHash = hashSystem3Definition(capabilityRegistry);
  const projectIdentity = input.projectId ?? input.knowledgeSnapshotId;
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
  const capabilityRegistrySnapshotId = snapshotId({ projectIdentity, capabilityRegistry });
  const compilationBasisId = snapshotId({
    compilationId: input.compilationId ?? 'deterministic',
    productWorkflowVersionId,
    inputSnapshotId,
    capabilityRegistrySnapshotId,
    runtimeProfileVersionId,
    readinessContract: input.readinessContract ?? null,
    compilerVersion: 'system3-compiler@2',
  });
  const executionPlanSnapshotId = snapshotId({
    compilationId: input.compilationId ?? 'deterministic',
    compilationBasisId,
    rerunScope: input.rerunScope ?? null,
  });
  const executionMode = input.rerunScope
    ? resolveSystem3ExecutionMode(input.rerunScope.affectedPhases)
    : 'full';
  if (executionMode !== 'full' && !input.rerunScope?.reusableArtifact) {
    throw new Error(`Scoped ${executionMode} execution requires an approved reusable artifact`);
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
  const plan: System3ExecutionPlan = {
    schemaVersion: 2,
    compilerVersion: 'system3-compiler@2',
    templateId: 'customer-churn-reference@1',
    // These IDs are persisted with the compilation. They ensure an approval
    // never silently follows a later source, workflow, or registry change.
    productWorkflowVersionId,
    inputSnapshotId,
    capabilityRegistrySnapshotId,
    compilationBasisId,
    executionPlanSnapshotId,
    runtimeProfileVersionId,
    runtimeProfileHash,
    runtimeProfile: resourceProfile,
    inputSnapshot: { sourceIds, sourceHashes },
    knowledgeSnapshotId: input.knowledgeSnapshotId,
    ...(input.readinessContract ? { readinessContract: input.readinessContract } : {}),
    capabilityRegistry: capabilityRegistry.map(capability => ({ ...capability })),
    rerunScope: input.rerunScope
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
        },
    phases: phasePlans.map(phase => ({
      ...phase,
      nodePath: [...phase.nodePath],
      permissions: [...phase.permissions],
      resourceProfile,
    })),
  };
  validateSystem3CapabilityPolicy(plan, availableCapabilities);
  return {
    plan,
    definitionHash: hashSystem3Definition(plan),
    capabilityRegistryHash,
  };
}

export function createApprovalManifest(input: {
  compilationId: string;
  projectId: string;
  plan: System3ExecutionPlan;
  definitionHash: string;
  capabilityRegistryHash: string;
  approvedBy?: string;
}): System3ApprovalManifest {
  return {
    schemaVersion: 2,
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
  };
}

export function newCompilationId(): string {
  return randomUUID();
}
