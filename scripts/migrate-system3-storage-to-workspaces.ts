import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, normalize, relative, sep } from 'node:path';
import { Database } from 'bun:sqlite';

interface ProjectRow {
  id: string;
  name: string;
  codebase_id: string;
  codebase_name: string;
  default_cwd: string;
}

interface SourceRow {
  id: string;
  source_id: string;
  project_id: string;
  kind: string;
  original_filename: string;
  lineage_version: number;
  content_hash: string;
  size_bytes: number;
  storage_key: string;
}

interface StorageKeyRow {
  project_id: string;
  storage_key: string;
}

interface WorkflowRunRow {
  id: string;
  codebase_id: string;
  metadata: string | null;
}

interface KeyMigration {
  projectId: string;
  oldKey: string;
  newKey: string;
}

const apply = process.argv.includes('--apply');
const configuredHome = process.env.ANVIL_HOME;
const anvilHome = normalize(configuredHome ? configuredHome : join(homedir(), '.anvil'));
const databasePath = join(anvilHome, 'anvil.db');
const workspacesRoot = join(anvilHome, 'workspaces');
const legacyRoot = join(anvilHome, 'system3', 'projects');
const database = apply
  ? new Database(databasePath)
  : new Database(databasePath, { readonly: true });

function safeFilename(filename: string): string {
  const clean = basename(filename).replace(/[^A-Za-z0-9._-]/g, '_');
  return clean.length > 0 ? clean : 'source';
}

function assertUnder(root: string, candidate: string): void {
  const normalizedRoot = normalize(root);
  const normalizedCandidate = normalize(candidate);
  if (
    normalizedCandidate !== normalizedRoot &&
    !normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
  ) {
    throw new Error(`Unsafe migration path outside ${normalizedRoot}: ${normalizedCandidate}`);
  }
}

function projectRoot(project: ProjectRow): string {
  const cwd = normalize(project.default_cwd);
  if (cwd.startsWith(`${workspacesRoot}${sep}`)) {
    const parts = relative(workspacesRoot, cwd).split(sep).filter(Boolean);
    if (parts.length >= 2) return join(workspacesRoot, parts[0], parts[1]);
  }
  const nameParts = project.codebase_name.split('/');
  if (nameParts.length === 2 && nameParts.every(value => /^[A-Za-z0-9._-]+$/.test(value))) {
    return join(workspacesRoot, nameParts[0], nameParts[1]);
  }
  if (/^[A-Za-z0-9._-]+$/.test(project.codebase_name)) {
    return join(workspacesRoot, '_local', project.codebase_name);
  }
  throw new Error(`Cannot map codebase '${project.codebase_name}' to an Anvil workspace`);
}

function sourceStorageKey(source: SourceRow): string {
  const hash = source.content_hash.slice('sha256:'.length);
  const version = source.lineage_version.toString().padStart(3, '0');
  return join(
    'sources',
    source.kind,
    source.source_id,
    `v${version}_${hash}`,
    safeFilename(source.original_filename)
  );
}

function resourceStorageKey(oldKey: string): string {
  if (oldKey.startsWith('artifacts/source-intake/')) {
    return `operations/OP-00/${oldKey.slice('artifacts/source-intake/'.length)}`;
  }
  if (oldKey.startsWith('knowledge/')) {
    return `snapshots/knowledge/${oldKey.slice('knowledge/'.length)}`;
  }
  if (oldKey.startsWith('readiness/')) {
    return `contracts/readiness/${oldKey.slice('readiness/'.length)}`;
  }
  return oldKey.startsWith('artifacts/') ? oldKey.slice('artifacts/'.length) : oldKey;
}

async function copyVerified(
  sourceCandidates: readonly string[],
  newPath: string,
  expectedHash?: string,
  expectedSize?: number
): Promise<void> {
  for (const candidate of sourceCandidates) assertUnder(anvilHome, candidate);
  assertUnder(workspacesRoot, newPath);
  let bytes: Buffer | undefined;
  let sourcePath: string | undefined;
  for (const candidate of [...sourceCandidates, newPath]) {
    try {
      bytes = await readFile(candidate);
      sourcePath = candidate;
      break;
    } catch (error) {
      const code = error as NodeJS.ErrnoException;
      if (code.code !== 'ENOENT') throw error;
    }
  }
  if (!bytes || !sourcePath) {
    throw new Error(`Migration source is missing for target ${newPath}`);
  }
  if (expectedSize !== undefined && bytes.byteLength !== expectedSize) {
    throw new Error(`Size mismatch for ${sourcePath}`);
  }
  if (expectedHash !== undefined) {
    const actualHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (actualHash !== expectedHash) throw new Error(`Hash mismatch for ${sourcePath}`);
  }
  if (!apply || sourcePath === newPath) return;
  await mkdir(dirname(newPath), { recursive: true });
  await writeFile(newPath, bytes, { flag: 'wx' }).catch(async error => {
    const code = error as NodeJS.ErrnoException;
    if (code.code !== 'EEXIST') throw error;
    const existing = await readFile(newPath);
    if (!existing.equals(bytes)) throw new Error(`Target exists with different bytes: ${newPath}`);
  });
}

const projects = database
  .query<ProjectRow, []>(
    `SELECT project.id, project.name, project.codebase_id,
            codebase.name AS codebase_name, codebase.default_cwd
     FROM remote_agent_system3_projects project
     JOIN remote_agent_codebases codebase ON codebase.id = project.codebase_id
     ORDER BY project.created_at`
  )
  .all();
const projectsById = new Map(projects.map(project => [project.id, project]));
const keyMigrations = new Map<string, KeyMigration>();

