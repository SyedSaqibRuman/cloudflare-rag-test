// --------------------------
// KB WIZARD — 5-step create/edit knowledge base modal.
// Steps: Basic Info → Data Source → Storage & Search → Processing → Review.
// Replaced the former 3-tab modal with a linear wizard to match the design doc.
// --------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { createKb, updateKb, getKbOptions, discoverWebsite, api } from "../api";
import { decodeProbeVerdict } from "../probe-verdict.js";
import { evaluateDefaultBindings } from "#shared/default-bindings.js";
import { KB_DEFAULT_SOURCE_TYPE, isSourceTypeEnabled } from "#shared/catalog-enums.js";
import { Modal, Button, Input, Select, TextArea, Spinner, Toggle, ArrowLeftIcon, ArrowRightIcon } from "./ui";

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------
const STEPS = [
  { id: "basic", label: "Basic Info", icon: "📝" },
  { id: "source", label: "Data Source", icon: "📥" },
  { id: "storage", label: "Storage & Search", icon: "📦" },
  { id: "processing", label: "Processing", icon: "⚙️" },
  { id: "review", label: "Review", icon: "✅" },
];

// The FULL source-type vocabulary. Only the types still offered
// (shared/catalog-enums.js → KB_DISABLED_SOURCE_TYPES) are rendered as cards —
// "wordpress" and "custom" are withdrawn, so they never appear as a choice.
// The withdrawn entries are kept here because an EXISTING KB may still carry
// one, and the review step needs a label for it.
const SOURCE_TYPES = [
  { value: "wordpress", label: "WordPress", note: "REST API", icon: "🔧" },
  { value: "file", label: "File Upload", note: "Documents", icon: "📄" },
  { value: "url", label: "URL / Sitemap", note: "Web pages", icon: "🌐" },
  { value: "custom", label: "Custom REST API", note: "API-driven · JSON", icon: "⚙️" },
];

const OFFERED_SOURCE_TYPES = SOURCE_TYPES.filter((st) => isSourceTypeEnabled(st.value));

/** Human label for a source type (falls back to the raw value for unknown ones). */
function sourceTypeLabel(value) {
  return SOURCE_TYPES.find((st) => st.value === value)?.label || value;
}

const OPTION_DEFAULT = { value: "", label: "Company default (config)" };

const PAGINATION_OPTIONS = [
  { value: "page", label: "Page number (?page=N)" },
  { value: "totalPages", label: "Page number + total pages field" },
  { value: "cursor", label: "Cursor (next-cursor field)" },
  { value: "link", label: "Link header (rel=next)" },
  { value: "none", label: "None (single request)" },
];

const AUTH_TYPE_OPTIONS = [
  { value: "none", label: "None (public API)" },
  { value: "bearer", label: "Bearer token" },
  { value: "header", label: "Custom header" },
  { value: "basic", label: "Basic (username + password)" },
  { value: "query", label: "Query parameter" },
];

const CONTENT_FORMAT_OPTIONS = [
  { value: "html", label: "HTML" },
  { value: "text", label: "Plain text" },
];

/** Parse a source_config into the wizard's REST form fields. */
function parseRest(config) {
  const raw = config == null ? {} : (typeof config === "string" ? JSON.parse(config) : config);
  const r = raw.rest || {};
  return {
    endpoint: r.endpoint || "",
    itemsPath: r.itemsPath ?? "",
    pagination: r.pagination || "page",
    perPage: r.perPage ? String(r.perPage) : "",
    maxItems: r.maxItems ? String(r.maxItems) : "",
    totalPagesPath: r.totalPagesPath || "",
    cursorPath: r.cursorPath || "",
    authType: r.auth?.type || "none",
    authHeaderName: r.auth?.headerName || "x-api-key",
    authParamName: r.auth?.paramName || "api_key",
    authUsername: r.auth?.username || "",
    authPassword: r.auth?.password || "",
    authToken: r.auth?.token || "",
    contentFormat: r.contentFormat || "html",
    // Advanced keys the wizard has no fields for (mapping, headers, timeout,
    // items, custom pagination paths). Kept verbatim and re-applied on save
    // so an API-driven edit round-trip never silently drops them.
    advanced: r,
  };
}

/** Read the website URL out of a stored source_config (website-first). */
function parseWebsiteUrl(config) {
  const raw = config == null ? {} : (typeof config === "string" ? JSON.parse(config) : config);
  return raw.websiteUrl || "";
}

/**
 * Client-side pre-check for the website field. Mirrors the server's
 * `normalizeWebsiteUrl` so the user gets an inline hint instead of a 400 —
 * the server remains the authority.
 * @param {string} value
 * @returns {string} error message, or "" when valid
 */
function validateWebsiteUrl(value) {
  const raw = (value || "").trim();
  if (!raw) return "Enter the website address to ingest, e.g. https://example.com";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return "That doesn't look like a valid URL — include https://";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http and https websites are supported.";
  }
  if (!parsed.hostname) return "That URL is missing a domain name.";
  return "";
}

/** Wizard form keys that map onto real rest config keys — everything else in `advanced` is passed through. */
const REST_FORM_KEYS = new Set([
  "endpoint", "itemsPath", "pagination", "perPage", "maxItems", "totalPagesPath", "cursorPath",
  "auth", "contentFormat",
]);

/**
 * Build the source_config.rest block from the wizard's REST form fields.
 * Mirrors the shape ingest/sources/rest.js expects. Returns undefined when
 * no endpoint is configured (custom source without REST config is allowed
 * server-side only if a server-side adapter exists — the wizard warns).
 */
function buildRestConfig(rest) {
  const endpoint = rest.endpoint.trim();
  if (!endpoint) return undefined;
  const r = { endpoint };
  if (rest.itemsPath.trim()) r.itemsPath = rest.itemsPath.trim();
  const pagination = rest.pagination || "page";
  if (pagination !== "page") r.pagination = pagination;
  if (rest.perPage.trim()) r.perPage = Number(rest.perPage);
  if (rest.maxItems.trim()) r.maxItems = Number(rest.maxItems);
  if (pagination === "totalPages" && rest.totalPagesPath.trim()) r.totalPagesPath = rest.totalPagesPath.trim();
  if (pagination === "cursor" && rest.cursorPath.trim()) r.cursorPath = rest.cursorPath.trim();
  if (rest.contentFormat !== "html") r.contentFormat = rest.contentFormat;
  const auth = buildRestAuth(rest);
  if (auth) r.auth = auth;
  // Preserve advanced keys set outside the wizard (mapping, headers, timeout,
  // items, …). Form-managed keys always win — but if the user blanked a form
  // field that previously had a value, that intent is respected (the key is
  // simply not re-added, and the advanced copy is skipped for it).
  const advanced = rest.advanced || {};
  for (const [k, v] of Object.entries(advanced)) {
    if (!REST_FORM_KEYS.has(k) && v !== undefined && v !== null) r[k] = v;
  }
  return r;
}

/** Build the auth block — undefined when type is none. Password/token kept if already set (edit mode round-trip). */
function buildRestAuth(rest) {
  const t = rest.authType;
  if (!t || t === "none") return undefined;
  const token = rest.authToken.trim();
  if (t === "bearer") return token ? { type: "bearer", token } : undefined;
  if (t === "header") return rest.authHeaderName.trim() && token ? { type: "header", headerName: rest.authHeaderName.trim(), token } : undefined;
  if (t === "basic") return rest.authUsername.trim() && rest.authPassword.trim() ? { type: "basic", username: rest.authUsername.trim(), password: rest.authPassword.trim() } : undefined;
  if (t === "query") return rest.authParamName.trim() && token ? { type: "query", paramName: rest.authParamName.trim(), token } : undefined;
  return undefined;
}

/**
 * Wizard-side mirror of ingest/sources/rest.js validateRestSourceConfig —
 * the same rules, checked live as the user types, so the Continue button
 * can block on an invalid config before it ever reaches the API.
 */
