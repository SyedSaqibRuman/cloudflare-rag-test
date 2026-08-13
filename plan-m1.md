# M1 Implementation Plan — Catalog + Foundations (Phases 0 + 1)

> Source of truth: `docs/platform-buildout.md` (FROZEN Architecture v1.0). This plan is the
> minute-level work breakdown for **M1 = Phase 0 (Foundations) + Phase 1 (Provider catalog
> completion)**. Written against the actual codebase state at HEAD `4b55215`.
> Schema truth: `migrations/001_init.sql` (checksummed — never edit; add `003`).

---

## 1. Goal & Definition of Done

Wire the two schema-only catalog tables into the live platform:

- `provider_endpoints` — CRUD + admin UI
- `provider_model_pricing` — CRUD + admin UI (history view, "current price" invariant)

**Definition of Done (all must hold):**

- [x] Migration `003_platform_seed.sql` exists, is idempotent (DML only), and applies cleanly on the live MariaDB (`node mysql/migrate.js` → "Applied 1 migration(s)"). Re-running is a no-op.
- [x] Seed data landed: 5 Cloudflare endpoints (`workers_ai`, `vectorize`, `r2`, `d1`, `kv`) and 13 pricing rows (from `schema/v5.sql` reference data).
- [x] `GET /gateway/providers/:key` returns `endpoints` inside the provider entry (registry cache extended).
- [x] Flat CRUD routes live: `GET/POST /gateway/endpoints`, `GET/POST /gateway/pricing` (+ `PUT/DELETE /:id` each). All behind existing `requireAdmin` + `adminLimiter` (`app.js:98`).
- [x] Every mutation writes an `audit_logs` row (`endpoint.created/.updated/.deleted`, `pricing.created/.updated/.deleted`).
- [x] Frontend: `#catalog` route → Provider Catalog page → provider detail with Endpoints + Models/Pricing tabs; add/edit/delete works end-to-end from the UI.
- [x] Frontend actually authenticates against `/gateway/*` (see **Critical finding F1** — `AUTH_PATHS` in `web/src/api.js` must gain `"/gateway"`).
- [x] New pure-logic tests green; full suite still 190/190 + new tests.
- [x] `web/dist` rebuilt; docs (`docs/openapi.js`, `docs/AI_API_REFERENCE.md`) updated.

---

## 2. Environment & Commands (verified this session)

| Thing | Value |
|---|---|
| Node | v26.5.0 (ESM, `node:sqlite` not needed here) |
| DB | MariaDB 11.8.8 @ `srv1398.hstgr.io:3306` / `u555265406_nodejs` (creds in `.env`, never print) |
| Migration state | 001 + 002 applied, 0 pending (`node mysql/migrate.js --dry-run` verified) |
| Server | `node app.js` (port 3000). **Never leave it running** (EADDRINUSE). User runs `npm run dev` themselves. |
| Tests | `node --test "config/__tests__/*.test.js" "query/__tests__/*.test.js" "cron/__tests__/*.test.js" "ingest/__tests__/*.test.js" "routes/__tests__/*.test.js" "mysql/__tests__/*.test.js"` → currently 190/190 |
| Build | `cd web && npm run build` → `web/dist` (required before the server serves UI) |
| Lint | none configured — match house style (2-space indent, `// ------` banners, emoji logs, JSDoc on exports) |

---

## 3. Pre-flight audit findings (affect the plan)

- **F1 — `AUTH_PATHS` gap (bug, must fix in M1).** `web/src/api.js:6` sets
  `AUTH_PATHS = ["/cloudflare", "/auth", "/logs"]` — **`/gateway` is missing**. The server
  gates `/gateway` with `requireAdmin` (`app.js:98`), so every UI call would 401 and the
  portal would bounce to the login page. Fix: `["/cloudflare", "/gateway", "/auth", "/logs"]`.
  (The current UI has never called `/gateway`, which is why this never surfaced.)
- **F2 — `companyFromRequest` already exists.** Phase 0's "extract `companyFromHeader`" is
  already done in `utils/request-context.js` (used by `routes/cloudflare.js:34`). M1 is
  **global catalog** — no company scoping needed. The only Phase 2+ work is a gateway variant
  that resolves against the MySQL `companies` table (`CompanyRepository.findByKey`) instead of
  `getCompanyConfig`; **defer to Phase 2**.
- **F3 — doc acceptance text drift.** `platform-buildout.md` §4 Phase 0 says
  "`/gateway/registry/:key` responses … include `endpoints` and `pricing`". The real route is
  `GET /gateway/providers/:key` (`gateway-router.js:82`). Plan targets the real route.
