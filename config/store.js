import fs from "fs";
import path from "path";
import { DEFAULT_COMPANY, getDefaultCompanyConfig } from "./schema.js";
import { hasEncryptionKey } from "./encryption.js";
import {
  loadCompanyConfig as loadSqliteCompany,
  saveCompanyConfig as saveSqliteCompany,
  listCompanyDbs as listSqliteCompanies,
  deleteCompanyDb as deleteSqliteCompany,
} from "./sqlite.js";
import * as mysqlStore from "./mysql-store.js";
import { isMysqlConfigured } from "../mysql/pool.js";

// --------------------------
// STORAGE BACKEND
// CONFIG_STORE=mysql routes persistence through the MySQL companies +
// company_config tables (config/mysql-store.js, async). Anything else (or
// unset) keeps the legacy SQLite per-company files — the default, and the
// backend the test suite exercises (no MySQL needed).
// --------------------------
const BACKEND = (process.env.CONFIG_STORE || "sqlite").toLowerCase();
const USE_MYSQL = BACKEND === "mysql";
if (BACKEND !== "sqlite" && BACKEND !== "mysql") {
  console.warn(`⚠️  Unknown CONFIG_STORE '${BACKEND}' — falling back to sqlite.`);
}

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
      saveSqliteCompany(name, config);
    }

    fs.unlinkSync(CONFIG_FILE);
    console.log(`🔄 Migrated runtime-config.json (${Object.keys(companies).length} companies) to SQLite`);
  } catch (err) {
    console.warn(`⚠️  Failed to migrate runtime-config.json: ${err.message}`);
  }
}

function warnIfPlaintext(count) {
  if (count > 0 && !hasEncryptionKey()) {
    console.warn(
      "⚠️  APP_ENCRYPTION_KEY is not set — company credentials will be stored in plaintext. " +
        "Set it in .env (see .env.example) to encrypt credentials at rest."
    );
  }
}

// --------------------------
// LOAD RUNTIME CONFIG
// SQLite backend: loaded synchronously at import (historical behavior).
// MySQL backend: filled by initConfig() before the app serves requests.
// No default company is seeded — a blank slate. Companies are created
// explicitly via POST /cloudflare/companies (admin portal → Companies page).
// --------------------------
function loadSqliteConfig() {
  migrateLegacyJson();
  const companies = {};
  for (const name of listSqliteCompanies()) {
    const config = loadSqliteCompany(name);
    if (config) companies[name] = config;
  }
  warnIfPlaintext(Object.keys(companies).length);
  return { COMPANIES: companies };
}

export const runtimeConfig = USE_MYSQL ? { COMPANIES: {} } : loadSqliteConfig();

/**
 * One-time lift of legacy SQLite companies into MySQL, run at boot when the
 * MySQL companies table is empty (same spirit as migrateLegacyJson). Existing
 * MySQL data is never overwritten.
 */
async function migrateSqliteToMysql() {
  const sqliteNames = listSqliteCompanies();
  if (sqliteNames.length === 0) return;

  const mysqlNames = await mysqlStore.listCompanyDbs();
  if (mysqlNames.length > 0) return;

  for (const name of sqliteNames) {
    const config = loadSqliteCompany(name);
    if (config) await mysqlStore.saveCompanyConfig(name, config);
  }
  console.log(`🔄 Migrated ${sqliteNames.length} company config(s) from SQLite (db/) to MySQL`);
}

/**
 * Boot-time initialization for the MySQL backend: migrate legacy SQLite data
 * once, then load every company's config into the runtimeConfig singleton.
 * app.js awaits this before listening; the query CLI awaits it on startup.
 */
export async function initConfig() {
  if (!USE_MYSQL) return;
  if (!isMysqlConfigured()) {
    console.warn("⚠️  CONFIG_STORE=mysql but MySQL is not configured — starting with an empty config.");
    return;
  }

  await migrateSqliteToMysql();

  const companies = {};
  for (const name of await mysqlStore.listCompanyDbs()) {
    const config = await mysqlStore.loadCompanyConfig(name);
    if (config) companies[name] = config;
  }
  runtimeConfig.COMPANIES = companies;
  warnIfPlaintext(Object.keys(companies).length);
  console.log(`✅ Loaded ${Object.keys(companies).length} company config(s) from MySQL`);
}

// --------------------------
// PERSIST
// --------------------------
export async function saveConfig(config) {
  if (USE_MYSQL) {
    for (const [name, companyConfig] of Object.entries(config.COMPANIES)) {
      await mysqlStore.saveCompanyConfig(name, companyConfig);
    }
  } else {
    for (const [name, companyConfig] of Object.entries(config.COMPANIES)) {
      saveSqliteCompany(name, companyConfig);
    }
  }
}

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
// Deletes from BOTH backends: the active one for truth, SQLite files as
// housekeeping so a later boot can't resurrect a deleted tenant.
// --------------------------
export async function deleteCompanyDb(name) {
  if (USE_MYSQL) {
    try {
      await mysqlStore.deleteCompanyDb(name);
    } catch {
      // MySQL is the source of truth here; failures propagate to the caller.
      throw new Error(`Failed to delete company '${name}' from MySQL`);
    }
  }
  deleteSqliteCompany(name);
}
