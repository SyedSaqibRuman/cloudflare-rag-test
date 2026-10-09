// --------------------------
// CLOUDFLARE ROUTES BARREL (Clean Architecture: one router per resource group)
// Mounted at /cloudflare behind requireAdmin + adminLimiter (app.js).
// --------------------------
import express from "express";

import companiesRouter from "./cloudflare/companies.js";
import apikeyRouter from "./cloudflare/apikey.js";
import indexesRouter from "./cloudflare/indexes.js";
import bucketsRouter from "./cloudflare/buckets.js";
import configRouter from "./cloudflare/config.js";
import promptRouter from "./cloudflare/prompt.js";
import setupStatusRouter from "./cloudflare/setup-status.js";

const router = express.Router();

// 0. Company management
router.use("/companies", companiesRouter);
// 0b. Ask API-key management (must follow the /companies/:name mount — paths
//     below resolve against the same prefix)
router.use("/companies", apikeyRouter);
// 1. Vectorize indexes
router.use("/indexes", indexesRouter);
// 2. R2 buckets
router.use("/buckets", bucketsRouter);
// 3. Runtime config
router.use("/config", configRouter);
// 4. System prompt
router.use("/prompt", promptRouter);
// 5. Setup checkpoints (GET /setup-status) — company configuration progress
router.use("/setup-status", setupStatusRouter);

export default router;
