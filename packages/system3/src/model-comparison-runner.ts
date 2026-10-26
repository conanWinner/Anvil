import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { z } from '@hono/zod-openapi';
import { blueprintAnalysisSchema } from './contracts';
import type { System3CapabilityContext, System3CapabilityResult } from './capabilities';
import {
  buildModelComparisonPrompt,
  createModelComparisonReport,
  modelComparisonCodeSchema,
  modelComparisonConfigSchema,
  modelComparisonModelReportSchema,
  sha256Hash,
  validateModelComparisonHarnessOutput,
} from './model-comparison';
import type { ModelComparisonConfig, ModelComparisonModelReport } from './model-comparison';
import { runPythonSandbox } from './python-sandbox';

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const modelComparisonInputSchema = z.object({
  projectId: z.string().uuid(),
  config: modelComparisonConfigSchema,
  inputHash: hashSchema,
  datasetSource: z.object({ id: z.string().uuid(), contentHash: hashSchema }),
  analysis: blueprintAnalysisSchema,
});
export const modelCandidateInputSchema = modelComparisonInputSchema.extend({
  index: z.number().int().min(0).max(3),
  model: z.string(),
});
const comparisonManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    inputHash: hashSchema,
    datasetHash: hashSchema,
    configHash: hashSchema,
    reports: z.array(modelComparisonModelReportSchema).min(2).max(4),
  })
  .strict();

const reproduceScript = `#!/bin/sh
set -eu
comparison_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
comparison_index=$1
case "$comparison_index" in 0|1|2|3) ;; *) exit 2 ;; esac
comparison_output=$(mktemp -d)
run_step() {
  comparison_entry=$1
  shift
  systemd-run --quiet --wait --pipe --collect -p MemoryMax=256M -p MemorySwapMax=0 -p CPUQuota=100% -p TasksMax=16 -p RuntimeMaxSec=30s -p TimeoutStopSec=2s -p KillMode=control-group -p LimitFSIZE=1048576 -p LimitNOFILE=64 -p NoNewPrivileges=yes \\
    /usr/bin/bwrap --die-with-parent --new-session --unshare-all --clearenv --cap-drop ALL \\
    --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \\
    --proc /proc --dev /dev --tmpfs /tmp --tmpfs /work \\
    --ro-bind "$comparison_root/input.csv" /work/input.csv \\
    "$@" --remount-ro /work --remount-ro / --chdir /work --uid 65534 --gid 65534 \\
    /usr/bin/python3 -I -B "/work/$comparison_entry.py"
}
run_step solution --ro-bind "$comparison_root/models/$comparison_index/solution.py" /work/solution.py > "$comparison_output/candidate-output.json"
run_step harness --ro-bind "$comparison_root/harness.py" /work/harness.py --ro-bind "$comparison_output/candidate-output.json" /work/candidate-output.json > "$comparison_output/checks.json"
cat "$comparison_output/checks.json"
printf '\\nReproduction files: %s\\n' "$comparison_output" >&2
/usr/bin/python3 -I -B - "$comparison_output/checks.json" "$comparison_root/model-comparison-config.json" <<'PY'
import json, sys
with open(sys.argv[1]) as result_file: checks = json.load(result_file)["checks"]
with open(sys.argv[2]) as config_file: required = json.load(config_file)["requirementIds"]
assert len(checks) == len(required) and {check["requirementId"] for check in checks} == set(required), "Missing or duplicate requirement checks"
assert all(check["passed"] is True for check in checks), "Requirement checks failed"
PY
`;

