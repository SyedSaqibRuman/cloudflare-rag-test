// --------------------------
// 🔹 HEALTH CHECK
// Probes MySQL, Vectorize, and R2 infrastructure.
// Each probe is best-effort with a 5s timeout — failures degrade
// gracefully and never crash the server.
// --------------------------
import { isMysqlConfigured, pingDb } from "../mysql/pool.js";
import { runtimeConfig } from "../config/index.js";
import { getCFClient } from "../client.js";
import { listBuckets } from "../services/r2.js";

const PROBE_TIMEOUT_MS = 5_000;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Run a probe function with a timeout — returns { status, latencyMs, ...extra } */
async function probe(fn) {
  const start = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("probe timeout")), PROBE_TIMEOUT_MS)
      ),
    ]);
    return { status: "ok", latencyMs: Date.now() - start, ...result };
  } catch (err) {
    return { status: "error", latencyMs: Date.now() - start, error: err.message };
  }
}

// ------------------------------------------------------------------
// Individual probes
// ------------------------------------------------------------------

async function probeMysql() {
  if (!isMysqlConfigured()) {
    return { status: "skipped", message: "MySQL not configured" };
  }
  return probe(async () => {
    await pingDb();
    return { message: "connected" };
  });
}

/**
 * Probe Vectorize and R2 for the first company with credentials.
 * This avoids scanning every company on every health check.
 */
function getFirstProducibleCompany() {
  const companies = Object.keys(runtimeConfig.COMPANIES || {});
  for (const name of companies) {
    try {
      const cfg = runtimeConfig.COMPANIES[name];
      if (cfg?.CLOUDFLARE_API_TOKEN) return name;
    } catch { /* skip */ }
  }
  return null;
}

async function probeVectorize(companyName) {
  if (!companyName) {
    return { status: "skipped", message: "No company with Cloudflare credentials" };
  }
  return probe(async () => {
    const client = getCFClient(companyName);
    // Use the account-level CF client to list indexes — no per-index probing
    const accountId = runtimeConfig.COMPANIES[companyName]?.CLOUDFLARE_ACCOUNT_ID || "";
    if (!accountId) return { message: "No account ID", company: companyName };
    const res = await client.vectorize.indexes.list({ account_id: accountId });
    const indexes = res?.result || [];
    return {
      message: `${indexes.length} index(es)`,
      company: companyName,
      indexes: indexes.map((i) => i.name),
    };
  });
}

async function probeR2(companyName) {
  if (!companyName) {
    return { status: "skipped", message: "No company with R2 credentials" };
  }
  return probe(async () => {
    const buckets = await listBuckets(companyName);
    return {
      message: `${buckets.length} bucket(s)`,
      company: companyName,
      buckets: buckets.map((b) => b.Name),
    };
  });
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Run all infrastructure probes and return a structured health report.
 * Overall status is "ok" if all configured probes pass, "degraded"
 * if any fail, "healthy" if everything is up.
 */
export async function runHealthCheck() {
  const company = getFirstProducibleCompany();

  const [mysql, vectorize, r2] = await Promise.all([
    probeMysql(),
    probeVectorize(company),
    probeR2(company),
  ]);

  const statuses = [mysql.status, vectorize.status, r2.status];
  const overall = statuses.every((s) => s === "ok" || s === "skipped")
    ? "healthy"
    : statuses.some((s) => s === "ok")
      ? "degraded"
      : "unhealthy";

  return {
    status: overall,
    uptime: process.uptime(),
    timestamp: Date.now(),
    configStore: process.env.CONFIG_STORE || "sqlite",
    companyCount: Object.keys(runtimeConfig.COMPANIES || {}).length,
    components: {
      mysql,
      vectorize,
      r2,
    },
  };
}

// ------------------------------------------------------------------
// Detailed health check — probes every company
// ------------------------------------------------------------------

function getCompanyNames() {
  return Object.keys(runtimeConfig.COMPANIES || {});
}

function companyHasCredentials(name) {
  const cfg = runtimeConfig.COMPANIES[name];
  return Boolean(cfg?.CLOUDFLARE_API_TOKEN);
}

/**
 * Probe Vectorize + R2 for a single company.
 * Returns { vectorize, r2 } in parallel.
 */
async function probeCompanyInfra(companyName) {
  const [vectorize, r2] = await Promise.all([
    probeVectorize(companyName),
    probeR2(companyName),
  ]);
  return { vectorize, r2 };
}

/**
 * Run a detailed health check that probes every registered company's
 * infrastructure. Intended for admin diagnostics — slower than the
 * lightweight /_health endpoint.
 */
export async function runDetailedHealthCheck() {
  const companyNames = getCompanyNames();
  const mysql = await probeMysql();

  // Probe all companies in parallel (bounded to avoid thundering herd)
  const BATCH_SIZE = 5;
  const companies = {};
  for (let i = 0; i < companyNames.length; i += BATCH_SIZE) {
    const batch = companyNames.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (name) => {
        if (!companyHasCredentials(name)) {
          return [name, { status: "skipped", message: "No Cloudflare credentials", vectorize: { status: "skipped" }, r2: { status: "skipped" } }];
        }
        const infra = await probeCompanyInfra(name);
        const statuses = [infra.vectorize.status, infra.r2.status];
        const status = statuses.every((s) => s === "ok" || s === "skipped")
          ? "healthy"
          : statuses.some((s) => s === "ok") ? "degraded" : "error";
        return [name, { status, ...infra }];
      })
    );
    for (const [name, result] of results) {
      companies[name] = result;
    }
  }

  // Overall status: healthy if mysql + all companies ok, degraded if any fail
  const companyStatuses = Object.values(companies).map((c) => c.status);
  const allStatuses = [mysql.status, ...companyStatuses];
  const overall = allStatuses.every((s) => s === "ok" || s === "skipped" || s === "healthy")
    ? "healthy"
    : allStatuses.some((s) => s === "ok" || s === "healthy")
      ? "degraded"
      : "unhealthy";

  return {
    status: overall,
    uptime: process.uptime(),
    timestamp: Date.now(),
    configStore: process.env.CONFIG_STORE || "sqlite",
    companyCount: companyNames.length,
    components: {
      mysql,
      companies,
    },
  };
}
