// --------------------------
// COST ALERTS — check usage costs against configurable thresholds
// Returns alerts when daily or monthly cost exceeds the configured limit.
// Thresholds are stored in a simple JSON config file (db/cost-alerts.json).
// --------------------------
import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "db", "cost-alerts.json");

// Default thresholds
const DEFAULTS = {
  dailyLimitUsd: 50,
  monthlyLimitUsd: 500,
  enabled: true,
};

/** Load alert config from disk (or defaults). */
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) };
    }
  } catch { /* fall through */ }
  return { ...DEFAULTS };
}

/** Save alert config to disk. */
export function saveAlertConfig(config) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...DEFAULTS, ...config }, null, 2));
}

/** Get current alert config. */
export function getAlertConfig() {
  return loadConfig();
}

/**
 * Check current usage against thresholds.
 * @param {number} companyId
 * @returns {Promise<{ alerts: Array, config: Object }>}
 */
export async function checkCostAlerts(companyId) {
  const config = loadConfig();
  if (!config.enabled) return { alerts: [], config };

  try {
    const { getPool } = await import("../pool.js");
    const pool = await getPool();

    // Daily cost (today)
    const [[dailyRow]] = await pool.query(
      `SELECT COALESCE(SUM(cost_usd), 0) AS cost
         FROM credential_usage_logs
        WHERE company_id = ? AND DATE(created_at) = CURDATE()`,
      [companyId]
    );

    // Monthly cost (current month)
    const [[monthlyRow]] = await pool.query(
      `SELECT COALESCE(SUM(cost_usd), 0) AS cost
         FROM credential_usage_logs
        WHERE company_id = ? AND YEAR(created_at) = YEAR(NOW()) AND MONTH(created_at) = MONTH(NOW())`,
      [companyId]
    );

    const dailyCost = Number(dailyRow?.cost || 0);
    const monthlyCost = Number(monthlyRow?.cost || 0);
    const alerts = [];

    if (dailyCost >= config.dailyLimitUsd) {
      alerts.push({
        type: "daily",
        severity: dailyCost >= config.dailyLimitUsd * 1.5 ? "critical" : "warning",
        message: `Daily cost ($${dailyCost.toFixed(2)}) has exceeded the $${config.dailyLimitUsd} threshold.`,
        current: dailyCost,
        limit: config.dailyLimitUsd,
      });
    } else if (dailyCost >= config.dailyLimitUsd * 0.8) {
      alerts.push({
        type: "daily",
        severity: "info",
        message: `Daily cost ($${dailyCost.toFixed(2)}) is approaching the $${config.dailyLimitUsd} threshold.`,
        current: dailyCost,
        limit: config.dailyLimitUsd,
      });
    }

    if (monthlyCost >= config.monthlyLimitUsd) {
      alerts.push({
        type: "monthly",
        severity: monthlyCost >= config.monthlyLimitUsd * 1.5 ? "critical" : "warning",
        message: `Monthly cost ($${monthlyCost.toFixed(2)}) has exceeded the $${config.monthlyLimitUsd} threshold.`,
        current: monthlyCost,
        limit: config.monthlyLimitUsd,
      });
    } else if (monthlyCost >= config.monthlyLimitUsd * 0.8) {
      alerts.push({
        type: "monthly",
        severity: "info",
        message: `Monthly cost ($${monthlyCost.toFixed(2)}) is approaching the $${config.monthlyLimitUsd} threshold.`,
        current: monthlyCost,
        limit: config.monthlyLimitUsd,
      });
    }

    return { alerts, config, dailyCost, monthlyCost };
  } catch {
    return { alerts: [], config };
  }
}
