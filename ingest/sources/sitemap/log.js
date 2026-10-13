// --------------------------
// DISCOVERY LOGGING
// Structured, prefixed console lines + a file trail. Deliberately logs only
// URLs and counts — never credentials or auth headers (§32).
// --------------------------

import { logToFile } from "../../../utils/logger.js";

const PREFIX = "[WebsiteDiscovery]";

/** @param {string} message */
export function logDiscovery(message) {
  console.log(`${PREFIX} ${message}`);
  logToFile("process.log", `${PREFIX} ${message}`);
}

/** @param {string} message */
export function logDiscoveryWarn(message) {
  console.warn(`${PREFIX} ⚠️  ${message}`);
  logToFile("error.log", `${PREFIX} ⚠️ ${message}`);
}
