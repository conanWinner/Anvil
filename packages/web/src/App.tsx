import { Component, lazy, Suspense } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { SessionGate } from '@/components/auth/SessionGate';
import { LoginPage } from '@/components/auth/LoginPage';
import { QueryClientProvider } from '@tanstack/react-query';
import { ProjectProvider } from '@/contexts/ProjectContext';
import { queryClient } from '@/lib/query-client';

const lazyRoutes = {
  console: lazy(async () => ({
    default: (await import('@/experiments/console/ConsoleApp')).ConsoleApp,
  })),
  system3: lazy(async () => ({
    default: (await import('@/features/system3/System3App')).System3App,
  })),
};

function RouteLoading(): React.ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center" aria-busy="true">
      <p role="status" aria-live="polite">
        Đang tải giao diện…
      </p>
    </main>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught rendering error', {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-zinc-950 p-8">
          <div className="max-w-md text-center">
            <h1 className="mb-2 text-xl font-semibold text-zinc-100">Something went wrong</h1>
            <p className="mb-4 text-sm text-zinc-400">
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
            <button
              onClick={(): void => {
                window.location.reload();
              }}
              className="rounded-md bg-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App(): React.ReactElement {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ProjectProvider>
          <BrowserRouter>
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                <Route path="/" element={<Navigate to="/console/projects" replace />} />
                <Route path="/login" element={<LoginPage />} />
                <Route
                  path="/console/projects/*"
                  element={
                    <SessionGate>
                      <lazyRoutes.system3 />
                    </SessionGate>
                  }
                />
                <Route
                  path="/console/*"
                  element={
                    <SessionGate>
                      <lazyRoutes.console />
                    </SessionGate>
                  }
                />
                <Route path="*" element={<Navigate to="/console" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ProjectProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
