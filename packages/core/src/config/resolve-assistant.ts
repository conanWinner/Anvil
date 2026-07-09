import { access } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '@anvil/paths';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('config.resolve-assistant');
  return cachedLog;
}

/**
 * Resolve the default AI assistant for a newly registered codebase.
 *
 * Precedence: SDK folder detection (`.codex` / `.claude` in repo) → configured
 * `assistant` from `.anvil/config.yaml` → first built-in provider in the
 * registry → hardcoded `'claude'`.
 *
 * Folder detection wins over config because a checked-in `.codex` or `.claude`
 * directory is an explicit per-repo signal from the user.
 */
export async function resolveDefaultAssistant(repoPath: string): Promise<string> {
  const codexFolder = join(repoPath, '.codex');
  const claudeFolder = join(repoPath, '.claude');

  try {
    await access(codexFolder);
    getLog().debug({ path: codexFolder }, 'assistant_detected_codex');
    return 'codex';
  } catch {
    // fall through
  }

  try {
    await access(claudeFolder);
    getLog().debug({ path: claudeFolder }, 'assistant_detected_claude');
    return 'claude';
  } catch {
    // fall through
  }

  // Lazy-load config-loader and @anvil/providers so this module doesn't eagerly
  // pull in their chains at every import site. config-loader.ts eagerly imports
  // @anvil/providers, which transitively pulls in claude/codex binary-resolver
  // and their BUNDLED_IS_BINARY dependency on @anvil/paths — that breaks adapter
  // tests on Linux that mock @anvil/paths without BUNDLED_IS_BINARY. The original
  // clone.ts logic used dynamic imports for exactly this reason.
  try {
    const { loadConfig } = await import('./config-loader');
    // Pass repoPath so the repo's own .anvil/config.yaml is merged on top of
    // the global config — without it, a repo-level `assistant: pi` would be
    // silently ignored during registration.
    const config = await loadConfig(repoPath);
    if (config.assistant) {
      getLog().debug({ provider: config.assistant }, 'assistant_default_from_config');
      return config.assistant;
    }
  } catch (err) {
    getLog().warn({ err }, 'config_load_failed_using_builtin_default');
  }

  const { getRegisteredProviders } = await import('@anvil/providers');
  return getRegisteredProviders().find(p => p.builtIn)?.id ?? 'claude';
}
