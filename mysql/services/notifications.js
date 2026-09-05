// --------------------------
// NOTIFICATIONS — email/webhook alerts for ingestion failures, workflow errors
// Uses a simple webhook-based approach (no SMTP dependency).
// Notification URLs are stored in db/notifications.json.
// --------------------------
import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "db", "notifications.json");

const DEFAULTS = {
  enabled: false,
  webhookUrls: [], // e.g. ["https://hooks.slack.com/services/..."]
  events: {
    ingestion_failed: true,
    workflow_failed: true,
    cost_threshold: true,
  },
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) };
    }
  } catch { /* fall through */ }
  return { ...DEFAULTS };
}

export function saveNotificationConfig(config) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...DEFAULTS, ...config }, null, 2));
}

export function getNotificationConfig() {
  return loadConfig();
}

/**
 * Send a notification to all configured webhook URLs.
 * @param {string} event - Event type (e.g. "ingestion_failed")
 * @param {Object} payload - Event data
 */
export async function sendNotification(event, payload) {
  const config = loadConfig();
  if (!config.enabled || !config.webhookUrls?.length) return;
  if (config.events?.[event] === false) return;

  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  });

  for (const url of config.webhookUrls) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      console.error(`⚠️ Notification webhook failed (${url}): ${err.message}`);
    }
  }
}

/** Convenience: notify ingestion failure. */
export async function notifyIngestionFailed(company, kbKey, error) {
  return sendNotification("ingestion_failed", {
    company,
    kbKey,
    error: String(error),
    message: `Ingestion failed for KB '${kbKey}' in company '${company}'.`,
  });
}

/** Convenience: notify workflow failure. */
export async function notifyWorkflowFailed(company, workflowKey, error, stepIndex) {
  return sendNotification("workflow_failed", {
    company,
    workflowKey,
    stepIndex,
    error: String(error),
    message: `Workflow '${workflowKey}' failed at step ${stepIndex} in company '${company}'.`,
  });
}

/** Convenience: notify cost threshold exceeded. */
export async function notifyCostThreshold(company, type, current, limit) {
  return sendNotification("cost_threshold", {
    company,
    type,
    current,
    limit,
    message: `${type} cost ($${current.toFixed(2)}) exceeded threshold ($${limit}) for company '${company}'.`,
  });
}