function byteHash(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function confinedDirectory(path: string, context: System3CapabilityContext): Promise<string> {
  const root = await realpath(resolve(context.artifactsDir, '../../..'));
  const candidate = await realpath(path);
  const rel = relative(root, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== candidate) {
    throw new Error('Model comparison path escaped its Workflow Run');
  }
  return candidate;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function result(value: Record<string, unknown>): System3CapabilityResult {
  return { output: JSON.stringify(value), structuredOutput: value };
}

function promptFor(input: z.infer<typeof modelComparisonInputSchema>, dataset: Uint8Array): string {
  return buildModelComparisonPrompt({
    task: JSON.stringify({
      businessGoal: input.analysis.businessGoal,
      technicalObjective: input.analysis.technicalObjective,
      requirements: input.analysis.requirements,
      // ponytail: CSV preview is limited to 8 KiB; full pinned data is available only inside the sandbox.
      csvPreview: new TextDecoder().decode(dataset.slice(0, 8 * 1024)),
      datasetHash: input.datasetSource.contentHash,
    }),
    inputHash: input.inputHash,
    prompt: input.config.prompt,
  });
}

export async function runModelCandidate(
  raw: Readonly<Record<string, unknown>>,
  dataset: Uint8Array,
  generateCode: (input: { model: string; prompt: string; signal: AbortSignal }) => Promise<unknown>,
  context: System3CapabilityContext
): Promise<System3CapabilityResult> {
  const input = modelCandidateInputSchema.parse(raw);
  if (input.config.models[input.index] !== input.model)
    throw new Error('Candidate model differs from the approved plan');
  if (byteHash(dataset) !== input.datasetSource.contentHash)
    throw new Error('Pinned comparison dataset hash mismatch');
  const prompt = promptFor(input, dataset);
  const candidateDir = join(context.artifactsDir, `candidate-${input.index.toString()}`);
  await mkdir(candidateDir, { recursive: false });
  await confinedDirectory(candidateDir, context);
  await writeFile(join(candidateDir, 'input.csv'), dataset, { flag: 'wx' });
  await writeFile(join(candidateDir, 'prompt.txt'), prompt, { flag: 'wx' });
  await writeFile(join(candidateDir, 'harness.py'), input.config.harness, { flag: 'wx' });
  let code: string | null = null;
  let candidateOutput: string | null = null;
  let harnessOutput: unknown;
  let status: ModelComparisonModelReport['status'] = 'failed';
  let error: string | null = null;
  try {
    context.signal.throwIfAborted();
    code = modelComparisonCodeSchema.parse(
      await generateCode({
        model: input.model,
        prompt,
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(60_000)]),
      })
    ).code;
    await writeFile(join(candidateDir, 'solution.py'), code, { flag: 'wx' });
    const execution = await runPythonSandbox({
      workspaceDir: candidateDir,
      entrypoint: 'solution.py',
      signal: context.signal,
      timeoutMs: 30_000,
    });
    await writeJson(join(candidateDir, 'execution.json'), execution);
    if (execution.exitCode !== 0)
      throw new Error('Candidate Python execution failed; see execution.json');
    JSON.parse(execution.stdout);
    candidateOutput = execution.stdout;
    await writeFile(join(candidateDir, 'candidate-output.json'), candidateOutput, { flag: 'wx' });
    const verification = await runPythonSandbox({
      workspaceDir: candidateDir,
      entrypoint: 'harness.py',
      signal: context.signal,
      timeoutMs: 30_000,
    });
    await writeJson(join(candidateDir, 'harness-execution.json'), verification);
    if (verification.exitCode !== 0)
      throw new Error('Comparison harness failed; see harness-execution.json');
    harnessOutput = validateModelComparisonHarnessOutput(
      JSON.parse(verification.stdout),
      input.config.requirementIds
    );
    status = 'completed';
  } catch (cause) {
    status = context.signal.aborted ? 'cancelled' : 'failed';
    // Provider errors can contain credentials or source excerpts. Keep a classified error in the report.
    error =
      cause instanceof z.ZodError
        ? 'Model or harness output failed validation'
        : context.signal.aborted
          ? 'Candidate cancelled'
          : 'Candidate generation, execution or verification failed';
  }
  const report = createModelComparisonReport({
    runId: context.runId,
    model: input.model,
    inputHash: input.inputHash,
    prompt,
    code,
    candidateOutput,
    harness: input.config.harness,
    status,
    error,
    harnessOutput,
    requirementIds: input.config.requirementIds,
  });
  await writeJson(join(candidateDir, 'report.json'), report);
  return result({ candidateDir, report });
}

