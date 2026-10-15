import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { z } from '@hono/zod-openapi';
import { blueprintAnalysisSchema } from './contracts';
import type { System3CapabilityDescriptor } from './contracts';
import { SYSTEM3_CSV_LIMITS } from './csv-contract';
import { profileDatasetCsvStream } from './understanding/dataset-profiler';

function descriptor<const T extends string>(
  id: T,
  phaseId: System3CapabilityDescriptor['phaseId'],
  permissions: System3CapabilityDescriptor['permissions'],
  timeoutMs: number,
  version = '1'
): System3CapabilityDescriptor & { id: T } {
  return {
    id,
    version,
    phaseId,
    permissions,
    timeoutMs,
    resourceProfile: { cpuOnly: true, ramGb: null },
    credentialRequirements: [],
    inputSchemaId: `${id}.input@${version}`,
    outputSchemaId: `${id}.output@${version}`,
  };
}

export const baselineCapabilityDescriptors = [
  descriptor('system3.approved-plan-materializer', 'build', ['artifact:write'], 10_000),
  descriptor('system3.project-scaffolder', 'build', ['source:read', 'artifact:write'], 30_000, '2'),
  descriptor('system3.project-validator', 'build', ['artifact:read', 'process:python'], 10_000),
  descriptor(
    'system3.pinned-dataset-materializer',
    'experiment',
    ['source:read', 'artifact:read', 'artifact:write'],
    10_000
  ),
  descriptor('system3.dataset-validator', 'experiment', ['artifact:read'], 10_000),
  descriptor(
    'system3.test-runner',
    'experiment',
    ['artifact:read', 'artifact:write', 'process:python'],
    120_000
  ),
  descriptor(
    'system3.data-pipeline-runner',
    'experiment',
    ['artifact:read', 'artifact:write', 'process:python'],
    120_000
  ),
  descriptor(
    'system3.baseline-runner',
    'experiment',
    ['artifact:read', 'artifact:write', 'process:python'],
    120_000
  ),
  descriptor(
    'system3.baseline-artifact-packager',
    'experiment',
    ['artifact:read', 'artifact:write', 'process:tar'],
    120_000
  ),
  descriptor(
    'system3.delivery-artifact-materializer',
    'delivery',
    ['artifact:read', 'artifact:write', 'process:tar'],
    120_000
  ),
  descriptor('system3.artifact-schema-validator', 'delivery', ['artifact:read'], 10_000),
  descriptor(
    'system3.evidence-map-builder',
    'delivery',
    ['artifact:read', 'artifact:write'],
    10_000
  ),
  descriptor('system3.baseline-gate-evaluator', 'delivery', ['artifact:read'], 10_000),
  descriptor(
    'system3.delivery-packager',
    'delivery',
    ['artifact:read', 'artifact:write', 'process:tar'],
    120_000
  ),
  descriptor(
    'system3.delivery-manifest-builder',
    'delivery',
    ['artifact:read', 'artifact:write'],
    10_000
  ),
] as const;

export type BaselineCapabilityId = (typeof baselineCapabilityDescriptors)[number]['id'];

interface CapabilityContext {
  runId: string;
  nodeId: string;
  cwd: string;
  artifactsDir: string;
  signal: AbortSignal;
}

interface CapabilityResult {
  output: string;
  structuredOutput?: unknown;
}

type CapabilityHandler = (
  input: Readonly<Record<string, unknown>>,
  context: CapabilityContext
) => Promise<CapabilityResult>;

