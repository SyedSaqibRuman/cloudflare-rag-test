---
type: changelog
status: active
area: decisions
tags: [change-log]
related:
  - "[[ADR Index]]"
---

- **2026-10-03 (kb#37 restored)** — **maxicert-test-kb (kb#37) vectors restored after the 09-29 index wipe — bounded re-ingest, 30 docs / 1,028 chunks / ~1,259 vectors, health flag cleared, retrieval verified**: the KB's registry file was already gone (nothing to reset — a fresh run would process everything, no silent skip), so the saved config (`scope: "all"`, `maxUrls: 1000`) was launched as-is; discovery reported **829 documents** at ~1.7 min/doc (512-char chunks of heavy Elementor pages + per-doc graph-LLM extraction, `enable_graph_rag: 1`) ≈ 20+ hours — so per the user's call the full run was stopped at 6 checkpointed docs and a **bounded re-ingest** started with a request-scoped override `{ scope: "limit", limit: 30 }` (the saved config stays "all" — a future full run can go overnight, e.g. via the new KB cron scheduling). Result: 30/30 docs (24 processed + 6 checkpoint-skipped from the aborted run — the registry did its job across the stop), 1,028 chunks, shared index 1,591 → 2,850 (~1,259 kb#37 vectors), status active, `lastIngestionAt` 2026-10-03 07:41:06 > index `created_on` 2026-09-29 07:11:41. Verification: `GET /gateway/kbs/health` flipped kb#37 to healthy and the **flagged list is now empty** (the Ingestion banner clears); a live Vectorize query ("ISO 9001 certification requirements") returns **11 of the top 25 matches from kb#37** (top score 0.740, real maxicert.com URLs). Also fixed while here: the three E2E scratch scripts' `purgeScratch` now deletes the `processed-<company>-<kb>.json` registry file too — it survives KB deletion, so a script re-run would silently SKIP every uploaded doc and fail its own assertions; today's leftover E2E registry files were removed as well. Operational notes: full-sitemap runs of this KB are a multi-hour/overnight affair at current graph-RAG settings; the 20-hour estimate assumes ~40 vectors/doc at chunk_size 512 — consider `docLimit` or scheduling it via the KB cron if the full 829-doc corpus is ever wanted.

- **2026-10-03 (later)** — **Cron-driven KB ingests are now first-class jobs: visible, pausable, resumable** — previously a cron tick called the ingest handler DIRECTLY (`job.handler({ signal })` with the schedule-level controller), which meant the run was invisible to `/jobs/running` and `kbStatus.inProgress` (both read only the standalone map), **impossible to pause** (`/job/pause` looks up `standaloneJobs`), and actively sabotaged by the kbStatus route's stuck-`indexing` auto-recovery (no standalone job visible → the poll flipped a live cron run's row back to `active`). Fix: the tick now routes through the standalone runner — `startJob(jobId, companyName, { kbKey, awaitCompletion: true })`, a new opt that attaches a `completion` promise to the normal response, resolved `{ status, error, durationMs }` in the runner's `finally` (HTTP callers see no change). The tick awaits it and maps settlement to schedule stats: `failed` stains `lastError`, `suspended`/`stopped` never do (user actions on the run, not schedule failures), and `runCount` only counts runs the runner accepted (concurrency-denied ticks log a skip). Because the run is a real standalone entry it gains progress tracking, appears in `/jobs/running` and the portal's Standalone Jobs card, and pause/resume work through the EXISTING endpoints — pausing a cron run checkpoints it (suspended + persisted); the schedule keeps ticking and the NEXT tick replaces the suspension, continuing from the registry checkpoint (`/job/resume` also works). `stopCron`'s cleanup now also stops the in-flight tick run (the run owns its own AbortController — the schedule-level one is kept for stop semantics). Verified: 3 new unit cases (completion resolves `completed`/`failed`; `stopCron` cleanup stops an in-flight tick run — 63/63 cron suite), plus a REAL pause/resume scheduler E2E — `scripts/e2e-kb-cron-pause.mjs` (self-cleaning, 21 checks, teardown subcommand): 14-doc scratch KB on an every-minute cron, tick 1 caught mid-flight via `kbStatus.inProgress` AND `/jobs/running`, paused mid-run → run aborted with `lastIngestion` still null, KB row `paused: true` + `pausedAt`, schedule SURVIVED with `lastError` null and `runCount` 1, tick 2 completed the full set (14/14 docs, 24.8s), no lingering suspended entry, `paused` flag cleared, scoped stop, deterministic-id teardown (14 vectors + 14 R2 objects + 404). Full suite 1384/1384 · lint clean; a load-dependent single-test flake appeared in 2 of 4 full-suite runs but is unreproducible in isolation (cron suite 5×, pipeline 3×, kb-health 2× all green — pre-existing parallelism flake, not from this change). openapi `job/pause`/`job/resume` descriptions updated.

- **2026-10-03** — **KB ingestion is now schedulable on cron, scoped to a company + knowledge base**: the cron layer never threaded `kbKey` — `POST /cloudflare/cron/start` accepted only `{ jobId, schedule, companyName }`, so a scheduled `ingest` always ticked into the LEGACY whole-company path (`ingest.js main()` without a KB), while the KB-driven path was reachable only from the Ingestion page's immediate-run button. Fix, both layers: `startCron(jobId, schedule, companyName, { kbKey })` keys the schedule like standalone jobs (`jobKey`'s third segment), stores `kbKey` on the state, passes `{ signal, companyName, kbKey }` to the handler on every tick, and `stopCron`/`cronStatus` carry it — so one company can run several KB schedules plus a legacy whole-company schedule concurrently, and `GET /status` cron entries report `kbKey` (the portal rows show `KB: <key>`). The route verifies the KB binding at SCHEDULE time (`CompanyRepository.findByKey` + `KbRepository.findByKey`; unknown company/KB pair → 400, `kbKey` without `companyName` → 400) — an unattended cron that ticks into `NotFoundError` run after run is worse than a rejected request now. Portal Scheduler: the Schedule Cron modal grows a **Knowledge base** select (loaded per form-company via `listKbs`, shown when job = `ingest`; "Legacy company-wide ingest (no KB)" remains an explicit option), the form's company stays synced to the selected company (it was initialized once at mount — a tenant switch would silently schedule against the old company), and the standalone/cron cards display + stop by kbKey. Verified live: negative 400s (bogus kb, kb-without-company), real schedule → status entry `key: ingest:maxicert:max-test-kb, kbKey: max-test-kb` → duplicate guard → stop with kbKey → 0 crons; full UI round-trip in the browser (KB dropdown lists the company's KBs, schedule `0 5 1 1 *` never fires, card renders `KB: maxicert-wp-30`, Stop removes it — screenshot `.scratch/verify-kb-cron-schedule.png`). Tests: 7 new kbKey-threading cases in `cron/__tests__/cron-modules.test.js` (response contract, concurrency per KB, duplicate guard, legacy-vs-KB coexistence, scoped stop leaving the sibling schedule running), plus a REAL fire-once scheduler E2E — `scripts/e2e-kb-cron-fire.mjs` (self-cleaning, 14 checks): scratch KB + one uploaded doc, a computed `M H * * *` schedule targeting the next minute boundary + 75s (fires exactly once, server-local clock), then proof the ingest ran THROUGH the scheduler — `/status` showed the KB-scoped schedule while waiting, the tick stamped `lastIngestion` (1 doc / 1 chunk / 3.5s), and the server log carries both `⏰ Cron tick: ingest [company: maxicert] [kb: e2e-cron-scratch]` and the completion line with no manual ingest call ever made — followed by scoped stop + full vector/R2/row cleanup. 1381/1381 · lint clean · portal rebuilt · docs (openapi.js, api/scheduler.md, AI_API_REFERENCE.md, DOCUMENTATION.md §scheduler) updated. Scheduled runs consume the SAME ingest path as the Ingestion page (registry checkpointing, webhook events, audit rows) — a KB cron is just a timer in front of `main({ kbKey })`.

- **2026-10-01 (later)** — **Security audit: four portal XSS/correctness findings fixed and browser-verified with hostile files**: (1) **Stored XSS via HTML KB previews** — the KbDetail file preview rendered uploaded `.html`/`.htm` documents in an **unsandboxed** same-origin iframe (needed for the `blob:` src), so a malicious uploaded document could execute script in the admin origin; the iframe now carries `sandbox="allow-same-origin"` (scripts disabled by omission — same-origin alone still lets `blob:` resolve and CSS/layout render, PDFs keep their unsandboxed iframe for the built-in viewer). (2) **Markdown `javascript:` link XSS** — `renderMarkdown`'s link regex accepted any href scheme, so an ingested/KB document containing `[click me](javascript:…)` produced a clickable script link at BOTH `dangerouslySetInnerHTML` sites (the MarkdownPreview and the ingested-doc preview); the same hole existed in the ask-answer renderer `components/Markdown.jsx` (React 18 only warns there). Fix: new shared pure module `web/src/markdown-sanitize.js` — `isSafeLinkUrl` allowlists `https?:`/`mailto:` schemes, treats any colon-less string as a safe relative URL, and rejects control chars (blocks `jav\tascript:` smuggling); `safeLinkUrl` returns null for unsafe URLs and both renderers emit an inert `<span title="Link removed (unsafe URL)">` instead of an anchor. Pinned as correct behavior: entity-encoded `javascript&#58;…` classifies SAFE — the raw-HTML path pre-escapes so entities can't decode, and React `setAttribute` doesn't decode entities so the browser parses a scheme-less relative URL. 14 pure-ESM tests (`web/src/__tests__/markdown-sanitize.test.js`). (3) `Assistants.jsx` rendered `<Pagination>` without importing it (crash when the assistants list paginated); (4) `fenceLang` implicit global in KbDetail's fence branch (sloppy-mode assignment, never read) — deleted. Gates: 1373/1373 · lint 0 errors · portal rebuilt. **Browser-verified with hostile files** (`scripts/e2e-xss-preview.mjs setup/teardown`, self-cleaning scratch KB): evil.md preview shows 0 `javascript:`/`data:` anchors, both hostile links render as inert spans, the safe `https://example.com/ok` link survives, and fenced `<b>bold</b>` renders as escaped text; evil.html preview iframe carries `sandbox="allow-same-origin"` with no `allow-scripts`, and the injected `window.__xssExecuted` marker stayed absent. Screenshots `.scratch/verify-xss-md-preview.png` / `verify-xss-html-preview.png`. **Follow-up audit of every remaining dynamic-render site** (`href=`/`src=`/`innerHTML`/`window.open` across `web/src`): verified safe by construction — locally-created `blob:` URLs (FilePreviewModal Download, bulk-export/log-download `a.href`), portal-internal encoded paths (`/gateway/kbs/:key/documents/:file`, `#nav` hashes), static strings (`/api-docs` window.open with noopener), and the catalog logo `<img src>` (no anchor semantics; broken-icon fallback). Two holes hardened with the same `safeLinkUrl` gate: (1) KbDetail's "Open source page" footer link rendered `docPreview.data.url` **unsanitized** — that value is the first chunk's `url` metadata assembled from R2 by `assembleDocumentPreview` (untrusted crawl payload, not a literal), so a poisoned chunk could inject a `javascript:` anchor; unsafe URLs now hide the button entirely (+ `noopener noreferrer`); (2) catalog provider detail's "Sign up / Learn more" / "Generate API key" links — admin-authored but bulk-importable, so `provider.websiteUrl`/`documentationUrl` and the auth-form help-text URL now pass through `safeLinkUrl` (unsafe → docs fallback → link dropped; helpTextUrl's https-only regex stays as first-line defense). 15 sanitizer tests (+1 locking the metadata-URL contract); 1374/1374 · lint clean · portal rebuilt.

- **2026-10-01** — **KB health check: stale-index detection at `GET /gateway/kbs/health`** (turning the 09-29 max-test-index forensics into a permanent check): a KB is flagged (`staleIndex: true`) **only with proof** — its `last_ingestion_at` is set, the bound index's live `created_on` is known (CF Vectorize list), and the last ingest predates the recreation. That combination means every vector the run wrote is gone while the ingestion registry still lists the documents as processed, so a re-ingest would silently skip them. Never-flag guarantees: never-ingested KBs, unknown created_on (live CF list unavailable — a failed list call degrades ALL CF-bound KBs to uncheckable rather than guessing), and no index bound. A name absent from a non-empty live list is a separate `indexMissing` signal (still uncheckable for staleness). Mechanics: pure evaluator `mysql/services/kb-health.js` (`evaluateKbIndexHealth`/`assessKbIndexHealth`, injected inputs — no I/O; `toEpochMs` rewrites the pool's naive `dateStrings` datetimes to explicit UTC, same lesson as the portal's `parseUtcDate`) + route in `mysql/routes/kbs.js` registered BEFORE `/kbs/:key` that partitions KBs: Cloudflare-family-bound rows (the same `isNonCfVectorProvider` denylist the ask path uses for retrieval routing — a strict `cloudflare_vectorize` match misrouted the live umbrella-`cloudflare` rows on first run; legacy config `VECTOR_INDEX` fallback also honored, mirroring the status route) are evaluated against the live index list; KBs bound to Qdrant/Pinecone/etc. are appended uncheckable with the provider named (their names would false-positive "index missing" against the CF list). Shared-index subtlety is handled: all KBs bound to one name are compared against the same created_on, so one recreation flags every KB that ingested into it. Portal: `kbHealth()` in `api.js`; the Ingestion page shows a dismissible rose banner naming each flagged KB + its actionable reason, a red "⚠ stale index" badge on the card, and the Active Indexes stat card degrades from "healthy" to "N needs re-ingest". Semantics locked by 34 pure tests (`mysql/__tests__/kb-health.test.js` — ms-boundary strictness, offset-carrying ISO strings, garbage/impossible datetimes, null created_on entries, empty live lists, epoch 0); documented in DOCUMENTATION.md §12 + openapi.js (`/gateway/kbs/health` + `KbIndexHealth`). Verified live end-to-end with three repeatable scripts: `scripts/e2e-kb-health-matrix.mjs` (15 checks — auth 401s incl. x-auth-token, company gate 400/404, query-param form, method/route negatives, contract shape, kb#37 regression), `scripts/e2e-kb-health-tenants.mjs` (all 7 companies — per-company kb_key uniqueness, no cross-tenant leakage; 4 of 7 shown in designed degraded mode `checked=false` with zero flags), and `scripts/e2e-kb-health-lifecycle.mjs` (mutating, self-cleaning: scratch KB create → duplicate-key 409 → never-ingested uncheckable → real upload+ingest → healthy → delete with deterministic-id vector + R2 cleanup → absent from report). Portal verified in-browser: banner, per-card badge, Active Indexes meta, and the dismiss-then-return-on-reload behavior.

- **2026-09-30 (later)** — **max-test-index recreation investigated; legacy index routes hardened (KB-binding guard 409 + audit trail)**: The 09-29 07:11 UTC recreate did NOT come from the gateway — zero audit rows for maxicert on 09-29, `provider_resources` #9 untouched since 09-09, and no `Create index failed` duplicate-create error in error.log (CF rejects duplicate names — `ensureIndex`'s create path was not the culprit). The legacy `/cloudflare/indexes` routes (Cloudflare page UI / dashboard / API) have no audit logging, so the exact actor is unprovable from app data; the parallel agent's dimension-mismatch fix that morning (07:11 = seconds after the 07:11:41 created_on) remains the likely context. Blast radius: 4 KBs bound to the index; kb#37 (`maxicert-test-kb`) lost its 963-URL ingestion (lastIngest 09-28 10:21, processed=0, 0 R2 objects, no registry — its data is GONE, needs full re-ingest); wp-30 restored earlier today. Two hardening fixes: (1) `listVectors` no longer swallows API errors into `[]` (fail-open made `ensureIndex` → `createVectorIndex` treat a transient failure as "index missing" and attempt a duplicate create — a latent recreate vector); (2) legacy index DELETE now returns **409 CONFLICT** when any live KB (any company — they share one CF account) binds the index name as its vector store (matched via new `KbRepository.listByVectorExternalId` since CF index lists carry no stable id), POST-create on an existing name whose KBs were deleted-or-repointed is likewise guarded, and every mutation writes a `vector_index.created/deleted` audit row. Live-verified: DELETE/POST on `max-test-index` → 409 naming all 4 KBs; scratch index create+delete → audited (`vector_index.created/deleted` rows with actor IP). 1325/1325 · lint clean.

- **2026-09-30** — **Stale-vector cleanup executed + wp-30 retrieval restored; two silent-destruction modes documented**: (1) The 11,130 stale `maxicert-web-auto` vectors from the 288-doc over-ingest were deleted from the shared `max-test-index` via `scripts/cleanup-web-auto-stale-vectors.mjs` (dry-run-first; recomputes deterministic ids from R2 keys + registry slugs — registry keys use dashes, R2 folders are `slugify`d underscores; hash scheme cross-checked against real chunk `.id` fields; `getByIds`/`deleteByIds` batches ≤20/≤100; resumable — an interrupted apply just re-runs). Verified: 11,445 → 645, all 125 current web-auto ids intact. (2) During cleanup verification, wp-30's vectors were found missing even BEFORE the cleanup — **`max-test-index` had been recreated 2026-09-29 07:11 UTC** (`created_on`), wiping everything ingested before it (wp-30's 09-28 run had all 1,259 chunks "Batch success" in vector.log — the index died, not the run). Vector counts prove it: 11,445 = 11,255 web-auto + 190 max-test-kb exactly. (3) The wp-30 re-ingest via the portal endpoint was then killed 27s in by a **nodemon restart** (file-change restart kills in-flight standalone jobs silently — job vanishes, no failed log; stdout restart timestamp 06:25:09.354 vs vector batch 06:25:09.273). Re-run OUT-OF-PROCESS (`node` + `ingest.js main()` directly) to survive restarts: 30/30 docs restored. Final index: 1,574 = 1,259 wp-30 + 190 max-test-kb + 125 web-auto. Retrieval verified via /ask: wp30-test grounded 2/2 (0.826/0.849, kb/maxicert-wp-30 sources); sarah (max-test-kb) grounded with 0.85 top scores; post-cleanup top-30 query shows all three KB prefixes coexisting healthily (wp-30 20 / max-test-kb 5 / web-auto 5). LESSONS: recreate-an-index invalidates every KB that ingested into it — re-ingest all of them; never judge a KB "ingested" by its lastIngestion stats alone when the index may postdate the run; long ingest runs should not depend on the nodemon-managed server process. Also fixed a latent `countVectors` SDK-shape bug in the CF vector adapter (`res?.result?.vectorCount` → SDK `_thenUnwrap` already returns the result; the silent catch masked it — status endpoint's `vectorCount` is always null).

- **2026-09-29 (latest)** — **Saved docLimit is now the Ingest default AND caps URL/sitemap discovery** (the `maxicert-web-auto` 288-doc over-ingest): a KB saved with `scope: "limit", docLimit: 3` ingested 288 docs. Two stacked causes: (1) the Ingestion page's Ingest button defaulted its scope to `{ type: "all" }` and ALWAYS sent one — the server treats an explicit request scope as a per-run override (`scope || kbScope`), so the wizard's saved scope was silently bypassed and the pipeline's `docLimit` mapped to `null` (the batch-trim in `processContent` never ran); (2) the url adapter's discovery cap defaulted to `maxUrls: 1000`, so the ~288-URL sitemap was fully fetched in one batch regardless of the saved limit. Fix, both layers: the portal now derives the Ingest default from the KB's saved `source_config` (`web/src/ingest-scope.js` `defaultIngestScope` — pure ESM, unit-tested; button title shows "Ingest (max 3)", the popover's explicit "All documents" still works as a deliberate override); the composition root resolves the EFFECTIVE scope (request wins over saved) BEFORE creating the source adapter and intersects it into the discovery cap (`ingest/scope.js` `capMaxUrls`/`resolveEffectiveScope` → `createSourceAdapter({ maxUrls })` → `createUrlSource`), so a limit-3 KB never fetches a 288-page sitemap just to trim it downstream. An explicit `{ scope: "all" }` request still fetches everything (the request defines the run; saved config defines the default). Verified live: fresh run (registry reset) → **3 docs / 125 chunks, mode "limit"**; button title browser-verified. Also fixed a latent latent-rejection papercut: the url adapter's discovery promise now has a floating `.catch` so an aborted-before-fetch run can't raise an unhandledRejection while a real run still sees the original error. Cleanup note: the 288 stale vectors/R2 objects from the buggy run remain in the shared `max-test-index`/`max-test-data` (deleted only by re-ingest overwrite or manual REST `byIds` delete — vector ids are recomputable from the registry via `makeVectorId`), harmless to other KBs' retrieval only in so far as scores compete; deletion is manual if desired. Tests: 15 new pure-ESM cases (`ingest/__tests__/ingest-scope.test.js` incl. a loopback-sitemap-server end-to-end cap test; `web/src/__tests__/ingest-scope.test.js`). 1322/1322 · lint clean · portal rebuilt · server restarted.

- **2026-09-29 (later)** — **Sitemap auto-resolution moved to KB-CREATION time** (spec §30/§31): a new `url`-source KB with only a `websiteUrl` now gets its sitemap resolved from robots.txt **during saveKb/updateKb** — `resolveWebsiteSitemap` runs `discoverSitemaps` (shallow, maxUrls 20, just to pin the root) and stamps `sourceConfig.sitemapUrl` + `sitemapResolvedAt`; ingest then reuses the stored sitemap instead of re-discovering. Failure semantics mirror the embedding probe: a definitive `SitemapError` (no sitemap anywhere / bad URL) rejects the save with a clear 400/502; unexpected internal errors fail OPEN (save without the sitemap, ingest re-checks). New `POST /gateway/kbs/discover-website` preview endpoint (before the POST /kbs route; preview-capped at 50 URLs) returns `{website, robotsUrl, robotsFound, sitemapFound, sitemapUrl, sitemapCount, urlCount, sampleUrls, truncated}`; the wizard debounces 600ms after a valid website URL and shows live status copy ("Finding sitemap…" / "✓ Sitemap found: … · N pages discovered" / "⚠️ couldn't find a sitemap…" per §31 — never raw errors). Verified live: preview endpoint returns maxicert's `sitemap_index.xml` (8 sitemaps, 50 URLs); KB `maxicert-web-auto` created with ONLY `websiteUrl` → row stores the resolved sitemap + timestamp; wizard shows the green found line as you type (screenshot dir /tmp/vis recreated after the session's tmp was wiped). Tests: 4 injected-seam cases in `mysql/__tests__/kb-service.test.js` (resolves+stores, definitive reject, fail-open, explicit sitemap skips discovery). Gotcha: the discovery test that simulates SitemapError must throw the REAL class (`new SitemapError(...)`) — a duck-typed `{name:"SitemapError"}` fails `instanceof`, silently takes the fail-open path, and reaches the real configured MySQL through the un-stubbed repo (caught by an FK error; add a create-throws leak guard when stubbing this path). 1307/1307 · lint clean · portal rebuilt · server restarted.

