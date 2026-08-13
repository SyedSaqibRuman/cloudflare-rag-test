// --------------------------
// pricing — one aggregate per file (Clean Architecture: repository layer).
// Extracted verbatim from the former mysql/repositories.js monolith.
// --------------------------
import { getPool } from "../pool.js";
import { json, mapRow } from "./helpers.js";

// ------------------------------------------------------------------
const PRICING_SELECT = `SELECT pmp.id, pmp.provider_model_id, pm.model_key, pm.model_name,
                               p.provider_key, pmp.effective_from, pmp.effective_to,
                               pmp.input_price_per_million, pmp.output_price_per_million,
                               pmp.cached_input_price_per_million, pmp.image_price,
                               pmp.audio_input_price_per_million, pmp.audio_output_price_per_million,
                               pmp.request_price, pmp.price_currency, pmp.billing_unit,
                               pmp.tier_name, pmp.min_units, pmp.rate_limit_notes, pmp.created_at
                          FROM provider_model_pricing pmp
                          JOIN provider_models pm ON pm.id = pmp.provider_model_id
                          JOIN providers p ON p.id = pm.provider_id`;

export const PricingRepository = {
  async list({ providerModelId = null, providerKey = null } = {}) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `${PRICING_SELECT}
        WHERE (? IS NULL OR pmp.provider_model_id = ?)
          AND (? IS NULL OR p.provider_key = ?)
        ORDER BY pm.model_name, pmp.effective_from DESC`,
      [providerModelId, providerModelId, providerKey, providerKey]
    );
    return rows.map(mapRow);
  },

  async findById(id) {
    const pool = await getPool();
    const [rows] = await pool.query(`${PRICING_SELECT} WHERE pmp.id = ?`, [id]);
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async create(modelId, input, conn) {
    const pool = conn ?? (await getPool());
    const [result] = await pool.query(
      `INSERT INTO provider_model_pricing
         (provider_model_id, effective_from, effective_to,
          input_price_per_million, output_price_per_million,
          cached_input_price_per_million, image_price,
          audio_input_price_per_million, audio_output_price_per_million,
          request_price, price_currency, billing_unit, tier_name,
          min_units, rate_limit_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        modelId,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.inputPricePerMillion ?? null,
        input.outputPricePerMillion ?? null,
        input.cachedInputPricePerMillion ?? null,
        input.imagePrice ?? null,
        input.audioInputPricePerMillion ?? null,
        input.audioOutputPricePerMillion ?? null,
        input.requestPrice ?? null,
        input.priceCurrency ?? "USD",
        input.billingUnit ?? "tokens",
        input.tierName ?? "standard",
        input.minUnits ?? null,
        input.rateLimitNotes ?? null,
      ]
    );
    return result.insertId;
  },

  async update(id, input, conn) {
    const pool = conn ?? (await getPool());
    const columnByKey = {
      effectiveFrom: "effective_from",
      effectiveTo: "effective_to",
      inputPricePerMillion: "input_price_per_million",
      outputPricePerMillion: "output_price_per_million",
      cachedInputPricePerMillion: "cached_input_price_per_million",
      imagePrice: "image_price",
      audioInputPricePerMillion: "audio_input_price_per_million",
      audioOutputPricePerMillion: "audio_output_price_per_million",
      requestPrice: "request_price",
      priceCurrency: "price_currency",
      billingUnit: "billing_unit",
      tierName: "tier_name",
      minUnits: "min_units",
      rateLimitNotes: "rate_limit_notes",
    };
    const sets = [];
    const args = [];
    for (const [key, column] of Object.entries(columnByKey)) {
      if (input[key] !== undefined) {
        sets.push(`\`${column}\` = ?`);
        args.push(input[key]);
      }
    }
    if (sets.length === 0) return;
    args.push(id);
    await pool.query(`UPDATE provider_model_pricing SET ${sets.join(", ")} WHERE id = ?`, args);
  },

  /** D3: close the open-ended row for a model (effective_to IS NULL). */
  async closeCurrent(modelId, effectiveToDate, conn) {
    const pool = conn ?? (await getPool());
    await pool.query(
      `UPDATE provider_model_pricing
          SET effective_to = ?
        WHERE provider_model_id = ? AND effective_to IS NULL`,
      [effectiveToDate, modelId]
    );
  },

  /** Hard delete — provider_model_pricing has no deleted_at column. */
  async remove(id) {
    const pool = await getPool();
    await pool.query(`DELETE FROM provider_model_pricing WHERE id = ?`, [id]);
  },
};

