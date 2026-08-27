import { useRef, useState } from "react";
import { useAuth } from "../auth.jsx";
import { Button, Spinner, Input } from "../components/ui";

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const usernameRef = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError("Enter both a username and a password.");
      usernameRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-indigo-500 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>
      <main id="main" className="w-full max-w-sm">
        <form
          onSubmit={submit}
          noValidate
          className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-xl"
        >
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500 text-lg font-bold text-white">
              PC
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-50" translate="no">
                PopularCert Admin
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Sign in to manage tenants, configuration, and pipelines
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300"
            >
              {error}
            </div>
          )}

          <div>
            <Input
              label="Username"
              type="text"
              name="username"
              autoComplete="username"
              spellCheck={false}
              autoFocus
              ref={usernameRef}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. admin"
            />
          </div>

          <div className="mt-4">
            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5">Password</span>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 pr-12 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-1 top-0 flex h-full w-11 items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  {showPassword ? (
                    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </label>
          </div>

          <Button type="submit" disabled={busy} className="mt-6 w-full min-h-11">
            {busy ? <Spinner className="h-4 w-4" /> : null}
            {busy ? "Signing in…" : "Sign In"}
          </Button>

          <p className="mt-4 text-center text-xs text-slate-500">
            Credentials come from <code className="font-mono" translate="no">ADMIN_USERNAME</code> and{" "}
            <code className="font-mono" translate="no">ADMIN_PASSWORD</code> in{" "}
            <code className="font-mono" translate="no">.env</code>.
          </p>
        </form>
      </main>
    </div>
  );
}
