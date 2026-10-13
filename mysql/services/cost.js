// --------------------------
// COST CALCULATOR
// Estimates cost_usd from provider_model_pricing table.
// Used by the usage logging pipeline to record per-call costs.
// --------------------------

// In-memory cache: modelKey → { input, output, cached, currency, fetchedAt }
const priceCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the current pricing for a model.
 * Uses the `v_model_pricing_current` view (effective_to IS NULL).
 * @param {string} modelKey
 * @param {Function} getPool — async pool getter
 * @returns {Promise<{ input: number, output: number, cached: number|null, currency: string } | null>}
 */
async function getModelPricing(modelKey, getPool) {
  const cached = priceCache.get(modelKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT input_price_per_million, output_price_per_million,
              cached_input_price_per_million, price_currency
       FROM v_model_pricing_current
       WHERE model_key = ?
       LIMIT 1`,
      [modelKey]
    );

    if (!rows[0]) return null;

    const pricing = {
      input: Number(rows[0].input_price_per_million) || 0,
      output: Number(rows[0].output_price_per_million) || 0,
      cached: rows[0].cached_input_price_per_million != null
        ? Number(rows[0].cached_input_per_million) : null,
      currency: rows[0].price_currency || "USD",
      fetchedAt: Date.now(),
    };

    priceCache.set(modelKey, pricing);
    return pricing;
  } catch {
    return null;
  }
}

/**
 * Estimate the cost of an LLM call.
 * @param {Object} opts
 * @param {string} opts.modelKey — e.g. "llama-3.3-70b"
 * @param {number} [opts.inputTokens]
 * @param {number} [opts.outputTokens]
 * @param {boolean} [opts.cached=false] — whether the input was cached
 * @param {Function} opts.getPool — async pool getter
 * @returns {Promise<{ costUsd: number, breakdown: { inputCost: number, outputCost: number } }>}
 */
export async function estimateCost({ modelKey, inputTokens = 0, outputTokens = 0, cached = false, getPool }) {
  const pricing = await getModelPricing(modelKey, getPool);

  if (!pricing || pricing.input === 0) {
    return { costUsd: 0, breakdown: { inputCost: 0, outputCost: 0 } };
  }

  const inputCost = cached && pricing.cached != null
    ? (pricing.cached / 1_000_000) * inputTokens
    : (pricing.input / 1_000_000) * inputTokens;

  const outputCost = (pricing.output / 1_000_000) * outputTokens;

  return {
    costUsd: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000, // 6 decimal places
    breakdown: {
      inputCost: Math.round(inputCost * 1_000_000) / 1_000_000,
      outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
    },
  };
}

/**
 * Clear the price cache (for testing or after pricing updates).
 */
export function clearPriceCache() {
  priceCache.clear();
}
