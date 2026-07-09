import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';

/**
 * Minimal login page — shown only when Better Auth is enabled server-side.
 * Uses the Better Auth email/password endpoint directly via fetch.
 */
export function LoginPage(): ReactElement {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? 'Sign in failed.');
        return;
      }
      navigate('/console', { replace: true });
    } catch {
      setError('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[oklch(0.640_0.295_330)]">
            <span className="text-sm font-bold text-white">A</span>
          </div>
          <span className="text-lg font-semibold text-zinc-100">Anvil</span>
        </div>

        <h1 className="mb-1 text-[18px] font-bold text-zinc-100">Sign in</h1>
        <p className="mb-6 text-sm text-zinc-400">Enter your credentials to continue.</p>

        <form
          onSubmit={(e): void => {
            void handleSubmit(e);
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-medium text-zinc-400">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e): void => {
                setEmail(e.target.value);
              }}
              required
              autoComplete="email"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-zinc-400">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e): void => {
                setPassword(e.target.value);
              }}
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
              placeholder="••••••••"
            />
          </div>

          {error !== null && (
            <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded-lg bg-[oklch(0.640_0.295_330)] py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
