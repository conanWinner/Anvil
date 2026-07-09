import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useEffect, useState } from 'react';

type AuthState = 'loading' | 'pass' | 'redirect-login';

/**
 * Gates the app behind a Better Auth session — but ONLY when the server has
 * web auth enabled. When disabled (the default / solo installs), renders a
 * brief full-screen loader until /api/auth/status resolves, then passes
 * children through unchanged.
 *
 * Rewritten to use plain fetch — no @tanstack/react-query dependency.
 */
export function SessionGate({ children }: { children: ReactNode }): React.ReactElement {
  const [state, setState] = useState<AuthState>('loading');

  useEffect(() => {
    let cancelled = false;

    async function check(): Promise<void> {
      try {
        const statusRes = await fetch('/api/auth/status', { credentials: 'same-origin' });
        if (cancelled) return;
        if (!statusRes.ok) {
          // Can't reach server — pass through so the app can show its own error
          setState('pass');
          return;
        }
        const status = (await statusRes.json()) as { enabled?: boolean };
        if (cancelled) return;

        // Auth disabled → always pass through
        if (!status.enabled) {
          setState('pass');
          return;
        }

        // Auth enabled → check for active session
        const sessionRes = await fetch('/api/auth/get-session', { credentials: 'same-origin' });
        if (cancelled) return;
        if (!sessionRes.ok) {
          setState('redirect-login');
          return;
        }
        const session = (await sessionRes.json()) as { user?: unknown } | null;
        setState(session?.user !== undefined && session.user !== null ? 'pass' : 'redirect-login');
      } catch {
        if (!cancelled) setState('pass'); // network error → pass through
      }
    }

    void check();
    return (): void => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') return <FullScreenLoader />;
  if (state === 'redirect-login') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function FullScreenLoader(): React.ReactElement {
  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
    </div>
  );
}
