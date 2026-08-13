// --------------------------
// LIVE PROBES (verify endpoint)
// Add a probe per provider_key to get connectivity checks beyond format
// validation. Probes receive the decrypted credential fields and must return
// { ok, latencyMs?, error? }.
// --------------------------
export const PROBES = {
  async cloudflare(fields) {
    const token = fields.api_token || fields.api_key;
    if (!token) {
      return { ok: false, error: "Cloudflare API token missing." };
    }
    const start = Date.now();
    try {
      const res = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok || body.success !== true) {
        return { ok: false, error: body.errors?.[0]?.message || `Cloudflare returned HTTP ${res.status}.` };
      }
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: `Network error: ${err.message}` };
    }
  },
};