const planInputSchema = z.object({
  projectId: z.string().uuid(),
  compilationId: z.string().uuid(),
  definitionHash: z.string().startsWith('sha256:'),
  plan: z.record(z.string(), z.unknown()),
});
const scaffoldInputSchema = z.object({
  projectName: z.string().min(1),
  targetColumn: z.string().min(1),
  datasetSourceVersionId: z.string().uuid(),
  datasetContentHash: z.string().startsWith('sha256:'),
  datasetFilename: z.string().min(1),
  datasetBytes: z.instanceof(Uint8Array),
});
const materializeDatasetInputSchema = z.object({
  projectDir: z.string().min(1),
  targetColumn: z.string().min(1),
  datasetSourceVersionId: z.string().uuid(),
  datasetContentHash: z.string().startsWith('sha256:'),
  datasetFilename: z.string().min(1),
  datasetBytes: z.instanceof(Uint8Array),
});
const projectDirInputSchema = z.object({ projectDir: z.string().min(1) });
const evidenceInputSchema = projectDirInputSchema.extend({
  analysis: blueprintAnalysisSchema,
  testResult: z.record(z.string(), z.unknown()),
  dataResult: z.record(z.string(), z.unknown()),
  experiment: z.record(z.string(), z.unknown()),
});
const gateInputSchema = z.object({ evidenceMap: z.record(z.string(), z.unknown()) });
const packageInputSchema = projectDirInputSchema.extend({
  gate: z.record(z.string(), z.unknown()),
});
const manifestInputSchema = z.object({
  projectId: z.string().uuid(),
  executionId: z.string().uuid(),
  packagePath: z.string().min(1),
  evidenceMap: z.record(z.string(), z.unknown()),
  gate: z.record(z.string(), z.unknown()),
});
const reuseArtifactInputSchema = z.object({
  projectId: z.string().uuid(),
  storageKey: z.string().min(1),
  contentHash: z.string().startsWith('sha256:'),
  sourceExecutionId: z.string().uuid(),
  archiveBytes: z.instanceof(Uint8Array),
});

const dataPy = `import csv
from collections import Counter
from pathlib import Path

MAX_ROWS = ${SYSTEM3_CSV_LIMITS.maxRows.toString()}
MAX_COLUMNS = ${SYSTEM3_CSV_LIMITS.maxColumns.toString()}
MAX_RECORD_BYTES = ${SYSTEM3_CSV_LIMITS.maxRecordBytes.toString()}
csv.field_size_limit(MAX_RECORD_BYTES)

def _validated_header(reader):
    try:
        header = next(reader)
    except StopIteration as exc:
        raise ValueError("dataset has no header") from exc
    if not header or any(not value.strip() for value in header):
        raise ValueError("dataset has a blank header")
    if len(header) > MAX_COLUMNS:
        raise ValueError(f"dataset exceeds {MAX_COLUMNS} columns")
    if len(set(header)) != len(header):
        raise ValueError("dataset has duplicate headers")
    return header

def summarize_dataset(path: Path, target_column: str):
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle, strict=True)
        header = _validated_header(reader)
        if target_column not in header:
            raise ValueError("target column missing")
        target_index = header.index(target_column)
        target_counts = Counter()
        row_count = 0
        for row in reader:
            row_count += 1
            if row_count > MAX_ROWS:
                raise ValueError(f"dataset exceeds {MAX_ROWS} rows")
            if len(row) != len(header):
                raise ValueError(f"row {row_count + 1} has {len(row)} fields; expected {len(header)}")
            if sum(len(value.encode("utf-8")) for value in row) > MAX_RECORD_BYTES:
                raise ValueError(f"row {row_count + 1} exceeds the record-size limit")
            target_counts[row[target_index]] += 1
    if row_count == 0:
        raise ValueError("dataset is empty")
    return row_count, target_counts
`;
const modelPy =
  'from collections import Counter\n\ndef majority_label(labels):\n    if not labels:\n        raise ValueError("labels are empty")\n    return Counter(labels).most_common(1)[0][0]\n\ndef evaluate(labels, prediction):\n    correct = sum(1 for label in labels if label == prediction)\n    return {"accuracy": correct / len(labels), "rows": len(labels), "prediction": prediction}\n';

function result(value: unknown): CapabilityResult {
  return { output: JSON.stringify(value), structuredOutput: value };
}

