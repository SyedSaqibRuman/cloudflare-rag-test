// --------------------------
// bulk operations routes — batch delete for KBs, assistants.
// POST /gateway/bulk/delete — { entity, keys: ["key1", "key2"] }
// POST /gateway/bulk/export — { entity, keys? } — export config as JSON
// POST /gateway/bulk/import — { entity, items: [...] } — import config from JSON
// --------------------------
import express from "express";
import {
  KbRepository,
  AssistantRepository,
  AuditRepository,
} from "../repositories.js";
import { requireGatewayCompany } from "../services/company-scope.js";
import { wrap } from "./helpers.js";
import { actorFromReq } from "./shared-helpers.js";

const router = express.Router();

// Entity → repository map
const REPOS = {
  kbs: KbRepository,
  assistants: AssistantRepository,
};

// ------------------------------------------------------------------
// POST /gateway/bulk/delete — batch soft-delete by keys
// Body: { entity: "kbs"|"assistants", keys: ["key1", "key2"] }
// ------------------------------------------------------------------
router.post(
  "/bulk/delete",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const { entity, keys } = req.body || {};
    if (!entity || !REPOS[entity]) {
      return res.status(400).json({ success: false, error: `Invalid entity '${entity}'. Must be one of: ${Object.keys(REPOS).join(", ")}.` });
    }
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ success: false, error: "keys must be a non-empty array." });
    }
    if (keys.length > 50) {
      return res.status(400).json({ success: false, error: "Maximum 50 items per bulk delete." });
    }

    const repo = REPOS[entity];
    const companyId = req.company.id;
    const actor = actorFromReq(req);
    let deleted = 0;
    const errors = [];

    for (const key of keys) {
      try {
        const row = await repo.findByKey(companyId, key);
        if (!row) {
          errors.push({ key, error: "Not found" });
          continue;
        }
        // Use hard delete for KBs, soft delete for assistants
        if (entity === "kbs") {
          await repo.remove(row.id);
        } else {
          await repo.remove(row.id);
        }
        deleted++;
        // Audit log
        await AuditRepository.log({
          companyId,
          action: `${entity.slice(0, -1)}.bulk_deleted`,
          entityType: entity.slice(0, -1),
          entityId: String(row.id),
          afterState: { key },
          ...actor,
        }).catch(() => {});
      } catch (err) {
        errors.push({ key, error: err.message });
      }
    }

    return res.json({
      success: true,
      message: `Deleted ${deleted} ${entity}.`,
      deleted,
      errors: errors.length > 0 ? errors : undefined,
    });
  })
);

// ------------------------------------------------------------------
// POST /gateway/bulk/export — export config as JSON
// Body: { entity, keys? } — if keys omitted, exports all
// ------------------------------------------------------------------
router.post(
  "/bulk/export",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const { entity, keys } = req.body || {};
    if (!entity || !REPOS[entity]) {
      return res.status(400).json({ success: false, error: `Invalid entity '${entity}'.` });
    }

    const repo = REPOS[entity];
    const companyId = req.company.id;
    let rows;

    if (Array.isArray(keys) && keys.length > 0) {
      rows = [];
      for (const key of keys) {
        const row = await repo.findByKey(companyId, key);
        if (row) rows.push(row);
      }
    } else {
      rows = await repo.listByCompany(companyId);
    }

    // Strip internal fields
    const exportData = rows.map((r) => {
      const copy = { ...r };
      delete copy.id;
      delete copy.company_id;
      delete copy.created_at;
      delete copy.updated_at;
      delete copy.deleted_at;
      return copy;
    });

    // Set download headers
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${entity}-export-${Date.now()}.json"`);
    return res.json({
      success: true,
      entity,
      count: exportData.length,
      exportedAt: new Date().toISOString(),
      items: exportData,
    });
  })
);

// ------------------------------------------------------------------
// POST /gateway/bulk/import — import config from JSON
// Body: { entity, items: [...], overwrite?: boolean }
// ------------------------------------------------------------------
router.post(
  "/bulk/import",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const { entity, items, overwrite } = req.body || {};
    if (!entity || !REPOS[entity]) {
      return res.status(400).json({ success: false, error: `Invalid entity '${entity}'.` });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "items must be a non-empty array." });
    }
    if (items.length > 50) {
      return res.status(400).json({ success: false, error: "Maximum 50 items per import." });
    }

    const repo = REPOS[entity];
    const companyId = req.company.id;
    const actor = actorFromReq(req);
    let imported = 0;
    const errors = [];

    for (const item of items) {
      try {
        const keyField = entity === "kbs" ? "kb_key" : "assistant_key";
        const key = item[keyField];
        if (!key) {
          errors.push({ key: "(missing)", error: "Missing key field" });
          continue;
        }

        const existing = await repo.findByKey(companyId, key);
        if (existing && !overwrite) {
          errors.push({ key, error: "Already exists (use overwrite=true)" });
          continue;
        }

        if (existing) {
          await repo.update(existing.id, item);
        } else {
          await repo.create(companyId, item);
        }
        imported++;

        await AuditRepository.log({
          companyId,
          action: `${entity.slice(0, -1)}.bulk_imported`,
          entityType: entity.slice(0, -1),
          entityId: key,
          afterState: { key, overwrite: Boolean(existing) },
          ...actor,
        }).catch(() => {});
      } catch (err) {
        errors.push({ key: item.kb_key || item.assistant_key || item.chatbot_key || "(unknown)", error: err.message });
      }
    }

    return res.json({
      success: true,
      message: `Imported ${imported} ${entity}.`,
      imported,
      errors: errors.length > 0 ? errors : undefined,
    });
  })
);

export default router;
