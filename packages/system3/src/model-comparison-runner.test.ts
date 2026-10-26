import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { System3CapabilityContext } from './capabilities';
import type { ModelComparisonModelReport } from './model-comparison';
import {
  packageModelComparison,
  runModelCandidate,
  verifyModelComparison,
} from './model-comparison-runner';

const sandboxTest = process.env.ANVIL_SANDBOX_TESTS === 'true' ? test : test.skip;

const dataset = Buffer.from('id,target\n1,yes\n2,no\n', 'utf8');
const datasetHash = `sha256:${createHash('sha256').update(dataset).digest('hex')}`;
const inputHash = `sha256:${'a'.repeat(64)}`;
const config = {
  schemaVersion: 1 as const,
  models: ['router9/test/model-one', 'router9/test/model-two'],
  prompt: 'Read the pinned CSV and emit one JSON result.',
  harness:
    'import csv, json\n' +
    'rows = list(csv.DictReader(open("/work/input.csv", newline="")))\n' +
    'candidate = json.load(open("/work/candidate-output.json"))\n' +
    'checks = [] if candidate.get("omit") else [{"requirementId": "FR-01", "passed": candidate.get("rows") == len(rows), "detail": "row count matches"}]\n' +
    'print(json.dumps({"checks": checks}))\n',
  requirementIds: ['FR-01'],
};
const analysis = {
  schemaVersion: 1 as const,
  businessGoal: 'Classify the pinned rows.',
  technicalObjective: 'Read CSV using Python standard library.',
  targetDefinition: 'The target column is target.',
  runtime: { cpuOnly: true, ramGb: 1 },
  requirements: [
    {
      id: 'FR-01',
      kind: 'functional',
      priority: 'must',
      source: 'test',
      statement: 'Read every dataset row.',
      acceptanceCriterion: 'Emit the same number of rows as the CSV contains.',
      sourcePointer: 'blueprint.md:1',
    },
  ],
  modules: [],
  manualReviews: [],
  dataset: {
    filename: 'input.csv',
    rowCount: 2,
    columnCount: 2,
    columns: ['id', 'target'],
    targetColumn: 'target',
    targetExists: true,
    targetDistribution: { yes: 1, no: 1 },
  },
};

type CandidateOutput = { candidateDir: string; report: ModelComparisonModelReport };

sandboxTest('runs, packages and independently verifies isolated model candidates', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'anvil-model-comparison-'));
  const confinementRoot = join(temporaryRoot, 'runs');
  const runId = randomUUID();
  const runRoot = join(confinementRoot, runId);
  const nodesRoot = join(runRoot, 'nodes');
  await mkdir(nodesRoot, { recursive: true });

  const contextFor = async (nodeId: string): Promise<System3CapabilityContext> => {
    const artifactsDir = join(nodesRoot, nodeId);
    await mkdir(artifactsDir);
    return {
      runId,
      nodeId,
      cwd: runRoot,
      artifactsDir,
      signal: new AbortController().signal,
    };
  };
  const input = {
    projectId: randomUUID(),
    config,
    inputHash,
    datasetSource: { id: randomUUID(), contentHash: datasetHash },
    analysis,
  };
  const codeFor = (model: string, omitRequirement = false): string =>
    `# ${model}\n` +
    'import csv, json\n' +
    'rows = list(csv.DictReader(open("/work/input.csv", newline="")))\n' +
    `print(json.dumps({"rows": len(rows), "omit": ${omitRequirement ? 'True' : 'False'}}))\n`;
  const candidates: CandidateOutput[] = [];
  for (const [index, model] of config.models.entries()) {
    const candidate = await runModelCandidate(
      { ...input, index, model },
      dataset,
      async () => ({ code: index === 0 ? 'this is not valid Python!' : codeFor(model) }),
      await contextFor(`candidate-${index.toString()}`)
    );
    candidates.push(candidate.structuredOutput as CandidateOutput);
  }

  expect(candidates.map(candidate => candidate.report.status)).toEqual(['failed', 'completed']);
  expect(candidates.map(candidate => candidate.report.inputHash)).toEqual([inputHash, inputHash]);
  expect(candidates[1]?.report.codeHash).toBeTruthy();
  expect(candidates[1]?.report.outputHash).toBeTruthy();
  expect(candidates[0]?.report.codeHash).not.toBe(candidates[1]?.report.codeHash);

  const missingRequirement = await runModelCandidate(
    { ...input, index: 1, model: config.models[1]! },
    dataset,
    async () => ({ code: codeFor(config.models[1]!, true) }),
    await contextFor('missing-requirement')
  );
  expect((missingRequirement.structuredOutput as CandidateOutput).report.status).toBe('failed');
  expect((missingRequirement.structuredOutput as CandidateOutput).report.error).toBe(
    'Candidate generation, execution or verification failed'
  );

  const packaged = await packageModelComparison(
    { ...input, candidates },
    dataset,
    await contextFor('package')
  );
  const projectDir = (packaged.structuredOutput as { projectDir: string }).projectDir;
  expect(packaged.structuredOutput).toMatchObject({
    testResult: { exitCode: 1 },
    experiment: { status: 'failed' },
  });
  const pins = { config, inputHash, datasetHash };
  const verified = await verifyModelComparison(projectDir, pins, await contextFor('verify'));
  expect(verified.reports.map(report => report.status)).toEqual(['failed', 'completed']);
  expect(verified.reports[1]?.checks).toEqual([
    { requirementId: 'FR-01', passed: true, detail: 'row count matches' },
  ]);

  const reproduce = (): Promise<number> =>
    Bun.spawn(['sh', join(projectDir, 'reproduce.sh'), '1'], {
      stdout: 'ignore',
      stderr: 'ignore',
    }).exited;
  expect(await reproduce()).toBe(0);
  const solutionPath = join(projectDir, 'models', '1', 'solution.py');
  await writeFile(solutionPath, 'print(\'{"rows":999}\')\n');
  expect(await reproduce()).not.toBe(0);
  await writeFile(solutionPath, codeFor(config.models[1]!));

  const packagedOutput = join(projectDir, 'models', '1', 'candidate-output.json');
  await writeFile(packagedOutput, '{"rows":999}\n');
  await expect(
    verifyModelComparison(projectDir, pins, await contextFor('verify-tampered'))
  ).rejects.toThrow('Comparison code or output content hash mismatch');
});
