// --------------------------
// CATALOG SERVICE
// Validation + transactional writes for the global provider catalog's
// endpoints (provider_endpoints) and price history (provider_model_pricing).
// Validation is pure and DB-free (D4); all SQL lives in the repositories (D5).
// Writers use a dedicated connection with explicit begin/commit/rollback (F4)
// and throw errors carrying a `status` so the router can map them to 4xx.
// The registry cache is dropped by the caller after writes (F7).
// --------------------------
import {
  ProviderRepository,
  ModelRepository,
  EndpointRepository,
  PricingRepository,
} from "../repositories.js";
import { getPool } from "../pool.js";

export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
export const ENDPOINT_KEY_RE = /^[a-z0-9-]+$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isDate(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** YYYY-MM-DD for the day before a valid YYYY-MM-DD date string. */
export function previousDay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - 1));
  return date.toISOString().slice(0, 10);
}

/**
 * Normalize a date value to a YYYY-MM-DD string. mysql2 returns DATE columns
 * as JS Date objects (local timezone) — format from local parts to avoid
 * UTC day-shift errors.
 */
function dateToYmd(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return value;
}

/** Map a snake_case DB row to camelCase so it can feed the validators. */
function camelize(row, mapping) {
  const out = {};
  for (const [dbKey, value] of Object.entries(row)) {
    const camel = mapping[dbKey];
    if (camel) out[camel] = value;
  }
  return out;
}

const ENDPOINT_ROW_TO_INPUT = {
  provider_key: "providerKey",
  endpoint_key: "endpointKey",
  endpoint_name: "endpointName",
  endpoint_url: "endpointUrl",
  http_method: "httpMethod",
  default_timeout_seconds: "defaultTimeoutSeconds",
  is_default: "isDefault",
  is_active: "isActive",
};

const PRICING_ROW_TO_INPUT = {
  provider_model_id: "providerModelId",
  effective_from: "effectiveFrom",
  effective_to: "effectiveTo",
  input_price_per_million: "inputPricePerMillion",
  output_price_per_million: "outputPricePerMillion",
  cached_input_price_per_million: "cachedInputPricePerMillion",
  image_price: "imagePrice",
  audio_input_price_per_million: "audioInputPricePerMillion",
  audio_output_price_per_million: "audioOutputPricePerMillion",
  request_price: "requestPrice",
  price_currency: "priceCurrency",
  billing_unit: "billingUnit",
  tier_name: "tierName",
  min_units: "minUnits",
  rate_limit_notes: "rateLimitNotes",
};

// ------------------------------------------------------------------
// ENDPOINT VALIDATION (pure, DB-free)
// ------------------------------------------------------------------

/**
 * Validate endpoint input. Normalizes defaults for optional fields.
 * @param {Object} input
 * @returns {{ ok: boolean, value?: Object, errors?: Object<string,string> }}
 */
export function validateEndpointInput(input = {}) {
  const errors = {};

  if (!input.providerKey?.trim()) errors.providerKey = "providerKey is required.";

  if (!input.endpointKey?.trim()) {
    errors.endpointKey = "endpointKey is required.";
  } else if (!ENDPOINT_KEY_RE.test(input.endpointKey)) {
    errors.endpointKey = "endpointKey must match /^[a-z0-9-]+$/.";
  } else if (input.endpointKey.length < 3 || input.endpointKey.length > 50) {
    errors.endpointKey = "endpointKey must be 3-50 characters.";
  }

  if (!input.endpointName?.trim()) {
    errors.endpointName = "endpointName is required.";
  } else if (input.endpointName.trim().length > 100) {
    errors.endpointName = "endpointName must be at most 100 characters.";
  }

  if (!input.endpointUrl?.trim()) {
    errors.endpointUrl = "endpointUrl is required.";
  } else if (input.endpointUrl.trim().length > 500) {
    errors.endpointUrl = "endpointUrl must be at most 500 characters.";
  } else {
    try {
      new URL(input.endpointUrl.trim());
    } catch {
      errors.endpointUrl = "endpointUrl must be a valid URL.";
    }
  }

  if (input.httpMethod !== undefined && input.httpMethod !== null) {
    if (!HTTP_METHODS.includes(input.httpMethod)) {
      errors.httpMethod = `httpMethod must be one of ${HTTP_METHODS.join(", ")}.`;
    }
  }

  if (input.defaultTimeoutSeconds !== undefined && input.defaultTimeoutSeconds !== null) {
    if (!Number.isInteger(input.defaultTimeoutSeconds)) {
      errors.defaultTimeoutSeconds = "defaultTimeoutSeconds must be an integer.";
    } else if (input.defaultTimeoutSeconds < 1 || input.defaultTimeoutSeconds > 3600) {
      errors.defaultTimeoutSeconds = "defaultTimeoutSeconds must be 1-3600.";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      providerKey: input.providerKey.trim(),
      endpointKey: input.endpointKey.trim(),
      endpointName: input.endpointName.trim(),
      endpointUrl: input.endpointUrl.trim(),
      httpMethod: input.httpMethod ?? "POST",
      defaultTimeoutSeconds: input.defaultTimeoutSeconds ?? 30,
      isDefault: input.isDefault ?? false,
      isActive: input.isActive ?? true,
    },
  };
}

