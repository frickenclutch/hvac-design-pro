import { Component, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Short label shown in the fallback UI (e.g. "3D Viewer") */
  label?: string;
  /** Render a full-page fallback (for route-level boundaries) */
  fullPage?: boolean;
  /** Optional callback when an error is caught */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /** Optional custom retry handler */
  onRetry?: () => void;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ''}]`, error, info);
    this.props.onError?.(error, info);
  }

  private handleRetry = () => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      const label = this.props.label ?? 'Component';

      if (this.props.fullPage) {
        return (
          <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-6 p-8 text-center bg-slate-950">
            <AlertTriangle className="w-16 h-16 text-amber-400 drop-shadow-[0_0_20px_rgba(245,158,11,0.3)]" />
            <div>
              <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
              <p className="text-sm text-slate-400 max-w-md">{this.state.error.message}</p>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/dashboard"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
              >
                <Home className="w-4 h-4" />
                Go to Dashboard
              </a>
              <button
                onClick={this.handleRetry}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors border border-slate-700"
              >
                <RotateCcw className="w-4 h-4" />
                Retry
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-400" />
          <div>
            <h3 className="text-sm font-bold text-slate-200 mb-1">{label} failed to load</h3>
            <p className="text-xs text-slate-500 max-w-xs">{this.state.error.message}</p>
          </div>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
