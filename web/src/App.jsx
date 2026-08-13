import { CompanyProvider } from "./context";
import { AuthProvider, useAuth } from "./auth.jsx";
import { useHashRoute } from "./hooks";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import LoginPage from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AskConsole from "./pages/AskConsole";
import Companies from "./pages/Companies";
import Config from "./pages/Config";
import Cloudflare from "./pages/Cloudflare";
import Scheduler from "./pages/Scheduler";
import Logs from "./pages/Logs";
import Catalog from "./pages/Catalog";
import Credentials from "./pages/Credentials";
import KbList from "./pages/KbList";
import KbDetail from "./pages/KbDetail";
import Assistants from "./pages/Assistants";

const PAGES = {
  dashboard: Dashboard,
  ask: AskConsole,
  companies: Companies,
  config: Config,
  cloudflare: Cloudflare,
  scheduler: Scheduler,
  logs: Logs,
  catalog: Catalog,
  credentials: Credentials,
  kbs: KbList,
  assistants: Assistants,
};

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
  const [seg] = route.split("/");
  const Page = PAGES[seg] || Dashboard;

  return (
    <CompanyProvider>
      <Layout route={seg} navigate={navigate}>
        <Page navigate={navigate} path={route} />
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
