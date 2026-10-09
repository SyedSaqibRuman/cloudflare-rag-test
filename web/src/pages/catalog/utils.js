// --------------------------
// CATALOG — display helpers (relative time, error tags, key slugs, model
// gating). Pure JS (no JSX), so node --test can import it directly.
// --------------------------
import {
  ANTHROPIC_COMPATIBLE_PREFIX,
  MODEL_CAPABILITY_KEYS,
  OPENAI_COMPATIBLE_PREFIX,
} from "./constants.js";
// Relative (NOT the #shared alias): this module is imported by
// __tests__/serves-models.test.js under bare `node --test`, which cannot
// resolve Vite aliases (and rejects "../" escapes in "imports" targets).
import { diagnoseError } from "../../../../shared/error-tag.js";
import { parseUtcDate } from "../../util.js";

// Alias for the shared 9Router diagnosis tag (backend calls it diagnoseError;
// the portal calls it errorTag). Single source of truth: shared/error-tag.js.
export const errorTag = diagnoseError;

// Lowercase, alphanumerics + underscores — matches the backend providerKey
// validation (/^[a-z0-9_]+$/). Drives the compatible-provider auto-key and
// any other key generation.
export const providerSlug = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

// Model keys allow letters, digits, dots, underscores, hyphens and
// vendor-prefix characters @ / : (backend matches the config-layer contract,
// e.g. gpt-4o or @cf/baai/bge-base-en-v1.5). The auto-key keeps dots plus any
// @ / the name carries and uses hyphens for separators — "GPT-4o" → "gpt-4o",
// "Claude 3.5 Sonnet" → "claude-3.5-sonnet".
export const modelKeyFromName = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9@._/-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");

// ------------------------------------------------------------------
// Model-card gating (9Router): the "Available Models" card only makes sense
// for providers that actually serve models. A provider counts when it is an
// OpenAI/Anthropic-compatible endpoint (oc_/ac_ — the wizard seeds no
// capability rows, but they are model providers by definition) or declares a
// model-serving capability (chat, embeddings, image generation, TTS/STT,
// vision, rerank…). Capability keys come from the light list provider row
// (supported only) or the full registry detail (is_supported flag).
// ------------------------------------------------------------------
export function servesModels(providerKey, provider, detail) {
  if (String(providerKey || "").startsWith(OPENAI_COMPATIBLE_PREFIX)) return true;
  if (String(providerKey || "").startsWith(ANTHROPIC_COMPATIBLE_PREFIX)) return true;
  if ((provider?.capabilityKeys || []).some((k) => MODEL_CAPABILITY_KEYS.has(k))) return true;
  return Boolean(
    (detail?.capabilities || []).some((c) => c.is_supported && MODEL_CAPABILITY_KEYS.has(c.capability_key))
  );
}

// ------------------------------------------------------------------
// Environments-card gating: environments are company-scoped (every credential
// has an optional environment pin), so the card only belongs on a provider's
// detail page when the selected company actually has environments AND has at
// least one connection for this provider — otherwise it's identical noise on
// every page.
// ------------------------------------------------------------------
export function usesEnvironments(providerKey, companyKey, companyEnvs, creds) {
  if (!companyKey) return false;
  if (!Array.isArray(companyEnvs) || companyEnvs.length === 0) return false;
  return (creds || []).some((c) => c.provider_key === providerKey);
}

// ------------------------------------------------------------------
// Resources-card gating: the registry-style ResourcesCard provisions
// infrastructure from the provider's catalog resource templates
// (provider_resource_types). Providers without real resources (the vast
// majority) have nothing to provision — the card would render an empty modal —
// so it only shows when the full registry detail carries at least one template
// that isn't the 'none' sentinel the catalog seeds for "No Resources" rows.
// Cloudflare-family providers are excluded upstream (they get the live
// CloudflareResourcesCard instead).
// ------------------------------------------------------------------
export function hasResourceTemplates(detail) {
  return Boolean(
    (detail?.resourceTemplates || []).some((t) => t && t.resource_type && t.resource_type !== "none")
  );
}

// Relative time for the card error badge ("3m ago"), 9Router-style.
// parseUtcDate (web/src/util.js) treats naive DB datetimes as UTC — MySQL
// DATETIME strings carry no timezone marker and would otherwise parse as
// browser-local, skewing every relative time by the UTC offset.
export function timeAgo(v) {
  const d = parseUtcDate(v);
  if (!d) return null;
  const diff = Math.max(0, Date.now() - d.getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

// errorTag is imported from shared/error-tag.js (see the alias above) — the
// provider error → 9Router diagnosis tag used by the Test Results modal + card
// badges. Keep edits in shared/error-tag.js, not here.
