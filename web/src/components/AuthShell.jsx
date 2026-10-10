// --------------------------
// AUTH SHELL — full-screen layout for the sign-in surface.
// Renders the page backdrop, the skip link, the PopularCert AI brand block
// (real gradient mark), and the `max-w-sm` card slot consumed by LoginPage.
// Visual language follows the Apple-design foundations: translucent material
// card (backdrop-blur + light-catching top edge), instant press feedback,
// tight tracking on large type, entrance motion guarded by reduced-motion.
// --------------------------

export default function AuthShell({ children }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-10">
      {/* Ambient depth: two soft color washes behind the card (compositor-only
          properties, static — no moving background). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[36rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -right-24 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl"
      />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-indigo-500 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>
      <main id="main" className="relative w-full max-w-sm">
        {children}
      </main>
    </div>
  );
}

/**
 * The portal's logo mark — an inline reproduction of the favicon (rounded
 * square, indigo→violet gradient, "P"). Inline SVG so it renders crisply at
 * any size and needs no network round-trip on the auth screen.
 */
export function LogoMark({ className = "h-14 w-14" }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="PopularCert AI logo">
      <defs>
        <linearGradient id="pc-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#pc-logo-g)" />
      <text
        x="16"
        y="22"
        fontFamily="system-ui,-apple-system,sans-serif"
        fontSize="18"
        fontWeight="700"
        fill="white"
        textAnchor="middle"
      >
        P
      </text>
    </svg>
  );
}

/** Brand block shown above the card: mark, wordmark, tagline. */
export function AuthBrandBlock() {
  return (
    <div className="mb-6 flex flex-col items-center gap-3 text-center">
      <div className="auth-enter" style={{ animationDelay: "0ms" }}>
        <LogoMark className="h-14 w-14 drop-shadow-[0_8px_24px_rgba(99,102,241,0.45)]" />
      </div>
      <h1
        className="auth-enter text-xl font-bold tracking-tight text-slate-50"
        style={{ animationDelay: "60ms" }}
        translate="no"
      >
        PopularCert AI
      </h1>
      <p
        className="auth-enter mt-1 text-sm leading-relaxed text-slate-400"
        style={{ animationDelay: "120ms" }}
      >
        Build AI assistants that answer questions using your content
      </p>
    </div>
  );
}
