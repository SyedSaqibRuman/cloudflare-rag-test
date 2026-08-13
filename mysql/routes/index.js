// --------------------------
// GATEWAY ROUTER COMPOSER (Clean Architecture: interface-adapters layer)
// Mounted at /gateway (behind requireAdmin, like /cloudflare). Each resource
// group lives in its own router file (providers, companies, resources,
// credentials, endpoints, pricing, kbs, assistants) plus shared helpers and
// the live probes map. The `gate` middleware applies to every route.
// --------------------------
import express from "express";
import { gate } from "./helpers.js";
import healthRouter from "./health.js";
import providersRouter from "./providers.js";
import companiesRouter from "./companies.js";
import resourcesRouter from "./resources.js";
import credentialsRouter from "./credentials.js";
import endpointsRouter from "./endpoints.js";
import pricingRouter from "./pricing.js";
import kbsRouter from "./kbs.js";
import assistantsRouter from "./assistants.js";

const router = express.Router();

// Every gateway route requires a configured database (503 otherwise).
router.use(gate);

router.use(healthRouter);
router.use(providersRouter);
router.use(companiesRouter);
router.use(resourcesRouter);
router.use(credentialsRouter);
router.use(endpointsRouter);
router.use(pricingRouter);
router.use(kbsRouter);
router.use(assistantsRouter);

export default router;
