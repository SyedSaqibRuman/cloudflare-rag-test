import { buildResponses } from "./prompts.js";
import { getConfig } from "../config/index.js";

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
 * Parse a company's BLOCKED_TOPICS config into substring regexes.
 * Best-effort — missing config or unknown companies yield nothing.
 */
function companyBlockedPatterns(companyName) {
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
const BLOCKED_PATTERNS = [
  /write.*poem/i, /tell.*joke/i, /write.*story/i, /generate.*code/i,
  /\bmovie\b/i, /\bsong\b/i, /\brecipe\b/i,
  /^(test|testing|ping|hello world|dummy|sample|asdf|qwerty|foo|bar)$/i,
  // Off-topic: code / programming requests (keep the assistant focused on
  // certification topics, even when phrased as a "study" or "example" ask)
  /write.*(code|program|script|function|class)/i,
  /\b(create|build|make|generate)\b.*\b(code|program|script|function|class|app|application|website|game|software|calculator)\b/i,
  /^(basic|simple|small|hello world)\s+.*\b(program|code|script)\b/i,
  /\b(how do i|how to)\s+(write|create|build|make|code)\b.*\b(code|program|script|function|class|app|website|game)\b/i,
  /\bprogramming\s+(help|tutorial|example|lesson|question)\b/i,
];

const CONTACT_PATTERNS = [
  /\b(contact|call me|call us|reach out|reach us)\b/i,
  /\b(talk|speak|connect)\s+(to|with)\s+(an?\s+)?(expert|consultant|team|agent|person|human)\b/i,
  /\b(get|request|need)\s+(a\s+)?(quote|quotation|callback|consultation)\b/i,
  /\b(pricing inquiry|request pricing|pricing details)\b/i,
  /\b(phone number|mobile number|email address|whatsapp number)\b/i,
  /\b(cost|costs|price|prices|pricing|fee|fees|charge|charges|how much|expense|expenses|affordable|cheap|rate|rates)\b/i,
  /\b(ceo|cto|coo|founder|owner|director|chairman|who (is|runs|owns|founded|leads))\b/i,
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
export const isBusinessQuery = (q, companyName = null) => {
  if (BLOCKED_PATTERNS.some((p) => p.test(q))) return false;
  return !companyBlockedPatterns(companyName).some((p) => p.test(q));
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
export function checkFastPath(question, companyName, assistantName = null) {
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
  if (!isBusinessQuery(question, companyName)) return R.blocked;
  if (isContactQuery(question)) return R.contact;
  if (isDiscoveryQuery(question)) return R.discovery;
  if (isOfficeQuery(question)) return R.office;
  if (isHelpQuery(question)) return R.help;
  if (isVagueQuery(question)) return R.vague;

  return null;
}