// ------------------------------------------------------------------
// PRICING VALIDATION (pure, DB-free)
// ------------------------------------------------------------------

const PRICE_FIELDS = [
  "inputPricePerMillion",
  "outputPricePerMillion",
  "cachedInputPricePerMillion",
  "imagePrice",
  "audioInputPricePerMillion",
  "audioOutputPricePerMillion",
  "requestPrice",
];

/**
 * Validate pricing input. Normalizes defaults for optional fields.
 * @param {Object} input
 * @returns {{ ok: boolean, value?: Object, errors?: Object<string,string> }}
 */
export function validatePricingInput(input = {}) {
  const errors = {};

  // mysql2 returns DECIMAL columns as strings and DATE columns as Date
  // objects — coerce both so merged DB rows validate identically to JSON.
  const effectiveFrom = dateToYmd(input.effectiveFrom);
  const effectiveTo = dateToYmd(input.effectiveTo);
  const prices = {};
  for (const field of PRICE_FIELDS) {
    const v = input[field];
    prices[field] = v === null || v === undefined ? null : Number(v);
  }
  const minUnits = input.minUnits === null || input.minUnits === undefined ? null : Number(input.minUnits);

  if (!input.providerModelId || !Number.isInteger(Number(input.providerModelId)) || Number(input.providerModelId) <= 0) {
    errors.providerModelId = "providerModelId is required and must be a positive integer.";
  }

  if (!effectiveFrom) {
    errors.effectiveFrom = "effectiveFrom is required.";
  } else if (!isDate(effectiveFrom)) {
    errors.effectiveFrom = "effectiveFrom must be a valid YYYY-MM-DD date.";
  }

  if (effectiveTo !== undefined && effectiveTo !== null) {
    if (!isDate(effectiveTo)) {
      errors.effectiveTo = "effectiveTo must be a valid YYYY-MM-DD date.";
    } else if (isDate(effectiveFrom) && effectiveTo <= effectiveFrom) {
      errors.effectiveTo = "effectiveTo must be after effectiveFrom.";
    }
  }

  for (const field of PRICE_FIELDS) {
    const v = prices[field];
    if (v === null || v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      errors[field] = `${field} must be a non-negative number.`;
    }
  }

  if (input.priceCurrency !== undefined && input.priceCurrency !== null && !String(input.priceCurrency).trim()) {
    errors.priceCurrency = "priceCurrency must be a non-empty string.";
  } else if (String(input.priceCurrency ?? "").length > 10) {
    errors.priceCurrency = "priceCurrency must be at most 10 characters.";
  }

  if (String(input.billingUnit ?? "").length > 50) {
    errors.billingUnit = "billingUnit must be at most 50 characters.";
  }

  if (String(input.tierName ?? "").length > 50) {
    errors.tierName = "tierName must be at most 50 characters.";
  }

  if (minUnits !== null) {
    if (!Number.isInteger(minUnits) || minUnits <= 0) {
      errors.minUnits = "minUnits must be a positive integer.";
    }
  }

  if (String(input.rateLimitNotes ?? "").length > 500) {
    errors.rateLimitNotes = "rateLimitNotes must be at most 500 characters.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      providerModelId: Number(input.providerModelId),
      effectiveFrom,
      effectiveTo: effectiveTo ?? null,
      ...Object.fromEntries(
        PRICE_FIELDS.map((f) => [f, prices[f]])
      ),
      priceCurrency: input.priceCurrency ?? "USD",
      billingUnit: input.billingUnit ?? "tokens",
      tierName: input.tierName ?? "standard",
      minUnits,
      rateLimitNotes: input.rateLimitNotes ?? null,
    },
  };
}

// ------------------------------------------------------------------
// ENDPOINT WRITERS (transactional)
// ------------------------------------------------------------------

/**
 * Create an endpoint for a provider. Validates, checks the (provider,
 * endpoint_key) uniqueness key, and — when isDefault is set — demotes any
 * other default for the provider inside the same transaction.
 * @param {Object} input  validated-normalized or raw input
 * @returns {Promise<{id: number}>}
 */