function validateRestFields(rest) {
  const errors = [];
  const endpoint = rest.endpoint.trim();
  if (!endpoint) {
    errors.push("An API endpoint URL is required.");
    return errors;
  }
  if (!/^https?:\/\//i.test(endpoint)) errors.push("Endpoint must be an http(s) URL.");
  const pagination = rest.pagination || "page";
  if (!endpoint.includes("{page}") && !endpoint.includes("{cursor}") && (pagination === "page" || pagination === "totalPages")) {
    errors.push('Endpoint has no {page} placeholder — switch pagination to "none" or "cursor", or add {page} to the URL.');
  }
  if (pagination === "totalPages" && !rest.totalPagesPath.trim()) {
    errors.push('Total pages path is required when pagination is "totalPages".');
  }
  if (pagination === "cursor" && !rest.cursorPath.trim()) {
    errors.push('Cursor path is required when pagination is "cursor".');
  }
  for (const k of ["perPage", "maxItems"]) {
    if (rest[k].trim() && (!Number.isFinite(Number(rest[k])) || Number(rest[k]) < 1)) {
      errors.push(`${k === "perPage" ? "Per page" : "Max items"} must be a positive number.`);
    }
  }
  const t = rest.authType;
  const token = rest.authToken.trim();
  if (t === "bearer" && !token) errors.push("Bearer token is required for bearer auth.");
  if (t === "header" && (!rest.authHeaderName.trim() || !token)) errors.push("Header name and token are required for header auth.");
  if (t === "basic" && (!rest.authUsername.trim() || !rest.authPassword.trim())) errors.push("Username and password are required for basic auth.");
  if (t === "query" && (!rest.authParamName.trim() || !token)) errors.push("Query param name and token are required for query auth.");
  return errors;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseUrls(config) {
  if (!config) return [];
  const raw = typeof config === "string" ? JSON.parse(config) : config;
  return Array.isArray(raw.urls) ? raw.urls : [];
}

function parseSitemapUrl(config) {
  if (!config) return "";
  const raw = typeof config === "string" ? JSON.parse(config) : config;
  return raw.sitemapUrl || "";
}

function parseScope(config) {
  if (!config) return { scope: "all", docLimit: "100", selectedPages: "" };
  const raw = typeof config === "string" ? JSON.parse(config) : config;
  const pages = Array.isArray(raw.selectedPages) ? raw.selectedPages.join("\n") : (raw.selectedPages || "");
  return { scope: raw.scope || "all", docLimit: String(raw.docLimit || 100), selectedPages: pages };
}

/**
 * Normalize webhook events to a comma-separated string for form state.
 * The API stores/returns events as a JSON array (e.g. ["completed","failed"]);
 * older rows or defaults may be plain strings. Both become "completed,failed".
 */
function toEventsString(value) {
  if (!value) return "";
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list.map((e) => String(e).trim()).filter(Boolean).join(",");
}

/** Step indicator — numbered pill bar at the top of the modal. */
function StepBar({ steps, current }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={step.id} className="flex items-center">
            <span
              className={`flex h-7 min-w-[2rem] items-center justify-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-all ${
                active
                  ? "border-indigo-500 bg-indigo-500/15 text-indigo-300"
                  : done
                    ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-400"
                    : "border-slate-700 bg-slate-800/50 text-slate-500"
              }`}
            >
              {done ? (
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <span>{i + 1}</span>
              )}
              <span className="hidden sm:inline">{step.label}</span>
            </span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-2 bg-slate-700" />}
          </div>
        );
      })}
    </div>
  );
}