- **F4 — MySQL pool transactions.** `pool.query("BEGIN")` can land on a different pooled
  connection than the following queries. Any multi-statement work (pricing overlap close,
  is_default exclusivity) MUST use `const conn = await (await getPool()).getConnection()`
  + `conn.beginTransaction()/commit()/rollback()`.
- **F5 — `provider_resource_types.provision_endpoint_key` is a comment-only reference** to
  `provider_endpoints.endpoint_key` (VARCHAR column, no FK — verified in `001_init.sql`).
  Deleting an endpoint is technically safe, but if a resource type references its key the
  wizard breaks. DELETE must first check references and refuse with a 409.
- **F6 — web has no Chart.js** (`web/package.json` deps: radix dropdown, react, react-dom).
  M1 needs no charts (pricing history is a table). M6 must render a CSS bar list or add the dep.
- **F7 — registry is cached in memory** (`provider-registry.js` `cache`). Any write to
  endpoints/pricing must call `invalidateRegistry()` or the provider detail stays stale until
  the health worker reloads it.

---

## 4. Locked decisions (D1–D7)

- **D1 — Flat routes** (per doc §4 Phase 1 "pick flat"): `/gateway/endpoints`,
  `/gateway/pricing` with provider/model in query or body — NOT nested under
  `/providers/:key/…`.
- **D2 — Endpoints join the registry cache** (`refreshRegistry` adds `entry.endpoints`);
  **pricing history stays a flat query** (`GET /gateway/pricing?modelId=`). Current price is
  already joined into `ModelRepository.listByProvider` (`pmp … effective_to IS NULL`).
- **D3 — "Current price" invariant**: exactly one open row per model
  (`effective_to IS NULL`). Creating a new row with `effective_from` overlapping a row with no
  `effective_to` closes that row (`effective_to = new.effective_from - 1 day`) inside one
  transaction.
- **D4 — Validation is a pure, DB-free service** (`mysql/services/catalog-service.js`) so it
  is unit-testable without MySQL, mirroring `credential-service.js`.
