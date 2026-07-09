import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { deliverCredential, getDecryptedProviderConnectionCredential } from '@anvil/core';

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins?: number;
  resetsAt?: number;
}

export interface CodexAccountUsage {
  connectionId: string;
  connectionName: string;
  planType?: string;
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance?: string;
  };
  lifetimeTokens?: number;
  currentStreakDays?: number;
}

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

interface RateLimitSnapshot {
  planType?: string | null;
  primary?: CodexRateLimitWindow | null;
  secondary?: CodexRateLimitWindow | null;
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance?: string | null;
  } | null;
}

interface RateLimitsResult {
  rateLimits?: RateLimitSnapshot;
}

interface TokenUsageResult {
  summary?: {
    lifetimeTokens?: number | null;
    currentStreakDays?: number | null;
  };
}

const REQUEST_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseResponse(line: string): JsonRpcResponse | null {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? (value as JsonRpcResponse) : null;
  } catch {
    return null;
  }
}

function send(proc: ChildProcessWithoutNullStreams, message: unknown): void {
  proc.stdin.write(`${JSON.stringify(message)}\n`);
}

async function waitForResponse(
  responses: Map<number, (response: JsonRpcResponse) => void>,
  id: number,
  action: () => void
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      responses.delete(id);
      reject(new Error('Codex App Server telemetry request timed out'));
    }, REQUEST_TIMEOUT_MS);
    responses.set(id, response => {
      clearTimeout(timer);
      if (response.error) {
        reject(new Error(response.error.message ?? 'Codex App Server request failed'));
      } else {
        resolve(response.result);
      }
    });
    action();
  });
}

async function writeDeliveryFiles(
  files: { path: string; contents: string }[] | undefined
): Promise<void> {
  for (const file of files ?? []) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents, { encoding: 'utf8', mode: 0o600 });
  }
}

export async function readCodexAccountUsage(
  userId: string,
  connectionId: string
): Promise<CodexAccountUsage> {
  const resolved = await getDecryptedProviderConnectionCredential(userId, connectionId);
  if (!resolved) throw new Error('Provider connection not found or credentials are unavailable');
  if (resolved.provider !== 'openai') {
    throw new Error('Account usage is only available for OpenAI connections');
  }

  const scratchDir = await mkdtemp(join(tmpdir(), 'anvil-codex-usage-'));
  let proc: ChildProcessWithoutNullStreams | undefined;
  try {
    const delivery = deliverCredential(resolved.provider, resolved.credential, {
      artifactsDir: scratchDir,
    });
    await writeDeliveryFiles(delivery.files);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...delivery.env,
      ANVIL_PROVIDER_AUTH_MODE: 'web-only',
    };
    delete env.CODEX_ACCESS_TOKEN;
    delete env.CODEX_ID_TOKEN;
    delete env.CODEX_REFRESH_TOKEN;
    delete env.CODEX_ACCOUNT_ID;

    proc = spawn(process.env.CODEX_BIN_PATH || 'codex', ['app-server', '--stdio'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const activeProc = proc;
    const responses = new Map<number, (response: JsonRpcResponse) => void>();
    const lines = createInterface({ input: proc.stdout });
    lines.on('line', line => {
      const response = parseResponse(line);
      if (response?.id === undefined) return;
      responses.get(response.id)?.(response);
      responses.delete(response.id);
    });

    await waitForResponse(responses, 0, () => {
      send(activeProc, {
        method: 'initialize',
        id: 0,
        params: {
          clientInfo: { name: 'anvil', title: 'Anvil', version: '0.5.0' },
          capabilities: { experimentalApi: true },
        },
      });
    });
    send(activeProc, { method: 'initialized', params: {} });

    const [limitsRaw, usageRaw] = await Promise.all([
      waitForResponse(responses, 1, () => {
        send(activeProc, { method: 'account/rateLimits/read', id: 1, params: {} });
      }),
      waitForResponse(responses, 2, () => {
        send(activeProc, { method: 'account/usage/read', id: 2, params: {} });
      }),
    ]);
    const limits = (isRecord(limitsRaw) ? limitsRaw : {}) as RateLimitsResult;
    const usage = (isRecord(usageRaw) ? usageRaw : {}) as TokenUsageResult;
    const snapshot = limits.rateLimits;
    if (!snapshot) throw new Error('Codex did not return account rate-limit data');

    return {
      connectionId,
      connectionName: resolved.name,
      ...(snapshot.planType ? { planType: snapshot.planType } : {}),
      ...(snapshot.primary ? { primary: snapshot.primary } : {}),
      ...(snapshot.secondary ? { secondary: snapshot.secondary } : {}),
      ...(snapshot.credits
        ? {
            credits: {
              hasCredits: snapshot.credits.hasCredits,
              unlimited: snapshot.credits.unlimited,
              ...(snapshot.credits.balance ? { balance: snapshot.credits.balance } : {}),
            },
          }
        : {}),
      ...(typeof usage.summary?.lifetimeTokens === 'number'
        ? { lifetimeTokens: usage.summary.lifetimeTokens }
        : {}),
      ...(typeof usage.summary?.currentStreakDays === 'number'
        ? { currentStreakDays: usage.summary.currentStreakDays }
        : {}),
    };
  } finally {
    proc?.kill();
    await rm(scratchDir, { recursive: true, force: true });
  }
}