- **2026-09-29** — **max-test-kb "no URLs or sitemap" error diagnosed + websiteUrl path validated live end-to-end**: the KB had been switched to `source_type: url` while its source_config was still empty — an ingest at 07:13 UTC threw `createSourceAdapter`'s guard (`url` with no websiteUrl/urls/sitemapUrl) and the error stuck on the KB row even after the config was subsequently filled in (`websiteUrl: https://maxicert.com` + `sitemapUrl`, docLimit 5) during the Website-URL feature implementation (ingest/sources/sitemap/*, kb-service + wizard updates landed 2026-09-29 morning). Root cause of the window: edits landed while the running server held older modules (process start 10:21 vs file mtimes up to 10:28) — after a clean restart (no jobs running; 1303/1303 tests, lint clean first), the saved config ingested successfully: **5/5 docs, 190 chunks, 6.6 min, lastError cleared, status active**. Discovery verified live beforehand: robots.txt → `sitemap_index.xml` → 7 child sitemaps → URLs, with the maxUrls cap enforced and an explicit "stopped early, site NOT fully crawled" warning. Operational rule reinforced: after pulling feature changes, restart the server AND rebuild `web/dist` before judging behavior; a stale `lastError` on a KB row only clears on the next successful (or newly failing) run.

- **2026-09-28 (latest 5)** — **maxicert-wp-30 verified end-to-end through /ask via a dedicated assistant**: created gateway assistant `wp30-test` (id 13, Cloudflare credential 10, `primaryKbId` 38 → `max-test-index` via the kb's `vector_external_id`) instead of touching the production `sarah` persona; `/ask` takes a per-request `assistantKey` that temporarily overrides `ASSISTANT_KEY` and restores it in a `finally` (verified restored to `sarah`). Results: "ISO 14001 Tanzania" → grounded answer, 1 source; "ISO 9001 Oman" → grounded answer, 3 sources incl. the exact ingested `page-oman-iso-9001-certification-meaning-process-benefits-2025` doc; retrieval probe 0.884–0.889. **Product finding (pre-existing, not fixed here):** cost/pricing questions ("How much does ISO certification cost…") hit the `CONTACT_PATTERNS` fast-path in `query/intent.js` (~line 90: `cost|price|how much|…`) and return the canned contact-form response BEFORE retrieval — even when a cost guide is ingested and retrievable at 0.889. Deliberate lead-gen behavior, but it makes price-content KBs unreachable at ask time; a per-assistant or per-company bypass (like the blocked-patterns tier) would be the consistent fix if ever wanted. Test-harness gotcha: scripts that import the config layer hang at exit because the lazy MySQL pool keeps the loop alive — always `process.exit()` explicitly, and beware `grep`-piped output being swallowed when the runner kills the process (redirect to a file instead). Test assistant `wp30-test` left in place (harmless, inactive unless selected).

- **2026-09-28 (latest 6)** — **Website ingestion: a user supplies only a WEBSITE url and the sitemap is discovered automatically — new `ingest/sources/sitemap/` module (CMS-independent, no WordPress REST)**: this is the replacement for the withdrawn WordPress source. Flow: `normalizeWebsiteUrl` → `{origin}/robots.txt` (always the origin, never the user's path) → every case-insensitive `Sitemap:` directive → relative refs resolved via the `URL` API → standard fallbacks `/sitemap.xml`, `/sitemap_index.xml`, `/wp-sitemap.xml` **only when robots gave nothing** and **only if the body is genuinely a sitemap document (a 200 alone is never enough)** → recursive `<sitemapindex>` expansion → deduped, in-scope `<urlset>` URLs. Layered per the spec's §38 separation: `normalize.js` (validation/scope/dedupeKey, pure) · `robots.js` · `parser.js` · `crawler.js` · `discover.js` (orchestrator) · `http.js` (one `fetchText` primitive owning timeout/retry/redirect/byte-cap) · `log.js`. Notable decisions: **cheerio XML mode instead of the old `/<loc>([^<]+)<\/loc>/gi` regex** — entities (`&amp;`) are decoded by the parser, and the tree is walked by **local name** because CSS selectors silently match nothing on prefixed `<sm:urlset>` documents (verified). Cycle protection is a `visited` Set (A→B→A terminates) plus `maxDepth`; `maxSitemaps`/`maxUrls` live once in `DEFAULT_DISCOVERY_LIMITS` and are **reported** through `truncated`, never silently applied. Scope defaults to the entered host + its `www.` sibling with `allowSubdomains`/`allowExternal` opt-outs; `javascript:`/`data:`/`file:` are rejected everywhere; redirects are re-checked against scope. `parseRobotsTxt` is total (a malformed line is logged and skipped). `discoverSitemaps` returns a plain result object and throws `NO_SITEMAP_FOUND` (404) with a **user-facing** message, never an internal parser/transport error. Wired through: `createUrlSource` gained `websiteUrl`/`maxDepth`/`allowSubdomains`/`allowExternal` and `getFailures()`/`getDiscovery()`; per-page failures are recorded and skipped so one 404 can't end a run; page bodies get a 5 MB cap; sitemap `<lastmod>` feeds `modified` so the registry's staleness check works on re-runs. `validateKbInput` now accepts a `websiteUrl`-only config (plus `maxDepth`); `PUT /gateway/kbs/:key/sources` accepts/validates `websiteUrl`, `maxUrls`, `maxDepth`. Portal: the "Sitemap URL" field is gone — the wizard shows a single **Website URL** box with the spec's copy, sitemap/URL-list moved behind an "Advanced" disclosure, and an inline validator mirroring the server rule. Chunk metadata gains `sourceType`/`websiteUrl`/`lastModified` (stored, **not** added to `metadataIndexes`, so existing Vectorize indexes need no change); chunk ids stay `sha256(r2Prefix/pageSlug)-index` — deterministic, so re-ingest updates rather than duplicating. 34 new tests in `ingest/__tests__/sitemap-discovery.test.js` (all 15 spec scenarios, injected `fetchImpl`, zero network); 1303/1303 · lint clean · portal rebuilt. **Verified live:** `discoverSitemaps("https://maxicert.com")` → 830 URLs in 4.7s, no errors, not truncated; a 2-page run produced 36 chunks from 134 KB of HTML with correct provenance and stable ids.

- **2026-09-28 (latest 5)** — **WordPress + Custom REST API KB source types withdrawn (hidden in the wizard, rejected by the API) after the real cause of the maxicert ingest failure was found**: byte-level probing of `https://maxicert.com/wp-json/wp/v2/posts?per_page=100&page=1` showed the response is **not** a WAF interstitial and **not** a size-based replacement — there is no `<html>`/`<!DOCTYPE` at all. It is **913,467 bytes of 100 concatenated `<style id="elementor-post-…">` blocks prepended to the intact JSON array**, which then parses cleanly (100 items, every `content.rendered` populated). The prefix is per-post (37774→9,197 B, 37579→9,464 B, 37478→8,938 B) and only appears on requests that ask for `content` — `?_fields=id,title`, `?_fields=id,excerpt,link` and `?context=embed` all return clean JSON. So the trigger is **requesting `content.rendered`**, not response size; the site emits each post's Elementor inline CSS both at the top of the body and inside `content.rendered` (duplicated, not moved). `services/wp.js`'s body-shape guard is therefore correct to refuse it — ingesting would mean chunking a page of CSS. The earlier "WAF replaces large responses" note in this log was wrong and is superseded. Fixes: (1) **withdrawal** — `shared/catalog-enums.js` now owns `KB_DISABLED_SOURCE_TYPES = ["wordpress","custom"]` and derives `KB_ENABLED_SOURCE_TYPES` (`file`,`url`) + `KB_DEFAULT_SOURCE_TYPE` (`file`) from it; the portal renders only the offered cards and `validateKbInput` / `PUT /kbs/:key/sources` reject a withdrawn type **unless it equals the row's unchanged stored value** (new `currentSourceType` option threaded from `updateKb`), so existing WordPress/custom KBs stay editable and keep ingesting. (2) **default no longer retired** — the `?? "wordpress"` fallbacks in `validateKbInput`, `updateKb`'s merge and `KbRepository.create` were all silently resolving to the broken type (a bare `POST /gateway/kbs` would have created a WordPress KB); they now use `KB_DEFAULT_SOURCE_TYPE`, and an update that omits `sourceType` inherits the stored value instead of migrating. (3) **legacy banner** — the wizard keeps a withdrawn type selected and explains it, pointing WordPress users at URL / Sitemap + `/wp-sitemap.xml`. Ingest is untouched by design: `createSourceAdapter` still resolves `wordpress`/`custom` on purpose. 6 new cases in `mysql/__tests__/kb-service.test.js`; 1267/1267 · lint clean · portal rebuilt. The site-side fix is still worth doing (Elementor → Settings → Advanced → disable Optimized Markup, and exclude `/wp-json/` from the CSS/LiteSpeed/WAF rules) — re-probe with `node scripts/probe-maxicert-rest.mjs`, exit 0 = fixed.

- **2026-09-28 (latest 4)** — **maxicert-wp-30 switched to the sitemap source and fully ingested (30 docs / 1,259 chunks, retrieval verified) + save-time gap fixed**: the KB was edited in the portal to `sourceType: "url"` but saved with `{ urls: [] }` and no sitemapUrl — the ingest then failed with `KB 'maxicert-wp-30' has source_type 'url' but no URLs or sitemap configured` (createSourceAdapter throws at run time). Config fixed via `PUT /gateway/kbs/maxicert-wp-30 { sourceType: "url", sourceConfig: { sitemapUrl: "https://maxicert.com/wp-sitemap.xml", maxUrls: 30, scope: "limit", docLimit: 30 } }` — maxUrls matched to docLimit so the adapter stops fetching after 30 sitemap pages instead of walking all 963. Ingest completed in 4.6 min: `documentsProcessed: 30, chunksCreated: 1259, embeddingFallbacks: 0`, status error→active, stale lastError cleared; retrieval through the `retrieveContext` seam returns an on-topic chunk at **0.884** (ISO 14001 Tanzania; first probe attempt timed out — CF embeddings throttling right after the 1,259-chunk burst, retry succeeded). **Product fix:** `validateKbInput` now rejects `sourceType: "url"` with no `urls`/`sitemapUrl` (and non-positive-integer `maxUrls`) at SAVE time — same principle as the existing custom-rest check, an unconfigured source must fail the save, not the ingest; string sourceConfig (legacy shape) skipped; 5 new cases in `mysql/__tests__/kb-service.test.js`. 1263/1263 · lint clean.

- **2026-09-28 (latest 3)** — **New test KB `maxicert-wp-30` (id 38) — wordpress source with docLimit 30 — created and ingest-tested against the still-hijacked REST API**: created via `POST /gateway/kbs { kbKey: "maxicert-wp-30", sourceType: "wordpress", sourceConfig: { scope: "limit", docLimit: 30 } }` (company defaults for vector/storage/embedding — resource ids 9/7, same `max-test-index`/`max-test-data` as the siblings; vector ids are `kb/<kbKey>`-prefixed so no collisions). Semantics note verified in `ingest/pipeline.js`: `scope: limit`'s `docLimit` is **cumulative across posts+pages** (shared stats object), so 30 = 30 documents total, matching the wizard's "Custom limit: N documents" copy. Ingest (`POST /gateway/kbs/maxicert-wp-30/ingest`, no scope override → uses the saved sourceConfig) failed in 45s with the exact expected `ExternalServiceError` — the site is STILL size-hijacking content-bearing REST responses (re-probed 10:58 UTC: `per_page=100&page=1` → 15MB Elementor HTML). Contract held: status `error`, actionable `lastError`, `documentCount` 0, `lastIngestion` null (failed runs don't stamp stats), portal card shows the Error badge (screenshot `/tmp/vis/r16-maxicert-wp-30-error.png`). When the site fix lands, re-running the same ingest should process exactly 30 docs then stop. New reusable probe `scripts/probe-maxicert-rest.mjs` (zero-dep, exit 0 = content JSON flowing / 1 = still hijacked / 2 = network error) re-checks the same three-request matrix on demand.

- **2026-09-28 (latest 2)** — **maxicert.com REST interception re-diagnosed as SIZE-based, not path-based** (correction to the two entries below; matters for what the site admin looks for): live probes on 2026-09-28 10:47 UTC show small REST responses passing through as real JSON regardless of route — `/wp-json/` index, `wp/v2/posts?per_page=100&_fields=id` (22KB, meta-only), `per_page=1&_fields=id,title` — while **any content-bearing response is replaced** with the newest item's rendered Elementor HTML: `posts?per_page=1&_fields=id,content` (172KB) → post 37774's HTML, `pages?per_page=1&_fields=id,content` → page 36891's, the fetcher's exact request (`per_page=100&page=1`, 15MB) → HTML. Same result with a Chrome UA and via Node fetch, so it's not UA/bot-sniffing; `?rest_route=` is hijacked even when the path form passes (likely a separate cache-rule artifact). No query-shape workaround exists — you cannot list posts without content — so the product-side fix stands and the failure contract did its job: a manual `max-test-kb` ingest surfaced the clear `ExternalServiceError` banner instead of a silent 0-doc "success" (status `error`, `lastError` recorded, run at 05:30 UTC, `documentCount` 77 untouched). Decision: Max Test KB stays on the `wordpress` source — no sitemap switch — until the site fix lands; a plain re-run of ingest then succeeds with no changes. For the site admin: look for a rule acting on large/content REST bodies (security-plugin request filter e.g. Wordfence, LiteSpeed Cache REST/cache rules, or a Hostinger WAF response-rewrite), not just path-based `/wp-json` blocks. Meanwhile `maxicert-test-kb` (sitemap source) ingested the full 963-URL sitemap: 75 docs active, retrieval verified.

- **2026-09-28 (latest)** — **Portal "LAST RUN 5h ago" timezone bug fixed — naive DB datetimes now parse as UTC**: every admin-portal relative/absolute time built from a MySQL DATETIME value (`last_ingestion_at` → `lastIngestion.at`, `pausedAt`, workflow/workflow-run `startedAt`, usage + webhook-delivery `created_at`) was skewed by the browser's UTC offset — `new Date("2026-09-28 10:21:03")` (space, no TZ marker) parses as **browser-local** per spec, so an IST (+5:30) browser showed "5h ago" for a run 5 minutes old (the maxicert-test-kb card in the user's screenshot; "Max Test KB 8h ago" = 2.5h real + 5.5h skew ✓ consistent). Fix: new `parseUtcDate` in `web/src/util.js` rewrites ONLY the naive `YYYY-MM-DD HH:MM:SS[.f]` shape to `YYYY-MM-DDTHH:MM:SSZ` and passes everything already-marked through untouched — ISO T/Z, offsets, date-only (already UTC per spec), HTTP-dates (KbDetail's registry `modifiedAt`), filesystem `mtime.toISOString()` (Logs), epoch numbers, Date objects. Wired into `util.js` `timeAgo`/`formatDate`, the catalog utils duplicate `timeAgo` (provider error badges), and the direct `new Date(dbValue)` display sites: IngestionList tooltip + recent-runs sort, Scheduler (job/ingestion startedAt), Usage + Webhooks + Workflows `created_at`/`startedAt`. Left alone deliberately: `checkedAt` (always `toISOString()`), useCatalog's `last_verified_at` sort (uniform skew preserves order), KbDetail's doc table. Verified live WITHOUT a server restart (express serves `web/dist` from disk per request): the just-finished 963-URL ingest (finished 10:21:03 UTC) renders **LAST RUN 19m ago** at 10:40 UTC with tooltip `Sep 28, 2026, 3:51 PM` (correct IST local conversion), Logs + Usage pages unaffected (screenshot `/tmp/vis/r15-last-run-fixed.png`). Tests: new pure-ESM `web/src/__tests__/utc-dates.test.js` (naive = ISO-Z instant, fractional-seconds DATETIME(3), offset strings not double-shifted, date-only passthrough, null-on-invalid, catalog null-contract) — 51/51 web tests, lint clean, portal rebuilt.

- **2026-09-28 (later)** — **maxicert-test-kb unblocked via the sitemap source — 20 docs / 855 chunks ingested, retrieval verified**: sharp-drawn diagnosis of maxicert.com's REST breakage: WordPress itself is healthy (real 404s, login, `/wp-json/` index, `/types`/`/media` JSON) but the **content collections only** (`/wp-json/wp/v2/pages|posts`, incl. single items) get their response **bodies replaced with rendered Elementor HTML** while genuine WP REST headers pass through (`Link: rel=api.w.org`, `X-Robots-Tag: noindex`) — a server-side content-route rewrite on Hostinger LiteSpeed (`platform: hostinger`, `panel: hpanel`), site-side to fix. Rather than wait, the KB was switched to the existing **url source**: `PUT /gateway/kbs/maxicert-test-kb { sourceType: "url", sourceConfig: { sitemapUrl: "https://maxicert.com/wp-sitemap.xml", maxUrls: 20, scope: "limit", docLimit: 20 } }` (sitemap index recursion already supported — 7 child sitemaps; `maxUrls` capped at 20 to match docLimit so only 20 pages are fetched, not 1000; vector ids stay collision-free in the shared `max-test-index` via the F14 `kb/<kbKey>` hash prefix). Ingest run: 20/20 documents, 855 chunks → R2 `kb/maxicert-test-kb/`, 0 embedding fallbacks, 34 min (big Elementor pages), status error→active. Retrieval verified through the production seam (`retrieveContext` CF fast-path — `max-test-index` is Cloudflare Vectorize, so `retrieveNonCfContext` correctly returns null there): BIFMA Nigeria 3 matches @0.844/0.829, ISO 14001 Tanzania 0.875 with on-topic chunks. Gotcha for future asks testing: maxicert `/ask` is gated by its per-company ask API key (400 Invalid or missing API key) — verify retrieval via `retrieveContext` or the portal, don't rotate the production key. Portal shows Active/20/855 (screenshot `/tmp/vis/r14-maxicert-kb-ingested.png`). When the site's WAF/plugin rule is lifted, the KB can be switched back to `wordpress` source for metadata-faithful ingests (registry keys are source-shaped, so a re-ingest re-processes cleanly).

- **2026-09-28** — **Ingestion no longer launders a dead WP source into a "successful" 0-doc run** (maxicert-test-kb diagnosis): the KB showed `active`/no-error with a fresh `lastSyncAt` and 0 documents — root cause was two-layered. (1) **Site-side:** maxicert.com's entire WP REST API is hijacked at the origin — every route (`/wp-json/wp/v2/pages|posts` AND `?rest_route=…`) returns HTTP 200 with `Content-Type: application/json` but the Elementor **homepage HTML** (~13 MB; LiteSpeed header; UA/Accept-independent; other tenants' sites unaffected). (2) **Product-side:** `fetchWP` (services/wp.js) swallowed every error into `null` after retries, `processContent` read that as "no more items", and the run completed "successfully" — status stayed `active`, `lastError` stayed null, and the failed run still stamped `lastSyncAt` (the misleading "5h ago"). Fix: fetchers now **throw** `ExternalServiceError` (502) with an actionable message — body-shape detection (first non-ws char must be `{`/`[`; headers not trusted), parse-error wrap, HTTP-error wrap — while listing exhaustion keeps returning `null`; `fetchWpByIds` validates BASE_URL (`ValidationError`) instead of silently returning `[]`. D12 then records status `error` + `last_error` naming the site and the server-side fix, audit `kb.ingest.failed`, webhook `failed`. Verified e2e: re-ran ingest on maxicert-test-kb with the fix → KB detail page shows the red banner with the full decoded message (screenshot `/tmp/vis/r13-kb-error-banner.png`); the site itself still needs its WAF/security-plugin rule lifted — nothing more to do from this repo. Tests: new `services/__tests__/wp-fetch.test.js` (8, local http server as the WP stand-in — no network; added `services/__tests__` glob to the npm test script) locking HTML-body/invalid-JSON/HTTP-500 → throw, exhaustion → null, BASE_URL guard. 1240/1240 tests · lint clean.

- **2026-09-27** — **neo's guardrail wording tuned via the portal + live edge-case re-verification**: dropped `medical advice`/`drug dosage` from the deterministic tiers (food-safety nuance is the persona guardrail's job — "how much sugar" must reach retrieval, it now lands in the no-info fallback), and rewrote the pattern tier with properly **`/`-delimited regexes**: `\bday trad(?:e|ing)\b`, `\binvest(?:ment|ing)\b`, `\bstocks\b` (kills the substring-`stocks` false positive on chicken stock), `\bwrit(?:e|ing) (?:code|a program|an essay)\b`, plus new injection captures `\bdisregard .{0,20}instructions\b`, `\breveal (?:your|the) (?:system )?(?:prompt|instructions)\b`, `\b(?:buy|sell) (?:stocks?|shares|crypto)\b`. Gotchas found live: (1) regex lines MUST be `/`-delimited — the first save shipped bare `day trad(?:e|ing)`, which parsed as a *literal phrase* and never matched (JSON + stream paths both sailed through; only plain literals like `crypto` vetoed); (2) `/ask` answers cache 60min keyed company+question+assistant — `POST /ask/reset` before comparing pre/post behavior or you verify the stale answer. 8-case matrix green: day-trading / invest-in-stocks / injection / reveal-prompt / disregard / buy-stocks vetoed pre-retrieval (0 sources), chicken-stock risotto + cookies flow to RAG (5 sources), sugar hits the no-info fallback. Screenshots `/tmp/vis/r10-neo-tuned-prompt-tab.png`, `r11-testai-daytrading-veto.png`, `r12-testai-stock-flows.png`.

- **2026-09-25** — **Assistant neo gets a recipes persona (system prompt + guardrails + blocked topics), and the intent fast-path no longer vetoes assistant-owned domains**: authored and applied to gateway assistant `neo` (company neoco, primary KB `neo-recipes`) via `PUT /gateway/assistants/neo`: `system_prompt` ({{CONSULTANT_NAME}}/{{COMPANY_NAME}} templated cooking persona — answer only from retrieved context, present ingredients/steps/timings exactly as sources state, cite recipe names, stay in-domain), `guardrail_prompt` (cooking Topic Scope + food-safety block — a custom guardrail REPLACES the built-in Topic Scope system block, so it re-includes the injection defense), `blocked_topics` (16 newline-separated: crypto/investment/gambling/politics/medical/write-code/injection attempts), temperature 0.3. Along the way found a real papercut: `query/intent.js` hard-blocks the literal word "recipe" (`BLOCKED_PATTERNS` `\brecipe\b`, plus movie/poem/joke/code patterns) BEFORE retrieval — a recipes assistant would be canned-refused on its own domain, including its own suggested follow-ups. Fix: `isBusinessQuery(q, company, hasOwnTopicPolicy)` and `checkFastPath(..., hasOwnTopicPolicy)` — when the selected assistant defines its own `blocked_topics` (i.e. it owns a topic policy), the built-in vertical hard-blocks are bypassed; company `BLOCKED_TOPICS` still always apply, and the pre-retrieval assistant-topic check in `runPipeline` still enforces the assistant's list. Verified live via `/ask` + portal: cookies/mac-and-cheese grounded with sources (persona voice, recipe quoted exactly), "cryptocurrency investment" refused, injection attempt refused (screenshot `/tmp/vis/r6-persona-mac-and-cheese.png`). Tests: 4 new `query/__tests__/query-modules.test.js` cases (bypass + non-bypass + fast-path both ways). 1172/1172 tests · lint clean.

- **2026-09-25** — **Blocked patterns are configurable (assistant + company tiers) instead of hardcoded globally**: the intent fast-path's veto set is no longer a compiled-in array. New `shared/blocked-patterns.js` (pure ESM) owns the format and resolution: each line is a literal phrase (regex-escaped, case-insensitive) or a `/delimited/` regex (only i/u flags accepted), and the tier order is **assistant.blocked_patterns > company `BLOCKED_PATTERNS` config key > `BUILT_IN_BLOCKED_PATTERN_LINES`** — a configured set fully replaces the tier above (an assistant/company can drop the certification-vertical "recipe" veto without listing every built-in). The anchored test-string gate stays always-on (infrastructure hygiene, not policy), and company `BLOCKED_TOPICS` substring vetoes continue to apply on top of whichever tier resolved; the previous one-off bypass ("assistant with blocked_topics skips built-ins") is REMOVED — neoco's recipes persona now carries an explicit 16-line pattern set instead. Plumbing: migration `031_assistant_blocked_patterns.sql` (`assistants.blocked_patterns` TEXT NULL, applied), `mysql/repositories/assistant.js` (create/update map `blockedPatterns`), `assistant-service.js` (validation ≤100 lines/8000 chars + every line must compile via `inspectBlockedPatterns` — save-time, not ask-time; duplicate route copies the field), `query/assistant.js` (override), `query/intent.js` (`checkFastPath(q, company, assistantName, assistantOverrides)` resolves the tier; `isBusinessQuery(q, company, patterns?)` keeps best-effort try/catch around `getConfig` — it throws COMPANY_NOT_FOUND for unknown companies), `config/schema.js` + `config/validation.js` (company `BLOCKED_PATTERNS` in GUARDRAIL_KEYS, same limits + compile check). Portal: Assistants modal Prompt tab gains a "Blocked patterns — replaces the built-ins" textarea; Config → Security gains a `BlockedPatternsCard` (loads/saves the company key via the existing company PUT). Verified live on neoco/neo: assistant tier → recipe+movie questions flow to RAG (5 sources) or persona-steered, crypto refused pre-retrieval; company tier (override cleared) → `\bmovie\b` refused company-wide while recipe flows; restored assistant patterns + cleared company key (screenshots `/tmp/vis/r8-assistant-blocked-patterns.png`, `r9-company-blocked-patterns.png`). Tests: `shared/__tests__/blocked-patterns.test.js` (12), pattern-tier cases in `query/__tests__/query-modules.test.js` (5 new/rewritten), assistant-service validation (3), config validation (1) + override-shape update. 1191/1191 tests · lint clean · portal rebuilt. Docs: `docs/openapi.js` `AssistantInput`/`Assistant` schemas (plus the whole guardrail field group `guardrailPrompt`/`blockedTopics`) and the `PUT /cloudflare/config` ConfigPatch GUARDRAIL description now cover `blockedPatterns`; `docs/AI_API_REFERENCE.md` gains a **Gateway - Assistants** section documenting the persona/guardrail fields, pattern-line format, and the three-tier resolution contract.

- **2026-09-26** — **Built-in prompt variables removed; every `{{VARIABLE}}` is now custom data.** `config/prompts.js` used to inject ten implicit names behind the operator's back — `CONSULTANT_NAME` (assistant name overriding config), `COMPANY_NAME`, `CONTACT_US_URL`, `LOCATIONS_URL`, `SERVICES_URL`, `BASE_URL`, `COMPANY_WEBSITE`, `ASSISTANT_NAME`, `CURRENT_DATE`, `CURRENT_YEAR` — so the same template meant different things per tenant and per day, and nothing in the UI showed which values were in play. Placeholders now resolve ONLY from data, in two tiers: the new company `PROMPT_VARIABLES` config key (JSON array of `{key,value}`, Config → Prompt → Default System Prompt) and the existing `assistants.assistant_variables` (assistant wins on conflict). An unmatched placeholder is left **literal** rather than blanked, so a missing variable is visible in the preview instead of silently deleting prompt text. New `shared/prompt-variables.js` owns the rules (key charset `[A-Z][A-Z0-9_]*` ≤64, ≤50 vars, values ≤2000 chars, case-insensitive match, last-write-wins dedupe) and is imported by BOTH the server and the portal — the old portal twins in `SystemPromptCard.jsx`/`Assistants.jsx` that re-implemented the regex and seeded config defaults are gone, so the preview can no longer drift from the ask path. API: `GET /cloudflare/prompt` returns `variables` (merged map), `companyVariables`, `assistantVariables` and `missing[]`; `PUT` accepts optional `variables` to save the template + definitions atomically and 400s on a malformed key; `GET /cloudflare/config` gained a `PROMPT` section (this also fixed a latent bug — `SYSTEM_PROMPT` was in `PROMPT_KEYS` but in no `CONFIG_SECTIONS` group, so `Assistants.jsx`'s `config.GENERAL.SYSTEM_PROMPT` seed was always `undefined` and new assistants started with an empty prompt). `config/company.js:applyConfigPatch` gained an **array branch**: without it a `PROMPT_VARIABLES` array fell through the string/number branches and was silently dropped with no error. `resetPrompt` restores the default variable set alongside the default template. Migration: `scripts/backfill-prompt-variables.mjs` (dry run by default, `--apply`, idempotent) materialized the former built-ins from each tenant's OWN config — 6 of 7 companies migrated, keeping per-tenant values (maxicert kept its own URLs, not popularcert's); `CURRENT_DATE`/`CURRENT_YEAR` are deliberately not seeded since a stored date goes stale. Verified live in the portal (editor, green/red placeholder chips, live re-resolution, save → reload round-trip normalizing `undefined_thing` → `UNDEFINED_THING`, Assistants chips) — screenshots `/tmp/vis/pv-variables-missing.png`, `/tmp/vis/pv-assistant-variables.png`. Tests: new `shared/__tests__/prompt-variables.test.js` (18), rewritten prompt-variable block in `mysql/__tests__/gateway-assistants.test.js`, `PROMPT_VARIABLES` cases in `config/__tests__/validation.test.js`, 5 route tests in `routes/__tests__/ask-routes.test.js` (built-ins absent, `missing[]`, template+variables save, 400 on bad key, `PROMPT` section shape). 1219/1219 tests · lint 0 errors · portal rebuilt.

