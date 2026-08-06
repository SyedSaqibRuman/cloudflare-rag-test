import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { login as apiLogin } from "./api";
import { getToken, setToken, clearToken, refreshDocsCookie } from "./auth";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [username, setUsername] = useState(null);

  useEffect(() => {
    let mounted = true;

    const forceLogout = () => {
      clearToken();
      if (mounted) setAuthed(false);
    };
    window.addEventListener("admin-unauthorized", forceLogout);

    (async () => {
      // Fail closed: the portal shows admin pages only when the server
      // explicitly reports an authenticated session. 401 (expired/revoked),
      // a missing endpoint, a 5xx, or a network error all land on the login
      // page. The one exception is the server's deliberate "bypass" mode
      // (admin auth not configured), which returns authenticated:true.
      let authedNow = false;
      let name = null;
      try {
        const res = await fetch("/auth/me", {
          headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          authedNow = !!data.authenticated;
          name = data.username || null;
          if (authedNow) refreshDocsCookie();
        }
      } catch {
        authedNow = false;
      } finally {
        if (mounted) {
          setAuthed(authedNow);
          setUsername(name);
          setChecking(false);
        }
      }
    })();

    return () => {
      mounted = false;
      window.removeEventListener("admin-unauthorized", forceLogout);
    };
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await apiLogin(username, password);
    setToken(data.token);
    setAuthed(true);
    // The login response carries no username, so ask the session endpoint for
    // it (best-effort) — the profile menu displays it.
    try {
      const res = await fetch("/auth/me", {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      if (res.ok) {
        const me = await res.json();
        setUsername(me.username || null);
      }
    } catch {
      // non-fatal: profile falls back to "Admin"
    }
    return data;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setAuthed(false);
    setUsername(null);
  }, []);

  const value = useMemo(
    () => ({ checking, authed, username, login, logout }),
    [checking, authed, username, login, logout]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
