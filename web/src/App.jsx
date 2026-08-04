import { CompanyProvider } from "./context";
import { useHashRoute } from "./hooks";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import AskConsole from "./pages/AskConsole";
import Companies from "./pages/Companies";
import Config from "./pages/Config";
import Prompt from "./pages/Prompt";
import Cloudflare from "./pages/Cloudflare";
import Scheduler from "./pages/Scheduler";

export default function App() {
  const [route, navigate] = useHashRoute();

  const pages = {
    dashboard: Dashboard,
    ask: AskConsole,
    companies: Companies,
    config: Config,
    prompt: Prompt,
    cloudflare: Cloudflare,
    scheduler: Scheduler,
  };

  const Page = pages[route] || Dashboard;

  return (
    <CompanyProvider>
      <Layout route={route} navigate={navigate}>
        <Page navigate={navigate} />
      </Layout>
    </CompanyProvider>
  );
}
