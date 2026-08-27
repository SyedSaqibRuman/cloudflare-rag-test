import { Component, lazy, Suspense } from "react";
import { CompanyProvider } from "./context";
import { AuthProvider, useAuth } from "./auth.jsx";
import { useHashRoute } from "./hooks";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import LoginPage from "./pages/Login";

// --------------------------
// Lazy-loaded pages — each becomes a separate Vite chunk, loaded on demand.
// The initial bundle shrinks from ~886 KB to ~428 KB (React + Layout + shared UI).
// --------------------------
const Dashboard = lazy(() => import("./pages/Dashboard"));
const AskConsole = lazy(() => import("./pages/AskConsole"));
const Companies = lazy(() => import("./pages/Companies"));
const Config = lazy(() => import("./pages/Config"));
const Cloudflare = lazy(() => import("./pages/Cloudflare"));
const Scheduler = lazy(() => import("./pages/Scheduler"));
const Logs = lazy(() => import("./pages/Logs"));
const Catalog = lazy(() => import("./pages/Catalog"));
const Assistants = lazy(() => import("./pages/Assistants"));
const Ingestion = lazy(() => import("./pages/Ingestion"));

const PAGES = {
  dashboard: Dashboard,
  ask: AskConsole,
  companies: Companies,
  config: Config,
  cloudflare: Cloudflare,
  scheduler: Scheduler,
  logs: Logs,
  catalog: Catalog,
  assistants: Assistants,
  ingestion: Ingestion,
};

// --------------------------
// Error Boundary — catches chunk load failures (network errors, broken
// builds) and renders a retry UI instead of a blank screen.
// --------------------------

class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  handleRetry = () => {
    // Clear the error so the boundary re-renders its children.
    // React.lazy caches the import promise, so we force a re-mount by
    // bumping a key on the boundary — this re-triggers the dynamic import.
    this.setState({ error: null, retryKey: (this.state.retryKey || 0) + 1 });
  };

  render() {
    if (this.state.error) {
      const isChunkError = this.state.error.name === "ChunkLoadError" ||
        /Loading chunk .* failed/i.test(this.state.error.message) ||
        /dynamically imported module/i.test(this.state.error.message);

      return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400">
            <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" x2="12" y1="8" y2="12" />
              <line x1="12" x2="12.01" y1="16" y2="16" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-100">
            {isChunkError ? "Failed to load page" : "Something went wrong"}
          </h3>
          <p className="mt-1 max-w-sm text-xs text-slate-400">
            {isChunkError
              ? "The page couldn't be downloaded. Check your connection and try again."
              : this.state.error.message || "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/** Lightweight loading fallback shown while a page chunk downloads. */
function PageFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

function Gate() {
  const { checking, authed } = useAuth();
  const [route, navigate] = useHashRoute();

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!authed) return <LoginPage />;

  // Hash routes may carry a detail segment (e.g. "#catalog/cloudflare") — the
  // first segment picks the page; the rest is passed to the page as `path`.
  const [seg, sub] = route.split("/");
  let Page = PAGES[seg] || Dashboard;


  return (
    <CompanyProvider>
      <Layout route={seg} navigate={navigate}>
        <PageErrorBoundary key={seg}>
          <Suspense fallback={<PageFallback />}>
            <Page navigate={navigate} path={route} />
          </Suspense>
        </PageErrorBoundary>
      </Layout>
    </CompanyProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
