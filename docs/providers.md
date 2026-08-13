# Providers — Adding & Editing

A **provider** is the top-level entry in the AI gateway catalog (admin portal → **Catalog** page). It describes an AI/infrastructure service (OpenAI, Cloudflare Workers AI, a vector database, object storage, …) so that the rest of the platform can reference it: the **Credentials** page collects API keys per provider, the **Config** page lets a company pick its models/resources from this catalog, and knowledge bases can bind provider resources.

All provider management happens through the **5-step wizard** in the admin portal — there is no raw SQL needed.

---

## Where providers live (data model)

| Table | Holds |
|-------|-------|
| `providers` | key, name, category, auth type, URLs, logo |
| `provider_auth_schemas` | the **credential form fields** (what the Credentials page asks for) |
| `provider_endpoints` | API endpoints for this provider |
| `provider_resource_types` | resource templates (vector index, object bucket, …) |
| `provider_capabilities` / `provider_models` / `pricing` | capabilities + models + prices — **not** managed by the wizard |

> Models, pricing, and capabilities are added afterward from the **provider detail page**, not from the wizard.

---

## Adding a provider (New Provider wizard)

Click **New Provider** — it's the button in the Catalog header, inside the provider dropdown, and on a provider's detail page. A 5-step wizard opens; the current step is highlighted in indigo and completed steps are clickable back-links. A collapsible **"How to add a provider"** help panel (open by default) sits under the step indicator, and its highlighted tip follows the step you're on.

### Step 1 — Basics
- **Provider name\*** — e.g. "Cloudflare Workers AI". The **provider key auto-generates** from it: lowercased, spaces → `_` → `cloudflare_workers_ai`.
- **Provider key\*** — the stable route ID. Must match `/^[a-z0-9_]+$/`, 3–50 chars. Once you type in it manually it stops auto-syncing with the name. **This can never be changed later.**
- **Service category\*** — `ai`, `embedding`, `vector`, `storage`, `graph`, `image`, `speech`, `search`, `database`, `email`, or `analytics`. Drives the card color/group on the Catalog grid and whether the provider is treated as AI (models/pricing) or infrastructure (capabilities).
- **Website / Docs / Logo URLs** — optional; must be valid URLs (logo persists to `providers.logo_url`).

### Step 2 — Auth defaults
- **Auth type\*** — `api_key`, `bearer_token`, `oauth2`, `basic_auth`, or `custom`. Stored on the provider row.
- **Auth header name** — default `Authorization`; where the credential is attached when making calls.
- **Default API base URL** — the base endpoint callers hit.
- **API key format regex** — optional; validated live as you type (must be a valid RegExp). Used later on the Credentials page to sanity-check the format of entered values — it validates entry format, not access at request time.

### Step 3 — Credential form fields (→ `provider_auth_schemas`)
This is what end users see on the **Credentials** page when connecting this provider. Each row becomes one input on that form:
- **Field name\*** (e.g. `api_key`), **Field label\*** (e.g. "API Key"), **Field type** — `text`, `password`, `textarea`, `select`, `url`, `email`, `numeric`, `json`, `file`.
- **Required** / **Encrypted at rest** toggles.
- Placeholder, help text, validation regex, display order, group (`main`/`advanced`), width (`full`/`half`/`third`/`quarter`).
- **Storage path (in blob)** — defaults to the field name. ⚠ Renaming a field later changes where values are stored: previously-saved credential values keyed by the old path get **orphaned**. The wizard warns about this inline and suggests pinning the storage path to the original value.

### Step 4 — Endpoints & resource types
- **Endpoints** (→ `provider_endpoints`): **Name first** (e.g. "Chat Completions"), and the **endpoint key auto-generates** from it — lowercased, spaces → `-` → `chat-completions` (matches `/^[a-z0-9-]+$/`). Typing in the key manually stops the auto-sync; editing an existing endpoint keeps its key. Also: HTTP method, URL (valid `http`/`https`), timeout, and a **default** flag.
- **Resource types** (→ `provider_resource_types`): **Display name first** (e.g. "Vectorize Index"), and the **resource type auto-matches** from it (e.g. `vector_index`; `object_bucket`, `sql_database`, `graph_database`, `kv_namespace`, … are picked up from the name keywords). Choosing the type from the dropdown manually stops the auto-match; editing an existing one keeps its type. Also: description, required, `config_schema` (the dynamic fields the provisioning form renders), and max-per-credential. These drive the **Resources** card on the Credentials page: once a company connects a credential for this provider, it can provision actual resources (vector index, bucket, …) whose type must match one of these templates.

