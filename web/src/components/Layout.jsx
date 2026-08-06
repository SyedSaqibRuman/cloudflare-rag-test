import { createContext, useContext, useEffect, useState } from "react";
import { cx } from "../util";
import { health as fetchHealth } from "../api";
import { useCompanies } from "../context";
import { useAuth } from "../auth.jsx";
import ThemeToggle from "./theme-toggle";
import CompanySelect from "./company-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

const HeaderActionsCtx = createContext(null);

/**
 * Pages call this with the toolbar JSX they want rendered in the shared
 * header, right of the title and next to the theme toggle.
 */
export function useHeaderActions(node) {
  const set = useContext(HeaderActionsCtx);
  useEffect(() => {
    set(node || null);
    return () => set(null);
  });
}
const NAV = [
  {
    section: "Overview",
    items: [{ id: "dashboard", label: "Dashboard", icon: <IconDashboard /> }],
  },
  {
    section: "AI",
    items: [
      { id: "ask", label: "Ask Console", icon: <IconChat /> },
      { id: "prompt", label: "Prompt", icon: <IconDoc /> },
    ],
  },
  {
    section: "Companies",
    items: [
      { id: "companies", label: "Companies", icon: <IconBuilding /> },
      { id: "config", label: "Configuration", icon: <IconSliders /> },
    ],
  },
  {
    section: "Infrastructure",
    items: [
      { id: "cloudflare", label: "Cloudflare", icon: <IconCloud /> },
      { id: "scheduler", label: "Scheduler", icon: <IconClock /> },
    ],
  },
];

const PAGE_META = {
  dashboard: { title: "Dashboard", subtitle: "Platform overview and live system state" },
  ask: { title: "Ask Console", subtitle: "Test the RAG assistant with live streaming responses" },
  companies: { title: "Companies", subtitle: "Tenants with isolated config, vector index, and R2 bucket" },
  config: { title: "Company Config", subtitle: "Hot-reloadable runtime configuration per tenant" },
  prompt: { title: "System Prompt", subtitle: "The assistant's behavior template with runtime variable interpolation" },
  cloudflare: { title: "Cloudflare Resources", subtitle: "Vector indexes and R2 buckets across the account" },
  scheduler: { title: "Scheduler", subtitle: "Run jobs on demand, schedule them with cron, and manage reusable presets" },
  logs: { title: "Logs", subtitle: "Server log files written by the app (error, process, upload, vector)" },
};

export default function Layout({ route, navigate, children }) {
  const { company, companies, select } = useCompanies();
  const { logout, username } = useAuth();
  const [status, setStatus] = useState("checking");
  const [headerActions, setHeaderActions] = useState(null);
  // Theme preference: "light" | "dark" | "system" (defaults to system so the
  // portal follows the OS until the admin picks an explicit theme).
  const [theme, setTheme] = useState(() => localStorage.getItem("pc_theme") || "system");
  const [osDark, setOsDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
  );

  useEffect(() => {
    localStorage.setItem("pc_theme", theme);
    const resolved = theme === "system" ? (osDark ? "dark" : "light") : theme;
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [theme, osDark]);

  // In system mode, live-follow OS preference changes.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setOsDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
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
    <HeaderActionsCtx.Provider value={setHeaderActions}>
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-indigo-500 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-slate-800 bg-slate-900/90 backdrop-blur">
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-lg shadow-indigo-500/25">
            PC
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-tight tracking-tight text-slate-100" translate="no">
              PopularCert
            </span>
            <span className="block truncate text-[11px] leading-tight text-slate-500">AI Gateway Admin</span>
          </span>
        </div>

        <div className="border-t border-slate-800 px-4 py-3">
          <CompanySelect company={company} companies={companies} select={select} />
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV.map((group, i) => (
            <div key={group.section} className={i === 0 ? "" : "mt-6 border-t border-slate-800/60 pt-4"}>
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {group.section}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    aria-current={route === item.id ? "page" : undefined}
                    className={cx(
                      "relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      route === item.id
                        ? "bg-indigo-500/15 text-indigo-300"
                        : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/70"
                    )}
                  >
                    {route === item.id && (
                      <span aria-hidden="true" className="absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-indigo-400" />
                    )}
                    {item.icon}
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-800 px-4 pt-4 pb-3">
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
          <div className="my-3 border-t border-slate-800/80" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="Admin menu"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-slate-800/70 data-[state=open]:bg-slate-800/70"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-semibold text-indigo-300">
                  {(username || "A").charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium text-slate-200">{username || "Admin"}</span>
                  <span className="block truncate text-[11px] text-slate-500">Administrator</span>
                </span>
                <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={8} className="w-52">
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  // Docs open in a new tab; auth rides on the path-scoped
                  // pc_admin_token cookie (set at login, see web/src/auth.js).
                  window.open("/api-docs", "_blank", "noopener,noreferrer");
                }}
              >
                <svg aria-hidden="true" className="h-4 w-4 text-slate-500 group-hover:text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                API docs
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("logs")}>
                <svg aria-hidden="true" className="h-4 w-4 text-slate-500 group-hover:text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M8 13h8" />
                  <path d="M8 17h8" />
                </svg>
                All logs
              </DropdownMenuItem>
              <div className="my-1 h-px bg-slate-800" />
              <DropdownMenuItem onSelect={logout} className="text-rose-400 focus:bg-rose-500/15 focus:text-rose-300">
                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main id="main" className="ml-60 flex-1">
        <header className="flex items-end justify-between gap-4 px-8 pt-6 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-50">{PAGE_META[route]?.title || "Dashboard"}</h1>
            <p className="text-sm text-slate-400 mt-1">{PAGE_META[route]?.subtitle || ""}</p>
          </div>
          <div className="flex items-center gap-2">
            {headerActions}
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
        </header>
        <div className="px-8 pb-8">{children}</div>
      </main>
    </div>
    </HeaderActionsCtx.Provider>
  );
}

function IconDashboard() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconBuilding() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </svg>
  );
}

function IconCloud() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}
