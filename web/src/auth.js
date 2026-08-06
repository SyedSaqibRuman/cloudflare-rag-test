// Admin session token storage (module-level, localStorage-backed).
const TOKEN_KEY = "pc_admin_token";
const DOCS_COOKIE = "pc_admin_token";

/**
 * Mirror the session token into a cookie scoped to /api-docs (SameSite=Lax,
 * never HttpOnly). A new-tab docs page can't set the Authorization header, and
 * its page + asset requests are gated by requireAdmin — the cookie is the only
 * way those requests can carry auth. Path-scoped so it is never sent anywhere
 * else on the origin.
 */
function setDocsCookie(token) {
  try {
    document.cookie = token
      ? `${DOCS_COOKIE}=${encodeURIComponent(token)}; path=/api-docs; SameSite=Lax`
      : `${DOCS_COOKIE}=; path=/api-docs; SameSite=Lax; Max-Age=0`;
  } catch {
    /* cookie unavailable — docs will require the header path only */
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — session lasts for the page lifetime only */
  }
  setDocsCookie(token);
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* noop */
  }
  setDocsCookie("");
}

/** Re-sync the docs cookie after a page load that restored a stored token. */
export function refreshDocsCookie() {
  setDocsCookie(getToken());
}

// Called when the API rejects an admin request with 401 (expired/revoked session).
// Flips the portal back to the login page via a window event.
export function onUnauthorized() {
  clearToken();
  window.dispatchEvent(new CustomEvent("admin-unauthorized"));
}
