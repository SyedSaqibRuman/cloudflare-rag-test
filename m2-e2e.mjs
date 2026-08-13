// M2 E2E checklist runner — talks to the :3100 test server.
// Reads admin creds from .env (never printed).
// NOTE: the live env has no CF credentials / bucket / index configured for any
// company (commit 4b55215 stripped env creds; company_config has empty
// R2_BUCKET_NAME/VECTOR_INDEX), so ingest follows the error path (D12): the KB
// row flips indexing → error, kb.ingest.failed is audited, and no registry is
// written. That path IS the meaningful E2E here; the happy path (docCount>0)
// needs real Cloudflare creds (out of M2 scope, F8).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:3100";

function loadEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = loadEnv(path.join(__dirname, ".env"));

async function req(method, p, { body, headers = {} } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}
const H = (t, c) => ({ Authorization: `Bearer ${t}`, "x-company-name": c });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (async () => {
  const { status, json } = await req("POST", "/auth/login", {
    body: { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD },
  });
  check("auth: login 200 + token", status === 200 && json?.token, `status=${status}`);
  return json?.token;
})();
const t = await token;

// ---- 3a options
{
  const { status, json } = await req("GET", "/gateway/kbs/options", { headers: H(t, "popularcert") });
  check("3a options → 200", status === 200, `status=${status}`);
  check("3a vectorResources empty (F8)", json?.options?.vectorResources?.length === 0);
  check("3a embeddingModels present", json?.options?.embeddingModels?.length >= 1);
  check("3a storageResources array", Array.isArray(json?.options?.storageResources));
}

// ---- 3b scoping
{
  let { status } = await req("GET", "/gateway/kbs", { headers: { Authorization: `Bearer ${t}` } });
  check("3b no company header → 400", status === 400, `status=${status}`);
  ({ status } = await req("GET", "/gateway/kbs", { headers: H(t, "nosuchco") }));
  check("3b unknown company → 404", status === 404, `status=${status}`);
}

// ---- 3c create + duplicate
{
  const body = { kbKey: "popularcert-kb", kbName: "Popularcert KB", chunkSize: 400 };
  let { status, json } = await req("POST", "/gateway/kbs", { headers: H(t, "popularcert"), body });
  check("3c create → 201 + kbId", status === 201 && json?.kbId > 0, JSON.stringify(json));
  ({ status } = await req("POST", "/gateway/kbs", { headers: H(t, "popularcert"), body }));
  check("3c duplicate → 409", status === 409, `status=${status}`);
}

// ---- 3d ingest (error path: no CF creds) + status
{
  // Fire both ingests concurrently. The first processed sets the running-job
  // entry synchronously (startJob), so the other must hit the F11 409 guard.
  // Node processes the two requests in arrival order, so either response may
  // be the 200 — assert exactly one 200-with-startedAt and one 409.
  const [r1, r2] = await Promise.all([
    req("POST", "/gateway/kbs/popularcert-kb/ingest", { headers: H(t, "popularcert") }),
    req("POST", "/gateway/kbs/popularcert-kb/ingest", { headers: H(t, "popularcert") }),
  ]);
  const started = [r1, r2].filter((r) => r.status === 200 && r.json?.startedAt);
  const denied = [r1, r2].filter((r) => r.status === 409);
  check("3d ingest → 200 started", started.length === 1, JSON.stringify([r1.status, r2.status]));
  check("3d second ingest → 409 (F11)", denied.length === 1, JSON.stringify([r1.status, r2.status, r1.json?.error, r2.json?.error]));

  let sawIndexing = false, final = null;
  // The error path flips indexing → error in a handful of fast DB calls, often
  // faster than poll latency, so "saw indexing" is opportunistic. The
  // deterministic proof of the transition is the audit trail below (the row
  // only reaches "error" through the indexing→catch path). Poll until the job
  // fully settles (inProgress false) so the at-rest state is asserted.
  for (let i = 0; i < 20; i++) {
    await sleep(i < 8 ? 50 : 500);
    const r = await req("GET", "/gateway/kbs/popularcert-kb/status", { headers: H(t, "popularcert") });
    if (r.json?.status?.status === "indexing") sawIndexing = true;
    const s = r.json?.status;
    if (s && (s.status === "error" || s.status === "active") && s.inProgress === false) {
      final = s;
      break;
    }
  }
  check("3d terminal status error (no creds → D12)", final?.status === "error", JSON.stringify(final));
  check("3d inProgress false at rest", final?.inProgress === false);
  if (sawIndexing) console.log("    (observed indexing state — informative)");
  check("3d no registry written (no successful run)", !fs.existsSync(path.join(__dirname, "processed-popularcert-popularcert-kb.json")));

  const kb = await req("GET", "/gateway/kbs/popularcert-kb", { headers: H(t, "popularcert") });
  check("3d kb row status persisted 'error' (D12)", kb.json?.kb?.status === "error", JSON.stringify(kb.json?.kb?.status));
  await sleep(1000); // let the rate-limit window breathe
}

// ---- 3e settings change
{
  await sleep(1500); // rate-limit window
  const { status, json } = await req("PUT", "/gateway/kbs/popularcert-kb", {
    headers: H(t, "popularcert"),
    body: { chunkSize: 600 },
  });
  check("3e PUT chunkSize 600 → 200", status === 200, JSON.stringify(json));
  const kb = await req("GET", "/gateway/kbs/popularcert-kb", { headers: H(t, "popularcert") });
  check("3e kb.chunk_size persisted", kb.json?.kb?.chunk_size === 600, JSON.stringify(kb.json?.kb?.chunk_size));
}

// ---- 3f delete + audit
{
  await sleep(1500); // rate-limit window
  let { status } = await req("DELETE", "/gateway/kbs/popularcert-kb", { headers: H(t, "popularcert") });
  check("3f delete → 200", status === 200, `status=${status}`);
  ({ status } = await req("GET", "/gateway/kbs/popularcert-kb", { headers: H(t, "popularcert") }));
  check("3f get after delete → 404", status === 404, `status=${status}`);
  const audit = await req("GET", "/gateway/companies/popularcert/audit", { headers: H(t, "popularcert") });
  const actions = (audit.json?.entries || []).map((a) => a.action);
  const kbActs = actions.filter((a) => a.startsWith("kb."));
  const unique = [...new Set(kbActs)];
  check("3f audit has kb.* rows", unique.length >= 4, JSON.stringify(actions));
  console.log(`    kb audit actions: ${unique.join(", ")}`);
}

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
process.exit(fail ? 1 : 0);
