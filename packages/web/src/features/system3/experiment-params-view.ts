/** Turning the parameter inputs of the run panel into the overrides the server accepts. */

export type ParamValue = number | string | boolean | null;
export type ParamEdits = Readonly<Record<string, Readonly<Record<string, string>>>>;

export function formatParamValue(value: ParamValue): string {
  return value === null ? 'null' : String(value);
}

function parseValue(text: string, fallback: ParamValue): { value: ParamValue } | { error: string } {
  const trimmed = text.trim();
  if (typeof fallback === 'number') {
    const number = Number(trimmed);
    return trimmed === '' || !Number.isFinite(number) ? { error: 'phải là số' } : { value: number };
  }
  if (typeof fallback === 'boolean')
    return trimmed === 'true' || trimmed === 'false'
      ? { value: trimmed === 'true' }
      : { error: 'phải là true hoặc false' };
  if (typeof fallback === 'string') return { value: trimmed };
  // A null default (for example no depth limit) accepts a number, a flag, a name or null again.
  if (trimmed === 'null' || trimmed === '') return { value: null };
  if (trimmed === 'true' || trimmed === 'false') return { value: trimmed === 'true' };
  const number = Number(trimmed);
  return { value: Number.isFinite(number) ? number : trimmed };
}

/** Only values that differ from the default are sent; a bad input is reported, never guessed. */
export function parseParamEdits(
  defaults: Readonly<Record<string, Readonly<Record<string, ParamValue>>>>,
  edits: ParamEdits,
  variantIds: readonly string[]
): { overrides: Record<string, Record<string, ParamValue>>; errors: string[] } {
  const overrides: Record<string, Record<string, ParamValue>> = {};
  const errors: string[] = [];
  for (const variant of variantIds) {
    const known = defaults[variant] ?? {};
    for (const [name, text] of Object.entries(edits[variant] ?? {})) {
      if (!Object.hasOwn(known, name)) continue;
      const fallback = known[name] ?? null;
      const parsed = parseValue(text, fallback);
      if ('error' in parsed) {
        errors.push(`${name}: ${parsed.error}`);
        continue;
      }
      if (parsed.value !== fallback) (overrides[variant] ??= {})[name] = parsed.value;
    }
  }
  return { overrides, errors };
}

/** Text inputs that reproduce a tried setting, for trying it again or choosing it for the run. */
export function editsFromParams(
  params: Readonly<Record<string, ParamValue>>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).map(([name, value]) => [name, formatParamValue(value)])
  );
}

type TrialParams = Readonly<Record<string, ParamValue>>;

export interface ParamTrial {
  round: number;
  variant: string;
  params: TrialParams | null;
  requested?: TrialParams;
}

/**
 * Each variant's latest tried setting: the panel is rebuilt after a trial and must not lose it.
 * Reported values the person did not ask for stay out, or they would become overrides.
 */
export function editsFromLatestTrials(trials: readonly ParamTrial[]): ParamEdits {
  const latest = new Map<string, { round: number; setting: TrialParams }>();
  for (const { round, variant, params, requested } of trials) {
    const setting = requested ?? params;
    const known = latest.get(variant);
    if (setting !== null && (known === undefined || round > known.round))
      latest.set(variant, { round, setting });
  }
  return Object.fromEntries(
    [...latest].map(([variant, { setting }]) => [variant, editsFromParams(setting)])
  );
}

/** Only what a trial changed from the defaults, so the list stays readable. */
export function describeTrialParams(
  { params, requested }: Pick<ParamTrial, 'params' | 'requested'>,
  defaults: TrialParams
): string {
  const setting = requested ?? params;
  if (setting === null) return 'không báo tham số';
  const changed = Object.entries(setting).filter(([name, value]) => value !== defaults[name]);
  return changed.length === 0
    ? 'mặc định'
    : changed.map(([name, value]) => `${name} = ${formatParamValue(value)}`).join(', ');
}
