// --------------------------
// ChunkErrorBoundary — catches chunk load failures for lazy-loaded catalog
// sub-modules (modals, cards). Shows a compact retry UI inline.
// --------------------------
import { Component } from "react";

export class ChunkErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  handleRetry = () => {
    this.setState({ error: null, retryKey: (this.state.retryKey || 0) + 1 });
  };

  render() {
    if (this.state.error) {
      const isChunk =
        this.state.error.name === "ChunkLoadError" ||
        /Loading chunk .* failed/i.test(this.state.error.message) ||
        /dynamically imported module/i.test(this.state.error.message);
      return (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-700 px-4 py-3 text-sm text-slate-400">
          <svg
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-rose-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" x2="12" y1="8" y2="12" />
            <line x1="12" x2="12.01" y1="16" y2="16" />
          </svg>
          <span className="flex-1">
            {isChunk
              ? "Failed to load — check your connection"
              : this.state.error.message}
          </span>
          <button
            type="button"
            onClick={this.handleRetry}
            className="shrink-0 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
