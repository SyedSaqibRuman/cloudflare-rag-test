import fs from "fs";
import path from "path";
import { env } from "../env.js";
import { DEFAULT_COMPANY, getDefaultCompanyConfig } from "./schema.js";

// --------------------------
// CONFIG FILE PATH
// --------------------------
const CONFIG_FILE = path.resolve(process.cwd(), "runtime-config.json");

// --------------------------
// LOAD PERSISTED CONFIG
// --------------------------
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const saved = JSON.parse(raw);

      // Multi-company format: already has COMPANIES map
      if (saved.COMPANIES && typeof saved.COMPANIES === "object") {
        return { COMPANIES: saved.COMPANIES };
      }

      // Legacy flat format → migrate to multi-company
      const companyName = saved.COMPANY_NAME || DEFAULT_COMPANY.COMPANY_NAME;
      const companyConfig = getDefaultCompanyConfig(saved);
      companyConfig.COMPANY_NAME = companyName;

      console.log(`🔄 Migrating flat config to company "${companyName}"`);
      return { COMPANIES: { [companyName]: companyConfig } };
    }
  } catch (err) {
    console.warn(`⚠️  Failed to load runtime-config.json: ${err.message}`);
  }

  // No config file — seed from env defaults
  const companyName = env.COMPANY_NAME || DEFAULT_COMPANY.COMPANY_NAME;
  return {
    COMPANIES: { [companyName]: getDefaultCompanyConfig() },
  };
}

// --------------------------
// PERSIST CONFIG TO DISK
// --------------------------
export function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
  } catch (err) {
    console.error(`❌ Failed to save runtime-config.json: ${err.message}`);
  }
}

// --------------------------
// RUNTIME CONFIG (loaded once, mutated in place)
// --------------------------
export const runtimeConfig = loadConfig();

// --------------------------
// HELPER: get a company config by name
// --------------------------
export function getCompanyConfig(companyName) {
  if (companyName && runtimeConfig.COMPANIES[companyName]) {
    return runtimeConfig.COMPANIES[companyName];
  }
  return null;
}

// --------------------------
// CONFIG FILE PATH (for reset operations)
// --------------------------
export { CONFIG_FILE };
