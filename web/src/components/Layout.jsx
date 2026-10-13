// --------------------------
// LAYOUT SHELL (Clean Architecture: shell composes nav constants + icons)
// Sidebar, header, theme + health state, and the HeaderActions context.
// --------------------------
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { cx } from "../util";
import { health as fetchHealth } from "../api";
import { useCompanies } from "../context";
import { useAuth } from "../auth.jsx";
import { getSessionRemaining } from "../auth.js";
import ThemeToggle from "./theme-toggle";
import CompanySelect from "./company-select";
import { PageHelpButton } from "./PageHelp";
import { Popover, PopoverTrigger, PopoverContent, PopoverItem, PopoverSeparator } from "./ui";
import { NAV, PAGE_META } from "./layout/nav.js";
import { NAV_ICONS } from "./layout/icons.jsx";
import KeyboardShortcuts from "./KeyboardShortcuts";
import SetupCheckpoints from "./SetupCheckpoints";

const HeaderActionsCtx = createContext(null);

// ------------------------------------------------------------------
// Session timeout badge — shows remaining session time, warns at <5 min
// ------------------------------------------------------------------
function SessionTimeoutBadge() {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    const tick = () => setRemaining(getSessionRemaining());
    tick();
    const id = setInterval(tick, 30000); // update every 30s
    return () => clearInterval(id);
  }, []);

  if (remaining === null) return null; // no JWT expiry available

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const isLow = remaining < 300; // <5 min
  const isExpired = remaining === 0;

  if (isExpired) return null; // will redirect to login

  return (
    <span
      className={cx(
        "hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        isLow
          ? "bg-amber-500/15 text-amber-400 animate-pulse"
          : "bg-slate-800/60 text-slate-400"
      )}
      title={`Session expires in ${mins}m ${String(secs).padStart(2, "0")}s`}
    >
      <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      {mins}:{String(secs).padStart(2, "0")}
    </span>
  );
}

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

