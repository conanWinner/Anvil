/**
 * Live end-to-end check of System 3 experiment execution outside the web flow:
 * blueprint → TW-02 analysis → experiment plan → agent build + review → full runs → Anvil scoring.
 * Calls real models through Pi (tokens are spent). Writes everything under --work.
 *
 *   bun run scripts/system3-experiment-live.ts --blueprint docs/system_2/DESIGN_B_2.md \
 *     --data /path/to/olist-csvs --work /tmp/run --builder router9/cx/gpt-6-luna \
 *     --reviewer router9/cx/gpt-5.6-luna [--variants logistic_regression,lightgbm]
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  getAgentProvider,
  registerBuiltinProviders,
  registerCommunityProviders,
} from '../packages/providers/src/index';
import {
  buildExperimentCodebase,
  deriveExperimentPlan,
  resolveMlRuntime,
  runExperimentVariants,
  understandProjectSources,
  type ExperimentGenerate,
} from '../packages/system3/src/index';

const { values } = parseArgs({
  options: {
    blueprint: { type: 'string' },
    data: { type: 'string' },
    work: { type: 'string' },
    builder: { type: 'string' },
    reviewer: { type: 'string' },
    variants: { type: 'string' },
  },
});
for (const key of ['blueprint', 'data', 'work', 'builder', 'reviewer'] as const)
  if (!values[key]) throw new Error(`--${key} is required`);
const work = resolve(values.work ?? '');
await mkdir(work, { recursive: true });
const log = async (line: string): Promise<void> => {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  await writeFile(join(work, 'live.log'), `${stamped}\n`, { flag: 'a' });
};

registerBuiltinProviders();
registerCommunityProviders();
const provider = getAgentProvider('pi');
const usage = { calls: 0, chars: 0 };
const generate: ExperimentGenerate = async ({ role, prompt, schema, signal }) => {
  const model = role === 'builder' ? values.builder : values.reviewer;
  usage.calls += 1;
  usage.chars += prompt.length;
  const started = Date.now();
  let text = '';
  let structured: unknown;
  for await (const chunk of provider.sendQuery(prompt, work, undefined, {
    model,
    persistSession: false,
    abortSignal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]),
    assistantConfig: { enableExtensions: false },
    nodeConfig: { allowed_tools: [], denied_tools: [], thinking: 'medium' },
    outputFormat: { type: 'json_schema', schema: schema as unknown as Record<string, unknown> },
  })) {
    if (chunk.type === 'tool' || chunk.type === 'tool_result')
      throw new Error(`${role} attempted a forbidden tool`);
    if (chunk.type === 'assistant') text += chunk.content;
    if (chunk.type === 'result') {
      if (chunk.isError) throw new Error(`${role} request failed`);
      if (chunk.structuredOutput !== undefined) structured = chunk.structuredOutput;
    }
  }
  await log(
    `${role} ${model ?? ''}: ${Math.round((Date.now() - started) / 1000).toString()}s, prompt ${prompt.length.toString()} chars`
  );
  await writeFile(
    join(work, `call-${usage.calls.toString().padStart(2, '0')}-${role}.json`),
    JSON.stringify(structured ?? text, null, 2)
  );
  return structured ?? (JSON.parse(text) as unknown);
};

const blueprintPath = resolve(values.blueprint ?? '');
const bytes = new Uint8Array(await readFile(blueprintPath));
const understanding = await understandProjectSources({
  sources: [
    {
      id: 'blueprint',
      kind: 'blueprint',
      filename: blueprintPath.split('/').at(-1) ?? 'blueprint.md',
      mediaType: 'text/markdown',
      contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      bytes,
    },
  ],
});
const plan = deriveExperimentPlan(understanding.analysis);
await writeFile(join(work, 'plan.json'), JSON.stringify(plan, null, 2));
const blocking = plan.gaps.filter(gap => gap.blocking);
if (blocking.length > 0 || plan.protocol === null)
  throw new Error(`Plan has blocking gaps: ${blocking.map(gap => gap.message).join('; ')}`);
const variantIds = values.variants
  ? values.variants.split(',')
  : plan.variants.map(variant => variant.id);
await log(`plan: ${variantIds.join(', ')}; primary ${plan.protocol.primaryMetric}`);

const runtime = await resolveMlRuntime();
const signal = new AbortController().signal;
const build = await buildExperimentCodebase({
  blueprint: new TextDecoder().decode(bytes),
  plan,
  variantIds,
  rawDataDir: resolve(values.data ?? ''),
  projectDir: join(work, 'project'),
  workDir: join(work, 'build'),
  runtime,
  generate,
  maxFixRounds: 4,
  maxReviewRounds: 2,
  signal,
  onEvent: event =>
    void log(
      `${event.stage} #${event.round.toString()} ${event.kind}: ${event.detail.slice(0, 300)}`
    ),
});
await writeFile(join(work, 'build.json'), JSON.stringify(build, null, 2));
if (build.status !== 'ready') {
  await log(`BUILD FAILED at ${build.stage}: ${build.reason.slice(0, 2000)}`);
  process.exit(1);
}
await log(`build ready; review: ${build.review.summary.slice(0, 500)}`);
const run = await runExperimentVariants({
  runtime,
  projectDir: join(work, 'project'),
  agentDataDir: build.split.agentDataDir,
  holdoutDir: build.split.holdoutDir,
  protocol: plan.protocol,
  variantIds,
  workDir: join(work, 'experiments'),
  timeoutMs: 25 * 60_000,
  signal,
  onVariant: item =>
    void log(
      `variant ${item.variant}: ${item.status} in ${Math.round(item.durationMs / 1000).toString()}s`
    ),
});
await writeFile(join(work, 'result.json'), JSON.stringify(run, null, 2));
for (const [variant, result] of Object.entries(run.evaluation.variants))
  await log(
    `${variant}: ${result.status}${result.status === 'verified' ? ` ${JSON.stringify(result.metrics)}` : ` ${result.error}`}`
  );
await log(
  `suggested: ${run.suggestion.suggested ?? 'none'} (${run.suggestion.reasons.join(', ')}); LLM calls ${usage.calls.toString()}`
);
