// --------------------------
// LAYOUT SHELL (Clean Architecture: shell composes nav constants + icons)
// Sidebar, header, theme + health state, and the HeaderActions context.
// --------------------------
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
import { NAV, PAGE_META } from "./layout/nav.js";
import { NAV_ICONS } from "./layout/icons.jsx";

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

export default function Layout({ route, navigate, children }) {
  const { company, companies, select, refresh } = useCompanies();
  const { logout, username } = useAuth();
  const [status, setStatus] = useState("checking");
  const [headerActions, setHeaderActions] = useState(null);
  // Theme preference: "light" | "dark" | "system" (defaults to system so the
  // portal follows the OS until the admin picks an explicit theme).
  const [theme, setTheme] = useState(() => localStorage.getItem("pc_theme") || "system");
  const [osDark, setOsDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
  );
  // Sidebar collapse state (icon-only mode), persisted across reloads.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("pc_sidebar_collapsed") === "1");

  // The "Cloudflare" nav item is company-scoped: it only appears when the
  // selected company has Cloudflare API credentials (account id + token)
  // configured. Refresh the companies list periodically so the menu appears
  // shortly after credentials are saved on another page.
  useEffect(() => {
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);
  const selectedCompany = companies.find((c) => c.name === company);
  const showCloudflare = !!selectedCompany?.hasCloudflareApi;

  useEffect(() => {
    localStorage.setItem("pc_sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

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
      <aside className={`fixed inset-y-0 left-0 z-30 flex flex-col border-r border-slate-800 bg-slate-900/90 backdrop-blur transition-[width] duration-200 ${collapsed ? "w-16" : "w-60"}`}>
        <div className="shrink-0 border-b border-slate-800">
          <div className={`flex items-center justify-between ${collapsed ? "px-2 pb-2 pt-2" : "px-3 pb-1 pt-2"}`}>
            {!collapsed && (
              <span className="px-1 text-[15px] font-semibold uppercase tracking-[0.08em] text-slate-400">Workspace</span>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={`rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-slate-100 ${collapsed ? "mx-auto" : ""}`}
            >
              {collapsed ? (
                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M9 3v18" />
                  <path d="m14 9 3 3-3 3" />
                </svg>
              ) : (
                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M9 3v18" />
                  <path d="m16 15-3-3 3-3" />
                </svg>
              )}
            </button>
          </div>
          {!collapsed && (
            <div className="px-3 pb-3">
              <CompanySelect company={company} companies={companies} select={select} onCreate={() => navigate("companies")} />
            </div>
          )}
        </div>

        <nav className={`flex-1 overflow-y-auto py-4 ${collapsed ? "px-2" : "px-3"}`}>
          {NAV.map((group, i) => (
            <div
              key={group.section}
              className={cx(
                i === 0 ? "" : collapsed ? "mt-3 border-t border-slate-800/60 pt-3" : "mt-6"
              )}
            >
              {!collapsed && (
                <p className="px-3 pb-2 text-[15px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  {group.section}
                </p>
              )}
              <div className="space-y-1">
                {group.items
                  .filter((item) => item.id !== "cloudflare" || showCloudflare)
                  .map((item) => {
                    const Icon = NAV_ICONS[item.icon] || NAV_ICONS.dashboard;
                    return (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      title={collapsed ? item.label : undefined}
                      aria-current={route === item.id ? "page" : undefined}
                      className={cx(
                        "relative flex items-center rounded-lg font-medium transition-colors",
                        collapsed ? "w-full justify-center py-2" : "w-full gap-3 px-3 py-2 text-sm",
                        route === item.id
                          ? "bg-indigo-500/15 font-semibold text-indigo-200"
                          : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/70"
                      )}
                    >
                      {route === item.id && (
                        <span aria-hidden="true" className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-indigo-400" />
                      )}
                      <Icon />
                      {!collapsed && item.label}
                    </a>
                  );
                  })}
              </div>
            </div>
          ))}
        </nav>

        <div className={`shrink-0 space-y-3 border-t border-slate-800 pt-3 pb-3 ${collapsed ? "px-2" : "px-4"}`}>
          <div className={`rounded-lg bg-slate-800/40 py-2 ${collapsed ? "flex justify-center" : "px-2.5"}`}>
            {collapsed ? (
              <span className="flex items-center gap-1.5" title={`API ${status}`}>
                <span
                  className={cx(
                    "h-2 w-2 rounded-full",
                    status === "online" ? "bg-emerald-400" : status === "offline" ? "bg-rose-500" : "bg-amber-400"
                  )}
                />
              </span>
            ) : (
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">System</span>
                <span className="flex items-center gap-1.5" title={`API ${status}`}>
                  <span
                    className={cx(
                      "h-2 w-2 rounded-full",
                      status === "online" ? "bg-emerald-400" : status === "offline" ? "bg-rose-500" : "bg-amber-400"
                    )}
                  />
                  <span className="text-slate-300">{status === "online" ? "API Online" : status === "offline" ? "API Offline" : "Checking…"}</span>
                </span>
              </div>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={username || "Admin"}
                className={`flex items-center rounded-lg transition-colors hover:bg-slate-800/70 data-[state=open]:bg-slate-800/70 ${
                  collapsed ? "mx-auto justify-center p-1" : "w-full gap-3 px-3 py-2 text-sm"
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-base font-semibold text-indigo-300">
                  {(username || "A").charAt(0).toUpperCase()}
                </span>
                {!collapsed && (
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium text-slate-200">{username || "Admin"}</span>
                    <span className="block truncate text-[11px] text-slate-500">Administrator</span>
                  </span>
                )}
                {!collapsed && (
                  <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={8} className="w-60">
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

      <main id="main" className={`flex-1 transition-[margin] duration-200 ${collapsed ? "ml-16" : "ml-60"}`}>
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
