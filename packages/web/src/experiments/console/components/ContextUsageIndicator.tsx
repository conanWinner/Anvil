import type { ReactElement } from 'react';
import type { ContextUsage } from '../lib/sse';

function compactTokens(tokens: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: tokens >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(tokens);
}

export function ContextUsageIndicator({
  usage,
}: {
  usage: ContextUsage | undefined;
}): ReactElement {
  const usedPercent =
    usage?.contextWindow && usage.contextWindow > 0
      ? Math.min(100, (usage.tokensIn / usage.contextWindow) * 100)
      : undefined;
  const remaining = usedPercent === undefined ? undefined : Math.max(0, 100 - usedPercent);
  const detail = usage
    ? [
        usage.model,
        `${usage.tokensIn.toLocaleString()} input tokens`,
        usage.tokensOut !== undefined
          ? `${usage.tokensOut.toLocaleString()} output tokens`
          : undefined,
        usage.contextWindow !== undefined
          ? `${usage.contextWindow.toLocaleString()} token context window`
          : 'Provider SDK does not report the context limit',
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Token usage appears after the next assistant response';

  const color =
    usedPercent !== undefined && usedPercent >= 90
      ? 'bg-error'
      : usedPercent !== undefined && usedPercent >= 75
        ? 'bg-warning'
        : 'bg-success';

  return (
    <div className="flex w-[132px] shrink-0 flex-col gap-1" title={detail}>
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-text-tertiary">
        <span>Context</span>
        <span>
          {!usage
            ? 'Waiting…'
            : remaining !== undefined
              ? `${Math.round(remaining)}% left`
              : `${compactTokens(usage.tokensIn)} used`}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-inset">
        <div
          className={`h-full rounded-full transition-[width,background-color] ${color}`}
          style={{ width: `${String(usedPercent ?? 0)}%` }}
        />
      </div>
    </div>
  );
}