- **D5 — SQL stays in repositories** (`repositories.js` gains `EndpointRepository` +
  `PricingRepository`); `provider-registry.js` gains thin read/write wrappers that delegate
  and invalidate the cache (satisfies the doc's `listEndpoints/saveEndpoint/listPricing/
  savePricing` names).
- **D6 — DELETE guards**: endpoint delete checks `provider_resource_types` references (409 on
  conflict); pricing delete always allowed.
- **D7 — `endpoint_key` validated `/^[a-z0-9-]+$/`, 3–50 chars** (`VARCHAR(50)`);
  `http_method` ∈ `GET|POST|PUT|DELETE|PATCH`; `endpoint_url` must parse via `new URL()`;
  `default_timeout_seconds` integer 1–3600.

---

## 5. Phase 0 — Foundations

> **Status: ✅ COMPLETE (verified 2026-08-07).** All four items landed:
> `003_platform_seed.sql` applied + idempotent (5 endpoints / 13 pricing rows live),
> registry cache carries `entry.endpoints` per provider, registry write wrappers
> invalidate the cache (F7), and 5.4 stays deferred by design (F2).

### 5.1 Create `migrations/003_platform_seed.sql` (DML only, idempotent)

**Status: ✅ done.** File exists (`migrations/003_platform_seed.sql`, DML-only, checksummed by `mysql/migrate.js`); 004 added later.

File header (house style + checksum warning):

```sql
-- --------------------------
-- 003_platform_seed.sql
-- Seed provider_endpoints + provider_model_pricing from the schema/v5.sql
-- reference data (v5 seeded these; migrations never did). DML only — no DDL.
-- Idempotent: rows already present are skipped, so re-running is a no-op.
-- Checksummed by mysql/migrate.js — NEVER edit after applying. Add 004.
-- --------------------------
```

**Endpoints** (from `schema/v5.sql:1186–1191`). Anti-join so it never duplicates:

```sql
INSERT INTO provider_endpoints
  (provider_id, endpoint_key, endpoint_name, endpoint_url, is_default)
SELECT p.id, s.endpoint_key, s.endpoint_name, s.endpoint_url, s.is_default
FROM (
  SELECT 'cloudflare' AS provider_key, 'workers_ai' AS endpoint_key, 'Workers AI'  AS endpoint_name,
         'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run' AS endpoint_url, TRUE AS is_default
  UNION ALL SELECT 'cloudflare', 'vectorize', 'Vectorize',
         'https://api.cloudflare.com/client/v4/accounts/{account_id}/vectorize', FALSE
  UNION ALL SELECT 'cloudflare', 'r2', 'R2 Storage',
         'https://api.cloudflare.com/client/v4/accounts/{account_id}/r2', FALSE
  UNION ALL SELECT 'cloudflare', 'd1', 'D1 Database',
         'https://api.cloudflare.com/client/v4/accounts/{account_id}/d1', FALSE
  UNION ALL SELECT 'cloudflare', 'kv', 'KV Store',
         'https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv', FALSE
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_endpoints pe
       ON pe.provider_id = p.id AND pe.endpoint_key = s.endpoint_key
WHERE pe.id IS NULL;
```

**Pricing** (from `schema/v5.sql:1272–1285`, all 13 rows). Same anti-join keyed on
`(provider_model_id, effective_from)`:

```sql
INSERT INTO provider_model_pricing
  (provider_model_id, effective_from, effective_to, input_price_per_million, output_price_per_million)
SELECT pm.id, s.effective_from, s.effective_to, s.input_price_per_million, s.output_price_per_million
FROM (
  SELECT 'gpt-4o' AS model_key, '2024-05-13' AS effective_from, '2024-08-31' AS effective_to, 10.00 AS input_price_per_million, 30.00 AS output_price_per_million
  UNION ALL SELECT 'gpt-4o',                 '2024-09-01', NULL,          5.00, 15.00
  UNION ALL SELECT 'gpt-4o-mini',            '2024-07-18', NULL,          0.15,  0.60
  UNION ALL SELECT 'o1',                     '2024-09-12', NULL,         15.00, 60.00
  UNION ALL SELECT 'text-embedding-3-large', '2024-01-25', NULL,          0.13, NULL
  UNION ALL SELECT 'text-embedding-3-small', '2024-01-25', NULL,          0.02, NULL
  UNION ALL SELECT 'claude-3-5-sonnet',      '2024-10-22', NULL,          3.00, 15.00
  UNION ALL SELECT 'claude-3-opus',          '2024-02-29', NULL,         15.00, 75.00
  UNION ALL SELECT 'claude-3-haiku',         '2024-03-07', NULL,          0.25,  1.25
  UNION ALL SELECT 'gemini-2.5-pro',         '2025-03-01', NULL,          1.25,  5.00
  UNION ALL SELECT 'gemini-2.5-flash',       '2025-03-01', NULL,          0.075, 0.30
  UNION ALL SELECT 'llama-3.1-70b-versatile','2024-07-01', NULL,          0.59,  0.79
  UNION ALL SELECT 'mistral-large-latest',   '2024-04-01', NULL,          2.00,  6.00
) s
JOIN provider_models pm ON pm.model_key = s.model_key
LEFT JOIN provider_model_pricing pp
       ON pp.provider_model_id = pm.id AND pp.effective_from = DATE(s.effective_from)
WHERE pp.id IS NULL;
```

Notes:
- `DATE(s.effective_from)` guards the DATE↔string comparison in the MariaDB driver path.
- Do **not** add partition clauses (pricing table has none) and do **not** touch stored procs.
- `node mysql/migrate.js` computes the SHA-256 checksum of the raw file → **freeze after
  first successful apply**.

### 5.2 Apply + verify migration

**Status: ✅ done.** `node mysql/migrate.js --dry-run` → "No pending migrations" (003 applied); re-run is a no-op. Live counts verified: `endpoints 5 pricing 13`.

```bash
node mysql/migrate.js --dry-run   # expect: Pending (1): 003_platform_seed.sql
node mysql/migrate.js             # expect: ⚙️ Applying … ✅ Applied 1 migration(s).
node mysql/migrate.js             # second run: "0 pending" (idempotency proof)
```

Verify rows (read-only; do not print credentials):

```bash
node -e "import('./mysql/pool.js').then(async m => { const p = await m.getPool();
  const [e] = await p.query('SELECT COUNT(*) c FROM provider_endpoints');
  const [pr] = await p.query('SELECT COUNT(*) c FROM provider_model_pricing');
  console.log('endpoints', e[0].c, 'pricing', pr[0].c); await p.end(); })"
# expect: endpoints 5  pricing 13
```

### 5.3 Registry service extension — `mysql/services/provider-registry.js`

**Status: ✅ done.** `refreshRegistry()` loads `EndpointRepository.list({ providerId })` into `entry.endpoints`; `listEndpoints`/`listPricing` reads + `saveEndpoint`/`updateEndpoint`/`removeEndpoint`/`savePricing`/`updatePricing`/`removePricing` mutators all `invalidateRegistry()` (F7). `GET /gateway/providers/:key` therefore returns `endpoints` (DoD item met).

Add (imports `EndpointRepository`, `PricingRepository`, `CatalogService` from the new modules):

```js
/** Endpoints for one provider (flat, uncached read). */
export async function listEndpoints(providerKey) { /* providerKey → provider.id → EndpointRepository.list({ providerId }) */ }

