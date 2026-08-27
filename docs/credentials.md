# Credentials — Provider Connections & Auto-Verify

Credentials are **per-company, per-provider API keys** stored in the AI gateway layer. There is no standalone Connections page anymore: provider credentials are managed on the **provider detail page** (admin portal → **Providers** → click a provider → **Connections** card), following the 9Router model of one card per provider with its stored API keys listed inline. Each credential row points at a provider from the catalog, holds the secret fields that provider's auth schema defines, and can be **verified** against the live provider.

---

## How credentials work

| Concept | Details |
|---------|---------|
| Scope | Credentials belong to a **company** (tenant) — pick the company in the sidebar company picker. |
| Provider | Each credential connects to one catalog provider (OpenAI, Cloudflare, …). |
| Auth schema | The credential form is generated from the provider's `provider_auth_schemas` (defined in the provider's catalog entry — seeded/imported, not editable in the portal). |
| Encryption | Values are encrypted **individually** with AES-256-GCM (`gcm:` blobs) inside one JSON blob (`encrypted_credentials`). Decrypted values exist only in memory — never in API responses. Requires `APP_ENCRYPTION_KEY`. |
| Verification | `last_verification_status` is stored per credential (`success` / `failed` / `unverified`) and shown as a status badge. |

> **Encrypted at rest:** when you create a credential, the response only returns `{ credentialId }` and a message like `Credential 'openai_main' stored (encrypted at rest, encryption_version 1)`. Secrets are never echoed back.

---

## Connecting a provider (Add Connection)

1. Open **Providers** (`#catalog`), click the provider card, and select the **company** in the sidebar company picker.
2. Click **Add Connection** on the provider detail page's **Connections** card.
3. The provider is locked to the page you're on; the form loads the provider's credential fields from its auth schema (`GET /gateway/providers/:key/auth-form`).
4. **Name** the credential — the **credential key auto-generates** from the name (lowercased, spaces → `_`). The key is the stable identifier for this credential; once you type it manually it stops auto-syncing.
5. **Fill the secret fields** (e.g. the API key, shown as a password input). If the provider has no schema, a plain **API Key** field is shown instead.
6. Optionally pick an **environment** (dev/prod/…) and toggle **Default credential**.
7. **Save** → `POST /gateway/companies/:key/credentials`.

### What happens on save (under the hood)

1. The route validates `providerKey`, `credentialKey`, and `credentialName` (400 if missing), and the provider must exist.
2. `validateFieldsAgainstSchema` checks the submitted fields against the provider's auth schema — required fields present, values matching their `validation_regex` (400 `Invalid credential fields.` with per-field errors otherwise).
3. Each field is **encrypted** (`encryptCredential`) into `gcm:` blobs; the blob and `encryption_version` are persisted; `credential.created` is audit-logged (sensitive).
4. Returns **201** with `credentialId`.

---

## Auto-verify after save

Immediately after a successful save, the portal **automatically verifies** the new credential and shows the probe result in a toast:

1. `POST /gateway/credentials/:id/verify`
2. The credential is decrypted and **format-verified** against the auth schema (required fields + regexes). This alone marks the result `success` or `failed`.
3. If format validation passes **and** the provider has a **live probe** (`PROBES` map in `mysql/routes/probes.js`), a connectivity check runs. Currently only `cloudflare` has a probe — it calls `GET https://api.cloudflare.com/client/v4/user/tokens/verify` with the token and measures latency.
   - Probe failure → overall status flips to `failed` with the provider's error message.
   - Probe success → `latencyMs` is recorded.
4. `last_verification_status` + `last_verified_at` are persisted, `credential.verified.success|failed` is audit-logged, and the response is `{ success, status, latencyMs?, error?, warning? }`.

Each key row's badge (`verified` / `failed` / `unverified`) on the Connections card reflects the latest result, and you can re-run verification any time with the ✓ button on the row.

> Providers without a probe still get format-level verification — a well-formed credential reports `success` even without a live network call.

### Prefilled edit form (non-secret fields)

When you edit a credential, **non-secret** stored fields come back decrypted and prefill the form — e.g. Cloudflare's **Account ID** (`account_id`) and **API Base URL** (`base_url`) — so you see what's saved and can change it. Secrets (password-type schema fields such as `api_token`) always stay blank: leave them empty to keep the stored value, enter a new value to replace it.

Mechanically, the credentials list accepts `?includeStored=1` (the portal sends it for the edit form). The server decrypts each blob and returns only fields the provider's auth schema **declares** as non-password — stored values under undeclared names (e.g. a legacy generic `api_key` field) are never exposed, and the raw encrypted blob never leaves the server.

---

## Managing credentials

The provider detail page's **Connections** card lists that provider's stored API keys **inline** (no separate table). Per-key rows:

| Action | How |
|--------|-----|
| **Verify** | ✓ icon on a row → `POST /gateway/credentials/:id/verify` (same probe pipeline as auto-verify). |
| **Edit** | Pencil icon → the same modal, prefilled with the non-secret stored fields. |
| **Enable/disable** | Toggle on the row flips `is_active` (`PUT /gateway/credentials/:id` with `{ isActive }`). |
| **Delete** | 🗑 icon → `DELETE /gateway/credentials/:id`. Soft-deletes the row so it can no longer be resolved; `credential.deleted` is audit-logged. |

