export const DISPLAY_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** Treat timezone-less SQLite timestamps as UTC while preserving explicit offsets. */
export function ensureUtc(timestamp: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp) ? timestamp : timestamp + 'Z';
}

export function formatVietnamDateTime(
  timestamp: string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const date = new Date(ensureUtc(timestamp));
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: DISPLAY_TIME_ZONE,
    hourCycle: 'h23',
    ...options,
  }).format(date);
}

export function formatVietnamClock(timestamp: string): string {
  return formatVietnamDateTime(timestamp, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Format the duration between two timestamps as a human-readable string. */
export function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(ensureUtc(startedAt)).getTime();
  const end = completedAt ? new Date(ensureUtc(completedAt)).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${String(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/** Format a started_at timestamp as a short locale string (e.g., "Mar 10, 2:30 PM"). */
export function formatStarted(startedAt: string): string {
  return formatVietnamDateTime(startedAt, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Format a duration in milliseconds as a human-readable string (e.g., "1.2s", "3.5m"). */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