/** Pricing history for one provider (flat, uncached read). */
export async function listPricing(providerKey) { /* → PricingRepository.list({ providerKey }) */ }

/** Create/update an endpoint; invalidates the registry cache on success. */
export async function saveEndpoint(input) { /* → CatalogService.saveEndpoint(input); invalidateRegistry() */ }

/** Create/update a pricing row; invalidates the registry cache on success. */
export async function savePricing(input) { /* → CatalogService.savePricing(input); invalidateRegistry() */ }
```

Also extend `refreshRegistry()` (line 38 `Promise.all`) with
`EndpointRepository.list({ providerId: provider.id })` → `entry.endpoints`. **Do not** bulk-load
pricing history into the cache (D2) — current price already rides on `models`.

### 5.4 Shared middleware (deferred — see F2)

**Status: ✅ n/a by design.** No code in M1; documented for Phase 2 (`mysql/services/company-scope.js` → `CompanyRepository.findByKey`).

No code in M1. Document for Phase 2: new `mysql/services/company-scope.js` exporting
`requireGatewayCompany(req, res, next)` that resolves `x-company-name` via
`CompanyRepository.findByKey` (NOT `companyFromRequest`, which reads the RAG `company_config`).

---

## 6. Phase 1 — Backend

### 6.1 `mysql/services/catalog-service.js` (new — pure validation + transaction helpers)

All functions DB-free except the two `*WithOverlap`/`save*` writers. Follow
`credential-service.js` shape (plain functions + JSDoc).

```js
export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
export const ENDPOINT_KEY_RE = /^[a-z0-9-]+$/;   // 3–50 chars

// --- Endpoint -------------------------------------------------
export function validateEndpointInput(input)
// Returns { ok: true, value } | { ok: false, errors: { field: msg } }
// Rules (D7):
//  providerKey        required, must exist later (route resolves via Registry.getProvider)
//  endpointKey        required, ENDPOINT_KEY_RE, 3–50 chars
//  endpointName       required, ≤100 chars
//  endpointUrl        required, ≤500 chars, `new URL()` must succeed
//  httpMethod         optional → "POST"; must be in HTTP_METHODS
//  defaultTimeoutSeconds optional → 30; integer 1–3600
//  isDefault / isActive optional booleans

export async function saveEndpoint(input)
// 1. validateEndpointInput → throw/return errors
// 2. provider = Registry.getProvider(providerKey) → 404-style error if null
// 3. EndpointRepository.findByKey(provider.id, endpointKey) → 409 if exists
// 4. transaction (F4, dedicated connection):
//      if input.isDefault → EndpointRepository.clearDefaults(provider.id, excludeId=null)
//      EndpointRepository.create(provider.id, value)
// 5. invalidateRegistry(); return { id }

export async function updateEndpoint(id, input)
// Same validation; fetch existing → 404 if missing;
// findByKey uniqueness excluding id; if isDefault → clearDefaults(provider_id, excludeId=id);
// EndpointRepository.update(id, value); invalidateRegistry()

export async function removeEndpoint(id, { audit, actor } )
// 1. EndpointRepository.findById(id) → 404 if missing
// 2. reference check (F5): SELECT COUNT(*) FROM provider_resource_types
//      WHERE provider_id = ? AND provision_endpoint_key = ? AND is_active = TRUE
//      → throw 409 "endpoint in use by N resource type(s)"
// 3. EndpointRepository.remove(id); invalidateRegistry()

// --- Pricing ---------------------------------------------------
export function validatePricingInput(input)
// Rules (D3/D7):
//  providerModelId    required, positive int
//  effectiveFrom      required, valid YYYY-MM-DD date
//  effectiveTo        optional; must be > effectiveFrom when set
//  all *_price_per_million / image_price / request_price  optional DECIMAL ≥ 0 (finite)
//  priceCurrency      optional → "USD", ≤10 chars
//  billingUnit        optional → "tokens", ≤50 chars
//  tierName           optional → "standard", ≤50 chars
//  minUnits           optional positive int; rateLimitNotes optional ≤500 chars

export async function savePricing(input)
// 1. validatePricingInput
// 2. ModelRepository.findById(providerModelId) → error if null
// 3. transaction (F4):
//      if effectiveTo is null OR overlaps the open row →
//        PricingRepository.closeCurrent(modelId, effectiveFrom - 1 day)
//      PricingRepository.create(modelId, value)
// 4. invalidateRegistry(); return { id }

