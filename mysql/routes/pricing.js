// --------------------------
// pricing routes (Clean Architecture: one router per resource group).
// Extracted verbatim from the former mysql/gateway-router.js monolith.
// --------------------------
import express from "express";
import { AuditRepository } from "../repositories.js";
import * as Registry from "../services/provider-registry.js";
import { wrap } from "./helpers.js";

const router = express.Router();


// GET /gateway/pricing?modelId=<id>&provider=<providerKey>
router.get(
  "/pricing",
  wrap(async (req, res) => {
    const { modelId, provider } = req.query;
    const pricing = await Registry.listPricingByModel(Number(modelId) || null, provider || null);
    return res.json({ success: true, pricing });
  })
);

// POST /gateway/pricing
// Body: { providerModelId, effectiveFrom, effectiveTo?, ...prices }
router.post(
  "/pricing",
  wrap(async (req, res) => {
    const result = await Registry.savePricing(req.body || {});
    const model = await Registry.getModelById(Number(req.body?.providerModelId));
    await AuditRepository.log({
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "pricing.created",
      entityType: "pricing",
      entityId: result.id,
      afterState: {
        model_key: model?.model_key || null,
        effective_from: req.body?.effectiveFrom,
      },
      reason: "admin action",
    });
    return res.status(201).json({
      success: true,
      message: `Pricing created for model '${model?.model_key || req.body?.providerModelId}' from ${req.body?.effectiveFrom}.`,
      pricingId: result.id,
    });
  })
);

// PUT /gateway/pricing/:id
router.put(
  "/pricing/:id",
  wrap(async (req, res) => {
    const existing = await Registry.getPricingById(Number(req.params.id));
    if (!existing) {
      return res.status(404).json({ success: false, error: "Pricing not found." });
    }
    await Registry.updatePricing(Number(req.params.id), req.body || {});
    await AuditRepository.log({
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "pricing.updated",
      entityType: "pricing",
      entityId: Number(req.params.id),
      beforeState: {
        effective_from: existing.effective_from,
        effective_to: existing.effective_to,
        input_price_per_million: existing.input_price_per_million,
        output_price_per_million: existing.output_price_per_million,
      },
      afterState: {
        effective_from: req.body?.effectiveFrom ?? existing.effective_from,
        effective_to: req.body?.effectiveTo ?? existing.effective_to,
        input_price_per_million: req.body?.inputPricePerMillion ?? existing.input_price_per_million,
        output_price_per_million: req.body?.outputPricePerMillion ?? existing.output_price_per_million,
      },
      reason: "admin action",
    });
    return res.json({ success: true, message: "Pricing updated." });
  })
);

// DELETE /gateway/pricing/:id
router.delete(
  "/pricing/:id",
  wrap(async (req, res) => {
    const existing = await Registry.getPricingById(Number(req.params.id));
    if (!existing) {
      return res.status(404).json({ success: false, error: "Pricing not found." });
    }
    await Registry.removePricing(Number(req.params.id));
    await AuditRepository.log({
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "pricing.deleted",
      entityType: "pricing",
      entityId: Number(req.params.id),
      afterState: {
        model_key: existing.model_key,
        effective_from: existing.effective_from,
      },
      reason: "admin action",
    });
    return res.json({ success: true, message: "Pricing deleted." });
  })
);


export default router;
