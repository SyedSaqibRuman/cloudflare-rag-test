// --------------------------
// WEBHOOKS ROUTES — manage webhook endpoints + delivery history
// Uses MySQL for persistence (replaces the fragile JSON file store).
// GET    /gateway/webhooks             — list all webhooks for the company
// POST   /gateway/webhooks             — create a webhook
// PUT    /gateway/webhooks/:id         — update a webhook
// DELETE /gateway/webhooks/:id         — delete a webhook
// POST   /gateway/webhooks/:id/test    — send a test event
// GET    /gateway/webhooks/:id/logs    — get delivery history
// --------------------------
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { requireGatewayCompany } from "../services/company-scope.js";
import { wrap } from "./helpers.js";
import { getPool } from "../pool.js";

const router = express.Router();

// ------------------------------------------------------------------
// One-time lift of legacy db/webhooks.json entries into MySQL.
// Runs at boot when the MySQL webhook_notifications table is empty
// (same spirit as the SQLite→MySQL company config lift in config/store.js).
// Existing MySQL data is never overwritten.
// ------------------------------------------------------------------
const LEGACY_WEBHOOKS_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../db/webhooks.json"
);

export async function liftLegacyWebhooks() {
  if (!fs.existsSync(LEGACY_WEBHOOKS_FILE)) return 0;

  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(LEGACY_WEBHOOKS_FILE, "utf8"));
  } catch {
    return 0; // unreadable/unparseable — nothing to lift
  }
  if (!Array.isArray(legacy) || legacy.length === 0) return 0;

  const pool = await getPool();
  const [rows] = await pool.query("SELECT COUNT(*) AS n FROM webhook_notifications");
  if (rows[0].n > 0) return 0; // MySQL already has data — never overwrite

  let lifted = 0;
  for (const wh of legacy) {
    if (!wh?.id || !wh?.url) continue;
    const companyId = Number(wh.company_id) || 1;
    const events = Array.isArray(wh.events) ? wh.events : ["ingestion.completed"];
    await pool.query(
      "INSERT INTO webhook_notifications (id, company_id, url, events, secret, is_active) VALUES (?, ?, ?, ?, ?, ?)",
      [wh.id, companyId, wh.url, JSON.stringify(events), wh.secret || "", wh.is_active === false ? 0 : 1]
    );
    lifted += 1;
  }
  if (lifted > 0) {
    console.log(`🔄 Migrated ${lifted} legacy webhook(s) from db/webhooks.json to MySQL`);
  }
  return lifted;
}

// ------------------------------------------------------------------
// GET /gateway/webhooks — list all webhooks
// ------------------------------------------------------------------
router.get(
  "/webhooks",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const pool = await getPool();
    const [rows] = await pool.query(
      "SELECT id, company_id, url, events, secret, is_active, created_at, updated_at FROM webhook_notifications WHERE company_id = ? ORDER BY created_at DESC",
      [req.company.id]
    );
    const webhooks = rows.map((r) => ({
      ...r,
      events: typeof r.events === "string" ? JSON.parse(r.events) : r.events,
      is_active: !!r.is_active,
    }));
    return res.json({ success: true, webhooks });
  })
);

// ------------------------------------------------------------------
// POST /gateway/webhooks — create a webhook
// ------------------------------------------------------------------
router.post(
  "/webhooks",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const { url, events, secret } = req.body || {};
    if (!url) return res.status(400).json({ success: false, error: "url is required." });

    const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const pool = await getPool();
    await pool.query(
      "INSERT INTO webhook_notifications (id, company_id, url, events, secret, is_active) VALUES (?, ?, ?, ?, ?, 1)",
      [id, req.company.id, url, JSON.stringify(events || ["ingestion.completed"]), secret || ""]
    );

    const webhook = { id, company_id: req.company.id, url, events: events || ["ingestion.completed"], secret: secret || "", is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    return res.status(201).json({ success: true, webhook });
  })
);

// ------------------------------------------------------------------
// PUT /gateway/webhooks/:id — update a webhook
// ------------------------------------------------------------------
router.put(
  "/webhooks/:id",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const { id } = req.params;
    const { url, events, secret, is_active } = req.body || {};
    const pool = await getPool();

    const [existing] = await pool.query("SELECT id FROM webhook_notifications WHERE id = ? AND company_id = ?", [id, req.company.id]);
    if (existing.length === 0) return res.status(404).json({ success: false, error: "Webhook not found." });

    const sets = [];
    const vals = [];
    if (url !== undefined) { sets.push("url = ?"); vals.push(url); }
    if (events !== undefined) { sets.push("events = ?"); vals.push(JSON.stringify(events)); }
    if (secret !== undefined) { sets.push("secret = ?"); vals.push(secret); }
    if (is_active !== undefined) { sets.push("is_active = ?"); vals.push(is_active ? 1 : 0); }

    if (sets.length > 0) {
      vals.push(id, req.company.id);
      await pool.query(`UPDATE webhook_notifications SET ${sets.join(", ")} WHERE id = ? AND company_id = ?`, vals);
    }

    const [rows] = await pool.query("SELECT id, company_id, url, events, secret, is_active, created_at, updated_at FROM webhook_notifications WHERE id = ? AND company_id = ?", [id, req.company.id]);
    const webhook = { ...rows[0], events: typeof rows[0].events === "string" ? JSON.parse(rows[0].events) : rows[0].events, is_active: !!rows[0].is_active };
    return res.json({ success: true, webhook });
  })
);

// ------------------------------------------------------------------
// DELETE /gateway/webhooks/:id — delete a webhook
// ------------------------------------------------------------------
router.delete(
  "/webhooks/:id",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const { id } = req.params;
    const pool = await getPool();
    const [result] = await pool.query("DELETE FROM webhook_notifications WHERE id = ? AND company_id = ?", [id, req.company.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: "Webhook not found." });
    return res.json({ success: true, message: "Webhook deleted." });
  })
);

// ------------------------------------------------------------------
// POST /gateway/webhooks/:id/test — send a test event
// ------------------------------------------------------------------
router.post(
  "/webhooks/:id/test",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const { id } = req.params;
    const pool = await getPool();
    const [rows] = await pool.query("SELECT id, url, company_id FROM webhook_notifications WHERE id = ? AND company_id = ?", [id, req.company.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: "Webhook not found." });
    const webhook = rows[0];

    const payload = {
      event: "webhook.test",
      timestamp: new Date().toISOString(),
      company: req.company?.company_key || "unknown",
      message: "This is a test webhook delivery.",
    };

    let statusCode = 200;
    let response = "";
    try {
      const fetchRes = await fetch(webhook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      statusCode = fetchRes.status;
      response = await fetchRes.text().catch(() => "");
    } catch (err) {
      statusCode = 0;
      response = err.message;
    }

    // Log the delivery
    await pool.query(
      "INSERT INTO webhook_delivery_logs (webhook_id, company_id, event, status_code, response) VALUES (?, ?, ?, ?, ?)",
      [id, req.company.id, "webhook.test", statusCode, response.slice(0, 500)]
    );

    return res.json({ success: true, statusCode, response: response.slice(0, 200) });
  })
);

// ------------------------------------------------------------------
// GET /gateway/webhooks/:id/logs — delivery history
// ------------------------------------------------------------------
router.get(
  "/webhooks/:id/logs",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const { id } = req.params;
    const pool = await getPool();
    const [logs] = await pool.query(
      "SELECT id, webhook_id, company_id, event, status_code, response, created_at FROM webhook_delivery_logs WHERE webhook_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 50",
      [id, req.company.id]
    );
    return res.json({ success: true, logs });
  })
);

export default router;