export async function updatePricing(id, input)
// 1. validatePricingInput; PricingRepository.findById(id) → 404 if missing
// 2. re-close open row if the edit re-opens/extends the range (same overlap rule)
// 3. PricingRepository.update(id, value); invalidateRegistry()

export async function removePricing(id) { /* findById → 404; remove; invalidateRegistry() */ }
```

### 6.2 Repositories — append to `mysql/repositories.js`

Follow the existing object-literal + `getPool()` pattern exactly (2-space indent, same banner).

```js
// ------------------------------------------------------------------
// EndpointRepository — provider_endpoints (global catalog metadata)
// ------------------------------------------------------------------
export const EndpointRepository = {
  // list({ providerId = null, providerKey = null }) — JOIN providers p,
  //   WHERE (? IS NULL OR pe.provider_id = ?) AND (? IS NULL OR p.provider_key = ?)
  //   ORDER BY p.provider_name, pe.is_default DESC, pe.endpoint_name
  //   Returns: id, provider_id, provider_key, provider_name, endpoint_key,
  //            endpoint_name, endpoint_url, http_method, default_timeout_seconds,
  //            is_default, is_active, created_at, updated_at
  async list(opts = {}) { /* see above */ },

  async findById(id) { /* SELECT same shape WHERE pe.id = ? */ },

  // Uniqueness gate for uk_provider_endpoint (provider_id, endpoint_key)
  async findByKey(providerId, endpointKey) { /* WHERE provider_id = ? AND endpoint_key = ? */ },

  async create(providerId, input) { /* INSERT (provider_id, endpoint_key, endpoint_name,
      endpoint_url, http_method, default_timeout_seconds, is_default, is_active) */ },

  async update(id, input) { /* UPDATE … WHERE id = ? — dynamic SET from provided keys */ },

  async clearDefaults(providerId, excludeId = null) { /* UPDATE provider_endpoints
      SET is_default = FALSE WHERE provider_id = ? AND (? IS NULL OR id <> ?) */ },

  async remove(id) { /* DELETE FROM provider_endpoints WHERE id = ? (hard delete — no
      deleted_at column on this table) */ },

  // F5 guard
  async countResourceTypeReferences(providerId, endpointKey) { /* SELECT COUNT(*) FROM
      provider_resource_types WHERE provider_id = ? AND provision_endpoint_key = ? */ },
};

// ------------------------------------------------------------------
// PricingRepository — provider_model_pricing (time-bucketed price history)
// ------------------------------------------------------------------
export const PricingRepository = {
  // list({ providerModelId = null, providerKey = null }) — JOIN provider_models pm,
  //   JOIN providers p; WHERE (? IS NULL OR pmp.provider_model_id = ?)
  //   AND (? IS NULL OR p.provider_key = ?); ORDER BY pm.model_name, pmp.effective_from DESC
  //   Returns all 19 columns of provider_model_pricing + model_key, model_name, provider_key
  async list(opts = {}) { /* see above */ },

  async findById(id) { /* same shape WHERE pmp.id = ? */ },

  async create(modelId, input) { /* INSERT … effective_from DATE, effective_to DATE */ },

  async update(id, input) { /* UPDATE … WHERE id = ? — dynamic SET */ },

  // D3: close the open-ended row for a model (effective_to IS NULL)
  async closeCurrent(modelId, effectiveToDate) { /* UPDATE provider_model_pricing
      SET effective_to = ? WHERE provider_model_id = ? AND effective_to IS NULL */ },

  async remove(id) { /* DELETE FROM provider_model_pricing WHERE id = ? (hard delete) */ },
};
```

### 6.3 Routes — append to `mysql/gateway-router.js`

New numbered sections **5. ENDPOINTS** and **6. PRICING** after the MODEL ACCESS block
(before the `PROBES` const). All use the existing `wrap()` helper; company header not needed
(global catalog, D1). Audit wiring mirrors the credential routes (`AuditRepository.log` with
`actorId: req.auth?.user`).

```
GET    /endpoints?provider=<providerKey>
  → Registry.listEndpoints(providerKey | null)   → { success: true, endpoints: [...] }
  (no provider filter → EndpointRepository.list() across all providers)

POST   /endpoints
  body: { providerKey, endpointKey, endpointName, endpointUrl,
          httpMethod?, defaultTimeoutSeconds?, isDefault?, isActive? }
  → 400 validation errors | 404 unknown provider | 409 duplicate key
  → 201 { success: true, message, endpointId }
  audit: "endpoint.created", entityType "endpoint", afterState {endpoint_key, provider_key}