### Step 5 — Review & confirm
- Shows the key/name/category/auth type, the field/endpoint/resource lists, and the exact **row counts** that will be written per table.
- A **"No models attached"** warning reminds you models are added afterward from the detail page.
- **Save as Draft** stores the whole wizard state in `localStorage` (a restore/discard banner appears next time); **Create Provider** submits.

---

## Editing a provider

Click the **pencil** icon on a catalog row, or **Edit Provider** on the detail page. The **same 5-step wizard** opens, but:

- **Everything is prefilled** from the provider's current state (`authForm`, `endpoints`, `resourceTemplates` are mapped back into the wizard).
- The **provider key is locked** — it is the route identity and cannot be changed.
- Title reads **EDIT PROVIDER**, the footer button reads **Save Changes**, and there is no Save-as-Draft.
- **Removals actually apply**: saving uses `replaceChildren: true`, which deletes any field/endpoint/resource-type row **not** in your new definition — the sections become exactly what you see. Removing a whole section deletes all of that provider's rows for it. Capabilities, models, and pricing are **never** touched by the wizard.

---

## What happens under the hood (both flows)

1. The wizard builds a **flat provider definition** and POSTs it to `POST /gateway/providers/import` with `{ replaceChildren: true|false }`.
2. `validateProviderDefinition` normalizes both the wrapped (`{ provider, authentication }`) and flat (`{ providerKey, authFields }`) shapes and rejects bad keys/categories/URLs with a **400** before any DB work.
3. `importProviderDefinition` runs inside **one transaction**:
   - `upsertProvider` → `INSERT … ON DUPLICATE KEY UPDATE` on `providers` (including `logo_url`)
   - then upserts each auth field, endpoint, capability, resource type, and (if provided) model + pricing
   - if `replaceChildren`, the three `delete*NotIn` repository methods run **after** the upserts — `NOT IN (…)` with your keep-list, or a plain `DELETE … WHERE provider_id = ?` when a section is empty
   - commit (or full rollback on any failure — e.g. an FK error from pricing rows referencing a removed endpoint aborts the whole save)
4. The provider **registry cache is invalidated and reloaded**, so the list/detail views reflect the change immediately.

---

## Models — adding, editing & pricing

Models are owned by a **provider** (catalog-level, not tenant-level) and are managed from the provider's detail page: click a provider card on the Catalog grid, then open the **Models** tab. The wizard never touches models — they're added here, one at a time, or in bulk by re-importing provider JSON.

### Adding a model (Add Model modal)

Click **Add Model** on the Models tab. The modal's first field is the **model name**, and the **model key auto-generates** from it:

| Field | Notes |
|-------|-------|
| **Model name** * | Display name, e.g. `GPT-4o` or `Claude 3.5 Sonnet`. Autofocused. |
| **Model key** * | **Auto-generates from the name**: lowercased, dots and any `@`/`/` preserved, spaces/other chars → `-` (`Claude 3.5 Sonnet` → `claude-3.5-sonnet`). Typing in the key manually stops the auto-sync. Must match `/^[a-zA-Z0-9@][a-zA-Z0-9._:@/-]*$/` (≤ 100 chars) — plain slugs (`gpt-4o`) or vendor-prefixed IDs (`@cf/baai/bge-base-en-v1.5`, `xai/grok-4.6`). **Editable after creation** (rename in the edit modal; collisions with an existing key on the same provider are refused). |
| **Family** (optional) | e.g. `gpt-4`, `llama` — groups related models. |
| **Category** * | One of `chat`, `embedding`, `reranker`, `image`, `tts`, `stt`, `vision`. Drives which Config-page dropdown a model appears in (chat → LLM/small LLM, embedding → embedding, reranker → reranker). |
| **Streaming / Function calling / Vision** | Capability toggles stored as flags on the row. |
| **Max context window / Max output tokens** | Optional numbers (e.g. `128000` / `4096`). |
| **Starting price** (optional) | Input + Output `$ / 1M` tokens — creates the first pricing row immediately. Leave both blank to add pricing later via the inline table. |

### Editing & deleting a model

