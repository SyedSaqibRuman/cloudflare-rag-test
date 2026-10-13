// --------------------------
// MARKDOWN LINK SANITIZER — shared by every markdown renderer in the portal.
//
// React 19+ strips javascript: URLs from href, but React 18 (this portal) only
// WARNS and still renders the link, so both the dangerouslySetInnerHTML
// renderer (pages/KbDetail.jsx renderMarkdown) and the JSX <a href> renderer
// (components/Markdown.jsx) must filter schemes before use. KB content and
// LLM answers are untrusted input — a crafted "[click](javascript:…)" link
// must never survive as an anchor.
//
// Allowed: http:, https:, mailto:, plus site-relative URLs (paths, ./ ../,
// #anchors, protocol-relative //) which resolve in an http(s) context and
// cannot execute script. Anything carrying a different scheme (javascript:,
// data:, vbscript:, file:, …) is rejected; callers render it as inert text.
// --------------------------

const SAFE_PROTOCOL_RE = /^(?:https?:|mailto:)/i;

/** Control characters can smuggle schemes past naive checks ("jav\tascript:")
 *  because browsers strip them before URL parsing — reject up front. */
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

/**
 * Whether a markdown link target is safe to render as an href.
 * @param {string|null|undefined} url  Raw URL from the markdown source.
 * @returns {boolean}
 */
export function isSafeLinkUrl(url) {
  if (url == null) return false;
  const raw = String(url).trim();
  if (raw === "") return false;
  if (CONTROL_CHARS_RE.test(raw)) return false;
  // Site-relative shapes never carry an executable scheme.
  if (raw.startsWith("#") || raw.startsWith("/") || raw.startsWith("./") || raw.startsWith("../")) {
    return true;
  }
  // No colon anywhere → no scheme is possible; the string can only resolve as
  // a site-relative URL (inert by construction). Everything WITH a colon must
  // prove itself against the allowlist.
  if (!raw.includes(":")) return true;
  return SAFE_PROTOCOL_RE.test(raw);
}

/**
 * The href to render for a markdown link, or null when the target must be
 * downgraded to plain text (the link text still shows — nothing disappears).
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
export function safeLinkUrl(url) {
  return isSafeLinkUrl(url) ? String(url).trim() : null;
}