**Rotate** and per-credential **model access** are API-only today (the portal UI was removed): `POST /gateway/credentials/:id/rotate` with `{ fields, reason }` (only submitted values change — empty fields keep the current secret; `credential.rotated` is audit-logged) and `POST /gateway/credentials/:id/models` (grant access to specific catalog models with optional `rateLimitPerMin` / `monthlyQuotaTokens` / `isDefaultForCategory`). Environments are also created via the API (`POST /gateway/companies/:key/environments`); the credential modal still lets you assign a credential to an existing environment.

---

## Provider resources (provisioning)

Provisioning **infrastructure resources** (vector index, object bucket, …) under a company credential — the *company → credential → resource* chain — is **API-only** in the portal today:

1. `POST /gateway/companies/:key/resources` with `{ providerKey, credentialId, resourceType, resourceKey, resourceName, config? }`.
2. **Name** the resource — the **resource key auto-generates** from the name (lowercased, spaces → `-`; must match `/^[a-z0-9-]+$/`, 3–63 chars, unique per company).
3. Fill any **config fields** the provider's resource template defines (`config_schema` — e.g. index name, dimensions, bucket region).

### What happens on save (under the hood)

1. Validates `providerKey`, `credentialId`, `resourceType`, `resourceKey`, `resourceName` (400 if missing); `resourceType` must be one of the catalog's eight types (`vector_index`, `object_bucket`, `sql_database`, `kv_namespace`, `graph_database`, `embedding_index`, `search_index`, `cache_namespace`).
2. The provider must exist **and** advertise that resource type in its catalog (400 otherwise).
3. The credential must belong to the company **and** to that provider (400 otherwise).
4. The template's `max_per_credential` cap is enforced (409 when the credential already has that many).
5. Duplicate resource keys → 409; otherwise the row is created with `status: provisioned` and `resource.created` is audit-logged; returns **201** with `resourceId`.

**Edit / delete** — `PUT /gateway/resources/:id` updates editable metadata (name, external id/url/region, description, config, status, defaults — `resourceKey` and the credential binding are immutable); `DELETE /gateway/resources/:id` **soft-deletes** so the row can no longer be resolved by lookups or knowledge bases.

> Resources are what **knowledge bases** bind to: the KB create modal's vector / storage dropdowns list `vector_index` / `object_bucket` resources (see [KBs](../README.md) — or the KB docs).

---

## API reference

All routes under `/gateway` sit behind `requireAdmin` (admin routes carry no rate limiter — authenticated admin sessions bypass the global baseline), and return **503** when the `MYSQL_*` env vars are unset.

| Method & Path | Purpose |
|---------------|---------|
| `GET /gateway/companies/:key/credentials` | List a company's credentials. `?includeInactive=1` includes disabled rows; `?includeStored=1` also returns decrypted **non-secret** fields (prefill for the edit form) — password/secret values never leave the DB. |
| `POST /gateway/companies/:key/credentials` | Create a credential — body `{ providerKey, credentialKey, credentialName, environmentKey?, fields, config?, isDefault?, priority? }`. |
| `POST /gateway/credentials/:id/verify` | Format-verify + live probe; records status, returns `{ success, status, latencyMs?, error?, warning? }`. |
| `POST /gateway/credentials/:id/rotate` | Rotate — body `{ fields?, rotationPolicy?, reason? }`. |
| `DELETE /gateway/credentials/:id` | Soft-delete the credential. |
| `POST /gateway/credentials/:id/models` | Grant model access — body `{ modelId, rateLimitPerMin?, monthlyQuotaTokens?, isDefaultForCategory? }`. |
| `GET /gateway/companies/:key` | Company detail **plus its environments** (new companies start with seeded Development / Staging / Production). |
| `POST /gateway/companies/:key/environments` | Create an environment — body `{ envKey, envName, description?, isProduction?, sortOrder? }` (envKey matches `/^[a-z0-9_-]{1,50}$/`; duplicates → 409). |
| `PUT /gateway/companies/:key/environments/:envKey` | Update an environment (rename, production flag, sort order). |
| `DELETE /gateway/companies/:key/environments/:envKey` | Soft-delete an environment; credentials that referenced it resolve as unassigned. |
| `GET /gateway/companies/:key/resources` | List a company's resources — `?type=` filters (e.g. `vector_index`). Rows are denormalized with credential/provider/environment names. |
| `POST /gateway/companies/:key/resources` | Provision a resource — body `{ providerKey, credentialId, resourceType, resourceKey, resourceName, environmentKey?, externalResourceId?, externalResourceUrl?, externalRegion?, description?, config?, isDefault? }`. |
| `PUT /gateway/resources/:id` | Update a resource's editable metadata (`resourceKey` / credential binding immutable). |
| `DELETE /gateway/resources/:id` | Soft-delete a resource. |

---

## Related

- **Providers** — define the auth schema and probes that drive the Connections card: [docs/providers.md](providers.md).
- **Resources** — provision infrastructure (vector index, object bucket) under a credential via the API; bind them to knowledge bases later.
- **Assistants** — bind a credential + model + KBs into a runtime persona: `GET/POST /gateway/assistants`, `GET/PUT/DELETE /gateway/assistants/:key`.
- **Gateway API** — full endpoint docs: `docs/AI_API_REFERENCE.md` → **Gateway - Provider Catalog** / credentials endpoints.
- **Implementation** — portal: `web/src/pages/credentials/` (`use-credential-modal.js` + `modals.jsx` + `fields.jsx` + `helpers.js`), consumed by `web/src/pages/catalog/connections-card.jsx`; routes + probes: `mysql/routes/` (`credentials.js`, `probes.js`); encryption/verification: `mysql/services/credential-service.js` + `config/encryption.js`; persistence: `mysql/repositories/` (`credential.js`, `resource.js`).