// ------------------------------------------------------------------
// LazyUserMenu — CSS Popover-based user menu (zero dependencies).
// ------------------------------------------------------------------
function LazyUserMenu({ username, isCollapsed, navigate, logout }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={typeof username === "string" ? username : username?.name || username?.sub || "Admin"}
          className={cx(
            "flex items-center rounded-lg transition-colors hover:bg-slate-800/70",
            isCollapsed ? "mx-auto justify-center p-1" : "w-full gap-3 px-3 py-2 text-sm"
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-base font-semibold text-indigo-300">
            {(typeof username === "string" ? username : username?.name || username?.sub || "A").charAt(0).toUpperCase()}
          </span>
          {!isCollapsed && (
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-medium text-slate-200">{typeof username === "string" ? username : username?.name || username?.sub || "Admin"}</span>
              <span className="block truncate text-[11px] text-slate-500">Administrator</span>
            </span>
          )}
          {!isCollapsed && (
            <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" sideOffset={8}>
        <PopoverItem
          onClick={() => window.open("/api-docs", "_blank", "noopener,noreferrer")}
        >
          <svg aria-hidden="true" className="h-4 w-4 text-slate-500 group-hover:text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          API docs
        </PopoverItem>
        <PopoverItem onClick={() => navigate("logs")}>
          <svg aria-hidden="true" className="h-4 w-4 text-slate-500 group-hover:text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M8 13h8" />
            <path d="M8 17h8" />
          </svg>
          All logs
        </PopoverItem>
        <PopoverSeparator />
        <PopoverItem onClick={logout} className="text-rose-400 focus:bg-rose-500/15 focus:text-rose-300">
          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign out
        </PopoverItem>
      </PopoverContent>
    </Popover>
  );
}

// ------------------------------------------------------------------
// Clerk component mode → <UserButton /> (profile + sign-out, Clerk-owned
// session). Legacy env login → the CSS Popover user menu.
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// User menu — CSS Popover (profile, API docs, logs, sign-out). Login is a
// plain API call; there is no embedded third-party auth widget in the shell.
// ------------------------------------------------------------------
function UserMenuOrLegacy({ username, isCollapsed, navigate, logout }) {
  return <LazyUserMenu username={username} isCollapsed={isCollapsed} navigate={navigate} logout={logout} />;
}

// ------------------------------------------------------------------
// SVG icon for the hamburger menu button (mobile only)
// ------------------------------------------------------------------
function HamburgerIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
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
  // Mobile drawer state (below md breakpoint)
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef(null);

  // Close mobile drawer on Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  // Close mobile drawer when route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [route]);

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
        if (mounted) setStatus(h?.status === "ok" || h?.status === "healthy" ? "online" : "offline");
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

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // ------------------------------------------------------------------
  // Shared sidebar content — rendered in both the desktop sidebar and the
  // mobile drawer. `isCollapsed` controls icon-only mode (desktop only);
  // `onNavClick` lets the mobile drawer close itself after navigation.
  // ------------------------------------------------------------------
  const renderSidebarContent = (isCollapsed, onNavClick) => (
    <>
      {/* Header / collapse / close */}
      <div className="shrink-0 border-b border-slate-800">
        <div className={cx("flex items-center justify-between", isCollapsed ? "px-2 pb-2 pt-2" : "px-3 pb-1 pt-2")}>
          {!isCollapsed && (
            <span className="px-1 text-[15px] font-semibold uppercase tracking-[0.08em] text-slate-400">Workspace</span>
          )}
          {/* Desktop: collapse toggle. Mobile: close (X) button. */}
          <button
            type="button"
            onClick={() => {
              if (onNavClick) {
                onNavClick(); // mobile — close drawer
              } else {
                setCollapsed((c) => !c); // desktop — toggle collapse
              }
            }}
            title={onNavClick ? "Close menu" : isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={onNavClick ? "Close menu" : isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cx(
              "rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-slate-100",
              isCollapsed && !onNavClick ? "mx-auto" : ""
            )}
          >
            {onNavClick ? (
              // Mobile: X close icon
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            ) : isCollapsed ? (
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
        {!isCollapsed && (
          <div className="px-3 pb-3">
            <CompanySelect company={company} companies={companies} select={select} onCreate={() => navigate("companies")} />
          </div>
        )}
        {isCollapsed && company && (
          <div className="px-2 pb-3">
            <button
              type="button"
              title={`Workspace: ${company.company_name || company.company_key}${company.status ? ` (${company.status})` : ""}`}
              aria-label={`Workspace: ${company.company_name || company.company_key}`}
              onClick={() => navigate("companies")}
              className="flex w-full items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-slate-300 transition-colors hover:bg-slate-800/70 hover:text-slate-100"
            >
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Nav links */}
      <nav className={cx("flex-1 overflow-y-auto py-4", isCollapsed ? "px-2" : "px-3")}>
        {NAV.map((group, i) => (
          <div
            key={group.section}
            className={cx(
              i === 0 ? "" : isCollapsed ? "mt-3 border-t border-slate-800/60 pt-3" : "mt-6"
            )}
          >
            {!isCollapsed && (
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
                    title={isCollapsed ? (item.tip || item.label) : item.tip || undefined}
                    aria-current={route === item.id ? "page" : undefined}
                    onClick={onNavClick}
                    className={cx(
                      "relative flex items-center rounded-lg font-medium transition-colors",
                      isCollapsed ? "w-full justify-center py-2" : "w-full gap-3 px-3 py-2 text-sm",
                      route === item.id
                        ? "bg-indigo-500/15 font-semibold text-indigo-200"
                        : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/70"
                    )}
                  >
                    {route === item.id && (
                      <span aria-hidden="true" className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-indigo-400" />
                    )}
                    <Icon />
                    {!isCollapsed && item.label}
                  </a>
                );
                })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: system status + user menu */}
      <div className={cx("shrink-0 space-y-3 border-t border-slate-800 pt-3 pb-3", isCollapsed ? "px-2" : "px-4")}>
        <div className={cx("rounded-lg bg-slate-800/40 py-2", isCollapsed ? "flex justify-center" : "px-2.5")}>
          {isCollapsed ? (
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
        <UserMenuOrLegacy
          username={username}
          isCollapsed={isCollapsed}
          navigate={navigate}
          logout={logout}
        />
      </div>
    </>
  );

  return (
    <HeaderActionsCtx.Provider value={setHeaderActions}>
    <KeyboardShortcuts navigate={navigate} />
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-indigo-500 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>

      {/* Mobile backdrop overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      {/* Desktop sidebar — always visible on md+, collapsed toggle */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-30 hidden md:flex flex-col border-r border-slate-800 bg-slate-900/90 backdrop-blur",
          collapsed ? "w-16" : "w-60",
          "transition-[width] duration-200"
        )}
      >
        {renderSidebarContent(collapsed, null)}
      </aside>

      {/* Mobile sidebar drawer — slides in from left on small viewports */}
      <aside
        ref={sidebarRef}
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-800 bg-slate-900 md:hidden",
          "transition-transform duration-200 ease-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {renderSidebarContent(false, closeMobile)}
      </aside>

      <main id="main" className={cx("min-w-0 flex-1 transition-[margin] duration-200", collapsed ? "md:ml-16" : "md:ml-60")}>
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-4 pt-4 pb-3 md:px-8 md:pt-6 md:pb-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* Hamburger menu — visible only below md breakpoint */}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="inline-flex items-center justify-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-slate-100 md:hidden"
              aria-label="Open navigation menu"
            >
              <HamburgerIcon />
            </button>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-50 md:text-2xl">{PAGE_META[route]?.title || "Dashboard"}</h1>
              <p className="text-xs text-slate-400 mt-0.5 md:text-sm md:mt-1">{PAGE_META[route]?.subtitle || ""}</p>
            </div>
          </div>
          {/* Header actions. The outer group never wraps — the theme toggle
              stays pinned to the first line on every page; page actions that
              don't fit wrap right-aligned inside the inner group instead of
              orphaning the toggle onto its own line (mobile audit). */}
          <div className="flex flex-nowrap items-start gap-2 sm:items-center">
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {headerActions}
            <PageHelpButton pageId={route} />
            {/* API docs — opens the Swagger UI in a new tab */}
            <a
              href="/api-docs"
              target="_blank"
              rel="noopener noreferrer"
              title="API documentation (Swagger UI)"
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              <span className="hidden md:inline">API Docs</span>
            </a>
            {/* Search button — shows keyboard shortcut hint */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
              className="hidden items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300 sm:flex"
              title="Search (Ctrl+K)"
            >
              <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <span className="hidden lg:inline">Search</span>
              <kbd className="hidden lg:inline rounded border border-slate-700 bg-slate-800 px-1 py-0.5 text-[10px] text-slate-500">⌘K</kbd>
            </button>
            <SessionTimeoutBadge />
            </div>
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
        </header>
        <div className="px-4 pb-8 md:px-8">
          {/* Horizontal setup checkpoints — shown only while the selected
              company's configuration is incomplete (sequential stepper) */}
          <SetupCheckpoints navigate={navigate} />
          {children}
        </div>
      </main>
    </div>
    </HeaderActionsCtx.Provider>
  );
}