- **2026-09-25** — **KB wizard no longer loses in-progress edits to the detail page's 30s poll**: the modal's seed effect treated any new `row` OBJECT reference as "row changed while open" and reset the whole form mid-wizard — `KbDetail`'s `usePoll(loadKb, 30000)` delivers a fresh object every tick, so an admin parked on the Storage & Search step could have their embedding-model selection (and any other edit) silently wiped ~30s in (or on Back-navigation tick boundaries). Row change detection now keys on row IDENTITY (`id` + `kb_key`, the same `rowIdentity` used in the effect deps), so background refetches of the SAME KB no-op while a genuine row switch (different KB) still reseeds. Verified live: selected `@cf/baai/bge-base-en-v1.5` in the advanced embedding dropdown, waited 35s across the poll boundary → selection intact; Back to step 2 → forward → value preserved; saved → `embedding_model_id: 174, provider: cloudflare`, bindings 22/24 untouched (probe passed live); then unbound back to null. 1168/1168 tests · lint clean · portal rebuilt.

- **2026-09-25** — **Bind-time probe failures surface as a decoded banner in the KB wizard**: the 400 from `probeOrThrow` now carries the structured verdict (`err.probe` on the HttpError → `wrap()` includes `body.probe` in the JSON error), `api()` attaches it to the thrown error (`err.probe`), and the KB wizard modal renders a persistent `role=alert` banner (⚠️ "Embedding model check failed — the binding was not saved" + model, decoded reason, raw provider detail, and the fix hint to switch back to Company default) instead of the raw prose error. The modal's own KB save calls pass a new per-call `{ silentError }` api() opt-out so the auto ERROR toast doesn't duplicate the banner (banner is persistent; toast vanished after 3.5s) — the SUCCESS toast still fires from the auto-toaster. Decoder lives in pure-ESM `web/src/probe-verdict.js` (`decodeProbeVerdict`, node --test friendly). Along the way: the modal's embedding select now sends **explicit `null`** for "Company default" (undefined kept the old binding merge — there was no UI way to unbind, making the banner's advice impossible to follow). Verified end-to-end in the portal: Edit neoco-rest-docs → Advanced → bind `NVIDIA NIM · nvidia/nemotron-3-embed-1b` → Save → banner rendered with the decoded HTTP-404 verdict, server row unchanged (`embedding_model_id` still null), no toast fired; re-saved with Company default → success, bindings 22/24 preserved (screenshots `/tmp/vis/probe-e2e-banner.png`, `probe-e2e-02-restored.png`). Tests: `mysql/__tests__/probe-error-payload.test.js` (wrap forwards/omits `probe`), `web/src/__tests__/probe-verdict.test.js` (decoder), kb-service assertion that the thrown error carries the verdict. 1168/1168 tests · lint clean · portal rebuilt.

- **2026-09-25** — **KB embedding models are validated at bind time** (closes the loop on the NVIDIA `nemotron-3-embed-1b` papercut): new `mysql/services/embedding-probe.js` — `probeEmbeddingModel({ companyId, embeddingModelId }, deps)` resolves model → provider → company credential → adapter through the **same resolution the ingest path uses** (`resolveEmbeddingModel`, `CredentialRepository.listByCompany`, `createEmbeddingAdapter`), performs ONE live test embed (15s deadline via `AbortController`; timers unref'd/cleared so no dangling handles), and returns a structured verdict: **ok** (dims/ms), **skipped** `no-model`/`transient`/`provider-outage` (fail-open — a 5xx or network outage must not brick KB configuration; the fallback counters + KB-detail warning card cover the runtime signal), **rejected** `unresolvable`/`no-credential`/`adapter`/`http-4xx`/`bad-response`. `safeDecrypt` degrades malformed credential blobs to `{}` (the 401 the probe then sees is the truthful verdict). Wired into `kb-service.js` `saveKb` (always) and `updateKb` (**only when `embeddingModelId` changed** — re-saving an unchanged, possibly long-standing binding must not hard-fail because a provider wobbled) via `probeOrThrow` → HttpError 400 with a fix message; both writers take an `opts.probe` test seam (house DI pattern). All embedding adapters accept `{ signal }` in `embed()` so the deadline actually aborts the socket. Verified live: binding NVIDIA's dead embed model → `400 "Embedding model probe failed (nvidia/nemotron-3-embed-1b: http-404)…"`; binding healthy `@cf/baai/bge-base-en-v1.5` → 200 in 0.8s; unbind to `null` + unchanged re-save → no probe. neoco restored to its deliberate unbound state, `/ask` still grounded. Tests: `mysql/__tests__/embedding-probe.test.js` (10 verdict cases) + 4 kb-service probe-seam cases. 1162/1162 tests · lint clean.

- **2026-09-23** — **KB-bound embedding failures are visible on the KB detail page** (migration `030_kb_embedding_fallback_stats.sql`): the vector adapters' CF-fallback path (`embedBatchWithFallback`) now counts fallback batches per run via an injectable `EmbedFallbackStats` collector (threaded `resolveKbAdapters({ embedStats })` → vector adapter → embed call) and `ingest.js` persists `last_ingestion_embedding_fallbacks` + `last_ingestion_embedding_error` on the KB row alongside the existing last-ingestion stats (repo `setIngestionStats`, `/gateway/kbs/:key/status` payload). The KB detail page renders an amber warning card ("Embedding model failed during the last ingest — Cloudflare fallback used: N batches …") plus a "CF fallback in last run" badge on the Infrastructure Embedding row. `null` = no KB-bound adapter (company default) — nothing to fall back FROM, never flagged. Verified live: bound the (deterministically 404ing) NVIDIA embedding model, ran an ingestion → row recorded `fallbacks=100`, status endpoint carries it, warning card rendered (screenshot `kb-detail-embedding-warning.png`); then unbound + restored. Tests: 8 embed-fallback cases incl. stats/callback contracts. 1148/1148 tests · lint clean.

- **2026-09-23** — **neoco KB embedding binding reset to the CF default**: `neoco-rest-docs`'s NVIDIA `nemotron-3-embed-1b` binding (set by the wizard's embedding-model dropdown) was the root trigger of the empty-retrieval bug; the binding was cleared via `PUT /gateway/kbs/neoco-rest-docs { embeddingModelId: null }` (bindings 22/24 preserved, audited) so ingest and query both use the company's CF embeddings (`@cf/baai/bge-base-en-v1.5`, 768-dim) with no fallback path in play. Verified: adapters resolve `embedding: null → CF`, retrieval returns 5 matches, `/ask` + Test AI chat answer grounded. Note: NVIDIA's `/v1/embeddings` was intermittently healthy during verification — the unbind stands as the reliability choice; re-binding later requires a full re-ingest (different vector space).

- **2026-09-23** — **KB retrieval falls back to company CF embeddings when the KB's embedding adapter dies** (`query/kb-retrieval.js` `embedQuestion` + new `mysql/adapters/embed-fallback.js`): a KB with a bound-but-broken embedding model (neoco's KB bound NVIDIA `nemotron-3-embed-1b` — NVIDIA's `/v1/embeddings` was 404ing) made every ask return empty: ingestion had written 768-dim CF vectors (via per-item retry fallback) but the query path only fell back to CF when the adapter was *missing*, never when it *threw*. The query side now catches adapter failures and embeds with the company's CF model — the same model the store was populated with. The ingest side was extracted into `embedBatchWithFallback` (adapter → CF fallback on throw/mismatch) and wired into the Qdrant/Pinecone/Weaviate vector adapters, killing the 400-failures-then-retry-storm pattern the neoco ingestion exhibited. Test: `mysql/__tests__/embed-fallback.test.js` (4 cases, stubbed CF fetch + throwaway config-store company). 1148/1148 tests · lint clean.