export async function saveEndpoint(input) {
  const check = validateEndpointInput(input);
  if (!check.ok) throw new HttpError(400, "Validation failed: " + JSON.stringify(check.errors));

  const { providerKey, ...value } = check.value;
  const provider = await ProviderRepository.findByKey(providerKey);
  if (!provider) throw new HttpError(404, `Unknown provider '${providerKey}'.`);

  if (await EndpointRepository.findByKey(provider.id, value.endpointKey)) {
    throw new HttpError(409, `Endpoint '${value.endpointKey}' already exists for provider '${providerKey}'.`);
  }

  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (value.isDefault) {
      await EndpointRepository.clearDefaults(provider.id, null, conn);
    }
    const id = await EndpointRepository.create(provider.id, value, conn);
    await conn.commit();
    return { id };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Update an endpoint. Enforces uniqueness excluding the row itself; when
 * isDefault flips on, demotes sibling defaults in the same transaction.
 * @param {number|string} id
 * @param {Object} input
 * @returns {Promise<{id: number}>}
 */
export async function updateEndpoint(id, input) {
  const existing = await EndpointRepository.findById(id);
  if (!existing) throw new HttpError(404, "Endpoint not found.");

  const check = validateEndpointInput({
    ...camelize(existing, ENDPOINT_ROW_TO_INPUT),
    ...input,
  });
  if (!check.ok) throw new HttpError(400, "Validation failed: " + JSON.stringify(check.errors));

  const { providerKey: _ignored, ...value } = check.value;
  if (value.endpointKey !== existing.endpoint_key) {
    const clash = await EndpointRepository.findByKey(existing.provider_id, value.endpointKey);
    if (clash && clash.id !== Number(id)) {
      throw new HttpError(409, `Endpoint '${value.endpointKey}' already exists for this provider.`);
    }
  }

  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (value.isDefault) {
      await EndpointRepository.clearDefaults(existing.provider_id, Number(id), conn);
    }
    await EndpointRepository.update(Number(id), value, conn);
    await conn.commit();
    return { id: Number(id) };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Remove an endpoint. Refuses when a live resource template references its
 * endpoint_key as the provisioner (F5).
 * @param {number|string} id
 * @returns {Promise<void>}
 */
export async function removeEndpoint(id) {
  const existing = await EndpointRepository.findById(id);
  if (!existing) throw new HttpError(404, "Endpoint not found.");

  const refs = await EndpointRepository.countResourceTypeReferences(
    existing.provider_id,
    existing.endpoint_key
  );
  if (refs > 0) {
    throw new HttpError(409, `Endpoint in use by ${refs} resource type(s).`);
  }

  await EndpointRepository.remove(id);
}

// ------------------------------------------------------------------
// PRICING WRITERS (transactional)
// ------------------------------------------------------------------

/**
 * Create a pricing row. When the new row is open-ended or overlaps the
 * current open row, the open row is closed the day before effectiveFrom
 * inside the same transaction (D3 current-price invariant).
 * @param {Object} input
 * @returns {Promise<{id: number}>}
 */
export async function savePricing(input) {
  const check = validatePricingInput(input);
  if (!check.ok) throw new HttpError(400, "Validation failed: " + JSON.stringify(check.errors));

  const value = check.value;
  const model = await ModelRepository.findById(value.providerModelId);
  if (!model) {
    throw new HttpError(404, `Unknown model id '${value.providerModelId}'.`);
  }

  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (value.effectiveTo === null) {
      await PricingRepository.closeCurrent(value.providerModelId, previousDay(value.effectiveFrom), conn);
    }
    const id = await PricingRepository.create(value.providerModelId, value, conn);
    await conn.commit();
    return { id };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Update a pricing row. Re-closes the open row when the edit re-opens or
 * extends the range (same overlap rule as savePricing).
 * @param {number|string} id
 * @param {Object} input
 * @returns {Promise<{id: number}>}
 */
export async function updatePricing(id, input) {
  const existing = await PricingRepository.findById(id);
  if (!existing) throw new HttpError(404, "Pricing not found.");

  const check = validatePricingInput({
    ...camelize(existing, PRICING_ROW_TO_INPUT),
    ...input,
  });
  if (!check.ok) throw new HttpError(400, "Validation failed: " + JSON.stringify(check.errors));

  const value = check.value;
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (value.effectiveTo === null) {
      await PricingRepository.closeCurrent(value.providerModelId, previousDay(value.effectiveFrom), conn);
    }
    await PricingRepository.update(Number(id), value, conn);
    await conn.commit();
    return { id: Number(id) };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Remove a pricing row (hard delete). */
export async function removePricing(id) {
  const existing = await PricingRepository.findById(id);
  if (!existing) throw new HttpError(404, "Pricing not found.");
  await PricingRepository.remove(id);
}