PUT    /endpoints/:id
  body: same minus providerKey (provider fixed at creation)
  → 404 | 400 | 409 (key clash with another row) | 200 { success: true, message }
  audit: "endpoint.updated" (+ before/after state JSON)

DELETE /endpoints/:id
  → 404 | 409 "in use by N resource type(s)" (F5) | 200 { success: true, message }
  audit: "endpoint.deleted", afterState { endpoint_key }

GET    /pricing?modelId=<id>&provider=<providerKey>
  → PricingRepository.list (filter by either) → { success: true, pricing: [...] }

POST   /pricing
  body: { providerModelId, effectiveFrom, effectiveTo?, inputPricePerMillion?,
          outputPricePerMillion?, cachedInputPricePerMillion?, imagePrice?,
          audioInputPricePerMillion?, audioOutputPricePerMillion?, requestPrice?,
          priceCurrency?, billingUnit?, tierName?, minUnits?, rateLimitNotes? }
  → 400 validation | 404 unknown model | 201 { success: true, message, pricingId }
  audit: "pricing.created", entityType "pricing", afterState {model_key, effective_from}

PUT    /pricing/:id → 404 | 400 | 200; audit "pricing.updated" (+ before/after)

DELETE /pricing/:id → 404 | 200; audit "pricing.deleted"
```

Response/error shapes must match the existing `/gateway` convention exactly:
`{ success: true, … }` / `{ success: false, error, errors? }`.

### 6.4 Registry import updates

`gateway-router.js` top imports: add `EndpointRepository`, `PricingRepository`,
`CatalogService`, and extend `import * as Registry from "./services/provider-registry.js"`
(no change needed — `saveEndpoint/savePricing/listEndpoints/listPricing` come off the
namespace). Decide in-code which of the flat GETs route through `Registry.listEndpoints`
(provider-filtered) vs `EndpointRepository.list` (unfiltered) — both are fine; keep the
registry wrappers as the sanctioned path per the doc.

---

## 7. Phase 1 — Frontend

### 7.1 `web/src/api.js`

- **F1 fix:** line 6 → `const AUTH_PATHS = ["/cloudflare", "/gateway", "/auth", "/logs"];`
- Append (all `api()`-based, admin token now attached via the fix above):

```js
export const listProviders = () => api("/gateway/providers").then((d) => d.providers);
export const getProvider = (key) => api(`/gateway/providers/${encodeURIComponent(key)}`).then((d) => d.provider);
export const listEndpoints = (provider) =>
  api(`/gateway/endpoints${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`).then((d) => d.endpoints);
export const createEndpoint = (body) => api("/gateway/endpoints", { method: "POST", body });
export const updateEndpoint = (id, body) => api(`/gateway/endpoints/${id}`, { method: "PUT", body });
export const deleteEndpoint = (id) => api(`/gateway/endpoints/${id}`, { method: "DELETE" });
export const listPricing = (modelId) =>
  api(`/gateway/pricing${modelId ? `?modelId=${modelId}` : ""}`).then((d) => d.pricing);
export const createPricing = (body) => api("/gateway/pricing", { method: "POST", body });
export const updatePricing = (id, body) => api(`/gateway/pricing/${id}`, { method: "PUT", body });
export const deletePricing = (id) => api(`/gateway/pricing/${id}`, { method: "DELETE" });
```

### 7.2 Routing — `web/src/App.jsx`

- `import Catalog from "./pages/Catalog";`
- `PAGES` gains `catalog: Catalog`.
- Split hash segments so detail routes work (`#catalog/cloudflare`):
  ```js
  const [seg, ...rest] = route.split("/");
  const Page = PAGES[seg] || Dashboard;
  // <Layout route={seg} …><Page navigate={navigate} path={route} /></Layout>
  ```
  (`useHashRoute` returns the raw hash — verified `web/src/hooks.js:3-17`.)

### 7.3 Nav — `web/src/components/Layout.jsx`

- New NAV group after "Infrastructure":
  ```js
  {
    section: "Catalog",
    items: [{ id: "catalog", label: "Providers", icon: <IconLayers /> }],
  },
  ```
