import fs from "fs";

// --------------------------
// INGESTION REGISTRY
// Small deep module for processed-<company>.json: which content keys were
// already ingested and their modified date, so unchanged posts are skipped.
// --------------------------
const REGISTRY_BASE = "./processed";

function registryPath(companyName) {
  return `${REGISTRY_BASE}${companyName ? "-" + companyName : ""}.json`;
}

/**
 * Create a registry bound to one company.
 * Returns { isStale(key, modifiedDate), record(key, modifiedDate) } over the
 * persisted data map. `record` mutates and persists synchronously.
 */
export function createRegistry(companyName) {
  const filePath = registryPath(companyName);
  let data = {};
  if (fs.existsSync(filePath)) {
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      data = {};
    }
  }

  return {
    isStale(key, modifiedDate) {
      return !data[key] || data[key] !== modifiedDate;
    },
    record(key, modifiedDate) {
      data[key] = modifiedDate;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    },
  };
}
