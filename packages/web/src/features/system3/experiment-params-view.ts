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

/** Only what a trial changed from the defaults, so the list stays readable. */
export function describeTrialParams(
  params: Readonly<Record<string, ParamValue>> | null,
  defaults: Readonly<Record<string, ParamValue>>
): string {
  if (params === null) return 'không báo tham số';
  const changed = Object.entries(params).filter(([name, value]) => value !== defaults[name]);
  return changed.length === 0
    ? 'mặc định'
    : changed.map(([name, value]) => `${name} = ${formatParamValue(value)}`).join(', ');
}