- `IconLayers`: inline SVG in the existing icon style (24×24, `stroke="currentColor"`
  `strokeWidth={1.5}` `fill="none"` — match the sibling icon functions' attributes).
- `PAGE_META.catalog = { title: "Provider Catalog", subtitle: "Global provider metadata — models, endpoints, and pricing" }`.

### 7.4 `web/src/pages/Catalog.jsx` (new)

Pattern source: `Cloudflare.jsx` (usePoll, Card/Button/Input/Select/Badge/Empty/Spinner/Modal/
IconButton/Toast, `window.confirm` before destructive actions).

**State:** `providers` (poll 30s, `listProviders()`), `selected` provider key (from `path`
prop: `path.split("/")[1]`), `detail` (fetched via `getProvider(key)` when selected), local
`endpoints`/`pricing` lists, tab state, modal state (`addEndpoint|editEndpoint|addPricing|
editPricing`), `toast`, `busy*`.

**List view** (no company selected required — global):
- Header actions: `useHeaderActions(<Button onClick={load}>Refresh</Button>)`.
- Grid of provider cards (2-col like §6.1 wireframe): name, `Badge` with category, authType,
  counts line: `Models {n} · Endpoints {n} · Capabilities {n} · Pricing {n}`. Click →
  `navigate("catalog/" + key)`.

**Detail view** (`#catalog/<key>`):
- Back button (`navigate("catalog")`), provider title, tabs (local state):
  `models | endpoints | capabilities | resources`.
- **Endpoints tab:**
  - Table: `endpoint_key` · name · `Badge` method · URL (truncated, `title` tooltip) ·
    timeout · `Badge` default · `Badge` active · `IconButton` edit/delete per row.
  - `[Add Endpoint]` → Modal (fields: endpointKey, endpointName, endpointUrl, httpMethod
    Select, defaultTimeoutSeconds, isDefault checkbox) → `createEndpoint({ providerKey, … })`.
  - Edit reuses the same modal prefilled → `updateEndpoint(id, body)`.
  - Delete: `window.confirm("Delete endpoint 'X'?")` → `deleteEndpoint(id)` → `load()`.
  - Inline `endpoint_key` validation hint (regex `/^[a-z0-9-]+$/`, 3–50) under the field.
- **Models tab:**
  - Table (from `detail.models`): model_key/name · family · category · context/output ·
    streaming/functions/vision checks · **current price** (input/output per M) ·
    `[History]` expander + `[Add price]`.
  - Expander loads `listPricing(model.id)` → sub-table: effective_from → effective_to ·
    input · output · currency · `Badge "current"` when `effective_to === null` ·
    edit/delete IconButtons.
  - Add/Edit price Modal: `effectiveFrom` (date), `effectiveTo` (date, optional),
    input/output price (number, optional), currency Select (USD default) →
    `createPricing({ providerModelId, … })` / `updatePricing(id, body)`.
  - Delete price: `window.confirm` → `deletePricing(id)`.
- **Capabilities tab:** read-only table (capability_key, is_supported badge, config JSON
  pretty-printed in `<pre>`).
- **Resource types tab:** read-only table (resource_type, display_name, description,
  is_required, provision_endpoint_key, config_schema).

Polling: `usePoll(load, 30000, [selected])` for the detail page (registry is cached server-side,
so 30s is plenty; manual Refresh button too).

---

## 8. Tests

### 8.1 New: `mysql/__tests__/catalog-service.test.js` (pure, no DB — mirrors
`credential-service.test.js` style)

| # | Test |
|---|---|
| 1 | `validateEndpointInput` rejects missing providerKey/endpointKey/endpointName/endpointUrl |
| 2 | rejects endpoint_key with uppercase/spaces/underscore (`ENDPOINT_KEY_RE`) |
| 3 | rejects endpoint_key < 3 or > 50 chars |
| 4 | rejects bad URL (`not a url`) |
| 5 | rejects unknown httpMethod; defaults to "POST" when omitted |
| 6 | rejects non-integer/out-of-range timeout; defaults to 30 |
| 7 | accepts a fully valid endpoint input and returns normalized value |
| 8 | `validatePricingInput` rejects missing providerModelId / effectiveFrom |
| 9 | rejects invalid date string and effectiveTo ≤ effectiveFrom |
| 10 | rejects negative/non-numeric prices; accepts null optional prices |
| 11 | defaults currency "USD", billingUnit "tokens", tierName "standard" |
| 12 | accepts full optional price column set (cached/audio/image/request) |
| 13 | `HTTP_METHODS` contains exactly the 5 enum values from `001_init.sql` |

Target: ~13 tests. Regression: full suite glob stays 190/190.

### 8.2 What we deliberately do NOT test (with reason)

- Repository SQL (needs live MariaDB — the repo's existing convention keeps `mysql/__tests__`
  DB-free; keep it that way).
