// --------------------------
// WEBHOOK SENDER
// Sends HTTP POST notifications when ingestion completes.
// Supports Slack, Discord, generic webhooks, and custom URLs.
//
// Fires asynchronously (fire-and-forget) — webhook failures never block
// or fail the ingestion pipeline.
// --------------------------

import crypto from "crypto";
import { logToFile } from "../utils/logger.js";

const TIMEOUT_MS = 10000;

/**
 * Send ingestion completion webhook if configured on the KB.
 *
 * @param {Object} opts
 * @param {string} opts.webhookUrl      Target URL (Slack, Discord, or custom)
 * @param {string} [opts.webhookSecret] HMAC secret for signature verification
 * @param {Object} opts.stats           Ingestion statistics
 * @param {string} opts.kbKey           Knowledge base key
 * @param {string} opts.companyName     Company key
 * @param {string} [opts.status]        "completed" | "failed"
 * @param {string} [opts.error]         Error message if failed
 */
export async function fireIngestionWebhook(opts) {
  const {
    webhookUrl,
    webhookSecret,
    webhookEvents,
    stats,
    kbKey,
    companyName,
    status = "completed",
    error,
  } = opts;

  if (!webhookUrl) return;

  // Respect event filtering: skip if this event type is not in webhookEvents.
  if (webhookEvents && !webhookEvents.split(",").map((e) => e.trim()).includes(status)) {
    return;
  }

  const payload = buildPayload({ stats, kbKey, companyName, status, error });

  try {
    await sendWebhook(webhookUrl, webhookSecret, payload);
    console.log(`✅ Webhook sent for KB '${kbKey}' → ${webhookUrl}`);
    logToFile("process.log", `🪝 Webhook sent: ${kbKey} → ${status}`);
  } catch (err) {
    console.error(`❌ Webhook failed for KB '${kbKey}': ${err.message}`);
    logToFile("error.log", `🪝 Webhook failed: ${kbKey} → ${err.message}`);
    // Best-effort — never throw
  }
}

/**
 * Build the webhook payload based on the target type.
 * Auto-detects Slack/Discord from the URL.
 */
function buildPayload({ stats, kbKey, companyName, status, error }) {
  const timestamp = new Date().toISOString();
  const isSuccess = status === "completed";

  // Detect platform from URL
  const isSlack = /hooks\.slack\.com/i.test(stats._webhookUrl || "");
  const isDiscord = /discord\.com\/api\/webhooks/i.test(stats._webhookUrl || "");

  const core = {
    event: `ingestion.${status}`,
    kbKey,
    companyName,
    timestamp,
    stats: {
      documentsProcessed: stats.documentsProcessed ?? 0,
      documentsSkipped: stats.documentsSkipped ?? 0,
      chunksCreated: stats.chunksCreated ?? 0,
      durationMs: stats.durationMs ?? 0,
      mode: stats.mode || "all",
    },
  };

  if (error) core.error = error;

  // Slack-formatted payload
  if (isSlack) {
    return {
      text: isSuccess
        ? `✅ *KB '${kbKey}' ingestion complete*`
        : `❌ *KB '${kbKey}' ingestion failed*`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: isSuccess
              ? `✅ *KB '${kbKey}' ingestion complete*\n\n` +
                `📊 ${core.stats.documentsProcessed} documents processed, ` +
                `${core.stats.chunksCreated} chunks created\n` +
                `⏱️ Duration: ${(core.stats.durationMs / 1000).toFixed(1)}s\n` +
                `🏢 Company: ${companyName}\n` +
                `📋 Mode: ${core.stats.mode}`
              : `❌ *KB '${kbKey}' ingestion failed*\n\n` +
                `🏢 Company: ${companyName}\n` +
                `⚠️ Error: ${error || "Unknown error"}`,
          },
        },
      ],
    };
  }

  // Discord-formatted payload
  if (isDiscord) {
    return {
      embeds: [
        {
          title: isSuccess
            ? `✅ KB '${kbKey}' ingestion complete`
            : `❌ KB '${kbKey}' ingestion failed`,
          color: isSuccess ? 0x22c55e : 0xef4444,
          fields: [
            { name: "Company", value: companyName, inline: true },
            { name: "Mode", value: core.stats.mode, inline: true },
            { name: "Documents", value: String(core.stats.documentsProcessed), inline: true },
            { name: "Chunks", value: String(core.stats.chunksCreated), inline: true },
            { name: "Duration", value: `${(core.stats.durationMs / 1000).toFixed(1)}s`, inline: true },
          ],
          timestamp,
        },
      ],
    };
  }

  // Generic JSON webhook (custom URL)
  return core;
}

/**
 * Send the webhook with HMAC signature if a secret is configured.
 */
async function sendWebhook(url, secret, payload) {
  const body = JSON.stringify(payload);

  const headers = { "Content-Type": "application/json" };

  // HMAC-SHA256 signature for verification
  if (secret) {
    const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
    headers["X-Webhook-Signature"] = `sha256=${signature}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