export async function packageModelComparison(
  raw: Readonly<Record<string, unknown>>,
  dataset: Uint8Array,
  context: System3CapabilityContext
): Promise<System3CapabilityResult> {
  context.signal.throwIfAborted();
  const input = modelComparisonInputSchema
    .extend({
      candidates: z
        .array(
          z.object({ candidateDir: z.string().min(1), report: modelComparisonModelReportSchema })
        )
        .min(2)
        .max(4),
    })
    .parse(raw);
  if (byteHash(dataset) !== input.datasetSource.contentHash)
    throw new Error('Pinned comparison dataset hash mismatch');
  if (input.candidates.length !== input.config.models.length)
    throw new Error('Comparison has missing candidates');
  const projectDir = join(context.artifactsDir, 'generated_project');
  await mkdir(projectDir, { recursive: false });
  await confinedDirectory(projectDir, context);
  await mkdir(join(projectDir, 'models'));
  await mkdir(join(projectDir, 'reports'));
  await writeFile(join(projectDir, 'input.csv'), dataset, { flag: 'wx' });
  await writeFile(join(projectDir, 'harness.py'), input.config.harness, { flag: 'wx' });
  await writeJson(join(projectDir, 'model-comparison-config.json'), input.config);
  const reports: ModelComparisonModelReport[] = [];
  for (const [index, candidate] of input.candidates.entries()) {
    const sourceDir = await confinedDirectory(candidate.candidateDir, context);
    const report = modelComparisonModelReportSchema.parse(
      JSON.parse(await readFile(join(sourceDir, 'report.json'), 'utf8'))
    );
    if (
      JSON.stringify(report) !== JSON.stringify(candidate.report) ||
      report.model !== input.config.models[index] ||
      report.inputHash !== input.inputHash
    ) {
      throw new Error('Candidate report differs from the approved comparison');
    }
    const destination = join(projectDir, 'models', index.toString());
    await mkdir(destination);
    for (const filename of [
      'solution.py',
      'candidate-output.json',
      'prompt.txt',
      'report.json',
      'execution.json',
      'harness-execution.json',
    ]) {
      const path = join(sourceDir, filename);
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024)
          throw new Error('Unsafe comparison artifact');
        await writeFile(join(destination, filename), await readFile(path), { flag: 'wx' });
      } catch (cause) {
        if (
          !(
            cause instanceof Error &&
            'code' in cause &&
            cause.code === 'ENOENT' &&
            report.status !== 'completed'
          )
        )
          throw cause;
      }
    }
    reports.push(report);
  }
  const manifest = comparisonManifestSchema.parse({
    schemaVersion: 1,
    inputHash: input.inputHash,
    datasetHash: input.datasetSource.contentHash,
    configHash: sha256Hash(JSON.stringify(input.config)),
    reports,
  });
  await writeJson(join(projectDir, 'comparison.json'), manifest);
  const complete = reports.every(report => report.status === 'completed');
  const testResult = { exitCode: complete ? 0 : 1, kind: 'model_comparison' };
  const dataResult = {
    status: 'passed',
    inputHash: input.inputHash,
    datasetHash: input.datasetSource.contentHash,
  };
  const experiment = {
    status: complete ? 'passed' : 'failed',
    kind: 'model_comparison',
    comparison: manifest,
  };
  await writeJson(join(projectDir, 'reports', 'test-results.json'), testResult);
  await writeJson(join(projectDir, 'reports', 'data_run.json'), dataResult);
  await writeJson(join(projectDir, 'reports', 'experiment_results.json'), experiment);
  await writeFile(join(projectDir, 'reproduce.sh'), reproduceScript, { flag: 'wx' });
  await writeJson(join(projectDir, 'runtime-lock.json'), {
    sandboxVersion: 'anvil-python@1',
    interpreter: '/usr/bin/python3',
    dependencies: [],
    platform: 'Linux with systemd and bubblewrap >= 0.9',
  });
  await writeFile(
    join(projectDir, 'REPRODUCING.md'),
    '# Reproduce model outputs\n\nRequirements: Linux, systemd, bubblewrap >= 0.9, Python 3 standard library. From this extracted directory, run `sh reproduce.sh <index>` for every selected model (zero-based indexes follow `comparison.json`; for two models run indexes 0 and 1). Each command writes fresh reproduction files in a new temporary directory and prints the requirement checks. No provider call or Anvil path is required.\n\nEach `models/<index>/solution.py` reads `/work/input.csv` and emits JSON. The approved `harness.py` reads `/work/input.csv` and `/work/candidate-output.json` and emits requirement checks.\n\nSolution and harness run separately without network, with 256 MiB RAM, one CPU, 16 processes and a 30-second timeout. Do not execute generated code on the host. `comparison.json` pins hashes and model identities; `model-comparison-config.json` pins the shared test.\n',
    { flag: 'wx' }
  );
  return result({ projectDir, testResult, dataResult, experiment });
}

