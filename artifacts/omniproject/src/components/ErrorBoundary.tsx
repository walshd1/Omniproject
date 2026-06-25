import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional custom fallback. When omitted the default themed panel is shown. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * App-level React error boundary. Without one, a render-time throw white-screens
 * the entire SPA under the bare Suspense fallback. This catches the throw and
 * shows a themed "Something went wrong / Reload" panel so the user keeps a way
 * out. Wrapped both around the Router (app shell) and around #main-content (so a
 * page-level throw leaves the nav shell intact).
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for diagnostics; the panel handles the user-facing recovery.
    console.error("Uncaught render error:", error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          role="alert"
          className="flex h-full min-h-[16rem] w-full items-center justify-center bg-background text-foreground p-8"
        >
          <div className="max-w-md w-full border-2 border-border bg-card p-8 text-center space-y-4">
            <div className="text-lg font-black uppercase tracking-tighter">Something went wrong</div>
            <p className="text-sm text-muted-foreground">
              An unexpected error interrupted this view. Reloading usually clears it.
            </p>
            {this.state.error?.message && (
              <p className="text-xs text-muted-foreground font-mono break-words border border-border bg-background p-2">
                {this.state.error.message}
              </p>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 border border-primary bg-primary text-primary-foreground px-4 py-2 text-sm font-black uppercase tracking-widest hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
