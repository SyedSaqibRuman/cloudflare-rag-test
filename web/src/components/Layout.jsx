import { useEffect, useState } from "react";
import { cx } from "../util";
import { api, health as fetchHealth } from "../api";
import { useCompanies } from "../context";
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: <IconDashboard /> },
  { id: "ask", label: "Ask Console", icon: <IconChat /> },
  { id: "companies", label: "Companies", icon: <IconBuilding /> },
  { id: "config", label: "Company Config", icon: <IconSliders /> },
  { id: "prompt", label: "Prompt", icon: <IconDoc /> },
  { id: "cloudflare", label: "Cloudflare", icon: <IconCloud /> },
  { id: "scheduler", label: "Scheduler", icon: <IconClock /> },
];

export default function Layout({ route, navigate, children }) {
  const { company, companies, select } = useCompanies();
  const [status, setStatus] = useState("checking");
  const [theme, setTheme] = useState(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("pc_theme", theme);
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const h = await fetchHealth();
        if (mounted) setStatus(h?.status === "ok" ? "online" : "offline");
      } catch {
        if (mounted) setStatus("offline");
      }
    };
    check();
    const id = setInterval(check, 10000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-slate-800 bg-slate-900/90 backdrop-blur">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-slate-800">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500 text-white font-bold">
            PC
          </div>
          <div>
            <p className="text-sm font-bold text-slate-50 leading-tight">PopularCert</p>
            <p className="text-[11px] text-slate-400">AI Conversation Platform</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={cx(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                route === item.id
                  ? "bg-indigo-500/15 text-indigo-300"
                  : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/70"
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="border-t border-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">API</span>
            <span className="flex items-center gap-1.5">
              <span
                className={cx(
                  "h-2 w-2 rounded-full",
                  status === "online" ? "bg-emerald-400" : status === "offline" ? "bg-rose-500" : "bg-amber-400"
                )}
              />
              <span className="text-slate-300">{status === "online" ? "Online" : status === "offline" ? "Offline" : "Checking…"}</span>
            </span>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Company</label>
            <select
              value={company}
              onChange={(e) => select(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="">No company selected</option>
              {companies.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.COMPANY_NAME || c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </aside>

      <main className="ml-60 flex-1">
        <header className="flex items-center justify-end px-8 pt-5 pb-2">
          <div
            role="radiogroup"
            aria-label="Theme"
            className={cx(
              "relative flex items-center rounded-full border p-1 transition-colors",
              theme === "dark" ? "border-slate-700 bg-slate-800/60" : "border-slate-700 bg-slate-800"
            )}
          >
            <span
              aria-hidden
              className={cx(
                "absolute top-1 bottom-1 w-9 rounded-full shadow-md ring-1 transition-all duration-300 ease-out",
                theme === "dark" ? "left-10 bg-slate-900 ring-slate-600" : "left-1 bg-white ring-black/5"
              )}
            />
            <button
              type="button"
              role="radio"
              aria-checked={theme === "light"}
              aria-label="Light mode"
              title="Light mode"
              onClick={() => setTheme("light")}
              className={cx(
                  "relative z-10 flex h-7 w-9 items-center justify-center rounded-full transition-colors",
                  theme === "light" ? "text-amber-500" : "text-slate-400 hover:text-slate-200"
                )}
              >
                <IconSun />
              </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === "dark"}
              aria-label="Dark mode"
              title="Dark mode"
              onClick={() => setTheme("dark")}
              className={cx(
                  "relative z-10 flex h-7 w-9 items-center justify-center rounded-full transition-colors",
                  theme === "dark" ? "text-indigo-300" : "text-slate-400 hover:text-slate-200"
                )}
              >
                <IconMoon />
              </button>
          </div>
        </header>
        <div className="px-8 py-4">{children}</div>
      </main>
    </div>
  );
}

function IconDashboard() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconBuilding() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" />
      <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
      <path d="M19 21V9a2 2 0 0 0-2-2h-2" />
      <path d="M9 7h2" />
      <path d="M9 11h2" />
      <path d="M9 15h2" />
    </svg>
  );
}

function IconSliders() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21v-7" />
      <path d="M4 10V3" />
      <path d="M12 21v-9" />
      <path d="M12 8V3" />
      <path d="M20 21v-5" />
      <path d="M20 12V3" />
      <path d="M1 14h6" />
      <path d="M9 8h6" />
      <path d="M17 16h6" />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </svg>
  );
}

function IconCloud() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
