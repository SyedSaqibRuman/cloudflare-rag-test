// --------------------------
// SHARED — blocked-pattern parsing & resolution.
// Single source of truth for the intent fast-path's configurable blocked
// patterns, used by BOTH the API server (config/validation.js compile check +
// query/intent.js runtime matching) and the admin portal (Assistants page
// helper text). Replaces the hardcoded BLOCKED_PATTERNS array that used to
// veto "recipe"/"movie"/"poem" questions globally — the pattern set is now
// data, resolved per ask:
//   1. assistant.blocked_patterns (assistant-owned topic policy)
//   2. company BLOCKED_PATTERNS config key
//   3. built-in defaults (BUILT_IN_BLOCKED_PATTERNS)
// Line format: a literal substring ("crypto" — regex-escaped, case-insensitive)
// or a slash-delimited JavaScript regex ("/write\s+a\s+poem/i" — flags
// optional; "i" assumed, only i/u accepted for safety).
// Pure ESM, zero deps — node --test and the portal can import it directly.
// --------------------------

/**
 * The built-in pattern set (formerly the hardcoded BLOCKED_PATTERNS in
 * query/intent.js). Source lines, not RegExp objects, so every tier flows
 * through the same parser. Test-string gates (test/asdf/foo…) stay here —
 * they are infrastructure hygiene, not topic policy.
 */
export const BUILT_IN_BLOCKED_PATTERN_LINES = [
  "/write.*poem/i",
  "/tell.*joke/i",
  "/write.*story/i",
  "/generate.*code/i",
  "/\\bmovie\\b/i",
  "/\\bsong\\b/i",
  "/\\brecipe\\b/i",
  "/^(test|testing|ping|hello world|dummy|sample|asdf|qwerty|foo|bar)$/i",
  // Off-topic: code / programming requests.
  "/write.*(code|program|script|function|class)/i",
  "/\\b(create|build|make|generate)\\b.*\\b(code|program|script|function|class|app|application|website|game|software|calculator)\\b/i",
  "/^(basic|simple|small|hello world)\\s+.*\\b(program|code|script)\\b/i",
  "/\\b(how do i|how to)\\s+(write|create|build|make|code)\\b.*\\b(code|program|script|function|class|app|website|game)\\b/i",
  "/\\bprogramming\\s+(help|tutorial|example|lesson|question)\\b/i",
];

/** Escape a string so it can be used inside a RegExp as a literal substring. */
export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse one pattern line into a RegExp.
 * - "/…/flags" → the raw regex (flags: optional; "i" assumed; only i/u allowed)
 * - anything else → the escaped literal, case-insensitive
 * @returns {RegExp|null} null when the line is empty or the regex is invalid
 */
export function parsePatternLine(line) {
  const raw = String(line ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^\/(.*)\/([a-z]*)$/s);
  if (m) {
    const [, body, flags] = m;
    const safe = (flags || "i").split("").filter((f) => f === "i" || f === "u");
    try {
      return new RegExp(body, [...new Set(safe)].join("") || undefined);
    } catch {
      return null;
    }
  }
  try {
    return new RegExp(escapeRegExp(raw), "i");
  } catch {
    return null;
  }
}

/**
 * Parse a newline-separated pattern list into regexes. Invalid/empty lines
 * are skipped (best-effort, same contract as the old parseBlockedTopics).
 * @returns {RegExp[]}
 */
export function parseBlockedPatterns(raw) {
  if (raw == null) return [];
  const lines = Array.isArray(raw) ? raw : String(raw).split("\n");
  const out = [];
  for (const line of lines) {
    const re = parsePatternLine(line);
    if (re) out.push(re);
  }
  return out;
}

/**
 * Count how many lines of a pattern list would compile — used by validation
 * to reject whole lists that contain an invalid line (fail at save time).
 * @returns {{ total: number, valid: number, firstInvalid: string|null }}
 */
export function inspectBlockedPatterns(raw) {
  if (raw == null) return { total: 0, valid: 0, firstInvalid: null };
  const lines = (Array.isArray(raw) ? raw : String(raw).split("\n")).map((l) => String(l).trim()).filter(Boolean);
  let valid = 0;
  let firstInvalid = null;
  for (const line of lines) {
    if (parsePatternLine(line)) valid += 1;
    else if (firstInvalid == null) firstInvalid = line;
  }
  return { total: lines.length, valid, firstInvalid };
}

/**
 * Resolve the effective blocked-pattern regexes for one ask.
 * First non-null tier wins (the tier fully replaces the built-ins — an
 * assistant that configures its own set opts out of the certification-vertical
 * defaults entirely). Company BLOCKED_TOPICS substring vetoes are separate and
 * always apply on top (query/intent.js).
 * @param {string|null} assistantPatterns newline-separated assistant patterns
 * @param {string|null} companyPatterns  newline-separated company BLOCKED_PATTERNS
 * @param {string[]} [builtIns] source lines for the built-in tier
 * @returns {RegExp[]}
 */
export function resolveBlockedPatterns(assistantPatterns, companyPatterns, builtIns = BUILT_IN_BLOCKED_PATTERN_LINES) {
  const source = assistantPatterns != null && String(assistantPatterns).trim()
    ? assistantPatterns
    : companyPatterns != null && String(companyPatterns).trim()
      ? companyPatterns
      : builtIns;
  return parseBlockedPatterns(source);
}
