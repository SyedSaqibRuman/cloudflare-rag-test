import { buildResponses } from "./prompts.js";
import { getConfig } from "../config/index.js";
import { resolveBlockedPatterns } from "../shared/blocked-patterns.js";

/** Escape a string so it can be used inside a RegExp as a literal substring. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a newline-separated blocked-topics string ("topic A\ntopic B") into
 * case-insensitive substring regexes. Unparseable lines are skipped.
 */
function parseBlockedTopics(raw) {
  if (!raw || typeof raw !== "string") return [];
  const regexes = [];
  for (const line of raw.split("\n")) {
    const topic = line.trim();
    if (!topic) continue;
    try {
      regexes.push(new RegExp(escapeRegExp(topic), "i"));
    } catch {
      /* skip unparseable line */
    }
  }
  return regexes;
}

/**
 * True when the question contains any topic from a blocked-topics string.
 * Shared by the company config check and the per-assistant guardrail check
 * (an assistant's BLOCKED_TOPICS adds to — never replaces — company patterns).
 */
export const matchesBlockedTopics = (q, blockedTopics) =>
  parseBlockedTopics(blockedTopics).some((p) => p.test(q));

/**
 * The company's BLOCKED_TOPICS substring vetoes — always apply on top of
 * whichever blocked-pattern tier resolved (they are plain keywords, not
 * replaceable policy).
 */
function companyBlockedTopics(companyName) {
  if (!companyName) return [];
  try {
    return parseBlockedTopics(getConfig(companyName)?.BLOCKED_TOPICS);
  } catch {
    return [];
  }
}

// --------------------------
// REGEX PATTERNS
// --------------------------

// Strips greeting + intro phrases so isVagueQuery sees clean remainder
const GREETING_PREFIX_REGEX =
  /^(?:(?:hi|hello|hey|hola|namaste|good\s+(?:morning|evening|afternoon))[,\s]*)?(?:it'?s\s+me|this\s+is|my\s+name\s+is|i(?:'m|m|\s+am))[,\s]*/i;