- Route handlers (would need a real DB or a mocking lib the project doesn't have).
- Coverage comes from the manual E2E checklist (§10) + the pure validators.

---

## 9. Docs sync (M1 closes with these updated)

1. `docs/openapi.js` — add to `paths` (file structure verified: `paths` opens at line 120):
   - `/gateway/endpoints`: GET, POST
   - `/gateway/endpoints/{id}`: PUT, DELETE
   - `/gateway/pricing`: GET, POST
   - `/gateway/pricing/{id}`: PUT, DELETE
   - Minimal `schemas` (Endpoint, Pricing) + 401/403 responses; keep `components` consistent
     with the existing spec.
2. `docs/AI_API_REFERENCE.md` — currently has **zero** `/gateway` mentions (verified). Add an
   "AI Gateway — Provider Catalog" section documenting the 8 routes, request/response shapes,
   and the current-price invariant.
3. `docs/platform-buildout.md` — **no edits** (frozen). If implementation finds drift (e.g.
   F3), that's an allowed incremental note only.

---

## 10. Manual E2E verification checklist (run in order)

```bash
# 0. Preflight
node mysql/migrate.js --dry-run            # Pending (1): 003_platform_seed.sql
node --test "config/__tests__/*.test.js" "query/__tests__/*.test.js" \
  "cron/__tests__/*.test.js" "ingest/__tests__/*.test.js" \
  "routes/__tests__/*.test.js" "mysql/__tests__/*.test.js"   # 190/190 + ~13 new

# 1. Migration
node mysql/migrate.js                      # Applied 1 migration(s)
node mysql/migrate.js                      # 0 pending (idempotent)

# 2. Server (own process, kill after)
node app.js &                              # then curl checks; kill afterwards

# 3. API (ADMIN_TOKEN = token from POST /auth/login)
curl -s localhost:3000/gateway/providers/cloudflare -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq '.provider.endpoints | length'      # 5 (registry now carries endpoints)
curl -s "localhost:3000/gateway/endpoints?provider=cloudflare" -H "Authorization: Bearer $ADMIN_TOKEN"
curl -s "localhost:3000/gateway/pricing" -H "Authorization: Bearer $ADMIN_TOKEN"   # 13 rows
curl -s -X POST localhost:3000/gateway/endpoints -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"providerKey":"groq","endpointKey":"chat","endpointName":"Chat Completions",
       "endpointUrl":"https://api.groq.com/openai/v1/chat/completions","httpMethod":"POST"}'
# → 201; repeat same body → 409
# pricing overlap: POST a gpt-4o-mini row with effectiveFrom 2026-01-01 →
#   the NULL-effective_to row must now read effective_to = 2025-12-31
# DELETE a used endpoint (cloudflare/vectorize) → 409 (referenced by resource types)
curl -s -X DELETE localhost:3000/gateway/pricing/1 -H "Authorization: Bearer $ADMIN_TOKEN"
curl -s "localhost:3000/gateway/companies/popularcert/audit" -H "Authorization: Bearer $ADMIN_TOKEN"
# → shows endpoint.* / pricing.* rows

# 4. UI
cd web && npm run build                     # REQUIRED before restart
# browse #catalog → open Cloudflare → Endpoints tab shows 5 rows
# Models tab → expand gpt-4o-mini → History shows old+new row, "current" badge moved
# Add endpoint for Groq → appears after Refresh; delete it → confirm dialog works

# 5. Cleanup
# kill the background app.js (never leave port 3000 busy)
```

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **003 checksum freeze** — a typo after applying means a new 004, not a fix | Dry-run + `--dry-run` before apply; eyeball the SQL twice; keep the file minimal |
| **Pooled-connection transactions** (F4) | All multi-statement writes use `getConnection()` + explicit begin/commit/rollback |
| **UI 401s on /gateway** (F1) | Fix `AUTH_PATHS` first — without it every catalog action bounces to Login |
| **Stale registry cache after writes** (F7) | `saveEndpoint`/`savePricing`/`remove*` all call `invalidateRegistry()`; UI polls anyway |
| **DELETE breaking the provisioning wizard** (F5) | 409 guard on `provider_resource_types` references |
| **Pricing overlap corrupting "current"** | Single transaction: close open row then insert; validator rejects `effectiveTo ≤ effectiveFrom` |
| **DATE↔string coercion in idempotency** | `DATE(s.effective_from)` in the anti-join |
| **Portal shows all pages to all admins** | Acceptable — the portal already requires admin login globally; per-role gating is out of scope |

---

## 12. Effort estimate

| Step | Est. (AI) |
|---|---|
| 003 migration + apply + verify | 20–30 min |
| Repositories + catalog-service | 60–90 min |
| Router + audit + registry wiring | 45–60 min |
| Unit tests (13) + regression | 30–45 min |
| api.js + routing + nav | 20–30 min |
| Catalog.jsx (list/detail/tabs/modals) | 90–120 min |
| Build + E2E checklist + docs sync | 45–60 min |
| **Total** | **~5–7 h** (vs 2–3 d human per doc) |