function assertNotAborted(context: CapabilityContext): void {
  if (context.signal.aborted) throw new Error(`Capability '${context.nodeId}' was aborted`);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function executionRoot(context: CapabilityContext): string {
  return resolve(context.artifactsDir, '../../..');
}

async function assertExecutionPath(path: string, context: CapabilityContext): Promise<string> {
  const root = await realpath(executionRoot(context));
  const candidate = await realpath(path);
  const rel = relative(root, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== candidate) {
    throw new Error('System 3 execution artifact escaped its immutable run root');
  }
  return candidate;
}

async function runPython(
  projectDir: string,
  args: string[],
  signal: AbortSignal
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const process = Bun.spawn(['python3', ...args], {
    cwd: projectDir,
    stdout: 'pipe',
    stderr: 'pipe',
    signal,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  const commandResult = { exitCode, stdout, stderr };
  if (exitCode !== 0) {
    throw new Error(`python3 ${args.join(' ')} failed: ${stderr.trim() || stdout.trim()}`);
  }
  return commandResult;
}

async function runTar(args: string[], cwd: string, signal: AbortSignal): Promise<string> {
  const process = Bun.spawn(['tar', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', signal });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0)
    throw new Error(`tar ${args.join(' ')} failed: ${stderr.trim() || stdout.trim()}`);
  return stdout;
}

export const baselineCapabilityHandlers: Readonly<Record<BaselineCapabilityId, CapabilityHandler>> =
  {
    'system3.approved-plan-materializer': async (raw, context) => {
      assertNotAborted(context);
      const input = planInputSchema.parse(raw);
      const planPath = join(context.artifactsDir, 'planning', 'approved-plan.json');
      await writeJson(planPath, input);
      return result({ planPath, definitionHash: input.definitionHash });
    },
    'system3.project-scaffolder': async (raw, context) => {
      assertNotAborted(context);
      const input = scaffoldInputSchema.parse(raw);
      const projectDir = join(context.artifactsDir, 'workspace', 'generated_project');
      await Promise.all([
        mkdir(join(projectDir, 'src', 'project'), { recursive: true }),
        mkdir(join(projectDir, 'tests'), { recursive: true }),
        mkdir(join(projectDir, 'data'), { recursive: true }),
        mkdir(join(projectDir, 'reports'), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(join(projectDir, 'src', 'project', '__init__.py'), '', 'utf8'),
        writeFile(join(projectDir, 'src', 'project', 'data.py'), dataPy, 'utf8'),
        writeFile(join(projectDir, 'src', 'project', 'model.py'), modelPy, 'utf8'),
        writeFile(join(projectDir, 'data', 'input.csv'), input.datasetBytes),
        writeJson(join(projectDir, 'config.json'), {
          targetColumn: input.targetColumn,
          primaryMetric: 'accuracy',
          sourceFilename: basename(input.datasetFilename),
          datasetSourceVersionId: input.datasetSourceVersionId,
          datasetContentHash: input.datasetContentHash,
        }),
        writeFile(
          join(projectDir, 'run_pipeline.py'),
          'import json, sys\nfrom pathlib import Path\nsys.path.insert(0, "src")\nfrom project.data import summarize_dataset\nconfig=json.loads(Path("config.json").read_text())\nrow_count, _ = summarize_dataset(Path("data/input.csv"), config["targetColumn"])\nPath("reports").mkdir(exist_ok=True)\nresult={"status":"passed","rows":row_count,"targetColumn":config["targetColumn"],"datasetSourceVersionId":config["datasetSourceVersionId"],"datasetContentHash":config["datasetContentHash"]}\nPath("reports/data_run.json").write_text(json.dumps(result, indent=2)+"\\n")\nprint(json.dumps(result))\n',
          'utf8'
        ),
        writeFile(
          join(projectDir, 'run_experiments.py'),
          'import json, sys\nfrom pathlib import Path\nsys.path.insert(0, "src")\nfrom project.data import summarize_dataset\nconfig=json.loads(Path("config.json").read_text())\nrow_count, target_counts = summarize_dataset(Path("data/input.csv"), config["targetColumn"])\nprediction, correct = target_counts.most_common(1)[0]\nmetrics={"accuracy":correct / row_count,"rows":row_count,"prediction":prediction}\nresult={"status":"passed","model":"majority_class_baseline","seed":42,"metrics":metrics,"selectionPolicy":{"primaryMetric":config["primaryMetric"]}}\nPath("reports").mkdir(exist_ok=True)\nPath("reports/experiment_results.json").write_text(json.dumps(result, indent=2)+"\\n")\nprint(json.dumps(result))\n',
          'utf8'
        ),
        writeFile(
          join(projectDir, 'tests', 'test_model.py'),
          'import sys, unittest\nsys.path.insert(0, "src")\nfrom project.model import evaluate, majority_label\nclass ModelTests(unittest.TestCase):\n    def test_majority_and_accuracy(self):\n        labels=["0","1","0","0"]\n        prediction=majority_label(labels)\n        self.assertEqual(prediction,"0")\n        self.assertEqual(evaluate(labels,prediction)["accuracy"],0.75)\nif __name__ == "__main__": unittest.main()\n',
          'utf8'
        ),
        writeFile(
          join(projectDir, 'pyproject.toml'),
          `[project]\nname = "${input.projectName.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n`,
          'utf8'
        ),
        writeFile(
          join(projectDir, 'README.md'),
          `# ${input.projectName}\n\nGenerated by the approved System 3 Customer Churn MVP workflow.\n\nThis package proves a deterministic majority-class baseline only; full DESIGN_B_2 coverage is not claimed.\n`,
          'utf8'
        ),
      ]);
      return result({ projectDir });
    },
    'system3.pinned-dataset-materializer': async (raw, context) => {
      assertNotAborted(context);
      const input = materializeDatasetInputSchema.parse(raw);
      const projectDir = await assertExecutionPath(input.projectDir, context);
      const configPath = join(projectDir, 'config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
      await Promise.all([
        writeFile(join(projectDir, 'data', 'input.csv'), input.datasetBytes),
        writeJson(configPath, {
          ...config,
          targetColumn: input.targetColumn,
          sourceFilename: basename(input.datasetFilename),
          datasetSourceVersionId: input.datasetSourceVersionId,
          datasetContentHash: input.datasetContentHash,
        }),
      ]);
      return result({ projectDir });
    },
    'system3.project-validator': async (raw, context) => {
      assertNotAborted(context);
      const input = projectDirInputSchema.parse(raw);
      const projectDir = await assertExecutionPath(input.projectDir, context);
      const required = [
        'config.json',
        'run_pipeline.py',
        'run_experiments.py',
        'tests/test_model.py',
        'data/input.csv',
      ];
      await Promise.all(required.map(path => access(join(projectDir, path))));
      return result({ projectDir, valid: true, required });
    },
    'system3.dataset-validator': async (raw, context) => {
      assertNotAborted(context);
      const input = projectDirInputSchema.parse(raw);
      const projectDir = await assertExecutionPath(input.projectDir, context);
      const config = JSON.parse(await readFile(join(projectDir, 'config.json'), 'utf8')) as {
        datasetContentHash?: unknown;
        datasetSourceVersionId?: unknown;
        sourceFilename?: unknown;
        targetColumn?: unknown;
      };
      if (
        typeof config.targetColumn !== 'string' ||
        typeof config.datasetSourceVersionId !== 'string' ||
        typeof config.sourceFilename !== 'string'
      ) {
        throw new Error('Dataset target column is missing');
      }
      if (
        typeof config.datasetContentHash !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(config.datasetContentHash)
      ) {
        throw new Error('Dataset content hash is missing or invalid; recompile and approve again');
      }
      const profile = await profileDatasetCsvStream({
        filename: config.sourceFilename,
        sourceVersionId: config.datasetSourceVersionId,
        chunks: createReadStream(join(projectDir, 'data', 'input.csv')),
        targetColumn: config.targetColumn,
        expectedContentHash: config.datasetContentHash,
        signal: context.signal,
      });
      if (!profile.targetExists) throw new Error('Dataset target column is missing');
      if (profile.rowCount === 0) throw new Error('Dataset is empty');
      return result({
        projectDir,
        rows: profile.rowCount,
        targetColumn: profile.targetColumn,
        rowFingerprint: profile.rowFingerprint,
      });
    },
    'system3.test-runner': async (raw, context) => {
      assertNotAborted(context);
      const input = projectDirInputSchema.parse(raw);
      const projectDir = await assertExecutionPath(input.projectDir, context);
      const testResult = await runPython(
        projectDir,
        ['-m', 'unittest', 'discover', '-s', 'tests', '-v'],
        context.signal
      );
      const reportPath = join(context.artifactsDir, 'execution', 'test-results.json');
      await Promise.all([
        writeJson(reportPath, testResult),
        writeJson(join(projectDir, 'reports', 'test-results.json'), testResult),
      ]);
      return result({ projectDir, reportPath, testResult });
    },
    'system3.data-pipeline-runner': async (raw, context) => {
      assertNotAborted(context);
      const input = projectDirInputSchema.parse(raw);
      const projectDir = await assertExecutionPath(input.projectDir, context);
      const command = await runPython(projectDir, ['run_pipeline.py'], context.signal);
      const dataResult = JSON.parse(
        await readFile(join(projectDir, 'reports', 'data_run.json'), 'utf8')
      ) as unknown;
      const reportPath = join(context.artifactsDir, 'execution', 'data-pipeline.json');
      await writeJson(reportPath, { command, result: dataResult });
      return result({ projectDir, reportPath, dataResult });
    },
    'system3.baseline-runner': async (raw, context) => {
      assertNotAborted(context);
      const input = projectDirInputSchema.parse(raw);
      const projectDir = await assertExecutionPath(input.projectDir, context);
      const command = await runPython(projectDir, ['run_experiments.py'], context.signal);
      const experiment = JSON.parse(
        await readFile(join(projectDir, 'reports', 'experiment_results.json'), 'utf8')
      ) as unknown;
      const reportPath = join(context.artifactsDir, 'execution', 'baseline-experiment.json');
      await writeJson(reportPath, { command, experiment });
      return result({ projectDir, reportPath, experiment });
    },
    'system3.baseline-artifact-packager': async (raw, context) => {
      assertNotAborted(context);
      const input = projectDirInputSchema.parse(raw);
      const projectDir = await assertExecutionPath(input.projectDir, context);
      const artifactDir = join(context.artifactsDir, 'execution');
      await mkdir(artifactDir, { recursive: true });
      const packagePath = join(artifactDir, 'baseline-artifact.tar.gz');
      const process = Bun.spawn(
        ['tar', '-czf', packagePath, '-C', join(projectDir, '..'), basename(projectDir)],
        { stdout: 'pipe', stderr: 'pipe', signal: context.signal }
      );
      const [stderr, exitCode] = await Promise.all([
        new Response(process.stderr).text(),
        process.exited,
      ]);
      if (exitCode !== 0) throw new Error(`Baseline artifact packaging failed: ${stderr.trim()}`);
      const bytes = await readFile(packagePath);
      return result({
        projectDir,
        packagePath,
        sizeBytes: bytes.byteLength,
        contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      });
    },
    'system3.delivery-artifact-materializer': async (raw, context) => {
      assertNotAborted(context);
      const input = reuseArtifactInputSchema.parse(raw);
      const actualHash = `sha256:${createHash('sha256').update(input.archiveBytes).digest('hex')}`;
      if (actualHash !== input.contentHash)
        throw new Error('Reusable delivery artifact hash mismatch');
      const reuseRoot = join(context.artifactsDir, 'reuse');
      const archivePath = join(reuseRoot, 'approved-delivery.tar.gz');
      const projectDir = join(reuseRoot, 'generated_project');
      await mkdir(projectDir, { recursive: true });
      await writeFile(archivePath, input.archiveBytes, { flag: 'wx' });
      const listing = await runTar(['-tzf', archivePath], reuseRoot, context.signal);
      for (const entry of listing.split(/\r?\n/).filter(Boolean)) {
        if (entry.startsWith('/') || entry.split('/').includes('..')) {
          throw new Error(`Reusable delivery artifact contains unsafe path '${entry}'`);
        }
      }
      await runTar(
        ['-xzf', archivePath, '--strip-components=1', '-C', projectDir],
        reuseRoot,
        context.signal
      );
      const [testResult, dataResult, experiment] = await Promise.all([
        readFile(join(projectDir, 'reports', 'test-results.json'), 'utf8').then(JSON.parse),
        readFile(join(projectDir, 'reports', 'data_run.json'), 'utf8').then(JSON.parse),
        readFile(join(projectDir, 'reports', 'experiment_results.json'), 'utf8').then(JSON.parse),
      ]);
      return result({
        projectDir,
        // The immutable archive is also the baseline package for a delivery-scoped
        // rerun. Returning it keeps the execution result contract uniform.
        packagePath: archivePath,
        testResult,
        dataResult,
        experiment,
        reusedArtifact: {
          storageKey: input.storageKey,
          contentHash: input.contentHash,
          sourceExecutionId: input.sourceExecutionId,
        },
      });
    },
    'system3.artifact-schema-validator': async (raw, context) => {
      assertNotAborted(context);
      const input = evidenceInputSchema.parse(raw);
      const projectDir = await assertExecutionPath(input.projectDir, context);
      const experiment = input.experiment;
      if (experiment.status !== 'passed' || experiment.model !== 'majority_class_baseline') {
        throw new Error('Baseline experiment artifact does not satisfy the MVP schema');
      }
      return result({ valid: true, projectDir });
    },
    'system3.evidence-map-builder': async (raw, context) => {
      assertNotAborted(context);
      const input = evidenceInputSchema.parse(raw);
      const testPassed = input.testResult.exitCode === 0;
      const experimentPassed = input.experiment.status === 'passed';
      const passed = testPassed && experimentPassed && input.dataResult.status === 'passed';
      const evidenceMap = {
        schemaVersion: 1,
        status: passed ? 'passed_with_scope_gaps' : 'failed',
        executionStatus: passed ? 'passed' : 'failed',
        requirementCoverage: {
          status: 'not_verified',
          verified: 0,
          total: input.analysis.requirements.length,
          note: 'The MVP verifies the baseline execution contract, not full DESIGN_B_2 coverage.',
        },
        mvpChecks: [
          { id: 'MVP-EXEC-001', status: testPassed ? 'passed' : 'failed' },
          {
            id: 'MVP-DATA-001',
            status: input.dataResult.status === 'passed' ? 'passed' : 'failed',
          },
          { id: 'MVP-EXPERIMENT-001', status: experimentPassed ? 'passed' : 'failed' },
        ],
        requirements: input.analysis.requirements.map(requirement => ({
          requirementId: requirement.id,
          status: 'not_verified',
          reason: 'Outside the approved deterministic majority-baseline MVP scope.',
          sourcePointer: requirement.sourcePointer,
        })),
      };
      const evidencePath = join(
        context.artifactsDir,
        'verification',
        'requirement-evidence-map.json'
      );
      await writeJson(evidencePath, evidenceMap);
      return result({ evidenceMap, evidencePath });
    },
    'system3.baseline-gate-evaluator': async (raw, context) => {
      assertNotAborted(context);
      const input = gateInputSchema.parse(raw);
      const passed = input.evidenceMap.executionStatus === 'passed';
      const gate = {
        id: 'G5',
        name: 'Ready for MVP Baseline Delivery',
        status: passed ? 'passed' : 'blocked',
        limitations: ['Full DESIGN_B_2 requirement coverage remains not verified'],
      };
      if (!passed) throw new Error('G5 baseline delivery gate is blocked');
      return result({ gate });
    },
    'system3.delivery-packager': async (raw, context) => {
      assertNotAborted(context);
      const input = packageInputSchema.parse(raw);
      if (input.gate.status !== 'passed') throw new Error('Cannot package before G5 passes');
      const projectDir = await assertExecutionPath(input.projectDir, context);
      const deliveryDir = join(context.artifactsDir, 'delivery');
      await mkdir(deliveryDir, { recursive: true });
      const packagePath = join(deliveryDir, 'generated_project.tar.gz');
      const process = Bun.spawn(
        ['tar', '-czf', packagePath, '-C', join(projectDir, '..'), basename(projectDir)],
        { stdout: 'pipe', stderr: 'pipe', signal: context.signal }
      );
      const [stderr, exitCode] = await Promise.all([
        new Response(process.stderr).text(),
        process.exited,
      ]);
      if (exitCode !== 0) throw new Error(`Packaging failed: ${stderr.trim()}`);
      const bytes = await readFile(packagePath);
      return result({
        packagePath,
        sizeBytes: bytes.byteLength,
        contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      });
    },
    'system3.delivery-manifest-builder': async (raw, context) => {
      assertNotAborted(context);
      const input = manifestInputSchema.parse(raw);
      const packagePath = await assertExecutionPath(input.packagePath, context);
      const info = await stat(packagePath);
      const bytes = await readFile(packagePath);
      const delivery = {
        schemaVersion: 1,
        projectId: input.projectId,
        executionId: input.executionId,
        status: 'ready',
        packagePath,
        packageFilename: basename(packagePath),
        sizeBytes: info.size,
        contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        requirementCoverage: input.evidenceMap.requirementCoverage,
        evidenceMap: input.evidenceMap,
        gate: input.gate,
      };
      const manifestPath = join(context.artifactsDir, 'delivery', 'delivery-manifest.json');
      await writeJson(manifestPath, delivery);
      return result({ delivery: { ...delivery, manifestPath } });
    },
  };