- **2026-09-23** — **"Prune Dead" button on the models card** (`mysql/services/dead-model-pruner.js` + route `POST /gateway/companies/:key/execute/prune-dead-models` + `web/src/pages/catalog/models-card.jsx`): one-click cleanup next to Test All — the button always runs a **fresh** sweep server-side (never trusts client-supplied results), classifies failures via the pure `partitionSweep` rules (only definitive disownments are prunable: `Function '<uuid>': Not found` and bare `404 page not found`; timeouts are NEVER pruned — capacity/outage — and 5xx/inference/quota failures are kept as existing-but-degraded), and returns a **dry-run preview** (default) that the UI shows in a confirm dialog listing each doomed key with the sweep stats. `dryRun:false` performs the deletes with a per-model reference guard (an assistant still pointing at the model skips it instead of breaking the persona) through `ModelRepository.remove` (pricing + grants cascade); everything is audited (`provider.execute.prune_dead_models`). Empty preview short-circuits to a toast ("No dead models to prune"). Verified live on NVIDIA: re-added a known-dead `adept/fuyu-8b`, ran the UI flow — preview showed "1 dead · 0 timeout/soft-failure" with the model key, confirm deleted the row (catalog back to the 1 embedding row; screenshots `/tmp/vis/prune-dead-preview.png` / `prune-dead-after.png`). Audit-archaeology along the way: the catalog's 27 post-prune rows were wiped at 10:24 by a manual **Delete All** click (audited `provider.models.bulk_deleted`) — not code; the 5 verified-fetch runs during NVIDIA outage waves correctly fetched 0 (outage guard working). Tests: `mysql/__tests__/dead-model-pruner.test.js` (6 pure cases). 1146/1146 tests · lint clean · portal rebuilt.
- **2026-09-23** — **NVIDIA dead-model prune + verified Fetch Models ("fetch only working models")**: (1) **Prune** — after a fresh Test-All sweep reclassified the drift (55 hard-404 `Function '<uuid>': Not found`, 14 timeouts, 5 soft errors, 8 working), the 55 hard-404 rows were deleted via the gateway API after a reference check confirmed zero assistants/company-config/model-access-grants pointing at them (grants cascade anyway). Post-prune sweep: **10/27 working · 14 timed out · 0 dead** (two capacity-blocked models — `nemotron-3-nano-omni-30b-a3b-reasoning`, `poolside/laguna-xs-2.1` — recovered mid-run). (2) **Verified sync** — `fetchProviderModels` now probes every advertised chat model with the batch tester before upserting (`verify` body flag, default on; `verify:false` restores the raw-listing upsert): only models that actually respond are kept, non-chat categories (embeddings) pass through untested, and the response carries a `verification` block (`chatAdvertised/chatResponding/chatDropped/timeouts/inconclusive` + per-model results), a `dropped` key list, and a toast-ready `message`. **Outage guard** (`isSweepInconclusive`): when ~every advertised chat model times out with zero responders AND fewer than 10% hard fails, the sweep is inconclusive — NVIDIA's developer endpoint flaps in waves (observed 3× today; one verified-fetch run caught 0/82 responding while a single direct ping succeeded minutes earlier), and a wave must not read as "all dead": nothing is upserted, `chatDropped` stays 0, the message says "Provider looks down… Nothing fetched; catalog unchanged. Retry when the provider recovers", and the (upsert-only) catalog is left untouched. Tests: `mysql/__tests__/model-tester.test.js` 12 cases (verified-sync keep/drop semantics, inconclusive matrix incl. the hard-fail escape hatch). 1140/1140 tests · lint clean · portal rebuilt · live-verified both paths (inconclusive during a wave; prune verified with the post-prune sweep).
- **2026-09-23** — **Fetch Models can't fix NVIDIA's dead catalog rows — their own /models advertises them** (investigation, no code change): re-running `POST /gateway/providers/nvidia/models/fetch` through neoco's credential returned HTTP 200 with the *same 82 model keys*, including the ones the Test-All sweep proved dead (`adept/fuyu-8b`, `01-ai/yi-large`, `bigcode/starcoder2-15b`, …) — a direct `GET https://integrate.api.nvidia.com/v1/models` confirms NVIDIA's listing endpoint itself advertises models whose inference functions no longer exist on the account (`Function '<uuid>': Not found`). The fetcher upserts (never deletes), so a refresh cannot prune; NVIDIA's catalog is the source of the drift, and only a live chat probe (Test All) distinguishes advertised-but-dead from working. Conclusion: pruning the 46 confirmed-dead rows stays a deliberate admin action (the follow-up request) — not something Fetch Models should or can do.
- **2026-09-23** — **Batch "Test All" for provider models + free-tier tagging** (`mysql/services/model-tester.js` + route `POST /gateway/companies/:key/execute/test-models` + `web/src/pages/catalog/models-card.jsx`): the provider detail page's models card gains a **Test All** button that pings every catalog chat model through the selected company's credential with a bounded worker pool (default concurrency 4, clamp 1–8) and a per-model timeout (default 20s, clamp 1–60s) — one hung or dead model can't stall the sweep. Results paint onto each model card (same ✓/✕ verdict shape as the single Test), plus a summary strip (`N/M working · K timed out · avg Xms`), a collapsible failing-models list with upstream error bodies, and a **"Free models working right now"** badge row — a model is tagged free-tier when its current pricing row is 0/0 or its key matches free-tier naming (`:free` suffix, `…0731free` tails, `free-` prefix; trailing letters excluded so `freedom` doesn't match). Live sweeps solved the standing `Function '<uuid>': Not found` 404 mystery: NVIDIA NIM maps stale catalog names (`adept/fuyu-8b`, `01-ai/yi-large`, …) to internal function UUIDs that no longer exist on the account — of 82 chat models only 8 nemotron/riva/guard models currently respond (46 hard-404, 8 timeouts); Cloudflare Workers AI: 2/4 chat models respond (`@cf/meta/llama-3.1-8b-instruct-fp8`, `@cf/meta/llama-3.2-3b-instruct`; 70B has no route, the bge embedding row correctly rejects a chat ping); cline: `poolside/laguna-s-2.1:free` responds (the only free-tagged working model today); bazaarlink `deepseek-v4-flash-0731free` currently hangs (free-tier saturation); kilo-gateway `kilo-auto/free` untestable (no credential). Tests: `mysql/__tests__/model-tester.test.js` (9 pure-ESM cases: ordering, per-model failure capture, timeout, category/modelIds filters, free tagging incl. false-positive guards, concurrency ceiling). 1137/1137 tests · lint clean · portal rebuilt · verified live via API sweeps and the UI on NVIDIA/cline with screenshots.
- **2026-09-23** — **Edit wizard's Advanced settings step gets the same company-default amber hints** (`web/src/components/kb-modal.jsx`): the Storage & Search step's Advanced mode now renders the review step's unresolvable-default warnings inline under the Vector Store / Document Storage selects (one shared `defaultBindingWarnings` memo feeds both places; each warning carries a `kind` routing it to its select), so an editor who flips a KB to "Company default (config)" immediately sees `⚠️ Config Vector Index "name" doesn't match any provisioned vector resource…` instead of discovering it from a failed ingest. Fix found during live testing: the edit wizard pre-filled `vectorExternalId`/`storageExternalId` from the saved row, which (a) suppressed the hint and (b) meant submit re-sent the stale external id even after the user switched the select to Company default — the select now clears the paired external id on any change, so the UI state, the hint, and the submitted body all agree. Also fixes the review-step `key` to `w.kind`. Verified live on neoco: with `VECTOR_INDEX=ghost-index-no-match` the hint appeared the moment Vector Store was switched to Company default (screenshot `/tmp/vis/kb-edit-advanced-amber-hint.png`); after restoring `qdrant-neoco-kb-vectors` the same flow shows zero hints; KB row confirmed untouched (both runs cancelled, bindings 22/24 intact) and config restored. 1128/1128 tests · lint clean · portal rebuilt.
- **2026-09-23** — **KB wizard review step warns when Company defaults won't resolve** (`web/src/components/kb-modal.jsx` + `shared/default-bindings.js`): the create wizard's Review step now evaluates the selected company's config (`VECTOR_INDEX` / `R2_BUCKET_NAME`) against the wizard's live resource options using **the same matcher the server-side auto-bind uses** (extracted from `kb-service.js` into `shared/default-bindings.js` — `findDefaultBinding` matches `resource_key` **or** `external_resource_id`, capability-guarded for vector — so the hint and the server can never drift). When a Company-default binding can't resolve to a provisioned resource, an amber hint renders directly under the failing review row: `⚠️ Config Vector Index "name" doesn't match any provisioned vector resource — ingest will fail until the KB is bound explicitly.` (Document Storage variant for the bucket). Purely informational — Create stays enabled, since the server-side auto-bind still fills whatever it can and the hint names the exact fix (explicit bindings in Advanced settings, or correct the company config). Verified live on neoco: with `VECTOR_INDEX=ghost-index-no-match` the hint rendered under the Vector Store row (`/tmp/vis/kb-wizard-amber-hint.png`); after restoring `qdrant-neoco-kb-vectors` the same review shows zero hints (`/tmp/vis/kb-wizard-clean-review.png`). Tests: `shared/__tests__/default-bindings.test.js` (pure-ESM matcher + review-evaluation cases); kb-service tests re-pointed at the shared module (no behavior change). 1122/1122 tests · lint clean · portal rebuilt.
- **2026-09-23** — **KBs auto-bind company-default resources at create/edit time** (`mysql/services/kb-service.js` `applyDefaultResourceBindings`): when a KB is saved with **no** explicit Vector Store / Document Storage binding (the wizard's "Company default (config)" path), the company config's `VECTOR_INDEX` / `R2_BUCKET_NAME` are resolved against the company's provisioned `provider_resources` rows and the matching ones are bound automatically — closing the gap where a freshly created KB's first ingest failed with `KB_STORAGE_NOT_CONFIGURED` until a manual Edit-wizard trip. Matching accepts either `resource_key` (what the Config page dropdown writes for registry rows) **or** `external_resource_id` (what live CF selectors write); vector candidates from storage-only providers are skipped (capability guard — never auto-bind a binding ingestion would reject) as are inactive rows; explicit caller bindings always win (fields left empty are the only ones filled), a missing config value or non-matching name silently leaves the field null, and repo failure degrades to no bindings (best-effort, never fails the save). Wired into both `saveKb` and `updateKb` (update merges — an existing binding is preserved). Live-verified: a KB created through the plain Recommended wizard path came out bound to Qdrant `neoco-kb-vectors` (resource 22) + R2 `neoco-doc-storage` (24) with zero manual steps. Tests: `mysql/__tests__/kb-default-bindings.test.js` (10 pure cases: key/external matching, capability skip, inactive skip, precedence, partial fill, missing config, repo failure, saveKb wiring). 1116/1116 tests · lint clean.
- **2026-09-22** — **KB Vector Stores auto-bind when a capable vector index is created** (`mysql/services/kb-auto-bind.js`): provisioning a `vector_index` resource under a vector-capable provider (cloudflare/pinecone/qdrant/weaviate/openai) via `POST /gateway/companies/:key/resources` now heals KBs of that company whose Vector Store binding is broken — null, deleted, inactive, or bound to a non-vector provider (the `testing-kb`-on-R2 papercut). Healthy bindings and KBs already pointing at the new resource are never touched; `vector_external_id` (a derived JOIN alias of the bound resource's external id) does **not** veto a rebind. The create response's `message` lists rebound KBs and returns `reboundKbs: [{kb_key, reason}]`; each rebind is audited (`kb.vector.autobound`, before/after states) and a KB sitting in `status:'error'` is flipped back to `active` (its `last_error` clears on the next successful ingest). Best-effort — failures only log a warning, never fail the create. Tests: `mysql/__tests__/kb-auto-bind.test.js` (12 pure cases incl. the live testing-kb shape); gateway-resources tests stub the auto-bind-facing repos (`findById→null`, `listByCompany→[]`) so route tests never touch the lazy pool. Live-verified on company `test`: creating a CF vector index rebound `testing-kb` from R2 resource #15 → the new index, status error→active. 1088/1088 tests · lint clean.
- **2026-09-22** — **Global toast system for the admin portal** (every action now emits visible feedback): new `web/src/toast-store.js` module-level pub/sub (stack of up to 4, 3.5s auto-dismiss, 1.2s identical-message dedupe, lazy `logUiToast` import so the module stays `node --test`-importable); upgraded `Toast`/`ToastCard` in `feedback.jsx` (glassy card, tone icon, dismiss button, `toast-pop-in` compositor animation honoring reduced-motion) + a single `<ToastViewport />` mounted once in `App.jsx`; `api()` now **auto-toasts mutations** — errors always (`pushToast(msg, "red")`), successes when the server returns a `message` — with two opt-outs: `silentRequest(promise)` (both) and `{ toast: false }` (success-only, used by pages whose `notify()` carries richer phrasing: Companies, Cloudflare indexes/buckets, Config, Assistants CRUD); `useToast().notify()` now pushes into the global store (same signature, all existing call sites keep working), `bulk-actions.jsx` migrated off its local `setToast`, the 10 pages' legacy `<Toast message={toast?.msg}/>` mirrors were removed (they double-rendered the viewport's card), and the KB wizard's `onSaved` no longer double-toasts. Every toast is mirrored to `logs/UI.logs` via `POST /logs/ui` (fire-and-forget audit). Verified live: single success toast on KB create, red error toast on duplicate key, stacking, dismiss, light + dark. 1076/1076 tests (new `web/src/__tests__/toast-store.test.js`, 10 cases) · lint clean.
- **2026-09-21** — **KB vector bindings validated against provider capability + silent pre-flight ingest failures now recorded** (two gaps found while diagnosing `testing-kb`'s instant-exit ingest — its Vector Store was bound to a `vector_index` resource created under **Cloudflare R2**, a storage-only provider with no vector adapter, so every run died in ~100 ms with `KB_VECTOR_NOT_CONFIGURED` while the UI showed nothing): (1) **Capability guard** — new `shared/vector-capability.js` single source of truth (`cloudflare/pinecone/qdrant/weaviate/openai`); `mysql/services/kb-service.js` `checkResourceOwnership` rejects save/update when the vector resource's `provider_key` is not vector-capable (400 with an actionable message), and `GET /gateway/kbs/options` now splits resources into `vectorResources` (capable only) + `incapableVectorResources`, so the wizard's Vector Store dropdown can never offer a storage provider; `kb-modal.jsx` shows an amber warning when editing a KB whose saved binding is already incapable. (2) **Failure recording** — `ingest.js` consolidates KB failure handling into the single outer catch: pre-flight config guards (storage/vector not configured, bad source adapter) now flip the KB row to `error` + write `last_error` + audit `kb.ingest.failed` like pipeline failures always did, so a fast-exit is visible in the UI instead of silently auto-recovering to `active`. Tests: `shared/__tests__/vector-capability.test.js` (7), `ingest/__tests__/ingest-guard-recording.test.js` (2 — locks that a guard failure records status/last_error/audit), kb-service capability-guard case. 1066/1066 · lint clean · verified live (options annotation, 400 on binding R2 id 15, wizard warning data). (between Ingest Content and Test Chat) so the configuration checklist covers assistant creation: `shared/setup-checkpoints.js` adds the `assistant` def (route `#assistants`), `routes/cloudflare/setup-status.js` flips it done when the company has a gateway assistant row (`AssistantRepository.listByCompany`, first row's name as the detail, e.g. "muse") **or** the legacy config `ASSISTANT_KEY` fallback (still honored by the ask path), `SetupCheckpoints.jsx` grid goes `lg:grid-cols-7`, and the onboarding wizard's "Create an Assistant" row now deep-links into the matching checkpoint instead of keeping its own action (`STEP_TO_CHECKPOINT.assistant` — every wizard step now has a checkpoint counterpart). Verified live: acme-cert 7/7 with `✓ assistant (muse)`; the incomplete `test` company shows the bar at 4/7 with the AI Assistant step pending and its click navigating to #assistants. 1056/1056 tests · lint clean.
- **2026-09-21** — **Test AI toolbar: the per-company ask API key now persists** (`web/src/pages/AskConsole.jsx`): typed once, stored under the `ask-api-key:<company>` localStorage key (try/catch best-effort), restored on page reload **and** on company switch (each company keeps its own key; switching resets the assistant selection as before). Verified live: set → reload → key restored → "What is your name?" answered as Muse with the restored key. **Mobile 390px sweep** of all 13 routes re-run: zero horizontal overflow on every page, theme toggle inline everywhere, dense tables (Assistants) scroll **inside** their card (`overflow-x-auto`), Catalog's Add-provider buttons right-align within the 390px viewport. 1055/1055 tests · lint clean.
- **2026-09-21** — **Full visual e2e pass of the portal** (dark + light, all 13 routes): every page verified live — Dashboard/onboarding (real-state 3/4), Knowledge list + KB detail (bindings, 1,260 vectors), Edit wizard pre-fill (Advanced mode shows the KB's actual Qdrant/R2/embedding bindings), Assistants modal (scoped credential/model dropdowns + non-chat-hidden note), Test AI (Muse persona + Java KB retrieval with sources), Providers, Companies, Workflows, Scheduler, Usage, Logs, Notifications, Cloud Services, ⌘K palette, Playground 24px card gap. One real gap found & fixed: the ask origin gate's dev-host allowlist (`utils/request-context.js`) treated `localhost` as a dev origin but not `127.0.0.1`/`::1`, so the portal worked at `localhost:3000` while Test AI failed with `Origin '127.0.0.1' is not allowed` when opened via the loopback IP — loopback hosts are now always trusted. 1055/1055 tests · lint clean.
- **2026-09-18** — Added a **System Prompt card** on the portal's Config → Playground tab (`web/src/pages/config/SystemPromptCard.jsx`): edit the company-level `SYSTEM_PROMPT` via the existing `GET/PUT /cloudflare/prompt` + `POST /cloudflare/prompt/reset` routes, with a client-side resolved-preview ({{VARIABLE}} → config values), unsaved-changes tracking, and reset-to-default. Previously company prompts were only editable via the API — per-assistant prompts (Assistants page) still override this at ask time.
- **2026-09-18** — **Credential keys are no longer globally unique.** Adding a credential whose key already existed anywhere in the table failed with `Duplicate entry 'test' for key 'uk_credential_key'`; migration `029_drop_global_credential_key.sql` drops that global index, `CredentialRepository.create` purges colliding soft-deleted rows (deleted keys can now be recreated), and create/update routes map `ER_DUP_ENTRY` → **409 `CREDENTIAL_KEY_EXISTS`** with an actionable message. See the detailed entry below.
- **2026-09-22** — **testing-kb ingestion failed: nameless vector resource.** The `test` company's KB was bound to a vector index resource whose `external_resource_id` and `config.index_name` were both empty, so `ensureIndex()` called Cloudflare's create-index API with `""` → 400 `vectorize.index.invalid_name - Index name ""` → KB stuck in `error`. Fixed the data (bound the existing live `test-index` to the resource, cleared the KB error state) and hardened the code: `ingest/resolve.js` now fails fast with an actionable message when a KB vector resource carries no index name (surfaced through the `KB_VECTOR_NOT_CONFIGURED` guard on the KB row), and `CloudflareVectorAdapter.ensureIndex()` refuses an empty name as defense in depth.
- **2026-09-21** — **KB detail page backs off idle progress polling.** The detail page previously hit `GET /gateway/kbs/:key/ingest-progress` every 2s even with no ingest running (~30 req/min per open tab, mostly 304s — visible in request logs). The poll now runs at 2s only while a run is live or paused and drops to 30s when idle (the Ingestion list page already skipped inactive KBs internally); live runs started on the detail page flip instantly via the status refresh, runs started elsewhere are picked up by the status poll within one 30s cycle.
- **2026-09-18** — Added `docs/company-setup-guide.md`, a standalone end-to-end company onboarding guide (prerequisites → create company → gateway connections → vector/storage resources incl. Qdrant/Pinecone/Weaviate + KB-binding 409 guard → KB creation → ingestion modes → assistant persona → ask API key → ops checklist). Linked from README's docs table.


# Change Log

Significant changes to the system or this wiki. One entry per notable event (not per commit).

---
## Starter suggestions are KB-grounded and provider-aware
- Date: 2026-09-22
- Summary: `query/suggestions.js` starter questions are now generated from the **bound KB's content** — the seed query is topic-oriented ("main topics and key concepts…"), the prompt is strictly content-framed ("questions a reader of THIS content would ask"), and retrieval prefers the selected assistant's primary KB index over the company `VECTOR_INDEX`. Generation executes through the assistant's own provider credential (same execution binding as the answer path) instead of always hitting Workers AI. The portal (`web/src/pages/AskConsole.jsx`) fallback starters are now content-agnostic ("What topics does this knowledge base cover?"…) and the localStorage cache key was bumped to `ask-starters:v2:` so stale off-KB cached questions flush immediately.
- Root Cause: The old prompt framed KB chunks as "company content" for a "first-time visitor", and the Workers-AI-only LLM call failed for non-CF `SMALL_LLM`s — both pushed the client to hardcoded certification-vertical fallback questions regardless of KB topic.
- Verification: Retrieval pulls book chunks from testing-kb (1.6k chars); generation returns KB-grounded questions when the provider has capacity; provider capacity errors (Bazaarlink free-tier 429) degrade to neutral starters, never wrong-domain ones. 1106/1106 tests (6 new in `query/__tests__/suggestions.test.js`); lint clean; portal rebuilt.

## Ask runtime executes assistants' own providers (provider-agnostic generation)
- Date: 2026-09-22
- Summary: An assistant whose catalog model is NOT an `@cf`/`@cloudflare` key now actually runs — `query/answer.js` routes the generation call through the gateway provider executor (`mysql/services/provider-executor.js`: new `createProviderStreamParser` + `streamChat` + `supportsProviderStreaming`; OpenAI-compatible SSE and Command Code NDJSON stream token-by-token, other wire formats deliver at completion). `resolveAssistantOverrides` exposes an `execution` binding (`credentialId` + `providerKey` from the assistant row) and `checkModelAccess` is now **grants-aware** (zero `credential_model_access` rows on a credential = unmanaged = allowed, so assistants never get blanked by "No access grant found"); side-calls (`rewriteFollowup`, `generatePossibleQuestions`) accept the same binding. The cache fingerprint (`getRetrievalBinding`) uses the executed model; the internal `execution`/`llmModel` keys are stripped from public `/ask` responses. Non-CF models without a credential binding still fall back to the company Workers AI model (legacy safe path).
- Root Cause: Company `test`'s assistant "adam" (Bazaarlink `deepseek-v4-flash-0731free`) fell back to the company model, which was also non-CF — every ask hit Cloudflare with a URI it doesn't route (`HTTP 400 code 7000 "No route for that URI"`), surfacing as the generic "An error occurred. Please try again."
- Verification: Live `/ask` + `/ask-stream` through Bazaarlink returned grounded answers from testing-kb's ingested book (token-by-token SSE); 1100/1100 tests incl. new `query/__tests__/provider-ask-runtime.test.js` (11 cases); lint clean; portal rebuilt.

## KB vector bindings validate provider capability; pre-flight ingest failures are recorded
- Date: 2026-09-21
- Summary: See the dated bullet above — `shared/vector-capability.js` defines the vector-capable provider keys mirroring `mysql/adapters/vector/factory.js`; the KB service guard (`checkResourceOwnership` → `isVectorCapableProvider`) refuses save/update bindings to storage-only providers, `/gateway/kbs/options` annotates capable vs incapable resources for the wizard, and `ingest.js`'s outer catch now records pre-flight config-guard failures (`KB_VECTOR_NOT_CONFIGURED` / `KB_STORAGE_NOT_CONFIGURED`) on the KB row (status `error` + `last_error` + audit) so instant-exit ingests are diagnosable from the UI.
- Root Cause: The KB wizard's Vector Store dropdown listed every `vector_index` resource regardless of provider, so a user could bind a KB to an R2 resource with no vector adapter; and `ingest.js`'s config guards threw before the error-recording try block, so such runs exited silently.
- Affected Areas: [[Knowledge Bases]] · [[Ingestion]]
- Source Files: `shared/vector-capability.js` · `mysql/services/kb-service.js` · `mysql/routes/kbs.js` · `web/src/components/kb-modal.jsx` · `ingest.js`
- Testing: `node --test shared/__tests__/vector-capability.test.js` + `ingest/__tests__/ingest-guard-recording.test.js`; full `npm test` 1066/1066 · lint clean · live: options endpoint split + 400 on binding R2 resource id 15.

---
## Credential keys are unique per company+provider+environment (global uk_credential_key dropped)
- Date: 2026-09-18
- Summary: Adding a credential whose key already existed **anywhere in the table** failed with `Duplicate entry 'test' for key 'uk_credential_key'` (hit live adding a bazaarlink.ai API key — company 85's row id=13 with key `test` blocked every other tenant). The `credentials` table carried a GLOBAL unique index on `credential_key`, so once any company used a key, no other company — nor the same company under a different provider — ever could. Migration `029_drop_global_credential_key.sql` drops that index; scoping stays with `uk_company_provider_env_cred` (company_id, provider_id, environment_id, credential_key). Additionally, `CredentialRepository.create` now purges conflicting **soft-deleted** rows before insert (deleted rows are invisible to the app but still occupied the composite unique key, so a just-deleted key could never be recreated), and both the create and update routes map mysql2's `ER_DUP_ENTRY` to **409 `CREDENTIAL_KEY_EXISTS`** with an actionable message instead of a raw 500.
- Root Cause: `UNIQUE KEY uk_credential_key (credential_key)` in `migrations/001_init.sql` made credential keys globally unique across all tenants — a multi-tenancy design flaw (the per-tenant composite key already existed alongside it). Soft-deleted rows permanently occupied both unique indexes because `remove()` only sets `deleted_at`.
- Affected Areas: [[AI Gateway Platform]]
- Source Files: `migrations/029_drop_global_credential_key.sql` · `mysql/repositories/credential.js` · `mysql/routes/credentials.js` · `mysql/__tests__/gateway-credentials.test.js` (3 new cases) · `docs/credentials.md`
- Testing: `node --test mysql/__tests__/gateway-credentials.test.js` (new 409 create/update + non-duplicate-500 cases pass); `node mysql/migrate.js` applied 029 live and `SHOW INDEX` confirms `uk_credential_key` is gone; full `npm test` + `npm run lint` clean.

## Delete guard: resources bound to a knowledge base can no longer be deleted (409)
- Date: 2026-09-18
- Summary: Deleting a `provider_resources` row (or the live store behind it) that a KB still binds as its vector/graph/storage resource left a dangling `knowledge_bases.*_resource_id` pointer — ingest then died with `Resource #N not found` → "Vector store is not configured" (hit live on KB `java-textbook`, whose Qdrant resource #13 was deleted from the portal at 00:03 while the KB still pointed at it; retrieval silently lost the KB too). All delete paths now run `assertResourceNotKbBound` (`mysql/routes/shared-helpers.js`) **before** removing anything: registry delete (`DELETE /gateway/resources/:id`), live vector delete (`DELETE /gateway/companies/:key/vector/resources/:provider/:name` — guard fires before the vendor API call, so the store itself is never dropped), and connection delete (`DELETE /gateway/credentials/:id` when its provisioned resources are bound). Blocking yields **409 Conflict** naming each KB and its binding role (`'java-textbook' (as vector resource)`), so the admin re-points or deletes the KB first. Two deliberate exceptions: the provider force-delete purge (`DELETE /gateway/providers/:key?force=true`) cannot be blocked (that's what force means) — instead `KbRepository.clearResourceBinding(resourceId)` NULLs the dangling columns first (a KB losing its vector resource degrades to empty config, which the pipeline already handles better than a stale id), and every purge is audited with `unbound_kbs` in `afterState`.
- Reason: correctness — the stale-pointer failure mode was silent until an ingest failed, and the fix (manually re-pointing `knowledge_bases.vector_resource_id`) was data surgery no portal admin could perform.
- Affected Areas: [[Knowledge Bases]] · [[Routes Map]] · [[Codebase Index]]
- Implementation notes: new `KbRepository.listByResource(resourceId)` (live KBs binding the id in any of the three columns — role attribution in the error message reads the same row's `vector_resource_id`/`graph_resource_id`/`storage_resource_id`) + `KbRepository.clearResourceBinding(resourceId)` (UPDATE … SET all three = NULL, returns the affected KB keys); `ConflictError` (409, `code: "CONFLICT"`) from `shared/errors.js`; the vector-resources live-delete handler checks bindings before `adapter.deleteIndex()`; error-tolerant ordering: an unreachable `listByResource` (legacy tests) fails closed — treat as empty only where the row is already soft-deleted.
- Source Files: `mysql/repositories/kb.js` · `mysql/routes/shared-helpers.js` (`assertResourceNotKbBound`) · `mysql/routes/resources.js` · `mysql/routes/vector-resources.js` · `mysql/routes/credentials.js` · `mysql/routes/providers.js` (force purge unbind) · `mysql/__tests__/kb-resource-guard.test.js` (5 new cases)
- Testing: `npm test` full suite **1052/1052** pass (5 new guard tests + fixed `gateway-resources`/`gateway-provider-test` stubs that the new `KbRepository` calls exposed as silently pool-hanging); verified live: `DELETE /gateway/resources/14` → 409 naming `java-textbook` (as vector resource), `DELETE /gateway/resources/11` → 409 naming both KBs (storage), unknown id still 404; `npm run lint` clean.
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---



## Live vector-store provisioning for Qdrant / Pinecone / Weaviate (parity with Cloudflare)
- Date: 2026-09-18
- Summary: The portal previously could only create/manage **Cloudflare** infrastructure live (Vectorize/R2/D1/KV via `cloudflare-resources.js`); Qdrant/Pinecone/Weaviate connections could be configured but their stores had to be provisioned by hand in the vendor console, then registered as dead rows on the provider detail page. A new gateway router `mysql/routes/vector-resources.js` exposes `GET|POST /gateway/companies/:key/vector/resources/:provider` and `DELETE …/:provider/:name` (provider ∈ pinecone|qdrant|weaviate), which list/create/drop the **actual** store (Pinecone index, Qdrant collection, Weaviate class) through the company's active gateway connection via per-store adapters (`mysql/adapters/vector/` — `listIndexes`/`createIndex`/`deleteIndex`, factory-keyed). A successful create ALSO registers a `vector_index` `provider_resources` row (external id = live name, `credential_id` bound, config carrying `index_name`/`collection_name`/`class_name`) so the new store is immediately selectable in the KB wizard / Config selectors; delete drops the live store first, then soft-deletes matching registry rows + runs `clearRagResource` (a failed provider call never orphans the binding). The provider detail page gains `vector-resources-card.jsx`, a live CRUD card mirroring the Cloudflare one, with per-provider create fields (Pinecone dimensions/metric/cloud/region, Qdrant dimensions/distance, Weaviate vectorizer) driven by the pure-JS metadata module `vector-providers.js`; the generic registry Resources card stays for pre-existing stores and remounts on live-card changes.
- Reason: feature parity — non-Cloudflare vector providers deserve the same "configure connection → create/manage stores in-portal" flow as Cloudflare Vectorize, without vendor-console round-trips or manual registry bookkeeping.
- Affected Areas: [[Component Architecture]] · [[Routes Map]] · [[Codebase Index]] · [[Knowledge Bases]]
- Implementation notes: name validation is a shared contract — `VECTOR_RESOURCE_NAME_RES` in `shared/patterns.js` (per-vendor regexes: Pinecone lowercase 1–45 alphanumeric-anchored, Qdrant 2–63 word/dot/hyphen, Weaviate must start uppercase) is enforced by the router's `validateName` and mirrored client-side by `vectorNameError`; adapter creation requires the company's **active** credential (404 with a pointer to the Connections card when absent); upstream provider errors are always surfaced as **502** so a vector store's 401 can never collide with the portal's admin-session 401 "logged out" handling; registration is best-effort + idempotent (`findByExternalId` reuse, slugified `resource_key` with `ER_DUP_ENTRY` retry suffixes); registration writes `config.<name key> = <name>` so `ingest/resolve.js` and `query/kb-retrieval.js` resolve portal-created stores exactly like manually registered ones.
- Source Files: `mysql/routes/vector-resources.js` · `mysql/adapters/vector/{factory,pinecone,qdrant,weaviate}.js` · `shared/patterns.js` · `web/src/api.js` · `web/src/pages/catalog/vector-resources-card.jsx` · `web/src/pages/catalog/vector-providers.js` · `web/src/pages/catalog/detail.jsx` · `web/src/pages/catalog/__tests__/vector-providers.test.js`
- Testing: `npm test` full suite 1047/1047 pass (incl. `mysql/__tests__/vector-adapters.test.js` 71/71 and the new `vector-providers.test.js` 5/5); `npm run lint` clean; `cd web && npm run build` ✓.
- Documentation Updated: [[Routes Map]] · [[Component Architecture]] · [[Codebase Index]] · this page.
- Related Decisions: [[ADR Index]]

---


## Assistant model dropdown scoped to configured providers

The Assistant form's Model select drew from the **selected credential's
provider** (correct — that's whose API key executes at ask time), but the
Credential select listed every credential including storage/vector credentials
(R2, Qdrant, Pinecone) whose providers have no chat models — producing dead
bindings with empty Model dropdowns. And the earlier session's catalog seeding
had added Cloudflare chat models that appeared for a Cloudflare credential even
when the admin thought of Cline as "the configured provider".

Now (per admin decision: configured-providers-only):

- **Credential select** lists only chat-capable credentials — when the modal
  opens, each configured provider's catalog is probed once and providers with
  zero chat models (storage R2/S3, vector Qdrant/Pinecone, graph Neo4j) are
  hidden, with a "N non-chat credentials hidden" note when any are dropped.
- **Model select** lists only `category: "chat"` models of the selected
  credential's provider (embeddings dropped; labels no longer repeat the
  category).
- The Providers *page* remains the full 113-provider seeded catalog
  (migrations 008/009/010 — a marketplace view); "No connections" badges are
  informational, not configuration.

Runtime note: the ask pipeline currently executes assistant LLM calls through
Cloudflare (`fetchCloudflareAI`) with a `@cf/` runnable gate — a Cline model
binding is honored only when the pipeline gains per-provider execution; the
`isRunnableModel` fallback keeps such assistants working on the company model
in the meantime.

- Date: 2026-09-17
- Summary: Model options = chat models of the selected credential's provider;
  non-chat credentials hidden from the Credential select.
- Reason: arbitrary/unconfigured provider values and dead model dropdowns
  confused assistant setup.
- Affected Areas: [[Knowledge Bases]] · [[Integration Architecture]]
- Implementation notes: per-provider chat counts are probed on modal open
  (parallel, failure → 0) rather than adding an API; scope for later: a
  dedicated "chat-capable credentials" gateway endpoint.
- Source Files: `web/src/pages/Assistants.jsx`
- Testing: `npm test` 1037/1037 pass; verified in-browser on acme-cert —
  Credential select shows only Cloudflare + Cline (R2/Qdrant/Pinecone hidden
  with the count note), Model select shows CF llama models for the CF
  credential and 50 Cline chat models after switching.
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## Assistant model dropdown: catalog seeding, no-models hint, token username crash

Three fixes around the Assistants page:

1. **Model dropdown empty (the report)** — two compounding causes: the new
   assistant was bound to the **Qdrant credential** (a vector-DB provider with
   zero models — the dropdown only lists the credential's provider models), and
   the Cloudflare catalog had only the BGE embedding model — no chat models at
   all. Seeded the three runnable CF chat models (llama-3.1-8b/3.3-70b/3.2-3b)
   via the idempotent `POST /gateway/providers/:key/models` upsert, repointed
   the assistant to the Cloudflare credential, and added a hint under the
   Model select when the selected credential's provider has no models (with a
   deep link to the provider detail page).
2. **Blank portal (found while verifying)** — `(username || "A").charAt` crashed
   the whole Layout when `/auth/me`'s `username` was an object (the dev token
   minted earlier in this session had signed an object payload). The AuthProvider
   now normalizes the username to a display string (name/username/sub), the
   sidebar is defensive on both shapes, and `verifyToken` rejects non-string
   `u` tokens so stale/hand-crafted tokens get a 401 + re-login instead of a
   crash.
3. **Assistants page TDZ crash (found while verifying)** — `credProvider` was
   declared before the `form` state it reads ("Cannot access 'a' before
   initialization" caught by the page error boundary); moved after the state
   declaration.

- Date: 2026-09-17
- Summary: Assistant model selection works end to end (credential → provider
  models dropdown → save); portal renders with any token shape.
- Reason: no selectable models existed for the bound provider; two render
  crashes hid the page.
- Affected Areas: [[Knowledge Bases]] · [[Authentication Flow]]
- Implementation notes: model seeding is data (upsert API), not a migration —
  re-runnable per environment; username normalization lives in AuthProvider so
  every context consumer gets a string.
- Source Files: `web/src/pages/Assistants.jsx` · `web/src/auth.jsx` · `web/src/components/Layout.jsx` · `auth.js`
- Testing: `npm test` 1037/1037 pass; verified in-browser — Muse edit modal
  shows Cloudflare credential + Llama 3.1 8B selected, Qdrant credential shows
  the no-models hint, save round-trip persists (cred 20 / model 340).
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## Qdrant/Weaviate register-existing vector resources ingestable; intent "who is" hijack fixed

The `java-textbook` KB (acme-cert, file-type, 40 MB PDF) failed ingestion with
`Qdrant create collection failed (400): bad request`. Three stacked root causes:

1. **Empty collection name at ingest** — the resolver only filled
   `vectorIndexName` from `kb.vector_external_id`, but register-existing
   templates (migration 027) store the target in resource config
   (`collection_name`/`class_name`/`index_name`), so the adapter built
   `PUT /collections/` (empty) → 400. `ingest/resolve.js` now falls back to the
   config-stored name; `query/kb-retrieval.js` gains `kbVectorIndexName()` and
   `vectorIndexMatchesKb` returns a new `"config"` origin so the ask path routes
   to the same collection.
2. **Named-vector collections silently dropped points** — a collection created
   externally with a named vector (e.g. `abstract-dense-vector`) accepted
   unnamed-vector upserts with 200 but discarded them (`points_count` stayed 0).
   The Qdrant adapter now probes the collection schema (`ensureIndex` on ingest,
   best-effort `_probeSchema` on query), distinguishes the unnamed params shape
   `{size, distance}` from a real named map (keying on the `size` key), wraps
   vectors as `{[name]: v}` when needed, and upserts with `?wait=true` rejecting
   `{status !== "ok"}` so failures are loud instead of silent.
3. **Intent fast-path hijacked content questions** — `CONTACT_PATTERNS` matched a
   bare `who is`, so "Who is the author of this Java book?" returned the canned
   contact response without touching RAG. Now `who is` requires a person-role
   word; `who runs/owns/founded/leads` still matches.

Also data-fixed the KB row (embedding model 174 `@cf/baai/bge-base-en-v1.5` was
unbound, status reset). Verified live: 1313-page PDF → 1260 chunks → 1260
points in Qdrant; `/ask` answers grounded in the book with sources.

- Date: 2026-09-17
- Summary: Non-CF (Qdrant) register-existing vector resources now ingest and
  answer; named-vector collections detected and handled; "who is …" content
  questions reach RAG instead of the contact canned response.
- Reason: KB ingestion errored / silently produced zero vectors; content
  questions starting with "who is" never reached retrieval.
- Affected Areas: [[Knowledge Bases]] · [[Integration Architecture]]
- Implementation notes: schema probe is best-effort; `?wait=true` trades a
  little latency for guaranteed persistence; query path probe only runs when
  the target collection is the adapter's own.
- Source Files: `ingest/resolve.js` · `query/kb-retrieval.js` · `mysql/adapters/vector/qdrant.js` · `query/intent.js`
- Testing: `npm test` 1037/1037 pass (new: config-name matching, kbVectorIndexName,
  named-vector upsert rejection, intent regression). Live e2e verified on
  `java-textbook` (acme-cert → Qdrant Cloud).
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## Header: theme toggle pinned inline; page-level overflow fixes

The theme toggle rendered as the last child of the header's wrapping actions
row, so pages with many toolbar actions (Knowledge, Catalog) wrapped it onto
its own left-aligned line below the actions — the screenshot-reported
"theme changer icon is not in same line" bug. Three-part fix:

1. **Layout header** (`web/src/components/Layout.jsx`): the actions cluster is
   now a non-wrapping outer row holding [wrapping, right-aligned inner group]
   + [theme toggle]. Page actions wrap within the inner group; the toggle can
   never orphan. `items-start sm:items-center` so a wrapped mobile toolbar
   top-aligns the toggle with its first row.
2. **Popover width contract** (`web/src/components/ui/overlay.jsx`): the
   wrapper was hard `w-full` with `cx("relative w-full", className)` — a
   passed `w-auto` collided with the default and stylesheet order decided the
   winner. Now `className ?? "w-full"`: a passed className replaces the
   default width authoritatively. `theme-toggle.jsx` passes
   `w-auto shrink-0`; full-width consumers (sidebar user menu, scope
   selectors) pass nothing and keep `w-full`.
3. **Page-level**: `#main` gains `min-w-0` (flex item default `min-width:auto`
   let Logs' unbreakable JSON log lines in the 70vh `<pre>` stretch main to
   1400px at 1280 viewport — the pre now scrolls internally). AskConsole's
   header toolbar wraps (`flex-wrap max-w-full`) and its API-key input goes
   fluid below `sm:` (`w-full max-w-64 min-w-0` instead of `w-64 shrink-0`).

Verified live: measured sweep of all 13 portal routes at 1280×800 — toggle
inline (top=47, right=32) on every page, doc width = viewport everywhere
(Logs 1633→1280, Ask 728→390 at mobile). Theme popover light/dark switch
re-verified after the width change; sidebar user menu unaffected.
1031/1031 tests · lint clean.

- Source Files: `web/src/components/Layout.jsx` · `web/src/components/theme-toggle.jsx` · `web/src/components/ui/overlay.jsx` · `web/src/pages/AskConsole.jsx`

---

The wizard re-listed guidance that the "Finish setting up" checkpoints bar
already owns (connect provider, ingest content, test chat). Now only the
bar's stepper carries that guidance: wizard steps with a checkpoint
 counterpart (`content`→content, `ai-setup`→credentials, `test`→chat) fire
`pc:focus-checkpoint` and navigate to the checkpoint's route — the bar
un-dismisses, highlights the matching step (ring pulse, 3.5s), and scrolls
into view. The assistant step keeps its own action (no checkpoint covers
it), and steps keep their progress/detected badges — completion logic is
unchanged, only where the button points. Fallback intact: when checkpoint
status is unavailable or the step is already done, the wizard renders its
own action button as before. Wiring is pure and unit-tested
(`checkpointLinkResolver` / `checkpointForStep` in
`web/src/onboarding-state.js`; 12 tests). Verified live on the incomplete
`test` company: linked rows show "↳ Tracked by the setup bar above",
clicking "Set Up Providers" navigated to #catalog with the bar present and
the AI Provider checkpoint highlighted; dismissed bar revives on focus
event. 1031/1031 tests · lint clean.

**Mobile audit (390px sweep)**: verified end-to-end at 390×844 — bar chips
fit in a 2×3 grid, linked rows and the "↳ Tracked by" hint render unclipped,
real button click navigates + revives + highlights with zero horizontal
scroll, highlight auto-clears after 3.5s, and light/dark both render clean.
One defect found and fixed: the wizard row was a single flex line, so the
action button squeezed the text column to ~100px on mobile — rows now
`flex-wrap` with the action dropping to its own right-aligned line under
`sm:` (desktop single-line unchanged, re-verified at 1280px).

- Source Files: `web/src/onboarding-state.js` · `web/src/components/OnboardingWizard.jsx` · `web/src/components/SetupCheckpoints.jsx` · `web/src/__tests__/onboarding-state.test.js`

## Onboarding wizard vs SetupCheckpoints: divergence locked by tests

The two setup guides overlap on purpose, and the interesting case is where
they must DISAGREE: a company completes onboarding, then its Cloudflare
connection is deleted — rag-sync clears `CLOUDFLARE_API_TOKEN` from the RAG
config store. SetupCheckpoints (config integrity) must reopen the "AI
Provider" step (setup-status `credentials: false` → the bar reappears);
the onboarding wizard (workspace artifacts) keeps "Connect AI Services"
done (the gateway credential row still exists). Wizard = "did the user do
the tour step", checkpoints = "is the tenant healthy".

To make this testable, the wizard's workspace probes moved from
`OnboardingWizard.jsx` into pure-ESM `web/src/onboarding-state.js`
(`checkWorkspaceState({ company, listKbs, listCredentials, listAssistants })`
with fetch-injectable fakes; probe failure → `null` "unknown", never
false). New tests: `web/src/__tests__/onboarding-state.test.js` (8 —
envelope counting, fresh/onboarded workspaces, per-probe failure isolation,
and the revoked-credential divergence case asserted on both sides) and a
`routes/__tests__/setup-status.test.js` case (revoked token reopens
`credentials` as the next blocker while vector-index/storage selections
survive). 1027/1027 tests · lint clean · wizard behavior unchanged in the
portal (same probes, now via the shared module).

- Source Files: `web/src/onboarding-state.js` · `web/src/components/OnboardingWizard.jsx` · `web/src/__tests__/onboarding-state.test.js` · `routes/__tests__/setup-status.test.js`

## KB wizard: JSON-only API tips + advanced-key passthrough

Follow-up to the REST e2e finding that JSON API bodies flow into chunks
verbatim. The wizard's Custom REST section now shows a **Tips for JSON-only
APIs** box under the Content-format selector: (1) which fields are
auto-detected (title/content/slug/link/modified from common shapes) and that
nested fields need a `mapping` block; (2) that `mapping` / `headers` /
`timeout` / `items` are advanced keys the form doesn't edit — set them once
via `PUT /gateway/kbs/<key>/sources` (the example interpolates the KB key
being typed); (3) retrieval-quality guidance (point `mapping.content` at the
prose field). A context-sensitive hint under Content format explains
HTML-vs-plain-text. To make tip 2 honest, the wizard now **preserves
advanced rest keys across edit round-trips**: `parseRest` stashes the raw
rest block and `buildRestConfig` re-applies every non-form key
(`REST_FORM_KEYS` allowlist; form-managed fields always win). Verified live:
a KB with API-set `mapping` + `timeout` survived a full wizard edit + save
untouched. Tips render in both themes (screenshot); 1018/1018 tests · lint
clean.

- Source Files: `web/src/components/kb-modal.jsx`

## Live e2e: custom REST source → ingest → /ask (passed)

Full lifecycle verification of the generic REST source against a real API
(jsonplaceholder.typicode.com), run as a throwaway KB `e2e-rest-throwaway`
on maxicert bound to the company default `max-test-index` / `max-test-data`:

- **Create** — `POST /gateway/kbs` with `sourceType: "custom"` and
  `source_config.rest = { endpoint: …posts?_page={page}&_limit=5, perPage:
  5, maxItems: 10 }` → validated at save time, created.
- **Ingest** — page-number pagination fetched 2 pages × 5 posts → 10 docs,
  each JSON body flattened into markdown → 100 chunks → R2 under
  `kb/e2e-rest-throwaway/` + Vectorize upserts (768d BGE) → status
  `active` in ~146s (graph extraction off; JSON bodies are one chunk each
  per doc-prefix batch).
- **Verify** — registry listed the 10 docs; document preview returned the
  stored chunk content (raw JSON payload as text); `/ask` answered
  content-grounded questions (post id 5 body quoted verbatim from stored
  chunks) with `[Source N]` labels, keyed via the company ask API key.
- **Teardown** — KB deleted via API (`removeKb` is DB-only by design D10);
  orphaned R2 objects + vectors purged by a one-off script that derives
  the same deterministic vector ids (`sha256(r2Prefix/slug)[:48]-<i>`)
  from the stored chunk JSONs, then `deleteByIds` + S3 `DeleteObjects`.
  Registry file removed.

Known sharp edge (by design, not a bug): JSON API bodies without HTML are
ingested as-is (chunker treats them as text), so retrieval quality depends
on the API returning meaningful text. A `mapping`/`contentFormat: "text"`
source_config keeps prose sources clean.

## KB detail: read-only REST Source card for custom KBs

The REST config saved by the wizard was invisible outside it — the KB detail
page showed only "Source type: custom". The Configuration tab now renders a
read-only **REST Source** card for `source_type: "custom"` KBs
(`web/src/pages/KbDetail.jsx`): endpoint (monospace, break-all), pagination
mode with totalPages/cursor sub-paths, items path, per-page / max-items,
content format, and auth (type + "configured" — secrets are never rendered,
presence-only with a rotate-via-wizard note). When the KB has no `rest`
block (e.g. a server-side adapter is intended), the card shows an explicit
warning that ingestion will fail until one is configured. Verified live in
both states: `testing-kb` (popularcert, no rest block → warning) and a new
`rest-test-kb` (maxicert, created through the wizard against
jsonplaceholder → full config view). 1018/1018 tests · lint clean.

- Source Files: `web/src/pages/KbDetail.jsx`

## KB wizard: Custom REST API config + adapter warning

The KB wizard's "Custom" source option was a dead end — the label promised an
API-driven source but step 2 offered no way to configure one (the backend
`source_type: "custom"` support from the REST-source work was unreachable from
the UI). `web/src/components/kb-modal.jsx` now renders, when Custom is
selected: an amber warning box ("Custom sources need a data feed before they
can ingest — configure the REST API below or register a server-side adapter,
otherwise ingestion fails with a 'no rest block' error"), structured REST
config fields (endpoint with `{page}`/`{cursor}` placeholders, items path,
pagination mode incl. totalPages/cursor/link sub-fields, per-page/max-items,
auth type with per-type fields, content format), and a live error list that
mirrors the server's `validateRestSourceConfig` rules as the user types.
Continue is disabled while the REST config is invalid — the same rules the
API enforces, checked client-side. `submit()` sends `{ rest: … }` as the
KB's `source_config`; the Review step shows the endpoint + auth rows.
Edit pre-fill round-trips the stored config via `parseRest` (auth tokens
included — the API redacts nothing in `source_config` for KB rows).
Also fixed two stale lint errors left from the Clerk removal (unused
`AuthShell` imports in `web/src/App.jsx`). Verified in-browser: warning shows,
invalid URL → 2 live errors + blocked Continue, valid URL → Continue enabled,
Review step shows the endpoint; 1018/1018 tests · lint clean.

- Source Files: `web/src/components/kb-modal.jsx` · `web/src/App.jsx`

## Onboarding wizard v2 — real-state completion + per-company scoping

Visual e2e of the Dashboard onboarding wizard caught a dead-navigation bug
(step buttons called `navigate(step.route)` but the route lives at
`step.action.route` → every click landed on `#undefined`), then a rework of
the progress model (`web/src/components/OnboardingWizard.jsx`):

- **Real-state verification**: steps 1–3 auto-complete from the selected
  company's actual workspace — a KB exists, a provider credential exists, an
  assistant exists (best-effort `Promise.all`, any API failure = "unknown",
  never blocks). Detected steps show a "Done · detected" badge. Step 4
  (Test AI) stays manual — no persisted test record exists.
- **Per-company keys**: progress / dismiss / collapse now live under
  `pc_onboarding_*:<company>`; legacy un-namespaced keys are ignored.
  Completing onboarding for one workspace no longer marks it done everywhere.
- **Collapse persistence**: manual collapse survives reloads per company.
- **Mobile**: verified at 390×844 (no h-scroll, clean stacking); "Mark as
  done" tap target bumped to 26px.

Findings recorded in `.scratch/onboarding-audit/findings.md`.

---

## Dark-mode contrast audit across all portal pages

Full dark-mode sweep of all 13 routes (screenshots + programmatic WCAG contrast check with
alpha-composited backgrounds). Two real defect classes found and fixed, plus a
project-wide convention change:

- **`text-slate-600` is banned for text on dark surfaces** (~35 instances across
  Dashboard, Scheduler, Logs, Companies, KbDetail, kb-modal, OnboardingWizard,
  SetupCheckpoints, and others) — bumped to `text-slate-500` (≥4:1 on slate-950).
- Onboarding wizard step circles: `text-slate-500` → `text-slate-300` on the
  slate-800 tile.
- Audit-tooling lesson: `getComputedStyle().color` returns `oklch()/oklab()` in
  Tailwind 4, which naively parsed RGB-luminance scripts misread as ~1:1 —
  emerald/amber/gray-400 flags were verified as false positives against raw
  computed values before touching them.

Verified: re-audit clean on every route (remaining flags are parse artifacts),
console error-free, lint + build green, server restarted with the new bundle.

---

## Apple-design audit across all portal pages

Full-page sweep (13 routes, screenshots + DOM assertions) against the apple-design foundations,
fixing at the **shared-primitive level** so every page inherits:

- **Press feedback everywhere** — `Button` (`active:scale-[0.97]`) and `IconButton`
  (`active:scale-90`) now dip on pointer-down, not just hover (§1 Response).
- **Modal material** — dialogs get a light-catching top edge (`border-t-slate-500/40`), layered
  depth shadow, and a critically-damped `modal-pop-in` entrance (scale+rise, 260ms,
  `cubic-bezier(0.16,1,0.3,1)`); title gets tight tracking (§12).
- **Skeleton shimmer** — loading placeholders keep the pulse and add a directional light sweep
  (`skeleton-shimmer`, compositor-only, reduced-motion collapses it) so loading reads as progress.
- **Header craft** — the API Docs button no longer wraps to two lines (`shrink-0 whitespace-nowrap`);
  page `h1` gets `tracking-tight` (§15).
- **Invalid DOM nesting fixed (Logs)** — each log-file card was a real `<button>` containing
  Download/Clear `<button>`s; converted to `div[role=button]` with `tabIndex` + Enter/Space key
  handling so keyboard parity is preserved (10 nested buttons → 0; console `validateDOMNesting`
  warning gone).

Verified: zero console errors across dashboard/ask/companies/logs, 1018/1018 tests, lint clean.

---

## Clerk components removed from the portal — login is a pure API call; Logs + API Docs links restored

- **Portal**: `@clerk/clerk-react` uninstalled; clerk auth module (removed), the `<SignIn />` card, the
  module-level session poller, `ClerkProvider` wiring in `App.jsx`, and the header
  `<UserButton />`/fallback are gone. `#login` route removed — every unauthenticated view renders
  the portal's own themed login form (`web/src/pages/Login.jsx` in `AuthShell`), which posts
  `username`/`password` to `POST /auth/login` and stores the returned HMAC token. The user menu
  (popover) is back as the only header account control.
- **Backend**: the clerk-proxy router (removed) (Frontend API dev proxy) and `POST /auth/clerk-session`
  (session-JWT exchange, clerk session module (removed)) deleted; `/auth/me` no longer advertises
  `clerkSessionExchange`; global rate-limiter static-prefix list slimmed to `/assets/`. Clerk
  remains **server-side only**: `auth-clerk.js` verifies passwords via the Backend API
  (lookup + `verify_password`), so Clerk-managed users keep working from the same form.
- **Navigation fixes**: the **Logs** sidebar link was missing from the NAV array (PAGE_META kept the
  entry but no item rendered it) — restored under Insights with a new `IconFile`; an **API Docs**
  button (Swagger UI, new tab) now sits in the page header next to Search/Theme so it no longer
  lives only inside the user popover.
- Verified: login through the form with a real Clerk user (200, provider `clerk`), `/auth/clerk-session`
  and `/clerk-proxy/*` 404, zero clerk code in the built bundle, Logs + API Docs visible in the UI.
  1018/1018 tests, lint clean.

---

## Clerk password login rewritten onto the real Backend API (verify_password)

`POST /auth/login` with `CLERK_SECRET_KEY` set previously drove Clerk's **two-step `sign_ins`
flow — which exists only on the Frontend API**. Server-side calls to `POST /v1/sign_ins` return a
plaintext `404 page not found`, so every Clerk login failed with "Clerk sign-in failed (HTTP 404)"
as soon as it ran against the real API (the old tests passed only because they faked `fetch`).

New flow in `auth-clerk.js` (verified live against api.clerk.com):
1. `GET /v1/users?email_address=…` then `?username=…` — resolve the identifier to a user (empty →
   generic `Invalid username or password.`, no account enumeration; 401/403/5xx → temporary error)
2. reject `two_factor_enabled` users with a clear message (the portal form has no 2FA step)
3. `POST /v1/users/:id/verify_password` — 200 `{verified:true}` → ok; 422 `incorrect_password` →
   invalid; **non-JSON 404 → temporary error (503), never "wrong password"** (regression-locked)

Identity now comes from the user object (primary verified email, falling back to the identifier);
`CLERK_ALLOWED_EMAILS` semantics unchanged. This affects **only the password login path** — the
browser `<SignIn />` component flow (Frontend API via `/clerk-proxy`) and the session-JWT exchange
(JWKS) were already correct. 1027/1027 tests (2 new: username-param fallback, non-JSON-404 mapping).

---

## Clerk/legacy login fallback matrix verified; header degrades gracefully when the Clerk session dies

- **Portal runtime gating** — `ClerkAuthShell` now mounts `<ClerkProvider>` only when the build has
  a publishable key AND the backend advertises the exchange (`clerk !== "off"`). A portal bundle
  built with the key but pointed at a Clerk-less backend boots exactly like a keyless build (no
  clerk-js against a dead `/clerk-proxy`, no hanging spinner on the login page).
- **Header fallback** — `ClerkUserButtonWithFallback` (clerk-auth.jsx, used by Layout): when Clerk
  mode is on but the Clerk session is gone (user deleted server-side, session revoked) while the
  admin HMAC token is still valid, the header swaps in the legacy user menu instead of rendering
  nothing — sign-out always exists.
- **Verified live** — a `:3100` instance with `CLERK_SECRET_KEY=` (unset) + `ADMIN_USERNAME/PASSWORD`
  env credentials: legacy form renders (no clerk-js), login 200, wrong password 401, token works on
  admin routes, `/auth/me` provider `env`, `/auth/clerk-session` 503; full UI login through the form.
  On the Clerk instance: all 14 portal pages render signed-in, header fallback engages after the
  e2e user's session was invalidated by deletion, Sign out clears the token and returns to the
  login shell. 1025/1025 tests, lint clean.

---

## Clerk component sign-in live end-to-end (browser e2e verified)

The full Clerk flow now works in the portal: `<SignIn />` card → credentials + email-code second
factor → session JWT exchanged for the admin HMAC token → dashboard, verified in a real browser.
What it took:

- **Publishable key reconstructed** — the pk was never pasted, but the Frontend API domain came
  from `GET /v1/domains` (secret key); a pk is just that host base64url-encoded. `fapiFromPublishableKey`
  decodes it back for `ClerkProvider` (explicit `frontendApi` — bare host, no scheme — because
  clerk-js 5.127.2 mangles URL construction otherwise, producing `https://https/…` requests).
- **Clerk development proxy (the clerk-proxy router (removed))** — all Frontend API traffic is forwarded
  same-origin via `/clerk-proxy/*` (Clerk's documented dev-proxy escape hatch): no CORS, no
  third-party-cookie problems, first-party localhost cookies. The FAPI host is discovered from
  `/v1/domains` (cached); request bodies are forwarded **raw bytes** (clerk-js sends
  form-urlencoded — re-serializing through `express.json()` dropped every field), `Origin` is
  forwarded (the environment PATCH requires it), and Set-Cookie rewriting keeps responses intact.
- **Session exchange moved out of React** — `startClerkSessionPoller` in clerk auth module (removed)
  is a module-level watcher on `window.Clerk` (started once from `ClerkAuth`), immune to Clerk
  component crashes/remounts that kept killing the in-tree bridge. `ClerkErrorBoundary` falls back
  to the legacy form by flipping Clerk mode off (never re-mounts Clerk components providerless).
- **Rate-limit scoping fixes (app.js / routes/auth.js)** — the global limiter no longer throttles
  static assets, `/clerk-proxy/*` (pre-auth infra that Clerk polls aggressively), or
  `/auth/clerk-session` (JWKS-verified, not brute-forceable); the brute-force limiter applies only
  to `/auth/login`. A failed exchange retry never clears an already-stored admin token.
- **Test hermeticity** — `clerk-login.test.js` neutralizes the developer's real
  `CLERK_ALLOWED_EMAILS` (`.env` now sets one) and seeds its own legacy credentials;
  `checkCredentials` reads `process.env` at call time (matches `isClerkConfigured`'s test-toggle
  contract) instead of the import-time `env` snapshot.

Config in `.env`: `CLERK_SECRET_KEY` (sk_, drives both the login and session-exchange backends),
optional `CLERK_ALLOWED_EMAILS`. Portal build key lives in `web/.env.local`
(`VITE_CLERK_PUBLISHABLE_KEY=pk_…`). Clerk dashboard: allowlist `http://localhost:3000`,
`http://127.0.0.1:3000` + `*.monkeycode-ai.live` under allowed origins.

---

## Clerk session verification now works with only the secret key; dedicated #login route + shared AuthShell

Two follow-ups to the Clerk component integration:

- **Secret-key JWKS mode (clerk session module (removed))** — the backend no longer needs a publishable
  key or `CLERK_ISSUER` to verify Clerk session JWTs. New `clerkVerifyMode()`: `jwks-url` (issuer
  configured — fetches `{issuer}/.well-known/jwks.json`, strict iss check) as before, plus
  `jwks-api` when only `CLERK_SECRET_KEY` is set — fetches the JWKS from Clerk's Backend API
  (`GET /v1/jwks`, secret-key auth; the old `/v1/environment` + `/v1/application` probes 404 on
  the current API and expose no frontend-api domain). The `/v1/jwks` key set is instance-scoped,
  so a valid RS256 signature still proves the token was minted by THIS Clerk instance; the iss
  claim is only shape-checked in this mode. `/auth/me` → `clerkSessionExchange: true` with just
  the sk_ key. `CLERK_PUBLISHABLE_KEY` remains an optional backend fallback for deriving the
  issuer. New test: secret-key-mode verification accepting an unknown-but-valid issuer.
- **Portal sign-in screens unified (`web/src/components/AuthShell.jsx`)** — brand block + card
  slot extracted so the legacy form and the Clerk card can't drift; `<SignIn />` styling aligned
  to the portal's card language (slate-900/70 panel, slate-800 border, indigo primary). New
  dedicated **`#login`** hash route renders `ClerkSignInScreen` (signing-in state while the
  session exchange runs, card otherwise); other unauth'd routes show the card when Clerk mode is
  on, legacy form otherwise.
- **Live e2e harness (`scripts/clerk-e2e-check.mjs`)** — asserts the exchange is advertised, a
  self-signed RS256 forgery is rejected 401 through the LIVE Clerk JWKS path, garbage is 401, and
  the real JWKS is reachable. Run `node scripts/clerk-e2e-check.mjs` with the server up.

Remaining manual step: paste `pk_…` into `web/.env.local` → `cd web && npm run build` → restart
→ the `<SignIn />` card renders at `#login` and the whole browser flow runs against Clerk's UI.

---

## Portal switched to Clerk components (<ClerkProvider> + <SignIn /> + <UserButton />)

The admin portal now supports **Clerk's prebuilt UI** on top of the earlier backend integration.
When the portal build carries a publishable key (`web/.env.local` → `VITE_CLERK_PUBLISHABLE_KEY`)
**and** the backend advertises the exchange (`/auth/me` → `clerkSessionExchange: true`, derived
from `CLERK_ISSUER` or `CLERK_PUBLISHABLE_KEY`), the login page renders Clerk's `<SignIn />`
(dark-themed via the `appearance` prop) and the header swaps the CSS user menu for `<UserButton />`
(profile + sign-out, Clerk-owned session). Flow: `<ClerkProvider>` wraps the app → the user signs
in with Clerk → the SPA POSTs the session JWT to **`POST /auth/clerk-session`** → the backend
verifies it against Clerk's JWKS (clerk session module (removed): RS256 via node:crypto, iss/exp/nbf,
optional `CLERK_ALLOWED_AZP`, JWKS cache with kid-rotation bust, issuer derived from the
publishable key) → identity via email/username claim → Backend-API user lookup → `sub`, then
mints the **same HMAC admin token** as the legacy login — so `requireAdmin`, `web/src/api.js`,
and the Swagger cookie flow are unchanged. Graceful degradation everywhere: no build key →
legacy username/password form; key but unconfigured backend → console warn + legacy form; legacy
form always reachable. New dep `@clerk/clerk-react` (portal only); web `npm audit` cleaned to 0
via a `nanoid ^3.3.18` override (transitive of vite→postcss). 8 new mocked-JWKS tests
(clerk session-exchange suite — since removed along with the component mode, see the
"Clerk components removed" entry above).
Setup: paste `pk_…` into `web/.env.local`, `sk_…` into `.env` → rebuild `web` → restart.

---

## Clerk integrated as the primary admin login backend

`POST /auth/login` now supports **Clerk** (`CLERK_SECRET_KEY` in `.env`): users are created and
managed in the Clerk dashboard, and the login verifies identifier (email or username) + password
against Clerk's Backend API sign-in flow — create sign-in (`POST /v1/sign_ins`) then attempt first
factor (`POST /v1/sign_ins/:id/attempt_first_factor`, strategy `password`). New module
`auth-clerk.js` (raw fetch, no deps; injectable fetch for tests). Deliberate semantics:

- **Clerk is authoritative when configured** — wrong credentials → 401 (with account-enumeration
  protection: unknown identifier and wrong password return the same message); a Clerk outage →
  503 and **no silent fallback** to env credentials (an outage must not bypass Clerk-side rate
  limits and audit). The legacy `.env` account is a break-glass backend used only when
  `CLERK_SECRET_KEY` is unset.
- Optional **`CLERK_ALLOWED_EMAILS`** allowlist (comma/space separated); empty = all Clerk users.
- `needs_second_factor` from Clerk → 401 with a clear message (portal login is single-factor).
- Successful logins still mint the **same HMAC session token** as before — `requireAdmin`, the
  portal, and the Swagger cookie flow are unchanged; `/auth/me` reports `provider: clerk|env`.
- `AUTH_ENABLED` now means "Clerk OR env credentials configured"; a dynamic `authConfigured()`
  twin exists for tests. Login route uses the dynamic twin so env toggles apply at call time.

Docs updated: `.env.example`, `docs/SETUP-TO-CHAT.md` (env block + troubleshooting rows),
`AGENTS.md` Gotcha 1. 14 new mocked-fetch tests (`routes/__tests__/clerk-login.test.js`) cover
the module and the HTTP contract incl. outage → 503 and authoritative-401 behavior.

---

## WP → Qdrant Cloud → chat e2e verified live; two KB-binding fixes

First full external-provider e2e with **Qdrant Cloud** (user-supplied serverless cluster): real
Qdrant credential on acme-cert (verify probe green) → `vector_index` resource bound via the
**resource** path → WordPress ingestion into the live cluster → `/ask` + Test AI streaming answer
sourced from Qdrant (`🔎 KB-driven retrieval: 'acme-wp-qdrant-kb' → qdrant`, sources 0.85–0.88).
Run stats: ~35k chunks → 18.7k vectors (768d Cosine, status green) from the first ~516 of 901 WP
docs (314 pages + 587 posts on maxicert.com); R2 previews reassemble (42 chunks / 13.2k chars).
Two real bugs the run caught:

1. **`findKbByVectorIndex` only matched `kb.vector_external_id`** — KBs bound through the wizard
   (via `vector_resource_id` → resource `external_resource_id`) never matched, so asks silently
   fell back to another KB or the CF path. New exported `vectorIndexMatchesKb(kb, resource, name)`
   prefers the bound resource's external id, then the legacy KB-row external id.
2. **Query path had no embedding fallback** — a KB without an `embedding_model_id` got a null
   embedding adapter and non-CF retrieval bailed (`Cannot read properties of null`). New exported
   `embedQuestion(embedding, question, companyName)` mirrors the ingest adapters' fallback
   (KB embedding model → company Cloudflare embeddings); text-search providers (OpenAI) unaffected.

Also learned: `PUT /cloudflare/config` accepts `{key, value}` (or grouped `models`) — flat-key
bodies are ignored silently. Standalone ingest jobs die with the server process (unless paused);
the registry makes the next run resume, so restarts only cost an explicit re-trigger.

---

## /ask/suggestions now routes non-CF vector providers (found during live e2e re-run)
- Date: 2026-09-12
- Summary: While re-running the full WP → Pinecone → chat e2e, a `Vector Query Error: 404` appeared in the server log during browser chats. Traced it to `GET /ask/suggestions` (`query/suggestions.js`): `generateStarterQuestions` called `retrieveContext(SEED_QUERY, company)` **without an indexName**, so on companies whose `VECTOR_INDEX` names a non-CF store (Pinecone etc.) the suggestions request fell through to the CF fast-path and errored against Vectorize (which doesn't know the index name). The chat streams themselves were never affected. Fix: pass the company's resolved `VECTOR_INDEX` from config, same as `runPipeline`. Verified with a fresh browser session: full re-ingestion (registry reset → 5 WP docs, 192 chunks, 41-vector batches upserted to Pinecone), then a Test AI question answered from Pinecone with a 0.85-score source and contextual follow-ups, and **zero** Vectorize 404s in the log.
- Reason: any `/ask/suggestions` call on a non-CF-bound company wasted a CF embedding + threw a confusing 404 in the logs; the starter questions also silently fell back to static ones.
- Affected Areas: [[Application Flow]] · [[Knowledge Bases]]
- Implementation notes: diagnostic technique — `KB-driven retrieval` log lines are the marker for successful non-CF routing; a `Vector Query Error: 404 (code 40040)` alongside them means *some* caller is still hitting the CF fallback (the `(code 3000) vectorize.index.not_found` variant from `Vector count error` is the benign KB status-count call).
- Source Files: `query/suggestions.js`
- Testing: `npm test` query-modules 98/98 pass; full suite unaffected (999). eslint clean.
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## OpenAI added as a vector provider (hosted Vector Stores, text-search contract)
- Date: 2026-09-12
- Summary: OpenAI joins Pinecone/Qdrant/Weaviate as a fully configurable non-CF vector provider. Migration `028_openai_vector_store.sql` adds the `vector_search` + `vector_index_resource` capabilities and a `vector_index` resource template whose `config_schema` carries `vector_store_id` (required — OpenAI stores are opaque `vs_…` ids, not admin-named indexes) and `max_num_results` (1–50). New `mysql/adapters/vector/openai.js` implements the same ensureIndex/upsert/query/countVectors contract over raw fetch, with a **text-search contract difference**: OpenAI Vector Stores embed + rerank internally, so `upsert()` uploads chunk text via the Files API and attaches it to the store with chunk metadata as file `attributes` (r2_key/title/url/slug/chunkIndex — the attribute key that lets query results map back to R2 chunks), and `query()` ignores the embedded vector and POSTs the raw question to `/vector_stores/{id}/search` (results return inline content + 0..1 scores, mapped to the standard `{ id, score, metadata }` match shape). Re-ingestion dedupes by deterministic filename (`kb-chunk-<id>.txt`): list → upload → attach → delete-old. `query/kb-retrieval.js` adds `openai` to the non-CF set and skips question embedding for text-search providers (embedding adapter is not even required on the OpenAI path). The existing generic OpenAI verify probe (`GET /v1/models`) already proved keys, so no probe change was needed.
- Reason: ADR-012's non-CF vector-store rollout aimed to cover every provider a KB might bind; OpenAI's Vector Stores are the most common hosted option after Pinecone and followed none of the existing adapters' vector-first contracts, so both a catalog entry and a contract variant (text-search) were required.
- Affected Areas: [[Knowledge Bases]] · [[Application Flow]] · [[ADR Index]]
- Implementation notes: the resource's `vector_store_id` config flows into the adapter through the same resource-config merge added in the e2e round (`ingest/resolve.js`); the KB's `vector_external_id` is accepted as a fallback identity. Live-verified: migration applied, `/gateway/providers/openai` reports the two vector capabilities, the resource template renders with its config_schema, and a dummy `sk-…` credential round-tripped through the verify probe, returning OpenAI's genuine "Incorrect API key provided…" error (test credential deleted after). File attributes are the only metadata channel (16 kv pairs, string values ≤512 chars) — long previews are intentionally clamped.
- Source Files: `migrations/028_openai_vector_store.sql` · `mysql/adapters/vector/openai.js` · `mysql/adapters/vector/factory.js` · `query/kb-retrieval.js` · `mysql/__tests__/openai-vector-adapter.test.js`
- Testing: `npm test` 999/999 pass (11 new adapter tests: id precedence, snake_case creds, text-search body, attribute mapping, missing-id/queryText/key errors, ensureIndex lookup, countVectors); eslint clean; web build clean.
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## Full WP → Pinecone → chat e2e verified live; ask-path now honors company VECTOR_INDEX
- Date: 2026-09-12
- Summary: End-to-end proof of ADR-012 Phase 2 against real infrastructure: WordPress posts ingested into a Pinecone-bound KB and answered through the Test AI page. Fixes required along the way: (1) **ask path ignored the company's `VECTOR_INDEX`** — `runPipeline` only passed `assistant?.vectorIndex` as `indexName`, so `/ask` and `/ask-stream` always queried the CF fast-path unless an assistant persona was selected; now `indexName: assistant?.vectorIndex || getVectorIndex(companyName) || null`, and since both ask variants share `runPipeline` the stream path is fixed by the same change. (2) **KB vector resource `config` never reached the adapter** — `resolveKbAdapters` merged only credential fields, so a Pinecone serverless index's per-index data-plane host (stored in the resource template's `config.host`) was dropped and every upsert failed with "Pinecone host is not configured"; resource config now flows in (credential fields still win on conflicts, `config.dimension` → `dimensions`). (3) **`query/graph.js` used `getGraphConfig` without importing it** (re-export only) — any question reaching the graph step crashed with `ReferenceError`; direct import from `config/graph.js` added. Live chain verified: 5 WP posts → 192 chunks → Pinecone upserts OK (`describe_index_stats` = 192 vectors in the default namespace, chunk JSON in R2 under `kb/<kbKey>/`) → `/ask` JSON answer with Pinecone-sourced source + `r2_key` → **streamed answer in the Test AI page** with SOURCES panel and suggested follow-ups (`KB-driven retrieval: 'acme-wp-pinecone-kb' → pinecone` in the log, no Vectorize 404 after the fix).
- Reason: Phase 2 was code-complete but only exercised by unit tests; this run surfaced three integration bugs invisible to them (ask-path index gate, resource-config drop, graph import) — the exact class of bug the ADR-012 rollout plan called for e2e verification to catch.
- Affected Areas: [[Knowledge Bases]] · [[Application Flow]] · [[Data Flow]] · [[ADR Index]]
- Implementation notes: e2e wiring used the acme-cert tenant (where the real Pinecone credential lives): mirrored Cloudflare + R2 gateway connections onto it via the credentials API (direct DB inserts DON'T reach the running server's RAG config store — writes must go through `updateCompany`/rag-sync inside the server process, learned when a PUT of config re-saved a credential-less view and wiped the hand-seeded keys), created the R2 bucket + Pinecone `vector_index` + `object_bucket` resources, set `VECTOR_INDEX=maxicert-pc-e2e` + `R2_BUCKET_NAME` + WP `BASE_URL` via the config API (PUT takes flat `{key, value}`), and created KB `acme-wp-pinecone-kb` (wordpress source, limit-5 scope, chunkSize 512) bound to those resources. A Pinecone `Vector Query Error: 404 "index was not found"` in the log means the CF fallback ran — i.e. kb-retrieval returned null — check `KB-driven retrieval` log lines to confirm routing.
- Source Files: `query/answer.js` · `query/graph.js` · `ingest/resolve.js` · `ingest/__tests__/resolve.test.js`
- Testing: `npm test` 987/988 pass (1 new: Pinecone adapter accepts resource-template config fields with scheme-less host normalization); eslint clean; web build clean. The earlier "Vector Query Error 404" on the first browser stream was the pre-fix build — gone after restart.
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## ADR-012 Phase 2 shipped + provider audit — /ask retrieves from non-CF vector stores, live Pinecone round-trip verified
- Date: 2026-09-12
- Summary: Phase 2 of ADR-012 is implemented: when the resolved vector index is NOT the company's Cloudflare index, the ask pipeline routes retrieval through the KB's own adapter stack (same resolution as ingestion — `ingest/resolve.js`). New `query/kb-retrieval.js` (`isNonCfVectorProvider`, `retrieveNonCfContext`) resolves the KB by matching `vector_external_id` against the requested index, pulls its vector + embedding adapters and R2 chunks, and maps adapter matches into the pipeline shape (`{ id, score, metadata: { r2_key, title, url, … } }`). `query/retrieval.js` calls it first for non-CF providers and falls back to the CF fast-path on any failure (graceful degradation, never an ask error). Migration `027_qdrant_weaviate_vector_templates.sql` seeds `vector_index` resource templates for Qdrant + Weaviate (dimension/metric/collection-class config) so the KB wizard can bind them. Provider audit produced three fixes: (1) **critical** — the pipeline's `<48hex>-<n>` ids are rejected by Qdrant (needs uint/UUID) and Weaviate (needs UUID); new `mysql/adapters/vector/vector-ids.js` derives deterministic per-provider ids (`uintFromPipelineId` u64 hash, `uuidFromPipelineId` UUIDv5-style) so re-ingestion overwrites the same points/objects; (2) `PineconeAdapter` now normalizes scheme-less control-plane hosts to `https://…` (caught LIVE — `fetch` rejects `"host.svc.pinecone.io/vectors/upsert"` with "Failed to parse URL"); (3) all embedding adapters accept snake_case credential forms. All modals now clamp to the viewport with internal scrolling by default (shared `Modal` in `ui/overlay.jsx`; custom overlays in KbDetail + cloudflare-resources-card updated).
- Reason: A Pinecone/Qdrant/Weaviate-bound KB could ingest but `/ask` only ever searched the company's Vectorize index (ADR-012 deferred this to Phase 2); the audit's id-format bug would have made Qdrant/Weaviate ingestion fail at the first upsert regardless.
- Affected Areas: [[Knowledge Bases]] · [[Application Flow]] · [[Data Flow]] · [[ADR Index]]
- Implementation notes: **live-verified end-to-end against real Pinecone Cloud**: discovered the stored real credential (id 13), created a 768-dim serverless index (`popcert-live-test`) via the control plane, ran the adapter's exact code path — `ensureIndex` → `upsert` (2 chunks, company CF embeddings) → polled `query` until eventually-consistent search returned the semantically correct top match (HACCP chunk, score 0.80, metadata.r2_key intact) — then deleted the test vectors (200) and index (202). The live run caught the scheme-less-host bug the unit tests missed. Shared Modal default flipped so all 30 modal usages get viewport clamping without per-call changes; `maxScreen` prop remains as an explicit opt-in.
- Source Files: `query/kb-retrieval.js` · `query/retrieval.js` · `query/__tests__/kb-retrieval.test.js` · `migrations/027_qdrant_weaviate_vector_templates.sql` · `mysql/adapters/vector/vector-ids.js` · `mysql/adapters/vector/{pinecone,qdrant,weaviate}.js` · `mysql/adapters/embedding/*.js` · `mysql/__tests__/{vector-ids,vector-adapters}.test.js` · `web/src/components/ui/overlay.jsx` · `web/src/pages/KbDetail.jsx` · `web/src/pages/catalog/cloudflare-resources-card.jsx`
- Testing: `npm test` 987/987 pass (5 kb-retrieval gate tests, 6 vector-ids tests, host-normalization adapter tests; 2 upsert-shape tests updated to expect normalized ids); eslint clean; web build clean. Also removed a leftover debug repro test (a `query/__tests__/zz-hang-repro` scratch file) whose unscrubbed MySQL import stalled the full-suite runner.
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## Qdrant + Weaviate made configurable — vector-provider trio complete (auth schemas + probes)
- Date: 2026-09-11
- Summary: Completes the vector-provider configurability started with Pinecone in 025. Migration `026_qdrant_weaviate_auth_schema.sql` seeds the fields the adapters consume: **qdrant** → `host` (required, e.g. `https://xyz.cloud.qdrant.io:6333` or `http://localhost:6333`), `api_key` (optional — required on Qdrant Cloud, absent on unauthenticated local instances; sent as the `api-key` header); **weaviate** → `host` (required, e.g. `https://xyz.weaviate.cloud` or `http://localhost:8080`), `api_key` (optional — required on Weaviate Cloud; sent as a Bearer token). The collection/class name intentionally is NOT a credential field — it comes from the KB's vector resource (`vector_external_id`), matching Pinecone. New hand-written probes: qdrant → `GET {host}/collections`, weaviate → `GET {host}/v1/schema`, both sending credentials only when provided so unauthenticated local instances verify cleanly; missing host fails fast without a network call. Adapters hardened to mirror the Pinecone treatment: accept snake_case *and* camelCase credential shapes, and throw clear "collection/class is not configured" errors before any network I/O when the KB has no bound vector resource.
- Reason: ADR-012 names Pinecone → Qdrant → Weaviate as the non-CF vector-store rollout; after 025 the latter two still rendered empty credential forms, blocking connection creation from the portal.
- Affected Areas: [[Knowledge Bases]] · [[Application Flow]] · [[ADR Index]]
- Implementation notes: live-verified — migration applied (4 rows confirmed), both auth-forms return their fields, dummy-credential verify round-trips hit the (nonexistent) test hosts and returned "Network error: fetch failed" — proving the probes fire with the right URL/headers; test credentials deleted after verification. The generic-probe format-only test in `gateway-credentials.test.js` used weaviate as its no-probe example; switched to a synthetic `vectorlocal` key since weaviate now legitimately has a probe. First 026 run failed on `s.field_placeholder` (column doesn't exist on this DB — 007's SELECT aliases it as a literal); fixed to `NULL AS field_placeholder` before the recorded apply.
- Source Files: `migrations/026_qdrant_weaviate_auth_schema.sql` · `mysql/routes/probes.js` · `mysql/adapters/vector/qdrant.js` · `mysql/adapters/vector/weaviate.js` · `mysql/__tests__/vector-adapters.test.js` · `mysql/__tests__/probes.test.js` · `mysql/__tests__/gateway-credentials.test.js`
- Testing: `npm test` 970/970 pass (4 new adapter tests: snake_case creds + missing collection/class errors for both providers; 5 new probe tests: URL/headers/optional-key, missing-host fail-fast, `getProbe` resolution); eslint clean; web build clean.
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## Pinecone provider made fully configurable (auth schema + credential mapping + verify probe)
- Date: 2026-09-11
- Summary: The `pinecone` provider was present in the catalog (provider row, `vector_search` capability, `vector_index` resource template, complete `PineconeAdapter`) but was not actually configurable: **zero `provider_auth_schemas` rows** meant the credential wizard rendered no fields, `normalizeCredential` didn't map `api_key`→`apiKey` (so even a hand-made connection would upsert with an undefined key), and there was no verify probe. Three fixes: (1) migration `025_pinecone_auth_schema.sql` seeds the four adapter-consumed fields — `api_key` (required, encrypted), `host` (data-plane URL, needed for serverless `pcsk_…` keys whose project segment can't be derived), `environment` (legacy pod env), `namespace` (optional scoping); (2) `ingest/resolve.js` `normalizeCredential` now maps `api_key`→`apiKey` alongside the existing Cloudflare mappings; (3) `mysql/routes/probes.js` gains a hand-written `pinecone` probe — control-plane `GET https://api.pinecone.io/indexes` with `Api-Key` + `X-Pinecone-API-Version: 2025-01`, which proves the key without needing a data-plane host. `PineconeAdapter` hardened: accepts both snake_case and camelCase credential shapes, defaults instead of undefined leaks, sends the required `X-Pinecone-API-Version` header on data-plane calls, throws clear errors on missing host/key instead of `undefined` URLs, and returns `""` from host derivation when the project segment isn't derivable (instead of `-unknown.svc`).
- Reason: ADR-012 names Pinecone as the first non-CF vector store for ask-retrieval, but admins couldn't even create a Pinecone connection from the portal; the wizard's dynamic form is driven entirely by `provider_auth_schemas`.
- Affected Areas: [[Knowledge Bases]] · [[Application Flow]] · [[ADR Index]]
- Implementation notes: legacy host derivation (`https://<index>-<project>.svc.<env>.pinecone.io`) now requires BOTH a legacy-shaped key (`<key>.<project>.<env>`) and an `environment`; serverless users must set the `host` credential from their index page. Probe classified via the shared `classifyStatus`/`parseProviderErrorMessage` helpers (401 → "Invalid API key" from Pinecone's error body). Live-verified: migration applied (4 fields confirmed in DB), `/gateway/providers/pinecone/auth-form` returns all fields, a real POST credential → verify round-trip hit Pinecone's control plane and returned its genuine error for a dummy key; test credential deleted after verification.
- Source Files: `migrations/025_pinecone_auth_schema.sql` · `ingest/resolve.js` · `mysql/routes/probes.js` · `mysql/adapters/vector/pinecone.js` · `mysql/__tests__/vector-adapters.test.js` · `mysql/__tests__/probes.test.js`
- Testing: `npm test` 961/961 pass (5 new adapter tests: snake_case creds, version header, serverless no-host error, missing-key error; 4 new probe tests: headers, 401 parse, missing key, `getProbe` resolution); eslint clean.
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## Setup checkpoints banner — sequential company configuration stepper
- Date: 2026-09-10
- Summary: New horizontal checkpoints banner (`web/src/components/SetupCheckpoints.jsx`) mounted in the Layout content area so it appears at the top of every portal page **only while the selected company's setup is incomplete**. Six checkpoints in fixed sequential order — 1 Workspace → 2 AI Provider → 3 Vector Index → 4 Document Storage → 5 Ingest Content → 6 Test Chat — rendered as a numbered left-to-right stepper; done steps get a green check, the first incomplete step is highlighted as "up next" with its number in a filled badge. Header shows "Finish setting up <company> — N of 6 steps complete — next up: <label>" with a **Continue setup** button that navigates to the next step's page; every step tile is clickable and jumps to its page. Backed by new `GET /cloudflare/setup-status` (`routes/cloudflare/setup-status.js`) which maps real state onto the shared pure model `shared/setup-checkpoints.js`: config credentials/index/bucket flags, gateway KB count (best-effort, MySQL optional) for Ingest Content, and a write-once chat marker (`utils/setup-progress.js`, `processed/chat-<company>.json`, written on the first successful `/ask`/`/ask-stream` answer) for Test Chat. Steps carry detail strings (selected index name, bucket name, KB count).
- Reason: Admins had no at-a-glance, ordered view of what remains to configure a company — the pieces live on four different pages. The stepper enforces the natural dependency order (provider creds before index/storage selection, content before chat).
- Affected Areas: [[Home]] · [[Application Flow]] · [[Knowledge Bases]]
- Implementation notes: the banner polls `/setup-status` every 20s while visible so steps complete live; dismissal is **in-memory only** — a reload brings it back while setup is unfinished (localStorage dismissal was tried and rejected because it permanently hid an incomplete-setup banner). Unknown companies are rejected by the shared company gate (400) before the handler; MySQL-unavailable deployments simply leave the Ingest Content step open (`isMysqlConfigured()` guard skips the KB probe). Route returns `steps` strictly in `SETUP_CHECKPOINT_DEFS` order regardless of flag evaluation order. The chat marker is idempotent, fire-and-forget, and never blocks an ask.
- Source Files: `shared/setup-checkpoints.js` · `shared/__tests__/setup-checkpoints.test.js` · `utils/setup-progress.js` · `routes/cloudflare/setup-status.js` · `routes/__tests__/setup-status.test.js` · `routes/cloudflare.js` · `routes/ask.js` · `web/src/components/SetupCheckpoints.jsx` · `web/src/components/Layout.jsx` · `web/src/api.js`
- Testing: `npm test` 953/953 pass (7 pure model tests + 6 route tests incl. sequential order, config-flag flipping, chat-marker flip, company gate); eslint clean; web build clean; live-verified — popularcert renders "5 of 6 steps complete — next up: Test Chat" with per-step details (index/bucket names, 3 knowledge bases), banner persists across pages, Continue setup lands on Test AI, step tile lands on AI Providers, maxicert (completed via a live ask) shows no banner, dismiss hides until reload.
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## Ingested-document preview + full setup-to-chat guide
- Date: 2026-09-10
- Summary: Two additions. (1) **Ingested-document preview**: the KB detail page's Processed Documents table (WordPress/URL KBs) now has a per-row eye button that reassembles the document from its stored object-storage chunks — new `GET /gateway/kbs/:key/documents/preview/:docKey` lists `kb/<kbKey>/<type>/<slugified key>/chunk-N.json` (trying the `site/` legacy prefix as fallback), fetches each chunk via the company's storage credentials, orders by `chunkIndex`, and joins contents (60k-char / 200-chunk preview cap, truncation flagged). New pure helpers in `ingest/preview.js` (`documentChunkPrefix` reproduces the pipeline's exact r2-key layout incl. the type segment; `assembleDocumentPreview` sorts/joins/caps); `services/r2.js` gained a paginated `listObjectKeys`. The modal renders markdown, chunk count, storage prefix, and an "Open source page" link. (2) **`docs/SETUP-TO-CHAT.md`**: complete click-by-click walkthrough from fresh clone through MySQL/Cloudflare setup, company/provider/credentials, KB creation, ingestion (incl. pause/resume/stop), and chatting in Test AI — linked from the README.
- Reason: File-based KBs already had previews (source files), but ingested WordPress/URL documents were opaque rows — admins couldn't see what the AI actually retrieved from. No single end-to-end setup doc existed.
- Affected Areas: [[Knowledge Bases]] · [[Document Processing & Chunking]] · [[Data Flow]]
- Implementation notes: the preview mirrors ingest's storage resolution (KB `storage_external_id` → config fallback) so it reads the same bucket the chunks were written to; registry membership is checked before listing (probing defense); the route is best-effort 404 (not 500) when chunks are absent/undeletable. Key layout discovery: chunk keys are `<prefix>/<type>/<slugify(type-slug)>/chunk-N.json` — the type segment is easy to miss when reconstructing keys.
- Source Files: `ingest/preview.js` · `ingest/__tests__/preview.test.js` · `services/r2.js` · `mysql/routes/kbs.js` · `web/src/api.js` · `web/src/pages/KbDetail.jsx` · `docs/SETUP-TO-CHAT.md` · `README.md`
- Testing: `npm test` 940/940 pass (8 new pure preview tests); eslint clean; web build clean; live-verified on max-test-kb — endpoint returned a 41-chunk/13k-char assembled document, UI modal rendered it with the storage prefix.
- Documentation Updated: this page.
- Related Decisions: [[ADR - Provider-agnostic adapter layer]]

---

## Ask-path audit: updateConfig arg-order fix + tenant URL defaults + missing model grant
- Date: 2026-09-10
- Summary: End-to-end chat audit surfaced three issues, all fixed. (1) **Persona-selected asks crashed**: `routes/ask.js` (×4) and `routes/public-assistants.js` (×4) called `updateConfig(companyName, patch)` — the write layer's signature is `updateConfig(patch, companyName)` — so the patch object hit `companyName?.trim()` and every ask carrying an `assistantKey` failed with "companyName?.trim is not a function". Call sites corrected; regression test added that exercises the override → ask → restore cycle through the router. (2) **Cross-tenant URLs in canned answers**: maxicert's config carried the Popularcert defaults for `CONTACT_US_URL`/`SERVICES_URL`/`LOCATIONS_URL`, so contact fallbacks linked to popularcert.com; corrected per-company via the config API. (3) **Missing model-access grant**: maxicert's assistant "sarah" is bound to NVIDIA credential 12 + model 338, but no `credential_model_access` row existed, so `checkModelAccess` denied every ask with "No access grant found"; the grant was created via `POST /gateway/credentials/:id/models`.
- Reason: The updateConfig regression came from the config-facade refactor (callers not swept); the URL defaults are inherited `DEFAULT_COMPANY` values that new tenants never overwrite; the grant gap is operator setup the UI does not force at assistant-bind time.
- Affected Areas: [[Ask Pipeline]] · [[Knowledge Bases]] · [[Integration Architecture]] · [[Technical Debt]]
- Implementation notes: also observed — `PUT /cloudflare/config` silently ignores unknown body shapes (`{config:{...}}` is accepted but only `baseUrl`/`models`/`key+value` are read; consider 400ing unknown keys); the PUT response currently echoes the company's plaintext `API_KEY` (the GET redacts it — should match); `intent.js` CONTACT_PATTERNS routes ANY question containing "cost/price/how much" to the canned contact response, so KB cost articles are never retrieved for those phrasings. Non-runnable assistant models (e.g. NVIDIA keys) gracefully fall back to the company's `@cf/` LLM while still being gated by their own credential's grants.
- Source Files: `routes/ask.js` · `routes/public-assistants.js` · `routes/__tests__/ask-routes.test.js`
- Testing: `npm test` 932/932 pass; eslint clean; live re-verified — JSON + SSE ask, cached answers, history rewriting, fast-paths, validation errors, 20/min AI limiter (20×200 then 429), browser chat (streaming, sources, suggested questions, Stop, Reset, persona switch).
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## KB detail page: live progress + paused snapshot controls
- Date: 2026-09-10
- Summary: The KB detail page's Ingestion tab now mirrors the KB cards: a progress card renders the live run (phase + graph sub-phase, n/total, chunk count) with Pause/Stop buttons, and — when a run is paused — the persisted `suspended_jobs` progress snapshot ("Ingestion paused · paused Xm ago · snapshot from the pause point") with a Resume button. `Run Ingest` is disabled with a "Paused — Resume to continue" label while a run is suspended. Edge fix in the lifecycle: `startJob` replacing a suspended entry now drops its persisted row (previously a fresh start over a paused job left the row behind, which would resurrect a stale pause after a restart).
- Reason: The paused-snapshot persistence landed on the KB cards only; the detail page showed nothing during runs and no pause context after a restart.
- Affected Areas: [[Knowledge Bases]] · [[Integration Architecture]]
- Implementation notes: shares the same `/gateway/kbs/:key/ingest-progress` payload (`running:false, paused:true, progress:<snapshot>, pausedAt`); 2s `usePoll` runs while live, paused, or for one cycle after completion so the box resolves to refreshed status; `IngestProgressBox` renders both states (indigo live / amber paused).
- Source Files: `web/src/pages/KbDetail.jsx` · `cron/lifecycle.js` · `cron/__tests__/cron-modules.test.js`
- Testing: `npm test` 931/931 pass; eslint clean; web build clean; live verified on max-test-kb — pause → snapshot card on detail page → Resume from detail page → live run → UI Stop → jobs empty, KB `active`.
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## Wiki bootstrapped
- **Date:** 2026-08-27
- **Summary:** Full Obsidian vault created from source-reverse-engineering pass across all backend/frontend/data layers; validated against running test suite (663 passing).
- **Affected areas:** entire vault ([[Documentation Map]])
- **Source basis:** commit d4eb11f workspace state.
- **Documentation updated:** creation of every page linked from [[Home]].

---

## Grilling session: multi-provider ask-retrieval decided (ADR-012)
- Date: 2026-08-27
- Summary: Stress-tested the retrieval asymmetry fork end-to-end; ledger locked — phased build beside CF fast-path, FULL parity incl. read-side vector stores, vendor-payload content doctrine (CF mirror transitional), fat dual-mode adapters, Pinecone-first rollout, implicit selection axis, graceful KB-unavailable degradation, binding-fingerprint cache fix in Phase 1. ADR recorded in-repo.
- Reason: eliminate silent embedding-space corruption + make gateway's multi-provider promise real.
- Affected Areas: [[Knowledge Bases]] · [[Data Flow]] · [[Ask Pipeline]] · [[Technical Debt]] (cache-key finding) · [[MySQL Gateway Schema]]
- Implementation notes: user overrode two recommendations deliberately (full parity over embeddings-only; vendor-payload over R2-mirror-canonical) — recorded as genuine trade-offs in ADR alternatives. Fact-finder pass also surfaced migrations 007–017 existence; schema page reconciled.
- Source Files: `docs/adr/adr-012-multi-provider-ask-retrieval.md` · `CONTEXT.md` glossary terms · `wiki/cloudflare wiki/{04 - Features/Knowledge Bases.md, 05 - Data/MySQL Gateway Schema.md, 09 - Reference/Glossary.md, 08 - Decisions/ADR Index.md}`
- Testing: n/a (design session); wiki link validator run post-edit.
- Documentation Updated: all listed above.
- Related Decisions: [[ADR Index]] · docs/adr/adr-012

---

## Vault created + synchronized to current tree
- Date: 2026-08-27
- Summary: Full Obsidian knowledge base authored (10 sections, 44 notes) inside `wiki/cloudflare wiki/`; validator added (`scripts/validate-wiki.mjs`); AGENTS.md discovery pointer installed.
- Reason: establish persistent AI/dev context layer per project Golden Rule.
- Affected Areas: [[Home]] · [[Documentation Map]] · all linked pages · [[ADR Index]]
- Implementation notes: post-authoring sweep caught mid-session repo cleanups (vectorize.old removal, runtime-config.json absence, Radix→in-house Popover migration) and corrected affected pages ([[Technical Debt]] TD-6, [[Multi-Tenancy & Company Config]], [[Frontend Overview]], [[Component Architecture]], [[UI Patterns]], [[Frontend Dependencies]]).
- Source Files: `wiki/**`, `scripts/validate-wiki.mjs`, `AGENTS.md`
- Testing: 663 tests passing pre-existing; link/path validation executed post-move.
- Documentation Updated: vault itself.
- Related Decisions: [[ADR Index]] snapshot records decision set at commit d4eb11f lineage.

---

## Neo4j driver pooling + capped/parallel graph extraction
- Date: 2026-09-09
- Summary: Knowledge-layer Neo4j drivers are now pooled per (uri, user, database) with `verifyConnectivity()` fail-fast, refcounted sessions, and a 60 s idle close; ingestion-time graph extraction capped at 10 chunks/doc with parallel (4-way) LLM proposal extraction followed by sequential WRITE-session commits.
- Reason: fresh-driver-per-call intermittently exhausted Neo4j Aura's connection cap ("No routing servers available"); per-chunk sequential LLM calls made GraphRAG ingestions take 15–21 min per document.
- Affected Areas: [[GraphRAG]] · [[Knowledge Bases]] · [[External Services]]
- Implementation notes: shared pool lives in `knowledge/neo4j.js` (`openKnowledgeSession`/`withKnowledgeSession` unchanged signatures — all knowledge services benefit); `_setDriverFactoryForTests` seam mirrors `mysql/pool.js` convention; extraction phases split so LLM latency parallelizes while Neo4j writes stay ordered.
- Source Files: `knowledge/neo4j.js` · `ingest/graph-extract.js` · `knowledge/__tests__/neo4j.test.js` · `ingest/__tests__/graph-extract.test.js`
- Testing: `npm test` 908/908 pass; eslint clean.
- Documentation Updated: [[GraphRAG]] · this page.
- Related Decisions: [[ADR Index]]

---

## Per-KB graph tuning + graph progress sub-phase + job pause/resume
- Date: 2026-09-09
- Summary: Three ingestion controls shipped. (1) `graph_extract_max_chunks` / `graph_extract_concurrency` per-KB columns (migration 023) override the global 10-chunk / 4-way graph extraction defaults, editable in the KB modal and validated 1–50 / 1–10. (2) The ingest pipeline reports a graph sub-phase (`extracting n/m chunks · c parallel` → `committing`) through `reportProgress(phase, sub)`, surfaced by `/gateway/kbs/:key/ingest-progress` and rendered on the KB card. (3) True pause/resume: `pauseJob` marks a job `suspended` and aborts cooperatively (entry stays resumable), `resumeJob` consumes it and starts a fresh run that skips checkpointed documents via the ingestion registry; new `POST /cloudflare/job/pause|resume` routes; `/job/stop` and `/job/pause` flip the KB row out of `indexing` best-effort so cards never show a stale Indexing badge after abort.
- Reason: GraphRAG ingestions were opaque 20-min-per-doc stalls; long runs had no mid-run control short of losing in-flight work.
- Affected Areas: [[GraphRAG]] · [[Knowledge Bases]] · [[Document Processing & Chunking]] · [[Integration Architecture]]
- Implementation notes: suspended jobs are reported by `getRunningJobs` with `status:"suspended"` + `pausedAt`; `findRunningIngestJob` matches only `running`, new `findPausedIngestJob` matches `suspended`; `/kbs/:key/status` now returns `paused`/`pausedAt`; `kbLifecycle` gained a `PausedRun` state between Indexing and Error; KB card shows Pause/Stop in the live progress box and a Resume button in an amber paused box. `shared/__tests__` added to the npm test globs.
- Source Files: `migrations/023_kb_graph_extract_settings.sql` · `mysql/repositories/kb.js` · `mysql/services/kb-service.js` · `ingest/graph-extract.js` · `ingest/pipeline.js` · `ingest.js` · `cron/lifecycle.js` · `cron/index.js` · `routes/cron.js` · `mysql/routes/kbs.js` · `mysql/routes/shared-helpers.js` · `web/src/api.js` · `web/src/pages/IngestionList.jsx` · `web/src/components/kb-modal.jsx` · `shared/status.js` · `docs/openapi.js`
- Testing: `npm test` 927/927 pass; eslint clean; web build clean; live pause/resume/stop verified on max-test-kb via API + portal card.
- Documentation Updated: [[GraphRAG]] · this page.
- Related Decisions: [[ADR Index]]

---

## Paused jobs survive restarts (suspended_jobs persistence)
- Date: 2026-09-09
- Summary: Pausing a standalone job now persists a `suspended_jobs` row (migration 024: job id, company, kb, timestamps, last progress; unique per job key). On boot `restoreSuspendedJobs()` re-registers every row as a suspended in-memory job so `/jobs/running`, the KB card's paused state, and `POST /cloudflare/job/resume` all work across a restart. Resume/stop delete the row; stopping a paused job is now allowed (guardStop accepts `suspended` too) and drops the row so paused jobs never resurrect.
- Reason: an in-memory-only suspended state vanished on restart, losing the pause/resume workflow for long ingestions.
- Affected Areas: [[Knowledge Bases]] · [[Integration Architecture]] · [[GraphRAG]]
- Implementation notes: `SuspendedJobRepository` (upsert/remove/listAll) is fire-and-forget — MySQL being down degrades to the old in-memory behavior; boot restore runs after auto-migration in `app.js` only when `CONFIG_STORE=mysql`. Unit tests stub the repository (same try/finally pattern as kb-service) so the cron suite never touches MySQL.
- Source Files: `migrations/024_suspended_jobs.sql` · `mysql/repositories/suspended-job.js` · `cron/lifecycle.js` · `cron/index.js` · `app.js` · `cron/__tests__/cron-modules.test.js`
- Testing: `npm test` 930/930 pass; live cycle verified — pause → restart → `⏸ Restored 1 paused job(s)` → resume → row consumed.
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## Assistant persona wins over intent fast-paths; assistant model dropdown scoped to configured chat providers
- Date: 2026-09-17
- Summary: Two ask/assistant fixes. (1) `checkFastPath` ran **before** `resolveAssistantOverrides` in both ask paths, so identity/greeting/vague questions always returned the company's canned persona ("Sarah") even when a gateway assistant (e.g. "Muse") was selected — overrides are now resolved first and the assistant's name flows into `checkFastPath`. (2) The Assistants form's Credential dropdown now lists only **chat-capable** providers the company actually has credentials for (providers with zero chat models in the catalog are hidden with an explanatory note), and the Model dropdown lists only that provider's chat models — embeddings and un-configured providers can no longer be selected. Test-AI verification surfaced a third gap: assistant models need a `credential_model_access` grant to execute — grants are created via the provider detail's per-credential model list (POST `/gateway/credentials/:id/models`).
- Reason: a selected assistant silently lost its persona on common opener questions ("what's your name"); the assistant form advertised models/providers that could never execute a chat.
- Affected Areas: [[Ask Pipeline]] · [[Assistant Personas]] · [[AI Gateway Platform]]
- Implementation notes: `runPipeline`/`askQuestionStream` call `resolveAssistantOverrides` before the fast-path check; `Assistants.jsx` probes each configured provider's models once per modal open and filters credentials to providers with ≥1 chat model; non-string `username` tokens are normalized in `AuthProvider` and rejected by `verifyToken` (fixes a portal blank-screen when a token carried an object payload).
- Source Files: `query/answer.js` · `query/intent.js` · `web/src/pages/Assistants.jsx` · `web/src/auth.jsx` · `web/src/components/Layout.jsx` · `auth.js`
- Testing: `npm test` 1037/1037 pass; eslint clean; live Test-AI pass with Muse — name question answers "I'm Muse", three Java-textbook questions answered with 0.81+ sources and follow-ups.
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## KB status: adapter-based vector count + honest last-run chunk label
- Date: 2026-09-17
- Summary: The KB detail page's Ingestion panel showed "Vectors in index —" and "Chunks created 0" for the Qdrant-bound `java-textbook` KB despite 1,260 vectors being present. Two display bugs: (1) `GET /gateway/kbs/:key/status` counted vectors **only** through the Cloudflare Vectorize fast-path (`countVectors` → CF SDK), which always fails for KBs bound to a non-CF vector resource — the route now resolves the KB's adapter stack first (`resolveKbAdapters` → adapter `countVectors()`, already implemented on every adapter) and falls back to the CF count for legacy KBs; (2) "Chunks created" showed the **last run's** counter, which is 0 whenever the registry skips unchanged documents — the label now reads "Chunks created (last run)" with an info tip ("N doc(s) skipped — unchanged since the previous run") whenever `documentsSkipped > 0`.
- Reason: the status endpoint predates ADR-012 Phase 2 (non-CF vector stores) and never learned the adapter path; the chunk label read as cumulative when it was per-run.
- Affected Areas: [[Knowledge Bases]] · [[AI Gateway Platform]]
- Implementation notes: adapter resolution is wrapped in try/catch (null on any failure, best-effort like the CF path); the added `resolveKbAdapters` import into `mysql/routes/kbs.js` introduces no circular import (resolve.js pulls repositories only). Also removed an unused `checkpointForStep` import flagged by eslint (leftover from the onboarding deep-link refactor).
- Source Files: `mysql/routes/kbs.js` · `web/src/pages/KbDetail.jsx` · `web/src/components/OnboardingWizard.jsx`
- Testing: `npm test` 1037/1037 pass; eslint clean; web build clean; live verified — `/gateway/kbs/java-textbook/status` returns `vectorCount: 1260` via the Qdrant adapter and the portal panel shows 1,260.
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## Blank Test-AI answers: model-access gate scoped to the executed model + non-streamed answers delivered as a token
- Date: 2026-09-17
- Summary: Every ask on the `java-textbook` KB returned a **blank assistant bubble** with suggestions about "credential/model pairs". Two independent bugs stacked: (1) the pre-LLM `checkModelAccess` gate ran for *any* selected assistant, even when the assistant's catalog model is not runtime-callable (assistant `muse` → `poolside/laguna-s-2.1:free`), so the pipeline denied an ask whose model it was never going to call (`Model access denied: No access grant found for this credential/model pair.`) while the real answer would have come from the company's `@cf/` LLM; (2) `askQuestionStream` only forwarded tokens produced by `llmCall`, so every runPipeline path that returns text without an LLM call (model-access denial, cache hit, custom Q&A, `noContext`) sent **zero** token frames — the portal sets "streaming" on the first token, so it rendered an empty message next to the arriving metadata/suggestion frames. Follow-up suggestions are now also generated from the answer's own topic instead of a hardcoded certification prompt + `code|programming|class|function…` regex, which had been filtering out the on-KB questions (e.g. "How does the `extends` keyword work in Java?").
- Reason: the gate assumed every assistant model is executable (only `@cf/`/`@cloudflare/` keys are), and the SSE contract had no fallback for text that never streamed; the certification-vertical suggestion prompt/regex predates multi-vertical KBs (ADR-012).
- Affected Areas: [[Ask Pipeline]] · [[Answer Streaming]] · [[Knowledge Bases]] · [[Assistant Personas]]
- Implementation notes: gate condition is now `assistant?.assistantKey && isRunnableModel(assistant.model)`; denial results carry `denied: true` and both ask paths skip suggestion generation for them; `askQuestionStream` tracks a `streamed` flag (set in the `onToken` callback *and* the CF SSE parser callback) and emits `transport.sendToken(result.answer)` once when nothing streamed — the answer therefore reaches the client on cache hits too. `generatePossibleQuestions` drops the hardcoded vertical (tenant `BLOCKED_TOPICS` still filters); the vestigial `firstTokenReceived` flag was removed.
- Source Files: `query/answer.js` · `query/llm.js` · `query/__tests__/stream-answer.test.js` · `query/__tests__/pipeline.test.js` · `query/__tests__/assistant-access.test.js`
- Testing: `npm test` full suite pass; `npm run lint` clean; live verify via curl `/ask-stream` (acme-cert + `x-api-key`) → Java KB tokens + `{"__start":true,"sources":[{"title":"1789626228200 Java","score":0.889,...}]}` + Java follow-ups; repeated question (cache hit) now emits exactly 1 token frame instead of 0; `/ask/suggestions` returns servlet/CGI starter chips from the PDF; browser check of the portal Test AI page (acme-cert, agent-browser) shows a rendered answer, `SOURCES 0.79 1789626228200 Java`, and on-BK follow-ups on two consecutive turns.
- Documentation Updated: [[Ask Pipeline]] · [[Answer Streaming]] · this page.
- Related Decisions: [[ADR Index]]

---

## Chat integration API doc + corrected SSE frame order
- Date: 2026-10-05
- Summary: Added `docs/api/chat-integration.md` — a single, verified guide for embedding the RAG chat (endpoint choice, auth, JSON + SSE contracts, a runnable client, rendering-safety rules, error table). While writing it the wire protocol was captured from the running server, which exposed a **documentation error**: the `__start` metadata frame is sent *after* the answer tokens (`query/answer.js` calls `transport.sendStart(...)` only once the pipeline finishes), but `docs/api/streaming.md`, `docs/AI_API_REFERENCE.md`, and the `/ask-stream` description in `docs/openapi.js` all claimed it arrives "before the first token". The `openapi.js` note additionally claimed the `__START_RESPONSE__` sentinel "is no longer emitted" — a live capture of the fast path shows it still is. Both claims are now corrected in all three files.
- Reason: an integrator following the old docs would use `__start` to clear a loading placeholder (it arrives too late) and would render the legacy sentinel as visible answer text on the greeting fast path. Verified against the server rather than trusted from the spec.
- Affected Areas: [[Answer Streaming]] · [[Ask Pipeline]] · [[API Reference]]
- Implementation notes: docs-only. New `docs/api/chat-integration.md` documents `/ask`, `/ask-stream`, and the four `/gateway/public/assistants` routes; its `streamAnswer()` client buffers on `\n\n` frame boundaries (partial-chunk safe), filters `__START_RESPONSE__`, handles the legacy standalone `{sources}` frame, and throws on non-2xx. It takes a `baseUrl` param because a relative `/ask-stream` URL throws `ERR_INVALID_URL` under Node fetch — found by executing the sample, not by reading it. The two open `assistantKey` findings from the 2026-10-05 security review are documented in the guide's Security notes with a recommendation to pin the assistant instead.
- Source Files: `docs/api/chat-integration.md` (new) · `docs/api/streaming.md` · `docs/AI_API_REFERENCE.md` · `docs/openapi.js`
- Testing: the doc's client was extracted from the markdown and executed against the live server — RAG path returned 1 token + `__start` + 3 `possibleQuestions` + `[DONE]` with no sentinel leakage; the fast path returned `token, DONE` (sentinel filtered); all four error paths surfaced real messages (401 wrong key, 400 unknown company, 400 empty question, 400 non-array history). `npm run lint` 0 errors (2 pre-existing `Webhooks.jsx`/`Workflows.jsx` warnings). `npm test` 1384/1384 on 9 of 11 full-suite runs; `ingest/__tests__/ingest-scope.test.js` flaked once under load (0/8 failures in isolation, and 4 clean full runs with the doc changes stashed — pre-existing load sensitivity, unrelated to these docs).
- Documentation Updated: this page.
- Related Decisions: [[ADR Index]]

---

## Fixed: rate-limit bypass via X-Forwarded-For + persistent assistantKey injection
- Date: 2026-10-05
- Summary: Closed both HIGH findings from the security review, each confirmed by a live exploit first and a live non-exploit after. (1) **Rate limits were fully bypassable.** `app.js` parsed `TRUST_PROXY` into `trustProxy` and set it once, then a duplicate `app.set("trust proxy", true)` further down clobbered it — and `parseTrustProxy` treated *unset* as `true` too, so the safe configuration was unreachable. With `trust proxy = true`, `req.ip` comes straight from the client-supplied `X-Forwarded-For`, making every limiter key attacker-chosen. (2) **`assistantKey` on the ask routes wrote to tenant config.** `routes/ask.js` and `routes/public-assistants.js` wrapped each ask in `updateConfig({ASSISTANT_KEY}, company)` — a persist-first DB write on a route that is unauthenticated for any company without an ask API key. Its restore (`prevKey ? {...} : {}`) was a no-op, so an injected key **persisted** after the request, and concurrent requests raced over the process-wide singleton.
- Reason: an attacker could rotate a header to bypass the 10/min login brute-force guard and the 20/min AI spend cap indefinitely, and could durably pin any tenant's assistant persona with a single unauthenticated request.
- Affected Areas: [[Ask Pipeline]] · [[Authentication Flow]] · [[Middleware]] · [[Security Model]] · [[Assistant Personas]]
- Implementation notes: trust proxy is now set exactly once and **defaults to `false`** — an unset `TRUST_PROXY` no longer means "trust everything", and the loud warning fires on any explicit `true`. The cost is that behind a proxy all clients share the proxy IP as their limiter key, which is why we warn rather than choose silently; `.env.example` documents it. `assistantKey` is now **request-scoped**: `resolveAssistantOverrides(company, {assistantKey})` accepts an override that beats the stored default for that call only, and `runPipeline` / `askQuestion` / `askQuestionStream` thread it through as an argument. All four config-mutating call sites are gone.
- Source Files: `app.js` · `routes/ask.js` · `routes/public-assistants.js` · `query/assistant.js` · `query/answer.js` · `.env.example` · `routes/__tests__/trust-proxy.test.js` (new) · `routes/__tests__/ask-routes.test.js`
- Testing: **live before/after on the running server.** Login limiter with rotating `X-Forwarded-For`: 30×401 and 0×429 before → 10×401 + 20×429 after. `POST /ask` with `assistantKey: "attacker-injected"` on a key-less company left `ASSISTANT_KEY` unset before the fix; a direct MySQL read afterwards shows 0 rows matching `%attacker%`/`%injected%` and all 6 tenants at their original values. 5 new route tests plus 2 trust-proxy tests; each was verified to **fail when the old behaviour is reintroduced** and pass with the fix. `npm run lint` 0 errors (2 pre-existing warnings). `npm test` 1390/1390.
- Known limitation (not fixed): the intermittent `Unable to deserialize cloned data` test failure is **upstream Node** — nodejs/node#64061, a bug in the test runner's IPC layer, not in this repo. It is random across files (hit `ingest-scope`, then `routes/setup-status`) and only reproduces under CPU load. Measured mitigation: `--test-concurrency=2` gives 0 failures unloaded but still flakes under load; `--test-concurrency=1` is clean under load but costs 2.1× runtime (107s vs 50s). `npm test` was left at the default rather than silently imposing that cost — use `--test-concurrency=1` when a green run matters more than speed.
- Documentation Updated: [[Ask Pipeline]] · this page.
- Related Decisions: [[ADR Index]]

---

## Refreshed docs/AI_API_REFERENCE.md + fixed TRUST_PROXY silently ignored via env.js
- Date: 2026-10-05
- Summary: Brought the machine-readable reference back in line with the code. It still documented `ADMIN_API_KEY` / `x-api-key: YOUR_ADMIN_API_KEY` for admin auth in **25 places** — a mechanism removed long ago and enforced nowhere — and its Environment Variables table listed per-company Cloudflare/R2/model/URL settings as env vars, which stopped being true when company config moved into the MySQL config store. While documenting the trust-proxy fix I also found that **`env.js` never exported `TRUST_PROXY`**, so `app.js`'s `env.TRUST_PROXY` was always `undefined`: the secure default held by accident rather than by configuration, and an operator setting the variable would have seen no effect at all.
- Reason: an integrator following the reference would send a header the server ignores and believe their routes were protected, or try to configure tenants through `.env` and find the values ignored. The `env.js` gap was a live footgun in the fix shipped earlier the same day.
- Affected Areas: [[API Reference]] · [[Ask Pipeline]] · [[Middleware]] · [[Security Model]] · [[Authentication Flow]]
- Implementation notes: `env.js` now exports `TRUST_PROXY` (the object is frozen and built from an explicit field list, so the omission was silent). In the reference — Authentication rewritten around `POST /auth/login` + `x-auth-token`/`Authorization: Bearer`, with the Clerk vs env-credential backends and the "auth disabled" default documented; a new **Limiter keying and `TRUST_PROXY`** section explaining how limiter keys are derived and why `true` is unsafe; 22 stale example headers corrected; the Environment Variables table replaced with the real env surface (MySQL, admin login, `APP_ENCRYPTION_KEY`, `TRUST_PROXY`, operational knobs) and an explicit note that company/AI config lives in the config store; CORS headers/methods corrected and the dynamic `<company>.com` rule documented; `assistantKey` added to both ask parameter tables as request-scoped; and a new **Public Assistant Routes** section covering the four `/gateway/public/assistants` endpoints that were absent entirely. Two pre-existing markdown table bugs were also repaired (a merged separator row and a row glued to `**Response:**`).
- Source Files: `env.js` · `docs/AI_API_REFERENCE.md` · `routes/__tests__/trust-proxy.test.js`
- Testing: every factual claim in the rewritten sections was checked against the running server — public list returns exactly the documented shape; 404 for a non-public/unknown assistant; 400 with no company header; public `/ask` returns exactly `{success, answer, sources, cached}` with `sources[0] = {title, score}`; `x-auth-token` → 200 while `x-api-key` → 401; CORS preflight from `https://maxicert.com` echoes `Content-Type,X-WP-Nonce,X-Company-Name,X-Api-Key,Authorization,X-Auth-Token`; login limiter with rotating `X-Forwarded-For` still 429s past 10. New regression test asserts `env.js` exports `TRUST_PROXY` (it fails without the export). `npm run lint` 0 errors; `npm test` 1391/1391 on 3 consecutive runs; wiki validator clean.
- Related Decisions: [[ADR Index]]

---

## Template (copy below for future significant changes)

```markdown
## <Short description>
- Date: YYYY-MM-DD
- Summary:
- Reason:
- Affected Areas: [[Feature]] · [[Architecture page]]
- Implementation notes:
- Source Files: `path/…`
- Testing: commands + result counts
- Documentation Updated: [[pages]]
- Related Decisions: [[ADR - …]]
```

Keep ADR changes separately when rationale-level decisions occur ([[ADR Index]] conventions).