- **Edit** — pencil icon on a model row → the same modal opens **prefilled** (name, key, family, category, flags, context/output). The **key is now editable too** — type a new key and save to rename it (`PUT /gateway/providers/{key}/models/{id}`); pricing and credential model-access grants follow the model row. Pricing fields stay hidden in edit mode (pricing has its own inline flow).
- **Delete** — trash icon → `DELETE /gateway/providers/{key}/models/{id}`. This is a **hard delete**: pricing rows and any tenant `credential_model_access` grants **cascade away** with the model.
- ⚠ **Renaming onto an existing key is refused** — the key is the unique key per provider (`provider_id, model_key`), so a rename that collides with another model on the same provider returns `409`.

### Pricing (inline on the Models tab)

Every model row shows its **price history inline** — no expand needed. Each price row carries `effectiveAt`/`expiresAt` (time-bucketed history, so old prices stay queryable):

- A **current** price (no expiry) is green-badged; **past** prices (expired) are muted.
- **Add price** (small button in the model's price area) → `POST /gateway/pricing` with input/output `$ / 1M` + currency + effective date.
- **Pencil / trash** on a row → `PUT /gateway/pricing/{id}` / `DELETE /gateway/pricing/{id}` (a price referenced as the model's current price is protected).
- Rows refresh automatically after every add/edit/delete — no manual reload.

### Under the hood (model CRUD)

| Route | What it does |
|-------|-------------|
| `GET /gateway/providers/{key}/models` | List the provider's models, each with its current price row (from `pricing`). |
| `POST /gateway/providers/{key}/models` | **Upsert** a single model — same `provider_id + model_key` refreshes the row in place; body may include `pricing: [{ inputPricePerMillion, outputPricePerMillion, … }]` to create the first price row. Validates key format, required name, and category. |
| `PUT /gateway/providers/{key}/models/{id}` | Update metadata — **including the model key (rename)**. `key` in the body may differ from the stored key; renaming onto an existing key on the same provider returns 409. |
| `DELETE /gateway/providers/{key}/models/{id}` | Hard delete; pricing + `credential_model_access` cascade (see `schema/v5.sql`). |

After every create/update/delete the **registry cache is invalidated**, so the model shows up immediately in the provider's Models tab **and** in every company Config-page model dropdown.

> **Cloudflare model IDs (`@cf/…`):** the runtime passes config model values **verbatim** to Workers AI (`/ai/run/{model}`), so full IDs like `@cf/meta/llama-3.3-70b-instruct-fp8` work end-to-end once set on the Config page. The catalog accepts these IDs as model keys too (the key charset includes `@`, `/` and mixed case, e.g. `@cf/moondream/moondream3.1-9B-A2B`) — add them through the Add Model modal (the auto-key preserves `@`/`/`) and they flow straight into the company Config dropdowns.

---

## After you've added a provider

- **Provider detail page** — add **models** and **pricing** rows on the Models tab (see [Models — adding, editing & pricing](#models--adding-editing--pricing)), plus endpoints/capabilities per tab.
- **Credentials page** — "New credentials → select provider" renders the form defined in Step 3; type the name (auto-lowercased into the key), paste the API key, save, and it **auto-verifies** the credential with an inline probe result. Full walkthrough: [docs/credentials.md](credentials.md).
- **Resources (Credentials page)** — with a credential saved, the **Resources** card provisions infrastructure under it (`POST /gateway/companies/:key/resources`): pick the provider's resource type from Step 4, fill its `config_schema` fields, and save. `max_per_credential` caps how many of each type a single credential can hold. Full walkthrough: [docs/credentials.md](credentials.md).
- **Assistants page** — once a credential (and optionally a knowledge base) exists, an assistant binds them into a runtime persona (`/gateway/assistants` CRUD): credential + model from that credential's provider + KBs + system prompt + temperature/tokens.
- **Config page** — the company's provider/model dropdowns (large/small LLM, embedding, reranker, vector, object storage) can now reference this provider.
- **Knowledge bases** — KBs can bind this provider's resource types (vector index / object bucket) and catalog embedding models.

---

## Related

- Gateway API routes: `docs/AI_API_REFERENCE.md` → **Gateway - Provider Catalog**. The wizard saves through `POST /gateway/providers/import` (body `{ definition, replaceChildren }`).
- Provider wizard implementation: `web/src/pages/catalog/` (`page.jsx` list/detail view, `wizard.jsx` 5-step `ProviderWizardModal`, `modals/` one file per modal).
- Import/validation logic: `mysql/services/catalog-importer.js`; persistence: `mysql/repositories/catalog-import.js` (`CatalogImportRepository`); registry cache: `mysql/services/provider-registry.js`.
