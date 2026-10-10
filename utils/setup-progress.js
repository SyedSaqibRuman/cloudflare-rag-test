// --------------------------
// SETUP PROGRESS MARKERS
// Tiny file-based flags per company that record "this company has used X".
// Currently only the chat checkpoint: processed/chat-<company>.json is written
// once on the first successful /ask or /ask-stream answer (intent fast-paths
// count too — the user did exercise the chat). Read by
// GET /cloudflare/setup-status to complete the final checkpoint.
// --------------------------
import fs from "fs";

const CHAT_DIR = "./processed";

function chatMarkerPath(companyName) {
  return `${CHAT_DIR}/chat-${companyName}.json`;
}

/**
 * Record that this company completed a chat turn. Idempotent — the marker is
 * only written when absent, so the per-ask cost is one existsSync.
 * Fire-and-forget by design: failures never affect the ask response.
 * @param {string} companyName
 */
export function markCompanyChat(companyName) {
  try {
    if (!companyName || typeof companyName !== "string") return;
    const file = chatMarkerPath(companyName);
    if (fs.existsSync(file)) return;
    fs.mkdirSync(CHAT_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ chattedAt: new Date().toISOString() }, null, 2));
  } catch {
    // best-effort — never break an ask over a progress marker
  }
}

/**
 * Read the chat marker for a company.
 * @param {string} companyName
 * @returns {boolean} true when the company has completed at least one chat turn
 */
export function hasCompanyChatted(companyName) {
  try {
    return fs.existsSync(chatMarkerPath(companyName));
  } catch {
    return false;
  }
}