// Matches pure intro with no topic intent — greeting optional
const NAME_GREETING_REGEX =
  /^(?:(?:hi|hello|hey|hola|namaste|good\s+(?:morning|evening|afternoon))[,\s]+)?(?:i(?:'m|m|\s+am)|it'?s\s+me|this\s+is|my\s+name\s+is)[,\s]+([a-zA-Z]+)\s*$/i;

// Clear intent signals — bypass vague detection
const QUESTION_WORDS_REGEX =
  /\b(what|how|why|when|where|who|which|is|are|can|do|does|tell me|explain|define|list|difference|compare|help)\b/i;

// Plain greeting with nothing else — respond warmly, skip RAG
const PLAIN_GREETING_REGEX =
  /^(?:hi|hello|hey|hola|namaste|good\s+(?:morning|evening|afternoon))[!,.\s]*$/i;

// --------------------------
// INTENT PATTERNS
// --------------------------
// The blocked-pattern set is CONFIGURABLE, not hardcoded: it resolves per ask
// through shared/blocked-patterns.js — assistant.blocked_patterns > company
// BLOCKED_PATTERNS > BUILT_IN_BLOCKED_PATTERN_LINES (the former hardcoded
// BLOCKED_PATTERNS array, now just the fallback tier). BLOCKED_TOPICS below
// keeps its old role: plain substring vetoes that ALWAYS apply on top of
// whichever pattern tier resolved.
// Test-string gate (test/asdf/foo…) is infrastructure hygiene, not topic
// policy: it stays ANCHORED full-match and always applies regardless of tier.
const TEST_STRING_REGEX = /^(test|testing|ping|hello world|dummy|sample|asdf|qwerty|foo|bar)$/i;

const CONTACT_PATTERNS = [
  /\b(contact|call me|call us|reach out|reach us)\b/i,
  /\b(talk|speak|connect)\s+(to|with)\s+(an?\s+)?(expert|consultant|team|agent|person|human)\b/i,
  /\b(get|request|need)\s+(a\s+)?(quote|quotation|callback|consultation)\b/i,
  /\b(pricing inquiry|request pricing|pricing details)\b/i,
  /\b(phone number|mobile number|email address|whatsapp number)\b/i,
  /\b(cost|costs|price|prices|pricing|fee|fees|charge|charges|how much|expense|expenses|affordable|cheap|rate|rates)\b/i,
  /\b(ceo|cto|coo|founder|owner|director|chairman)\b/i,
  // "who runs/owns/founded/leads …" is always contact-ish, but a bare "who is …"
  // is usually a CONTENT question ("who is the author of this book") — require
  // a person-role word after "who is" instead of matching every "who is" query.
  /\bwho\s+(runs|owns|founded|leads)\b/i,
  /\bwho\s+is\s+(the\s+)?(ceo|cto|coo|founder|owner|director|chairman|consultant|expert|agent|person\s+in\s+charge)\b/i,
];

const IDENTITY_PATTERNS = [
  /who are you/i, /are you (an?\s+)?(ai|bot|robot|human|assistant)/i,
  /what is your name/i, /who am i talking to/i, /are you real/i,
];

const DISCOVERY_PATTERNS = [
  /\b(how\s+(do\s+i|to|can\s+i|can\s+we)\s+(get|become|obtain|apply\s+for|start)\s+(certified|certification|iso|ce\s+mark|halal))\b/i,
  /\b(get(ting)?\s+certified|obtain\s+certification|apply\s+for\s+certification|start\s+(the\s+)?certification)\b/i,
  /\b(want\s+to\s+(get|be|become)\s+certified)\b/i,
];

const OFFICE_PATTERNS = [
  /\b(where|location|office|offices|branch|branches|address|headquarter|hq|based)\b/i,
];

const HELP_PATTERNS = [
  /^(i need help|need help|help me|i want help|can you help|please help)\b/i,
];

// --------------------------
// INTENT DETECTION
// --------------------------
export const isOfficeQuery = (q) => OFFICE_PATTERNS.some((p) => p.test(q));
export const isHelpQuery = (q) => HELP_PATTERNS.some((p) => p.test(q));
export const isIdentityQuery = (q) => IDENTITY_PATTERNS.some((p) => p.test(q));
export const isContactQuery = (q) => CONTACT_PATTERNS.some((p) => p.test(q));
export const isBusinessQuery = (q, companyName = null, patterns = null) => {
  if (TEST_STRING_REGEX.test(q.trim())) return false;
  // Default tier when the caller didn't resolve one: company BLOCKED_PATTERNS
  // (configurable) else the built-ins — shared/blocked-patterns.js owns the
  // tiering. Best-effort: unknown companies fall through to built-ins without
  // throwing (getConfig throws COMPANY_NOT_FOUND for unknown names).
  let companyPatterns = null;
  if (companyName && !patterns) {
    try {
      companyPatterns = getConfig(companyName)?.BLOCKED_PATTERNS ?? null;
    } catch {
      companyPatterns = null;
    }
  }
  const effective = patterns ?? resolveBlockedPatterns(null, companyPatterns);
  if (effective.some((p) => p.test(q))) return false;
  return !companyBlockedTopics(companyName).some((p) => p.test(q));
};
export const isDiscoveryQuery = (q) => DISCOVERY_PATTERNS.some((p) => p.test(q));

// Strips greeting/intro filler, then checks if remainder is too short with no intent words.
// Non-Latin scripts bypass entirely — QUESTION_WORDS_REGEX is English-only.
export function isVagueQuery(question) {
  const stripped = question.replace(GREETING_PREFIX_REGEX, "").trim();
  if (!stripped) return false;
  // Intentional ASCII-range check (non-Latin scripts bypass).
  if (/[^\u0000-\u007F]/.test(stripped)) return false;
  return stripped.length <= 30 && !QUESTION_WORDS_REGEX.test(stripped);
}

// --------------------------
// FAST PATH CHECK
// --------------------------
export function checkFastPath(question, companyName, assistantName = null, assistantOverrides = null) {
  const R = buildResponses(companyName, assistantName);
  if (!question || question.length <= 1) return R.invalid;
  if (PLAIN_GREETING_REGEX.test(question)) return R.greeting;

  const nameMatch = question.match(NAME_GREETING_REGEX);
  if (nameMatch) {
    const name =
      nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
    return `Hi ${name}, how can I help you today?`;
  }

  if (isIdentityQuery(question)) return R.identity;
  // Effective blocked-pattern tier: assistant.blockedPatterns > company
  // BLOCKED_PATTERNS > built-ins (shared/blocked-patterns.js owns the layering);
  // isBusinessQuery also enforces the always-on test-string gate and the
  // company's BLOCKED_TOPICS substring vetoes on top of the tier.
  let companyPatterns = null;
  if (companyName) {
    try {
      companyPatterns = getConfig(companyName)?.BLOCKED_PATTERNS ?? null;
    } catch {
      companyPatterns = null;
    }
  }
  const patterns = resolveBlockedPatterns(assistantOverrides?.blockedPatterns ?? null, companyPatterns);
  if (!isBusinessQuery(question, companyName, patterns)) return R.blocked;
  if (isContactQuery(question)) return R.contact;
  if (isDiscoveryQuery(question)) return R.discovery;
  if (isOfficeQuery(question)) return R.office;
  if (isHelpQuery(question)) return R.help;
  if (isVagueQuery(question)) return R.vague;

  return null;
}