function addKeyMigration(projectId: string, oldKey: string, newKey: string): void {
  const identity = `${projectId}:${oldKey}`;
  const existing = keyMigrations.get(identity);
  if (existing && existing.newKey !== newKey) {
    throw new Error(`Conflicting target keys for ${identity}`);
  }
  keyMigrations.set(identity, { projectId, oldKey, newKey });
}

for (const source of database
  .query<SourceRow, []>(
    `SELECT id, source_id, project_id, kind, original_filename, lineage_version,
            content_hash, size_bytes, storage_key
     FROM remote_agent_system3_source_versions
     WHERE storage_status = 'ready'`
  )
  .all()) {
  const project = projectsById.get(source.project_id);
  if (!project) throw new Error(`Missing project for Source Version ${source.id}`);
  const newKey = sourceStorageKey(source);
  const artifactsRoot = join(projectRoot(project), 'artifacts');
  await copyVerified(
    [
      join(legacyRoot, source.project_id, source.storage_key),
      join(artifactsRoot, source.storage_key),
    ],
    join(artifactsRoot, newKey),
    source.content_hash,
    source.size_bytes
  );
  addKeyMigration(source.project_id, source.storage_key, newKey);
}

const resourceQueries = [
  'SELECT project_id, artifact_key AS storage_key FROM remote_agent_system3_source_intake_reports',
  'SELECT project_id, artifact_key AS storage_key FROM remote_agent_system3_knowledge_snapshots',
  'SELECT project_id, artifact_key AS storage_key FROM remote_agent_system3_readiness_contracts',
  'SELECT project_id, artifact_key AS storage_key FROM remote_agent_system3_artifact_versions',
  'SELECT project_id, package_storage_key AS storage_key FROM remote_agent_system3_delivery_manifests',
] as const;

for (const query of resourceQueries) {
  for (const resource of database.query<StorageKeyRow, []>(query).all()) {
    const project = projectsById.get(resource.project_id);
    if (!project) throw new Error(`Missing project for storage key ${resource.storage_key}`);
    const newKey = resourceStorageKey(resource.storage_key);
    const artifactsRoot = join(projectRoot(project), 'artifacts');
    await copyVerified(
      [
        join(legacyRoot, resource.project_id, resource.storage_key),
        join(artifactsRoot, resource.storage_key),
      ],
      join(artifactsRoot, newKey)
    );
    addKeyMigration(resource.project_id, resource.storage_key, newKey);
  }
}

for (const project of projects) {
  const root = projectRoot(project);
  const oldRunRoot = join(project.default_cwd, '.anvil', 'artifacts', 'runs');
  const newRunRoot = join(root, 'artifacts', 'runs');
  const oldLogRoot = join(project.default_cwd, '.anvil', 'logs');
  const newLogRoot = join(root, 'logs');
  if (apply) {
    await stat(oldRunRoot)
      .then(async () => cp(oldRunRoot, newRunRoot, { recursive: true, errorOnExist: false }))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    await stat(oldLogRoot)
      .then(async () => cp(oldLogRoot, newLogRoot, { recursive: true, errorOnExist: false }))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    await writeFile(
      join(root, 'project.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          projectId: project.id,
          codebaseId: project.codebase_id,
          name: project.name,
          sourcePath: project.default_cwd,
          artifactsPath: join(root, 'artifacts'),
        },
        null,
        2
      )}\n`
    );
  }
}

if (apply) {
  const migrateDatabase = database.transaction(() => {
    for (const migration of keyMigrations.values()) {
      database
        .query(
          `UPDATE remote_agent_system3_source_versions
           SET storage_key = ? WHERE project_id = ? AND storage_key = ?`
        )
        .run(migration.newKey, migration.projectId, migration.oldKey);
      for (const table of [
        'remote_agent_system3_source_intake_reports',
        'remote_agent_system3_knowledge_snapshots',
        'remote_agent_system3_readiness_contracts',
        'remote_agent_system3_artifact_versions',
      ]) {
        database
          .query(`UPDATE ${table} SET artifact_key = ? WHERE project_id = ? AND artifact_key = ?`)
          .run(migration.newKey, migration.projectId, migration.oldKey);
      }
      database
        .query(
          `UPDATE remote_agent_system3_delivery_manifests
           SET package_storage_key = ? WHERE project_id = ? AND package_storage_key = ?`
        )
        .run(migration.newKey, migration.projectId, migration.oldKey);
    }

    const runs = database
      .query<WorkflowRunRow, []>(
        `SELECT id, codebase_id, metadata FROM remote_agent_workflow_runs
         WHERE codebase_id IN (SELECT codebase_id FROM remote_agent_system3_projects)`
      )
      .all();
    for (const run of runs) {
      const project = projects.find(value => value.codebase_id === run.codebase_id);
      if (!project) continue;
      const metadata = run.metadata ? (JSON.parse(run.metadata) as Record<string, unknown>) : {};
      const oldPrefix = join(project.default_cwd, '.anvil', 'artifacts', 'runs');
      const current = metadata.artifacts_dir;
      if (typeof current !== 'string') continue;
      const relativeRunPath = relative(oldPrefix, current);
      if (relativeRunPath.startsWith('..') || relativeRunPath === '') continue;
      metadata.artifacts_dir = join(projectRoot(project), 'artifacts', 'runs', relativeRunPath);
      database
        .query('UPDATE remote_agent_workflow_runs SET metadata = ? WHERE id = ?')
        .run(JSON.stringify(metadata), run.id);
    }
  });
  migrateDatabase();
}

console.log(
  JSON.stringify(
    {
      mode: apply ? 'applied' : 'dry-run',
      anvilHome,
      projectCount: projects.length,
      migratedStorageKeys: keyMigrations.size,
      projects: projects.map(project => ({
        id: project.id,
        name: project.name,
        workspace: projectRoot(project),
      })),
    },
    null,
    2
  )
);

database.close();