/** Section card wrapper for visual grouping. */
function Section({ title, icon, children, className = "" }) {
  return (
    <div className={`rounded-xl border border-slate-800/80 bg-gradient-to-br from-slate-900/80 to-slate-950/60 p-4 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-800 text-sm">{icon}</span>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h4>
      </div>
      {children}
    </div>
  );
}

/** Source type card selector. */
function SourceTypeSelector({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {OFFERED_SOURCE_TYPES.map((st) => (
        <button
          key={st.value}
          type="button"
          onClick={() => onChange(st.value)}
          className={`group flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all ${
            value === st.value
              ? "border-indigo-500 bg-indigo-500/10 shadow-lg shadow-indigo-500/5"
              : "border-slate-800 bg-slate-900/50 hover:border-slate-600 hover:bg-slate-800/50"
          }`}
        >
          <span className="text-xl">{st.icon}</span>
          <div className="min-w-0">
            <p className={`text-sm font-medium ${value === st.value ? "text-indigo-300" : "text-slate-200"}`}>{st.label}</p>
            <p className="text-[11px] text-slate-500">{st.note}</p>
          </div>
          {value === st.value && (
            <svg className="ml-auto h-4 w-4 shrink-0 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function KbModal({ open, row, company, onClose, onSaved }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    kbKey: "",
    kbName: "",
    description: "",
    rest: parseRest(null),
    vectorResourceId: "",
    storageResourceId: "",
    vectorExternalId: "",
    storageExternalId: "",
    embeddingModelId: "",
    sourceType: KB_DEFAULT_SOURCE_TYPE,
    websiteUrl: "",
    urls: "",
    sitemapUrl: "",
    ingestScope: "all",
    docLimit: "100",
    selectedPages: "",
    chunkSize: "512",
    chunkOverlap: "50",
    retrievalTopK: "10",
    retrievalScoreThreshold: "0.7",
    enableHybridSearch: true,
    enableGraphRag: false,
    webhookUrl: "",
    webhookSecret: "",
    webhookEvents: "completed,failed",
  });
  const [options, setOptions] = useState({
    vectorResources: [],
    storageResources: [],
    embeddingModels: [],
    availableEmbeddingModels: [],
    unavailableEmbeddingModels: [],
  });
  const [companyDefaults, setCompanyDefaults] = useState(null); // { VECTOR_INDEX, R2_BUCKET_NAME, BASE_URL } | null
  const [optionsError, setOptionsError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Structured verdict from a failed bind-time embedding probe (server sends it
  // on the 400) — rendered as a decoded banner instead of raw prose.
  const [probeError, setProbeError] = useState(null);

  const [advancedMode, setAdvancedMode] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Selecting a source type. When the operator switches to a website (URL /
  // Sitemap) source, prefill the Website URL from the company's BASE_URL so a
  // KB that ingests the company's own site needs no typing. The prefill only
  // fires when the field is empty — a URL the operator already typed (or one
  // loaded from an existing KB row) is never overwritten.
  const changeSourceType = (v) => {
    set("sourceType", v);
    if (v === "url" && !form.websiteUrl?.trim() && companyDefaults?.BASE_URL) {
      set("websiteUrl", companyDefaults.BASE_URL);
    }
  };

  // Live mirror of the server's rest config validation (custom sources).
  const restErrors = useMemo(
    () => (form.sourceType === "custom" ? validateRestFields(form.rest) : []),
    [form.sourceType, form.rest]
  );

  // Website sources need EITHER a website URL (automatic sitemap discovery) or
  // an explicit sitemap/URL list from the advanced section. Mirrors the server
  // rule in validateKbInput so the user is told before submitting.
  const websiteUrlError = useMemo(() => {
    if (form.sourceType !== "url") return "";
    const hasExplicitSource = Boolean(form.sitemapUrl?.trim() || form.urls?.trim());
    if (!form.websiteUrl?.trim() && !hasExplicitSource) return validateWebsiteUrl("");
    if (form.websiteUrl?.trim()) return validateWebsiteUrl(form.websiteUrl);
    return "";
  }, [form.sourceType, form.websiteUrl, form.sitemapUrl, form.urls]);

  // ---- Sitemap discovery preview (spec §30/§31) ----
  // The moment a valid website URL is entered (and no explicit sitemap/URLs
  // are given in the advanced section), the backend runs robots.txt →
  // fallbacks → index-crawl discovery and reports what it found. Purely
  // informational at this stage — saveKb re-resolves authoritatively.
  const [discovery, setDiscovery] = useState({ status: "idle" }); // idle|checking|found|notfound|error
  const hasExplicitSource = Boolean(form.sitemapUrl?.trim() || form.urls?.trim());
  useEffect(() => {
    if (form.sourceType !== "url" || websiteUrlError || hasExplicitSource) {
      setDiscovery({ status: "idle" });
      return undefined;
    }
    const websiteUrl = form.websiteUrl.trim();
    if (!websiteUrl) {
      setDiscovery({ status: "idle" });
      return undefined;
    }
    let cancelled = false;
    setDiscovery({ status: "checking" });
    const timer = setTimeout(async () => {
      try {
        const d = await discoverWebsite(company, websiteUrl);
        if (!cancelled) {
          setDiscovery(
            d.sitemapFound
              ? { status: "found", sitemapUrl: d.sitemapUrl, urlCount: d.urlCount, sitemapCount: d.sitemapCount, robotsUrl: d.robotsUrl }
              : { status: "notfound" }
          );
        }
      } catch (e) {
        if (!cancelled) setDiscovery({ status: "error", error: e.message });
      }
    }, 600); // debounce while the user types
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.sourceType, form.websiteUrl, websiteUrlError, hasExplicitSource, company]);

  // Reset on open transition OR row change while open (issue-002 fix).
  // Separate refs track the previous open state and row identity so we can
  // detect both dimensions independently. Row IDENTITY is `id`/`kb_key`, not
  // the object reference: the KB detail page refetches the row on a 30s poll,
  // and re-seeding the form on every fresh object used to wipe in-progress
  // edits (e.g. the embedding dropdown) while the admin was mid-wizard.
  const wasOpenRef = useRef(open);
  const rowIdentity = row ? `${row.id ?? ""}:${row.kb_key ?? ""}` : null;
  const prevRowIdentityRef = useRef(rowIdentity);
  useEffect(() => {
    const opened = open && !wasOpenRef.current;
    const rowChangedWhileOpen =
      open && rowIdentity !== null && rowIdentity !== prevRowIdentityRef.current;
    wasOpenRef.current = open;
    prevRowIdentityRef.current = rowIdentity;

    if (opened || rowChangedWhileOpen) {
      // Determine which fields come from the KB row (loaded from DB) vs.
      // defaults.  For vector/storage the row carries both a numeric
      // provider_resources id AND the external resource name (the actual
      // Cloudflare index/bucket name).  The Select value must match one
      // of the option values built in the useMemo below: numeric id for
      // registry rows, the name string for live resources.
      const vectorVal = row?.vector_resource_id
        ? String(row.vector_resource_id)
        : (row?.vector_external_id || "");
      const storageVal = row?.storage_resource_id
        ? String(row.storage_resource_id)
        : (row?.storage_external_id || "");

      setStep((prev) => opened ? 0 : prev);
      setForm({
        kbKey: row ? row.kb_key : `${company || ""}-kb`,
        kbName: row?.kb_name ?? "",
        description: row?.description ?? "",
        vectorResourceId: vectorVal,
        storageResourceId: storageVal,
        vectorExternalId: row?.vector_external_id || "",
        storageExternalId: row?.storage_external_id || "",
        embeddingModelId: row?.embedding_model_id ? String(row.embedding_model_id) : "",
        // Legacy rows may carry a withdrawn source_type — keep it so re-saving
        // is a no-op; the step-2 banner explains it and offers a way to migrate.
        sourceType: row?.source_type || KB_DEFAULT_SOURCE_TYPE,
        rest: parseRest(row?.source_config),
        websiteUrl: parseWebsiteUrl(row?.source_config),
        urls: parseUrls(row?.source_config).join("\n"),
        sitemapUrl: parseSitemapUrl(row?.source_config),
        ingestScope: parseScope(row?.source_config).scope,
        docLimit: parseScope(row?.source_config).docLimit,
        selectedPages: parseScope(row?.source_config).selectedPages,
        chunkSize: String(row?.chunk_size ?? 512),
        chunkOverlap: String(row?.chunk_overlap ?? 50),
        retrievalTopK: String(row?.retrieval_top_k ?? 10),
        retrievalScoreThreshold: String(row?.retrieval_score_threshold ?? 0.7),
        enableHybridSearch: row ? !!row.enable_hybrid_search : true,
        graphResourceId: row?.graph_resource_id ? String(row.graph_resource_id) : "",
        enableGraphRag: row ? !!row.enable_graph_rag : false,
        graphExtractMaxChunks: row?.graph_extract_max_chunks != null ? String(row.graph_extract_max_chunks) : "",
        graphExtractConcurrency: row?.graph_extract_concurrency != null ? String(row.graph_extract_concurrency) : "",
        webhookUrl: row?.webhook_url ?? "",
        webhookSecret: "",
        webhookEvents: toEventsString(row?.webhook_events) || "completed,failed",
      });
      setError(null);
      setOptionsError(null);
      setProbeError(null);
      if (company) {
        getKbOptions(company)
          .then(setOptions)
          .catch((e) => {
            console.error("Failed to load KB options:", e);
            setOptionsError("Could not load resource options. Some dropdowns may be incomplete.");
          });
        // The server auto-binds "Company default" KBs from these config values
        // (kb-service applyDefaultResourceBindings). Fetched best-effort so the
        // review step can warn when a default won't resolve to a resource.
        // Legacy (unsectioned) responses fall back to the body itself.
        api("/cloudflare/config", { company })
          .then((d) => {
            const cfg = d?.config || d || {};
            setCompanyDefaults({
              VECTOR_INDEX: cfg.VECTOR_INDEX ?? cfg.STORAGE?.VECTOR_INDEX ?? "",
              R2_BUCKET_NAME: cfg.R2_BUCKET_NAME ?? cfg.STORAGE?.R2_BUCKET_NAME ?? "",
              // Company's canonical website — prefills the KB website URL field
              // when a URL/Sitemap source is selected (GENERAL section).
              BASE_URL: cfg.BASE_URL ?? cfg.GENERAL?.BASE_URL ?? "",
            });
          })
          .catch(() => setCompanyDefaults(null)); // hint simply won't render
      }
    }
  }, [open, rowIdentity, company, row]);

  // Validation per step
  const canContinue = () => {
    if (step === 0) {
      return form.kbName.trim() && /^[a-z0-9-]+$/.test(form.kbKey) && form.kbKey.length >= 3;
    }
    // Custom sources: block continuing until the REST config passes the same
    // rules the server enforces (restErrors is empty only when valid).
    if (step === 1 && form.sourceType === "custom" && restErrors.length > 0) return false;
    // Website sources: a website URL (or an explicit sitemap/URL list) is
    // required — there is nothing to ingest otherwise.
    if (step === 1 && websiteUrlError) return false;
    // Steps 2-4 always valid (optional fields)
    return true;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setProbeError(null);
    try {
      const numOrUndef = (v) => (v === "" || v === null ? undefined : Number(v));
      // Live resources use name strings as option values; detect them by
      // checking whether the selected value is a valid numeric id.
      const isLiveResourceId = (v) => v !== "" && v !== null && isNaN(Number(v));
      const body = {
        kbKey: form.kbKey.trim(),
        kbName: form.kbName.trim(),
        description: form.description.trim() || null,
        vectorResourceId: isLiveResourceId(form.vectorResourceId) ? undefined : numOrUndef(form.vectorResourceId),
        vectorExternalId: isLiveResourceId(form.vectorResourceId) ? form.vectorResourceId : (form.vectorExternalId || undefined),
        storageResourceId: isLiveResourceId(form.storageResourceId) ? undefined : numOrUndef(form.storageResourceId),
        storageExternalId: isLiveResourceId(form.storageResourceId) ? form.storageResourceId : (form.storageExternalId || undefined),
        // "" (Company default) → explicit null so an existing KB-bound model
        // can be CLEARED from the modal — undefined would merge-keep the old
        // binding and there'd be no way to follow the probe's "remove the
        // binding" advice from the UI.
        embeddingModelId: form.embeddingModelId === "" ? null : Number(form.embeddingModelId),
        sourceType: form.sourceType || KB_DEFAULT_SOURCE_TYPE,
        sourceConfig: ["wordpress", "url"].includes(form.sourceType)
          ? {
              // Website-first: the backend discovers the sitemap automatically,
              // so a websiteUrl alone is a complete, valid configuration.
              ...(form.sourceType === "url" ? {
                websiteUrl: form.websiteUrl.trim() || undefined,
                urls: form.urls.split("\n").map((u) => u.trim()).filter(Boolean),
                sitemapUrl: form.sitemapUrl.trim() || undefined,
              } : {}),
              scope: form.ingestScope || "all",
              docLimit: form.ingestScope === "limit" ? Number(form.docLimit) : undefined,
              selectedPages: form.ingestScope === "selected"
                ? form.selectedPages.split("\n").map((u) => u.trim()).filter(Boolean)
                : undefined,
            }
          : form.sourceType === "custom"
            ? { rest: buildRestConfig(form.rest) }
            : undefined,
        chunkSize: Number(form.chunkSize),
        chunkOverlap: Number(form.chunkOverlap),
        retrievalTopK: Number(form.retrievalTopK),
        retrievalScoreThreshold: Number(form.retrievalScoreThreshold),
        enableHybridSearch: form.enableHybridSearch,
        graphResourceId: numOrUndef(form.graphResourceId),
        enableGraphRag: form.enableGraphRag,
        // Blank string = "use server default" → sent as undefined so the
        // backend stores NULL (defaults), not 0.
        ...(form.graphExtractMaxChunks.trim() !== "" && { graphExtractMaxChunks: Number(form.graphExtractMaxChunks) }),
        ...(form.graphExtractConcurrency.trim() !== "" && { graphExtractConcurrency: Number(form.graphExtractConcurrency) }),
        webhookUrl: form.webhookUrl.trim() || null,
        webhookEvents: form.webhookEvents || "completed,failed",
        ...(row
          ? form.webhookSecret.trim() && { webhookSecret: form.webhookSecret.trim() }
          : { webhookSecret: form.webhookSecret.trim() || null }),
      };
      // silentError: the modal renders ALL failures inline (decoded probe
      // banner / rose error) — the auto error toast would be redundant. The
      // SUCCESS toast still fires from the auto-toaster.
      if (row) await updateKb(row.kb_key, body, company, { silentError: true });
      else await createKb(body, company, { silentError: true });
      onSaved();
    } catch (e) {
      // Probe failures get the decoded verdict banner INSTEAD of the raw
      // prose banner (the auto-toast is silenced for this call — the banner
      // is persistent, actionable feedback the toast can't provide).
      setProbeError(e.probe || null);
      setError(e.probe ? null : e.message);
    } finally {
      setBusy(false);
    }
  };

  // Build option lists — memoized so <select> elements don't re-mount on every
  // keystroke, which previously caused dropdowns to auto-collapse in ~1–2s.
  // vectorResources from /kbs/options is already filtered server-side to
  // vector-capable providers; the server also returns the resources it filtered
  // OUT (incapableVectorResources — e.g. a vector_index row accidentally created
  // under Cloudflare R2) so an existing KB bound to one can explain the problem
  // instead of silently showing the wrong default.
  const {
    vectorOptions,
    storageOptions,
    graphOptions,
    modelOptions,
    selectedModel,
    unavailableEmbeddingCount,
    incapableVectorBinding,
  } = useMemo(() => {
    // Only the models this company can actually call — provider has an embedding
    // adapter AND an active credential (server-side partition).
    const availableEmbeddingModels = options.availableEmbeddingModels || [];
    const seenVector = new Set();
    const vectorResourceOpts = [];
    for (const r of options.vectorResources || []) {
      const key = r.external_resource_id || r.resource_key;
      if (seenVector.has(key)) continue;
      seenVector.add(key);
      // Label with the Cloudflare-facing name (external_resource_id) so the
      // dropdown reads exactly like the Cloudflare dashboard; resource_name /
      // resource_key are the fallback for rows provisioned without one.
      vectorResourceOpts.push({ value: String(r.id), label: `${r.external_resource_id || r.resource_name || r.resource_key}${r.provider_name ? ` · ${r.provider_name}` : ""}` });
    }
    for (const r of options.liveVectorResources || []) {
      const key = r.name || r.id;
      if (seenVector.has(key)) continue;
      seenVector.add(key);
      vectorResourceOpts.push({ value: key, label: `${r.name || r.id} (live)` });
    }

    // The KB's saved vector binding is unusable for ingestion when its provider
    // has no vector adapter (server filtered it out of vectorResources).
    const boundId = row?.vector_resource_id != null ? String(row.vector_resource_id) : null;
    const incapableVectorBinding =
      boundId &&
      !vectorResourceOpts.some((o) => o.value === boundId) &&
      (options.incapableVectorResources || []).find((r) => String(r.id) === boundId) || null;

    const seenStorage = new Set();
    const storageResourceOpts = [];
    for (const r of options.storageResources || []) {
      const key = r.external_resource_id || r.resource_key;
      if (seenStorage.has(key)) continue;
      seenStorage.add(key);
      // Same Cloudflare-facing label rule as the Vector Store above: prefer
      // external_resource_id so Document Storage mirrors the Cloudflare bucket
      // name; resource_name / resource_key are the fallback.
      storageResourceOpts.push({ value: String(r.id), label: `${r.external_resource_id || r.resource_name || r.resource_key}${r.provider_name ? ` · ${r.provider_name}` : ""}` });
    }
    for (const r of options.liveStorageResources || []) {
      const key = r.name || r.id;
      if (seenStorage.has(key)) continue;
      seenStorage.add(key);
      storageResourceOpts.push({ value: key, label: `${r.name || r.id} (live)` });
    }

    const graphResourceOpts = [];
    for (const r of options.graphResources || []) {
      graphResourceOpts.push({ value: String(r.id), label: `${r.resource_name || r.resource_key}${r.provider_name ? ` · ${r.provider_name}` : ""}` });
    }

    return {
      vectorOptions: [OPTION_DEFAULT, ...vectorResourceOpts],
      storageOptions: [OPTION_DEFAULT, ...storageResourceOpts],
      graphOptions: [OPTION_DEFAULT, ...graphResourceOpts],
      // Only models the company can actually call: the provider must have an
      // embedding adapter AND an active credential for this company (partition
      // is done server-side, shared/embedding-capability.js). `embeddingModels`
      // stays as a fallback so an existing KB remains editable if the server
      // predates the partition.
      modelOptions: [
        OPTION_DEFAULT,
        ...(availableEmbeddingModels.length
          ? availableEmbeddingModels
          : (options.embeddingModels || [])
        ).map((m) => ({ value: String(m.id), label: `${m.provider_name} · ${m.model_name}` })),
      ],
      selectedModel: (options.embeddingModels || []).find((m) => String(m.id) === form.embeddingModelId),
      unavailableEmbeddingCount: (options.unavailableEmbeddingModels || []).length,
      incapableVectorBinding,
    };
  }, [options, form.embeddingModelId, row]);

  // Review-step mirror of the server's default-binding resolution: when the KB
  // relies on "Company default (config)", check the company config values will
  // actually resolve to provisioned resources (shared matcher = the server's).
  // Best-effort UX sugar only — the server auto-binds or leaves null either way.
  const defaultBindingWarnings = useMemo(() => {
    if (!companyDefaults) return [];
    const hasVectorBinding = Boolean(form.vectorResourceId || form.vectorExternalId);
    const hasStorageBinding = Boolean(form.storageResourceId || form.storageExternalId);
    // Registry + live rows: the server's listByCompany sees registry rows only,
    // but live names are written by the config selectors too — evaluate against
    // both so the hint never cries wolf for a live-resource default.
    const resources = [
      ...(options.vectorResources || []),
      ...(options.storageResources || []),
      ...(options.graphResources || []),
      ...(options.liveVectorResources || []).map((r) => ({ ...r, resource_type: "vector_index" })),
      ...(options.liveStorageResources || []).map((r) => ({ ...r, resource_type: "object_bucket" })),
    ];
    const result = evaluateDefaultBindings({
      resources,
      vectorDefault: companyDefaults.VECTOR_INDEX,
      storageDefault: companyDefaults.R2_BUCKET_NAME,
      hasVectorBinding,
      hasStorageBinding,
    });
    // `kind` routes each warning to its Advanced-mode select (same hints the
    // review step renders — one memo feeds both places).
    return [
      { ...result.vector, kind: "vector" },
      { ...result.storage, kind: "storage" },
    ].filter((s) => s.needed && !s.resolved && s.reason);
  }, [companyDefaults, form.vectorResourceId, form.vectorExternalId, form.storageResourceId, form.storageExternalId, options]);

  const vectorDefaultWarning = defaultBindingWarnings.find((w) => w.kind === "vector");
  const storageDefaultWarning = defaultBindingWarnings.find((w) => w.kind === "storage");

  if (!open) return null;

  return (
    <Modal
      open={open}
      title={row ? "Edit Knowledge Base" : "Create Knowledge Base"}
      onClose={onClose}
      maxScreen
      footer={
        <div className="flex w-full items-center justify-between">
          <div>
            {step > 0 && (
              <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeftIcon className="h-3.5 w-3.5" /> Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canContinue()}>
                Continue <ArrowRightIcon className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button onClick={submit} disabled={busy}>
                {busy ? <Spinner className="h-3.5 w-3.5" /> : row ? "Save Changes" : "Create Knowledge Base"}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {/* Step indicator */}
      <div className="mb-5 -mx-1">
        <StepBar steps={STEPS} current={step} />
      </div>

      {/* ── Step 1: Basic Info ──────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-4">
          <Section title="Basic Information" icon="📝">
            <div className="space-y-3">
              <Input
                label="Name"
                placeholder="e.g. PopularCert Knowledge Base"
                value={form.kbName}
                onChange={(e) => {
                  set("kbName", e.target.value);
                  if (!row) {
                    const key = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 63);
                    set("kbKey", key);
                  }
                }}
              />
              <div>
                <Input
                  label="Key"
                  placeholder="e.g. popularcert-kb"
                  value={form.kbKey}
                  onChange={(e) => set("kbKey", e.target.value)}
                  disabled={!!row}
                  error={
                    form.kbKey && !/^[a-z0-9-]+$/.test(form.kbKey)
                      ? "Lowercase, numbers, hyphens only"
                      : form.kbKey && (form.kbKey.length < 3 || form.kbKey.length > 63)
                        ? "3–63 characters required"
                        : undefined
                  }
                />
                <p className="mt-1 text-[11px] text-slate-500">Auto-generated from name · Editable in create mode</p>
              </div>
              <TextArea
                label="Description"
                rows={2}
                placeholder="What content does this knowledge base contain?"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
          </Section>
        </div>
      )}

      {/* ── Step 2: Data Source ─────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <Section title="Data Source" icon="📥">
            <p className="mb-3 text-sm text-slate-400">Where should this knowledge base get its content?</p>

            {/* A KB that still uses a withdrawn source (WordPress / Custom REST
                API). It is kept selected so re-saving is a no-op, but it is not
                offered as a choice — pick one below to migrate. */}
            {!isSourceTypeEnabled(form.sourceType) && (
              <div className="mb-3 flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                <span className="shrink-0 text-amber-400">⚠️</span>
                <div className="text-xs text-amber-300">
                  <p className="font-medium">{sourceTypeLabel(form.sourceType)} is no longer offered.</p>
                  <p className="mt-0.5 text-amber-300/80">
                    This KB keeps working as-is until you change it. For a WordPress site, choose
                    URL / Sitemap and point it at <code className="font-mono">/wp-sitemap.xml</code> — it
                    ingests the same pages without the broken REST API.
                  </p>
                </div>
              </div>
            )}

            <SourceTypeSelector value={form.sourceType} onChange={changeSourceType} />

            {/* Scope selector for WordPress/URL */}
            {["wordpress", "url"].includes(form.sourceType) && (
              <div className="mt-4 space-y-3">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Ingestion Scope</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {/* Entire website */}
                  <button
                    type="button"
                    onClick={() => set("ingestScope", "all")}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      form.ingestScope === "all"
                        ? "border-indigo-500 bg-indigo-500/10 shadow-md shadow-indigo-500/10"
                        : "border-slate-700 bg-slate-800/50 hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        form.ingestScope === "all" ? "border-indigo-400" : "border-slate-600"
                      }`}>
                        {form.ingestScope === "all" && <span className="h-2 w-2 rounded-full bg-indigo-400" />}
                      </span>
                      <span className="text-sm font-medium text-slate-200">Entire website</span>
                    </div>
                    <p className="mt-1 pl-7 text-[11px] text-slate-500">Fetch and index all available content</p>
                  </button>

                  {/* Custom limit */}
                  <button
                    type="button"
                    onClick={() => set("ingestScope", "limit")}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      form.ingestScope === "limit"
                        ? "border-indigo-500 bg-indigo-500/10 shadow-md shadow-indigo-500/10"
                        : "border-slate-700 bg-slate-800/50 hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        form.ingestScope === "limit" ? "border-indigo-400" : "border-slate-600"
                      }`}>
                        {form.ingestScope === "limit" && <span className="h-2 w-2 rounded-full bg-indigo-400" />}
                      </span>
                      <span className="text-sm font-medium text-slate-200">Custom limit</span>
                    </div>
                    <p className="mt-1 pl-7 text-[11px] text-slate-500">Set a maximum number of documents</p>
                  </button>

                  {/* Selected pages */}
                  {form.sourceType === "url" && (
                    <button
                      type="button"
                      onClick={() => set("ingestScope", "selected")}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        form.ingestScope === "selected"
                          ? "border-indigo-500 bg-indigo-500/10 shadow-md shadow-indigo-500/10"
                          : "border-slate-700 bg-slate-800/50 hover:border-slate-600"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                          form.ingestScope === "selected" ? "border-indigo-400" : "border-slate-600"
                        }`}>
                          {form.ingestScope === "selected" && <span className="h-2 w-2 rounded-full bg-indigo-400" />}
                        </span>
                        <span className="text-sm font-medium text-slate-200">Selected pages</span>
                      </div>
                      <p className="mt-1 pl-7 text-[11px] text-slate-500">Pick specific URLs to ingest</p>
                    </button>
                  )}
                </div>

                {/* Limit input */}
                {form.ingestScope === "limit" && (
                  <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
                    <Input
                      label="Maximum documents"
                      type="number"
                      min={1}
                      max={100000}
                      value={form.docLimit}
                      onChange={(e) => set("docLimit", e.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-slate-500">Stop after processing this many documents</p>
                  </div>
                )}

                {/* Selected pages URL list */}
                {form.ingestScope === "selected" && form.sourceType === "url" && (
                  <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
                    <TextArea
                      label="Pages to ingest (one URL per line)"
                      rows={4}
                      placeholder={"https://example.com/about\nhttps://example.com/services\nhttps://example.com/contact"}
                      value={form.selectedPages}
                      onChange={(e) => set("selectedPages", e.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-slate-500">Only these specific pages will be fetched and indexed</p>
                  </div>
                )}
              </div>
            )}

            {/* URL / website fields. The user supplies ONLY a website URL —
                the sitemap is discovered automatically by the backend
                (robots.txt → standard fallbacks → sitemap indexes). */}
            {form.sourceType === "url" && (
              <div className="mt-3 space-y-3">
                <Input
                  label="Website URL"
                  placeholder="https://example.com"
                  value={form.websiteUrl}
                  onChange={(e) => set("websiteUrl", e.target.value)}
                  error={websiteUrlError || undefined}
                />
                {/* Live discovery status (spec §31) — informative only; saveKb
                    re-resolves authoritatively and stamps sitemapUrl. */}
                {discovery.status === "checking" && (
                  <p className="-mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                    <Spinner className="h-3 w-3" /> Finding sitemap…
                  </p>
                )}
                {discovery.status === "found" && (
                  <p className="-mt-2 text-[11px] text-green-400">
                    ✓ Sitemap found{discovery.sitemapUrl ? `: ${discovery.sitemapUrl}` : ""}
                    {discovery.sitemapCount > 1 ? ` (via ${discovery.sitemapCount} sitemap file(s))` : ""}
                    {discovery.urlCount != null ? ` · ${discovery.urlCount.toLocaleString()} pages discovered` : ""}
                  </p>
                )}
                {discovery.status === "notfound" && (
                  <p className="-mt-2 text-[11px] text-amber-400">
                    ⚠️ We couldn't find a sitemap for this website (checked robots.txt and the standard
                    locations). Saving will fail unless the site exposes one — or you specify a sitemap
                    or URL list under Advanced.
                  </p>
                )}
                {discovery.status === "error" && (
                  <p className="-mt-2 text-[11px] text-amber-400">
                    ⚠️ Couldn't check this website right now — the sitemap will be resolved at ingest time.
                  </p>
                )}
                {discovery.status === "idle" && (
                  <p className="-mt-2 text-[11px] text-slate-500">
                    We'll automatically find the site's sitemap (via robots.txt) and discover the pages
                    available for ingestion.
                  </p>
                )}
                <details className="text-xs">
                  <summary className="cursor-pointer text-slate-400 hover:text-slate-300">
                    Advanced: specify a sitemap or list URLs manually
                  </summary>
                  <div className="mt-3 space-y-3">
                    <Input
                      label="Sitemap URL (optional)"
                      placeholder="https://example.com/sitemap.xml"
                      value={form.sitemapUrl}
                      onChange={(e) => set("sitemapUrl", e.target.value)}
                    />
                    {!form.sitemapUrl && (
                      <TextArea
                        label="Or enter URLs manually"
                        rows={4}
                        placeholder={"https://example.com/page-1\nhttps://example.com/page-2"}
                        value={form.urls}
                        onChange={(e) => set("urls", e.target.value)}
                      />
                    )}
                  </div>
                </details>
              </div>
            )}

            {form.sourceType === "file" && (
              <p className="mt-3 text-sm text-slate-500">
                Files can be uploaded after creation from the Knowledge Base detail page.
              </p>
            )}

            {/* Custom source: adapter warning + REST config */}
            {form.sourceType === "custom" && (
              <div className="mt-4 space-y-3">
                <div className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                  <span className="shrink-0 text-amber-400">⚠️</span>
                  <div className="text-xs text-amber-300">
                    <p className="font-medium">Custom sources need a data feed before they can ingest.</p>
                    <p className="mt-0.5 text-amber-300/80">
                      Configure the REST API below — or, for full control, register a server-side adapter
                      for this KB on the backend (ingest/sources). Without one of these, ingestion will fail
                      with a "no rest block" error.
                    </p>
                  </div>
                </div>

                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">REST API Configuration</p>

                <Input
                  label="API endpoint"
                  placeholder="https://api.example.com/articles?page={page}&per_page=50"
                  value={form.rest.endpoint}
                  onChange={(e) => set("rest", { ...form.rest, endpoint: e.target.value })}
                  error={restErrors.length ? undefined : undefined}
                />
                <p className="-mt-2 text-[11px] text-slate-500">
                  Use {'{page}'} or {'{cursor}'} in the URL as the pagination placeholder. Response must be JSON.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Select
                      label="Pagination"
                      options={PAGINATION_OPTIONS}
                      value={form.rest.pagination}
                      onChange={(e) => set("rest", { ...form.rest, pagination: e.target.value })}
                    />
                  </div>
                  <Input
                    label="Items path (optional)"
                    placeholder="data — dot path to the items array"
                    value={form.rest.itemsPath}
                    onChange={(e) => set("rest", { ...form.rest, itemsPath: e.target.value })}
                  />
                </div>
                {(form.rest.pagination === "totalPages" || form.rest.pagination === "cursor") && (
                  <Input
                    label={form.rest.pagination === "totalPages" ? "Total pages path" : "Next cursor path"}
                    placeholder={form.rest.pagination === "totalPages" ? "meta.total_pages" : "meta.next_cursor"}
                    value={form.rest.pagination === "totalPages" ? form.rest.totalPagesPath : form.rest.cursorPath}
                    onChange={(e) => set("rest", { ...form.rest, [form.rest.pagination === "totalPages" ? "totalPagesPath" : "cursorPath"]: e.target.value })}
                  />
                )}

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Per page (optional)"
                    type="number"
                    min={1}
                    placeholder="50"
                    value={form.rest.perPage}
                    onChange={(e) => set("rest", { ...form.rest, perPage: e.target.value })}
                  />
                  <Input
                    label="Max items (safety cap)"
                    type="number"
                    min={1}
                    placeholder="1000"
                    value={form.rest.maxItems}
                    onChange={(e) => set("rest", { ...form.rest, maxItems: e.target.value })}
                  />
                </div>

                {/* Auth */}
                <Select
                  label="Authentication"
                  options={AUTH_TYPE_OPTIONS}
                  value={form.rest.authType}
                  onChange={(e) => set("rest", { ...form.rest, authType: e.target.value })}
                />
                {form.rest.authType === "bearer" && (
                  <Input label="Bearer token" type="password" value={form.rest.authToken} onChange={(e) => set("rest", { ...form.rest, authToken: e.target.value })} />
                )}
                {form.rest.authType === "header" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Header name" placeholder="x-api-key" value={form.rest.authHeaderName} onChange={(e) => set("rest", { ...form.rest, authHeaderName: e.target.value })} />
                    <Input label="Token" type="password" value={form.rest.authToken} onChange={(e) => set("rest", { ...form.rest, authToken: e.target.value })} />
                  </div>
                )}
                {form.rest.authType === "basic" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Username" value={form.rest.authUsername} onChange={(e) => set("rest", { ...form.rest, authUsername: e.target.value })} />
                    <Input label="Password" type="password" value={form.rest.authPassword} onChange={(e) => set("rest", { ...form.rest, authPassword: e.target.value })} />
                  </div>
                )}
                {form.rest.authType === "query" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Query param" placeholder="api_key" value={form.rest.authParamName} onChange={(e) => set("rest", { ...form.rest, authParamName: e.target.value })} />
                    <Input label="Token" type="password" value={form.rest.authToken} onChange={(e) => set("rest", { ...form.rest, authToken: e.target.value })} />
                  </div>
                )}

                <Select
                  label="Content format"
                  options={CONTENT_FORMAT_OPTIONS}
                  value={form.rest.contentFormat}
                  onChange={(e) => set("rest", { ...form.rest, contentFormat: e.target.value })}
                />
                <p className="-mt-2 text-[11px] text-slate-500">
                  {form.rest.contentFormat === "text"
                    ? "Plain text is wrapped into HTML paragraphs before chunking — best for JSON fields that hold prose."
                    : "Pick \"Plain text\" if your API returns prose in JSON fields — raw JSON structure otherwise flows into chunks as-is."}
                </p>

                {/* JSON-only API tips — the adapter's field auto-detection + advanced passthrough */}
                <div className="rounded-lg border border-slate-700/60 bg-slate-800/30 px-3 py-2.5">
                  <p className="text-[11px] font-medium text-slate-400">💡 Tips for JSON-only APIs</p>
                  <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-slate-500">
                    <li>
                      <span className="text-slate-400">Auto-detected fields:</span> title, content, slug, link and
                      modified are found automatically from common shapes (<span className="font-mono">title.rendered</span>,
                      <span className="font-mono"> body</span>, <span className="font-mono">html</span>,
                      <span className="font-mono"> updated_at</span>…). Nested or unusual fields need a
                      <span className="font-mono"> mapping</span> block.
                    </li>
                    <li>
                      <span className="text-slate-400">mapping / headers / timeout / items</span> are advanced keys this
                      form doesn't edit. Set them once via the API
                      (<span className="font-mono">PUT /gateway/kbs/{row ? row.kb_key : form.kbKey || "<key>"}/sources</span>) and this
                      wizard preserves them on every edit — e.g.
                      <span className="font-mono"> "mapping": {"{"}"content": "description", "modified": "published_at"{"}"}</span>.
                    </li>
                    <li>
                      <span className="text-slate-400">Retrieval quality:</span> if a field holds JSON-in-JSON or dense
                      data, point <span className="font-mono">mapping.content</span> at the prose field — the chunker
                      indexes whatever content resolves to, verbatim.
                    </li>
                  </ul>
                </div>

                {restErrors.length > 0 && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {restErrors.map((e) => (
                      <p key={e}>• {e}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Section>
        </div>
      )}

      {/* ── Step 3: Storage & Search ────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Basic mode — simplified view */}
          {!advancedMode && (
            <>
              <Section title="AI Search" icon="🔍">
                <p className="mb-3 text-sm text-slate-400">
                  We'll use recommended settings for your AI to search your content.
                  You can customize these later in Advanced mode.
                </p>
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">✅</span>
                    <div>
                      <p className="text-sm font-medium text-slate-200">Recommended Settings</p>
                      <p className="text-[11px] text-slate-500">
                        Vector search, document storage, and AI embeddings configured automatically
                      </p>
                    </div>
                  </div>
                </div>
                {/* Embedding model is surfaced in Basic mode too — it directly
                    shapes retrieval quality and is the one AI choice most
                    operators want control over. Same control as Advanced mode;
                    the rest of the technical bindings stay behind the toggle. */}
                <Select
                  label="Embedding Model"
                  options={modelOptions}
                  value={form.embeddingModelId}
                  onChange={(e) => set("embeddingModelId", e.target.value)}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  The AI model that converts your text into searchable format. Only models you
                  can actually call are listed — the provider must be connected on the AI Providers
                  page.
                </p>
                {unavailableEmbeddingCount > 0 && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    {unavailableEmbeddingCount} other model
                    {unavailableEmbeddingCount === 1 ? " is" : "s are"} hidden — connect the
                    provider on the AI Providers page to use {unavailableEmbeddingCount === 1 ? "it" : "them"}.
                  </p>
                )}
                {selectedModel && (
                  <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
                    <span>Provider: <span className="text-slate-300">{selectedModel.provider_name}</span></span>
                    {selectedModel.dimensions && <span>Dimensions: <span className="text-slate-300">{selectedModel.dimensions}</span></span>}
                  </div>
                )}
              </Section>
            </>
          )}

          {/* Advanced mode — full technical control */}
          {advancedMode && (
            <>
              {incapableVectorBinding && (
                <div className="rounded-lg border border-amber-600/50 bg-amber-500/10 p-3 text-[13px] text-amber-300">
                  ⚠️ This KB's current Vector Store ({incapableVectorBinding.resource_name || incapableVectorBinding.resource_key}
                  {incapableVectorBinding.provider_name ? ` · ${incapableVectorBinding.provider_name}` : ""}) is on a
                  storage-only provider and cannot be used for ingestion. Ingest would fail with
                  <span className="text-amber-200"> “Unsupported vector provider.”</span> Pick a Cloudflare (Vectorize),
                  Pinecone, Qdrant, Weaviate, or OpenAI index below.
                </div>
              )}
              <Section title="Vector Database" icon="🗄️">
                <Select
                  label="Vector Store"
                  options={vectorOptions}
                  value={form.vectorResourceId}
                  onChange={(e) => {
                    set("vectorResourceId", e.target.value);
                    // Any explicit choice (registry row, live resource, or
                    // Company default) supersedes a pre-filled live external id
                    // from the saved KB — clear it so state matches the select
                    // and submit stops re-sending the stale external id that
                    // would win over "Company default".
                    set("vectorExternalId", "");
                  }}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Where AI search indexes are stored (Cloudflare Vectorize, Pinecone, etc.)
                </p>
                {vectorDefaultWarning && (
                  <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    ⚠️ {vectorDefaultWarning.reason}
                  </div>
                )}
              </Section>

              <Section title="Object Storage" icon="📦">
                <Select
                  label="Document Storage"
                  options={storageOptions}
                  value={form.storageResourceId}
                  onChange={(e) => {
                    set("storageResourceId", e.target.value);
                    // Same supersede rule as Vector Store.
                    set("storageExternalId", "");
                  }}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Where your content documents are stored
                </p>
                {storageDefaultWarning && (
                  <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    ⚠️ {storageDefaultWarning.reason}
                  </div>
                )}
              </Section>

              <Section title="AI Processing" icon="🧠">
                <Select
                  label="Embedding Model"
                  options={modelOptions}
                  value={form.embeddingModelId}
                  onChange={(e) => set("embeddingModelId", e.target.value)}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  The AI model that converts your text into searchable format. Only models you
                  can actually call are listed — the provider must be connected on the AI Providers
                  page.
                </p>
                {unavailableEmbeddingCount > 0 && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    {unavailableEmbeddingCount} other model
                    {unavailableEmbeddingCount === 1 ? " is" : "s are"} hidden — connect the
                    provider on the AI Providers page to use {unavailableEmbeddingCount === 1 ? "it" : "them"}.
                  </p>
                )}
                {selectedModel && (
                  <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
                    <span>Provider: <span className="text-slate-300">{selectedModel.provider_name}</span></span>
                    {selectedModel.dimensions && <span>Dimensions: <span className="text-slate-300">{selectedModel.dimensions}</span></span>}
                  </div>
                )}
              </Section>

              <Section title="Knowledge Graph" icon="🕸️">
                <Select
                  label="Graph Database"
                  options={graphOptions}
                  value={form.graphResourceId}
                  onChange={(e) => {
                    set("graphResourceId", e.target.value);
                    if (e.target.value) set("enableGraphRag", true);
                  }}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Optional — connects to Neo4j to map relationships between concepts
                </p>
                {form.graphResourceId && (
                  <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-800/30 p-3">
                    <div>
                      <p className="text-sm font-medium text-slate-200">Graph RAG</p>
                      <p className="text-[11px] text-slate-500">Extract entities and relationships from content</p>
                    </div>
                    <Toggle
                      checked={form.enableGraphRag}
                      onChange={(v) => set("enableGraphRag", v)}
                    />
                  </div>
                )}
                {form.graphResourceId && form.enableGraphRag && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Input
                      label="Max chunks / doc"
                      type="number"
                      min="1"
                      max="50"
                      placeholder="10"
                      value={form.graphExtractMaxChunks}
                      onChange={(e) => set("graphExtractMaxChunks", e.target.value)}
                    />
                    <Input
                      label="Parallel LLM calls"
                      type="number"
                      min="1"
                      max="10"
                      placeholder="4"
                      value={form.graphExtractConcurrency}
                      onChange={(e) => set("graphExtractConcurrency", e.target.value)}
                    />
                  </div>
                )}
                {form.graphResourceId && form.enableGraphRag && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Higher values = richer graph but slower ingestion. Defaults: 10 chunks, 4 parallel.
                  </p>
                )}
              </Section>
            </>
          )}

          {/* Toggle between Basic and Advanced */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setAdvancedMode(!advancedMode)}
              className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-300"
            >
              {advancedMode ? (
                <>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 0 0 4.561 21h14.878a2 2 0 0 0 1.94-1.515L22 17" /></svg>
                  Switch to Basic Mode
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v18m-6-6l6 6 6-6" /></svg>
                  Advanced Settings
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Processing ──────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <Section title="Chunking" icon="🧩">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Chunk size (chars)"
                type="number"
                min={1}
                max={10000}
                value={form.chunkSize}
                onChange={(e) => set("chunkSize", e.target.value)}
              />
              <Input
                label="Overlap (chars)"
                type="number"
                min={0}
                value={form.chunkOverlap}
                onChange={(e) => set("chunkOverlap", e.target.value)}
              />
            </div>
          </Section>

          <Section title="Retrieval" icon="🔍">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Top-K results"
                type="number"
                min={1}
                max={100}
                value={form.retrievalTopK}
                onChange={(e) => set("retrievalTopK", e.target.value)}
              />
              <Input
                label="Similarity threshold"
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={form.retrievalScoreThreshold}
                onChange={(e) => set("retrievalScoreThreshold", e.target.value)}
              />
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-800/30 p-3">
              <div>
                <p className="text-sm font-medium text-slate-200">Hybrid search</p>
                <p className="text-[11px] text-slate-500">Combine vector similarity with keyword matching</p>
              </div>
              <Toggle
                checked={form.enableHybridSearch}
                onChange={(v) => set("enableHybridSearch", v)}
              />
            </div>
          </Section>

          <Section title="Notifications" icon="🔔">
            <div className="space-y-3">
              <Input
                label="Webhook URL"
                placeholder="https://hooks.slack.com/services/... or https://example.com/webhook"
                value={form.webhookUrl}
                onChange={(e) => set("webhookUrl", e.target.value)}
              />
              <p className="-mt-1 text-[11px] text-slate-500">
                Auto-detects Slack, Discord, or sends generic JSON payloads
              </p>

              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    label="HMAC Secret (optional)"
                    placeholder="For signature verification"
                    value={form.webhookSecret}
                    onChange={(e) => set("webhookSecret", e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Notify on</label>
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.webhookEvents.includes("completed")}
                      onChange={(e) => {
                        const events = toEventsString(form.webhookEvents).split(",").filter(Boolean);
                        if (e.target.checked) events.push("completed");
                        else { const i = events.indexOf("completed"); if (i >= 0) events.splice(i, 1); }
                        set("webhookEvents", events.join(","));
                      }}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                    />
                    <span className="flex items-center gap-1.5">
                      <span className="text-emerald-400">✓</span> Completed
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.webhookEvents.includes("failed")}
                      onChange={(e) => {
                        const events = toEventsString(form.webhookEvents).split(",").filter(Boolean);
                        if (e.target.checked) events.push("failed");
                        else { const i = events.indexOf("failed"); if (i >= 0) events.splice(i, 1); }
                        set("webhookEvents", events.join(","));
                      }}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                    />
                    <span className="flex items-center gap-1.5">
                      <span className="text-rose-400">✗</span> Failed
                    </span>
                  </label>
                </div>
              </div>

              {form.webhookUrl && row && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await api(`/gateway/kbs/${row.kb_key}/webhook/test`, { method: "POST", company });
                    } catch {
                      // silent — test webhook is fire-and-forget
                    }
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-700 hover:text-slate-100"
                >
                  🧪 Send test webhook
                </button>
              )}

              {form.webhookUrl && (
                <div className="rounded-lg bg-slate-800/30 p-3">
                  <p className="text-[11px] font-medium text-slate-400">Payload preview</p>
                  <pre className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-[10px] text-slate-500">
{JSON.stringify({
  event: "ingestion.completed",
  kbKey: form.kbKey || "my-kb",
  companyName: company || "my-company",
  timestamp: new Date().toISOString(),
  stats: { documentsProcessed: 42, documentsSkipped: 5, chunksCreated: 380, durationMs: 12345, mode: form.ingestScope || "all" },
}, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </Section>
        </div>
      )}

      {/* ── Step 5: Review ──────────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-4">
          <Section title="Review Knowledge Base" icon="✅">
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
              <h3 className="text-base font-semibold text-slate-100">{form.kbName || "Untitled"}</h3>
              <p className="mt-0.5 font-mono text-[11px] text-slate-500">{form.kbKey}</p>
              {form.description && <p className="mt-2 text-sm text-slate-400">{form.description}</p>}

              <dl className="mt-4 space-y-3 text-sm">
                <ReviewRow label="Source" value={sourceTypeLabel(form.sourceType)} />
                {form.sourceType === "custom" && form.rest.endpoint.trim() && (
                  <ReviewRow label="API endpoint" value={
                    form.rest.endpoint.length > 44 ? form.rest.endpoint.slice(0, 44) + "…" : form.rest.endpoint
                  } />
                )}
                {form.sourceType === "custom" && form.rest.authType !== "none" && (
                  <ReviewRow label="API auth" value={AUTH_TYPE_OPTIONS.find((a) => a.value === form.rest.authType)?.label || form.rest.authType} />
                )}
                {form.sourceType === "url" && form.websiteUrl && (
                  <ReviewRow label="Website" value={form.websiteUrl.trim()} />
                )}
                {form.sourceType === "url" && form.websiteUrl && !form.sitemapUrl && !form.urls && (
                  <p className="text-[11px] text-slate-500">
                    Sitemap will be discovered automatically from the site's robots.txt at ingest time.
                  </p>
                )}
                {form.sourceType === "url" && form.sitemapUrl && (
                  <ReviewRow label="Sitemap" value={form.sitemapUrl.trim()} />
                )}
                {form.sourceType === "url" && form.urls && (
                  <ReviewRow label="URLs" value={`${form.urls.split("\n").filter(Boolean).length} configured`} />
                )}
                <ReviewRow label="Scope" value={
                  form.ingestScope === "limit" ? `Custom limit: ${form.docLimit} documents` :
                  form.ingestScope === "selected" ? `Selected: ${form.selectedPages.split("\n").filter(Boolean).length} page(s)` :
                  "Entire website"
                } />
                <div className="border-t border-slate-700/50" />
                <ReviewRow label="Embedding" value={
                  selectedModel ? `${selectedModel.provider_name} · ${selectedModel.model_name}` : "Company default"
                } />
                <ReviewRow label="Vector Store" value={
                  vectorOptions.find((o) => o.value === form.vectorResourceId)?.label || "Company default"
                } />
                <ReviewRow label="Object Storage" value={
                  storageOptions.find((o) => o.value === form.storageResourceId)?.label || "Company default"
                } />
                <div className="border-t border-slate-700/50" />
                <ReviewRow label="Chunking" value={`${form.chunkSize} chars · ${form.chunkOverlap} overlap`} />
                <ReviewRow label="Retrieval" value={`Top-${form.retrievalTopK} · ≥ ${Number(form.retrievalScoreThreshold).toFixed(2)}`} />
                <ReviewRow label="Hybrid search" value={form.enableHybridSearch ? "✓ Enabled" : "— Disabled"} />
                <ReviewRow label="Graph" value={
                  form.graphResourceId
                    ? `${graphOptions.find((o) => o.value === form.graphResourceId)?.label || "—"}${form.enableGraphRag ? " · GraphRAG ✓" : " · GraphRAG —"}`
                    : "— Not configured"
                } />
                <div className="border-t border-slate-700/50" />
                <ReviewRow label="Webhook" value={form.webhookUrl ? `🔔 ${form.webhookEvents || "all events"}` : "— Not configured"} />
                {form.webhookUrl && <ReviewRow label="Webhook URL" value={form.webhookUrl.length > 40 ? form.webhookUrl.slice(0, 40) + '…' : form.webhookUrl} />}
              </dl>

              {defaultBindingWarnings.length > 0 && (
                <div className="mt-4 space-y-2">
                  {defaultBindingWarnings.map((w) => (
                    <div
                      key={w.kind}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
                      role="status"
                    >
                      ⚠️ {w.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>
        </div>
      )}

      {optionsError && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {optionsError}
        </div>
      )}
      {probeError && <ProbeErrorBanner probe={probeError} />}
      {!probeError && error && (
        <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {error}
        </div>
      )}
    </Modal>
  );
}

/** Review summary row: label on left, value on right. */
function ReviewRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-500 uppercase text-[10px] tracking-wider">{label}</dt>
      <dd className="text-right font-medium text-slate-200">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bind-time embedding probe failure banner
// ---------------------------------------------------------------------------

/** Persistent banner for a failed bind-time embedding probe — decodes the
 * structured verdict (err.probe via web/src/probe-verdict.js) into what
 * failed, why, and how to fix it. */
function ProbeErrorBanner({ probe }) {
  const { model, reason, detail } = decodeProbeVerdict(probe);
  return (
    <div role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
      <p className="font-semibold">⚠️ Embedding model check failed — the binding was not saved</p>
      <p className="mt-1 text-xs leading-relaxed text-rose-200/90">
        A live test embedding with <span className="font-medium text-rose-200">{model}</span> failed: {reason}
        {detail ? <span className="block break-words text-rose-300/70">{detail}</span> : null}
      </p>
      <p className="mt-1.5 text-xs text-rose-300/80">
        Set the embedding model dropdown back to “Company default (config)” to save without a KB-bound model, or pick a working model.
      </p>
    </div>
  );
}
