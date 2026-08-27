# Providers — 9Router-style Connect & Manage

A **provider** is the top-level entry in the AI gateway catalog (admin portal → **Providers** page, nav label "Providers" → `#catalog`). It describes an AI/infrastructure service (OpenAI, Cloudflare Workers AI, a vector database, object storage, …) so the rest of the platform can reference it: the **Connections** page collects API keys per provider, the **Config** page lets a company pick its models/resources from this catalog, and knowledge bases can bind provider resources.

The page is modeled on **9Router's providers page**: a searchable grid of provider cards grouped by **how they authenticate** (Custom / OAuth / API Key), each card showing the selected company's live connection state, with per-section **Test All** batch verification and a hover toggle that disables every connection at once.

> **No provider-creation wizard.** The catalog is seeded via migrations (`migrations/010_seed_9router_catalog.sql`); new providers are added as **Custom (OpenAI/Anthropic Compatible)** endpoints from the page itself. Provider management is limited to connections + models on the detail page — endpoints, pricing, and capabilities are managed via the API/imports, not the portal.

---

## The Providers page (list view)

### Sections

| Section | Contains | Header action |
|---------|----------|---------------|
| **Custom Providers** | OpenAI/Anthropic-compatible endpoints added via the quick-add modal (provider keys prefixed `oc_` / `ac_`) | **Add Anthropic Compatible** / **Add OpenAI Compatible** |
| **OAuth Providers** | Providers whose auth type is `oauth2` | **Test All** |
| **API Key Providers** | Everything else (`api_key`, `bearer_token`, `basic_auth`, `custom`) | **Test All** + **Show all N providers** (first 20 shown) |

### Provider cards

Each card (9Router layout):

- **Icon tile** — the provider's `logo_url` on a category-colored background, falling back to the first two letters of the key.
- **Name**.
- **Status badges**, computed from the selected company's credentials:
  - `N Connected` (green dot) — active credentials with `last_verification_status = success`.
  - `N Error (CODE)` (red dot) — active credentials whose last verification failed, with a short diagnosis tag (`AUTH` / `429` / `5XX` / `NET` / `RUNTIME` / `ERR`) plus the relative time of the latest error.
  - `No connections` — when the company has no credential for this provider.
  - `Disabled` (⏸) — every credential for this provider is inactive.
- **Disable toggle** (appears on hover when the provider has connections) — flips `is_active` on all of the company's credentials for that provider (`PUT /gateway/credentials/:id` with `{ isActive }`).
- Clicking the card opens the **provider detail page**.

### Search & company scope

- The **search box** filters by provider name or key across all sections.
- Connection state is **per company** — the page follows the sidebar's company picker (falling back to the first gateway company).

### Test All (batch verification)

Each non-custom section has a **Test All** button that runs the same decrypt → auth-schema validation → live-probe pipeline as the per-credential verify endpoint over every **active** credential in that section (`POST /gateway/credentials/test-batch`, body `{ companyKey, group }`). The results modal shows:

- A summary (`N passed` / `N failed` / `N tested`).
- One row per credential: name, provider, latency, and an OK / diagnosis badge.

### Adding a custom provider (OpenAI/Anthropic Compatible)

The **Add OpenAI Compatible** / **Add Anthropic Compatible** buttons open a small modal (mirrors 9Router's `AddCompatibleModal`):

1. **Name** — the provider key auto-generates as `oc_<name>` / `ac_<name>` (lowercase, spaces → `_`; the key charset is `/^[a-z0-9_]+$/`, so the compatible prefixes use underscores).
2. **Base URL** — defaulted to `https://api.openai.com/v1` / `https://api.anthropic.com/v1`; this becomes `default_api_base_url`.
3. **API Key (for Check)** — optional; a **Check** button probes `{baseUrl}/models` with `Authorization: Bearer <key>` to prove the endpoint is reachable before creating.

On create the provider is stored via `POST /gateway/providers` (category `ai`, auth type `bearer_token`) and the page navigates to its detail page. The card appears under **Custom Providers**.

---

## Provider detail page

The detail page is intentionally slim — **connections + models only** (the 9Router model):

### Connections card

Lists every credential the selected company has for this provider (including disabled ones):

- Each row: name, status badge (`verified` / `error` / `untested` / `disabled`), environment, default flag, and the latest verification error.
- Actions per row: **Verify** (re-runs the probe), **Edit**, **Delete**, and an enable/disable toggle.
- **Add Connection** opens the credential modal (auth schema from the provider, **Check Connection** pre-save probe, secrets encrypted at rest), and newly saved credentials are **auto-verified** (result shown in a toast).

### Models card

Lists the provider's catalog models (key, name, category, stream/tools/vision flags, context window):

- **Add Model** / edit / delete via the model modal (`POST|PUT|DELETE /gateway/providers/{key}/models[/{id}]`).
- **Test** (flask icon) runs a live chat completion through the company's credential via the executor (`POST /gateway/companies/:key/execute/chat`) and shows the latency or upstream error — the 9Router per-model test.

### Header actions

- **Test Provider** — the catalog-level probe modal (`POST /gateway/providers/{key}/test`): format-validate + live probe, or a bare base-URL connectivity check.
- **Delete Provider** — removes the provider (refused with 409 while tenant credentials/resources reference it unless forced).

---

## After you've added a provider

- **Provider detail → Connections card** — "Add Connection" renders the form defined by the provider's auth schema; type the name (auto-lowercased into the key), paste the API key, save, and it **auto-verifies** with an inline probe result. Full walkthrough: [docs/credentials.md](credentials.md).
- **Config page** — the company's provider/model dropdowns (large/small LLM, embedding, reranker, vector, object storage) can reference this provider.
- **Assistants / Knowledge Bases** — bind the provider's credentials, models, and resource types.

---

## Related

- Gateway API routes: `docs/AI_API_REFERENCE.md` → **Gateway - Provider Catalog** / credentials endpoints.
- Batch testing + probes: `mysql/routes/credentials.js` (`POST /gateway/credentials/test-batch`), `mysql/routes/probes.js` (`PROBES` + generic OpenAI-compatible fallback).
- Portal implementation: `web/src/pages/catalog/` (`page.jsx` list/detail, `components.jsx` cards, `connections-card.jsx`, `models-card.jsx`, `modals/add-compatible-modal.jsx`).
- Registry cache: `mysql/services/provider-registry.js`; persistence: `mysql/repositories/provider.js`.
