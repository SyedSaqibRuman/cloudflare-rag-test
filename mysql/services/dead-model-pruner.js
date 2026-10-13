// --------------------------
// DEAD-MODEL PRUNER — one-click cleanup after a Test-All sweep.
// Classification (pure, exported for tests): a model is PRUNED only when the
// provider answered with a definitive "this model does not exist" —
//   • Cloudflare/NVIDIA function style: `Function '<uuid>': Not found …`
//   • bare 404 bodies ("404 page not found")
// Timeouts are NEVER pruned (capacity / outage waves), and soft failures
// (5xx, inference errors, 4xx quotas) are kept — the model exists but is
// degraded. Reference safety (assistants / company config / model-access
// grants) is checked server-side before any delete.
// --------------------------

/** Classify one sweep result: "prune" | "keep" | "ok". */
export function classifySweepResult(result) {
  if (result?.ok) return "ok";
  const error = String(result?.error || "");
  if (/timeout after/i.test(error)) return "keep"; // capacity / outage — not dead
  if (/Function '[^']+': Not found/i.test(error)) return "prune";
  if (/404 page not found/i.test(error)) return "prune";
  return "keep"; // 5xx, inference errors, quotas — model exists
}

/** Split a sweep's results into prune/keep/ok buckets. */
export function partitionSweep(results = []) {
  const prune = [];
  const keep = [];
  const ok = [];
  for (const r of results) {
    const verdict = classifySweepResult(r);
    if (verdict === "prune") prune.push(r);
    else if (verdict === "ok") ok.push(r);
    else keep.push(r);
  }
  return { prune, keep, ok };
}
