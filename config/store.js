import fs from "fs";
import path from "path";
import { DEFAULT_COMPANY, getDefaultCompanyConfig } from "./schema.js";
import { hasEncryptionKey } from "./encryption.js";
import {
  loadCompanyConfig,
  saveCompanyConfig,
  listCompanyDbs,
  deleteCompanyDb,
} from "./sqlite.js";

// --------------------------
// LEGACY JSON CONFIG FILE
// Only used to migrate old flat/multi-company runtime-config.json into SQLite.
// --------------------------
const CONFIG_FILE = path.resolve(process.cwd(), "runtime-config.json");

function migrateLegacyJson() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return;

    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const saved = JSON.parse(raw);

    const companies =
      saved.COMPANIES && typeof saved.COMPANIES === "object"
        ? saved.COMPANIES
        : {
            [saved.COMPANY_NAME || DEFAULT_COMPANY.COMPANY_NAME]: getDefaultCompanyConfig(saved),
          };

    for (const [name, config] of Object.entries(companies)) {
      saveCompanyConfig(name, config);
    }

    fs.unlinkSync(CONFIG_FILE);
    console.log(`🔄 Migrated runtime-config.json (${Object.keys(companies).length} companies) to SQLite`);
  } catch (err) {
    console.warn(`⚠️  Failed to migrate runtime-config.json: ${err.message}`);
  }
}

// --------------------------
// LOAD RUNTIME CONFIG FROM SQLITE
// --------------------------
function loadConfig() {
  migrateLegacyJson();

  const companies = {};
  for (const name of listCompanyDbs()) {
    const config = loadCompanyConfig(name);
    if (config) companies[name] = config;
  }

  // No default company is seeded — a blank slate. Companies are created
  // explicitly via POST /cloudflare/companies (admin portal → Companies page).

  if (Object.keys(companies).length > 0 && !hasEncryptionKey()) {
    console.warn(
      "⚠️  APP_ENCRYPTION_KEY is not set — company credentials will be stored in plaintext. " +
        "Set it in .env (see .env.example) to encrypt credentials at rest."
    );
  }

  return { COMPANIES: companies };
}

// --------------------------
// PERSIST TO SQLITE (one database file per company)
// --------------------------
export function saveConfig(config) {
  for (const [name, companyConfig] of Object.entries(config.COMPANIES)) {
    saveCompanyConfig(name, companyConfig);
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
// RE-EXPORTS for company deletion
// --------------------------
export { deleteCompanyDb };
