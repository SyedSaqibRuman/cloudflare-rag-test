// --------------------------
// health routes (Clean Architecture: one router per resource group).
// Extracted verbatim from the former mysql/gateway-router.js monolith.
// --------------------------
import express from "express";
import { env } from "../../env.js";
import { pingDb } from "../pool.js";
import * as Registry from "../services/provider-registry.js";
import { wrap } from "./helpers.js";

const router = express.Router();


// GET /gateway/health — DB connectivity probe (also forces pool creation)
router.get(
  "/health",
  wrap(async (_req, res) => {
    await pingDb();
    return res.json({
      success: true,
      configured: true,
      database: env.MYSQL_DATABASE,
      registryLoaded: Registry.isRegistryLoaded(),
      connected: true,
    });
  })
);


export default router;