export async function verifyModelComparison(
  projectDir: string,
  pins: { config: ModelComparisonConfig; inputHash: string; datasetHash: string },
  context: System3CapabilityContext
): Promise<z.infer<typeof comparisonManifestSchema>> {
  const root = await confinedDirectory(projectDir, context);
  const manifest = comparisonManifestSchema.parse(
    JSON.parse(await readFile(join(root, 'comparison.json'), 'utf8'))
  );
  const dataset = await readFile(join(root, 'input.csv'));
  const harness = await readFile(join(root, 'harness.py'), 'utf8');
  if (
    manifest.inputHash !== pins.inputHash ||
    manifest.datasetHash !== pins.datasetHash ||
    byteHash(dataset) !== pins.datasetHash ||
    manifest.configHash !== sha256Hash(JSON.stringify(pins.config)) ||
    harness !== pins.config.harness ||
    manifest.reports.length !== pins.config.models.length
  ) {
    throw new Error('Comparison artifacts differ from the approved inputs or harness');
  }
  for (const [index, report] of manifest.reports.entries()) {
    if (
      report.model !== pins.config.models[index] ||
      report.inputHash !== pins.inputHash ||
      report.harnessHash !== sha256Hash(harness)
    )
      throw new Error('Comparison model provenance mismatch');
    if (report.status !== 'completed') continue;
    const directory = join(root, 'models', index.toString());
    const [code, output, prompt] = await Promise.all([
      readFile(join(directory, 'solution.py'), 'utf8'),
      readFile(join(directory, 'candidate-output.json'), 'utf8'),
      readFile(join(directory, 'prompt.txt'), 'utf8'),
    ]);
    if (
      sha256Hash(code) !== report.codeHash ||
      sha256Hash(output) !== report.outputHash ||
      sha256Hash(prompt) !== report.promptHash
    )
      throw new Error('Comparison code or output content hash mismatch');
    const checkDir = await mkdtemp(join(context.artifactsDir, `verify-${randomUUID()}-`));
    await writeFile(join(checkDir, 'input.csv'), dataset, { flag: 'wx' });
    await writeFile(join(checkDir, 'candidate-output.json'), output, { flag: 'wx' });
    await writeFile(join(checkDir, 'harness.py'), harness, { flag: 'wx' });
    const check = await runPythonSandbox({
      workspaceDir: checkDir,
      entrypoint: 'harness.py',
      signal: context.signal,
      timeoutMs: 30_000,
    });
    if (check.exitCode !== 0) throw new Error('Independent comparison harness failed');
    const actual = validateModelComparisonHarnessOutput(
      JSON.parse(check.stdout),
      pins.config.requirementIds
    );
    if (JSON.stringify(actual.checks) !== JSON.stringify(report.checks))
      throw new Error('Stored Evidence differs from the independent harness');
  }
  return manifest;
}
