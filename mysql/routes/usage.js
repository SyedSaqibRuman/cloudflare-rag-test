// --------------------------
// usage routes (Clean Architecture: one router per resource group).
// Aggregate reads for the usage dashboard under /gateway/usage.
// --------------------------
import express from "express";
import { UsageRepository } from "../repositories.js";
import { requireGatewayCompany } from "../services/company-scope.js";
import { wrap } from "./helpers.js";

const router = express.Router();

router.use("/usage", requireGatewayCompany);

// GET /gateway/usage — aggregate usage for the selected company
// Query params: from, to, groupBy (day|model|credential)
router.get(
  "/usage",
  wrap(async (req, res) => {
    const { from, to, groupBy } = req.query;
    const data = await UsageRepository.aggregate(req.company.id, {
      from: from || undefined,
      to: to || undefined,
      groupBy: groupBy || "day",
    });
    return res.json({ success: true, data });
  })
);

// GET /gateway/usage/summary — summary stats
router.get(
  "/usage/summary",
  wrap(async (req, res) => {
    const { from, to } = req.query;
    const summary = await UsageRepository.summary(req.company.id, {
      from: from || undefined,
      to: to || undefined,
    });
    return res.json({ success: true, summary });
  })
);

// GET /gateway/usage/top — top models by cost
router.get(
  "/usage/top",
  wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const type = req.query.type || "model";
    let data;
    if (type === "kb") {
      data = await UsageRepository.topKBsByCost(req.company.id, limit);
    } else {
      data = await UsageRepository.topByCost(req.company.id, limit);
    }
    return res.json({ success: true, data });
  })
);

// GET /gateway/usage/recent — recent calls
router.get(
  "/usage/recent",
  wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const data = await UsageRepository.recent(req.company.id, limit);
    return res.json({ success: true, data });
  })
);

// GET /gateway/usage/alerts — check cost thresholds
router.get(
  "/usage/alerts",
  wrap(async (req, res) => {
    const { checkCostAlerts, getAlertConfig } = await import("../../mysql/services/cost-alerts.js");
    const result = await checkCostAlerts(req.company.id);
    return res.json({ success: true, ...result });
  })
);

// PUT /gateway/usage/alerts — update cost thresholds
router.put(
  "/usage/alerts",
  wrap(async (req, res) => {
    const { saveAlertConfig, getAlertConfig } = await import("../../mysql/services/cost-alerts.js");
    const { dailyLimitUsd, monthlyLimitUsd, enabled } = req.body || {};
    const config = getAlertConfig();
    if (dailyLimitUsd !== undefined) config.dailyLimitUsd = Number(dailyLimitUsd);
    if (monthlyLimitUsd !== undefined) config.monthlyLimitUsd = Number(monthlyLimitUsd);
    if (enabled !== undefined) config.enabled = Boolean(enabled);
    saveAlertConfig(config);
    return res.json({ success: true, config });
  })
);

export default router;
