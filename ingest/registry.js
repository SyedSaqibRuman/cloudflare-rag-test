import fs from "fs";

// --------------------------
// INGESTION REGISTRY
// Small deep module for processed-<company>[-<kbKey>].json: which content
// keys were already ingested and their modified date, so unchanged posts are
// skipped. KB registries carry a __metaFingerprint so settings changes
// (chunk_size) force a re-ingest (F13).
// --------------------------
const REGISTRY_BASE = "./processed";

function registryPath(companyName, kbKey = null) {
  return `${REGISTRY_BASE}${companyName ? "-" + companyName : ""}${kbKey ? "-" + kbKey : ""}.json`;
}

/**
 * Create a registry bound to one company (and optionally one KB).
 * Returns { isStale(key, modifiedDate), record(key, modifiedDate), countDocuments() }
 * over the persisted data map. `record` mutates and persists synchronously.
 * @param {string} companyName
 * @param {string|null} kbKey
 * @param {Object|null} meta  settings fingerprint (e.g. { chunkSize }) — when
 *   provided, a fingerprint change marks every key stale (full re-ingest).
 */
export function createRegistry(companyName, kbKey = null, meta = null) {
  const filePath = registryPath(companyName, kbKey);
  let data = {};
  if (fs.existsSync(filePath)) {
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      data = {};
    }
  }

  const metaFingerprint = meta ? JSON.stringify(meta) : null;

  return {
    isStale(key, modifiedDate) {
      return (
        !data[key] ||
        data[key] !== modifiedDate ||
        (meta && data.__metaFingerprint !== metaFingerprint)
      );
    },
    record(key, modifiedDate) {
      data[key] = modifiedDate;
      if (meta) {
        data.__meta = meta;
        data.__metaFingerprint = metaFingerprint;
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    },
    countDocuments() {
      return Object.keys(data).filter((k) => !k.startsWith("__")).length;
    },
  };
}
