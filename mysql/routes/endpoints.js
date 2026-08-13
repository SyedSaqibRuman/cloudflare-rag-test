// --------------------------
// endpoints routes (Clean Architecture: one router per resource group).
// Extracted verbatim from the former mysql/gateway-router.js monolith.
// --------------------------
import express from "express";
import { AuditRepository } from "../repositories.js";
import * as Registry from "../services/provider-registry.js";
import { wrap } from "./helpers.js";

const router = express.Router();


// GET /gateway/endpoints?provider=<providerKey>
router.get(
  "/endpoints",
  wrap(async (req, res) => {
    const { provider } = req.query;
    const endpoints = await Registry.listEndpoints(provider || null);
    return res.json({ success: true, endpoints });
  })
);

// POST /gateway/endpoints
// Body: { providerKey, endpointKey, endpointName, endpointUrl,
//         httpMethod?, defaultTimeoutSeconds?, isDefault?, isActive? }
router.post(
  "/endpoints",
  wrap(async (req, res) => {
    const result = await Registry.saveEndpoint(req.body || {});
    const provider = await Registry.getProvider(req.body?.providerKey);
    await AuditRepository.log({
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "endpoint.created",
      entityType: "endpoint",
      entityId: result.id,
      afterState: { endpoint_key: req.body?.endpointKey, provider_key: req.body?.providerKey },
      reason: "admin action",
    });
    return res.status(201).json({
      success: true,
      message: `Endpoint '${req.body?.endpointKey}' created for provider '${req.body?.providerKey}'.`,
      endpointId: result.id,
      providerKey: provider?.provider_key || req.body?.providerKey,
    });
  })
);

// PUT /gateway/endpoints/:id
router.put(
  "/endpoints/:id",
  wrap(async (req, res) => {
    const existing = await Registry.getEndpointById(Number(req.params.id));
    if (!existing) {
      return res.status(404).json({ success: false, error: "Endpoint not found." });
    }
    await Registry.updateEndpoint(Number(req.params.id), req.body || {});
    await AuditRepository.log({
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "endpoint.updated",
      entityType: "endpoint",
      entityId: Number(req.params.id),
      beforeState: {
        endpoint_key: existing.endpoint_key,
        endpoint_url: existing.endpoint_url,
        http_method: existing.http_method,
        is_default: existing.is_default,
        is_active: existing.is_active,
      },
      afterState: {
        endpoint_key: req.body?.endpointKey ?? existing.endpoint_key,
        endpoint_url: req.body?.endpointUrl ?? existing.endpoint_url,
        http_method: req.body?.httpMethod ?? existing.http_method,
        is_default: req.body?.isDefault ?? existing.is_default,
        is_active: req.body?.isActive ?? existing.is_active,
      },
      reason: "admin action",
    });
    return res.json({ success: true, message: "Endpoint updated." });
  })
);

// DELETE /gateway/endpoints/:id
router.delete(
  "/endpoints/:id",
  wrap(async (req, res) => {
    const existing = await Registry.getEndpointById(Number(req.params.id));
    if (!existing) {
      return res.status(404).json({ success: false, error: "Endpoint not found." });
    }
    await Registry.removeEndpoint(Number(req.params.id));
    await AuditRepository.log({
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "endpoint.deleted",
      entityType: "endpoint",
      entityId: Number(req.params.id),
      afterState: { endpoint_key: existing.endpoint_key },
      reason: "admin action",
    });
    return res.json({ success: true, message: "Endpoint deleted." });
  })
);


export default router;
