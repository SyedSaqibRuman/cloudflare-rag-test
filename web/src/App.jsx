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
import Prompt from "./pages/Prompt";
import Cloudflare from "./pages/Cloudflare";
import Scheduler from "./pages/Scheduler";
import Logs from "./pages/Logs";

const PAGES = {
  dashboard: Dashboard,
  ask: AskConsole,
  companies: Companies,
  config: Config,
  prompt: Prompt,
  cloudflare: Cloudflare,
  scheduler: Scheduler,
  logs: Logs,
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

  const Page = PAGES[route] || Dashboard;

  return (
    <CompanyProvider>
      <Layout route={route} navigate={navigate}>
        <Page navigate={navigate} />
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
