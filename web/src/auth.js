// Admin session token storage (module-level, localStorage-backed).
const TOKEN_KEY = "pc_admin_token";

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
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* noop */
  }
}

// Called when the API rejects an admin request with 401 (expired/revoked session).
// Flips the portal back to the login page via a window event.
export function onUnauthorized() {
  clearToken();
  window.dispatchEvent(new CustomEvent("admin-unauthorized"));
}
