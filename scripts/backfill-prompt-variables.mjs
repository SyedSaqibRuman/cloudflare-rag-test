// --------------------------
// BACKFILL — company PROMPT_VARIABLES (one-off data migration)
//
// Prompt variables used to be implicit "built-ins": config/prompts.js injected
// {{CONSULTANT_NAME}}, {{COMPANY_NAME}}, {{CONTACT_US_URL}}, {{LOCATIONS_URL}},
// {{SERVICES_URL}}, {{BASE_URL}}, {{COMPANY_WEBSITE}}, {{ASSISTANT_NAME}},
// {{CURRENT_DATE}} and {{CURRENT_YEAR}} straight from company config + the wall
// clock. Those built-ins are gone (shared/prompt-variables.js) — every
// placeholder must now be defined as data.
//
// This script materializes that data for tenants that predate the change: for
// each company it seeds PROMPT_VARIABLES from the company's OWN config values,
// so the resolved system prompt is byte-for-byte what it was before. Only the
// placeholders a company actually uses are created; CURRENT_DATE/CURRENT_YEAR
// are deliberately NOT seeded (a frozen date baked into a prompt would rot —
// operators should add them as custom variables if they want them).
//
// Idempotent: companies that already define PROMPT_VARIABLES are skipped unless
// --force is passed. Safe to re-run.
//
// Usage:
//   node scripts/backfill-prompt-variables.mjs            # dry run (default)
//   node scripts/backfill-prompt-variables.mjs --apply    # write to the store
//   node scripts/backfill-prompt-variables.mjs --apply --force
// --------------------------
import { initConfig, listCompanies, getConfig, updateConfig } from "../config/index.js";
import { closePool } from "../mysql/pool.js";
import { collectPlaceholders, normalizePromptVariables } from "../shared/prompt-variables.js";

const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");

/** Former built-ins, mapped to the company config field that used to feed them. */
const LEGACY_BUILTIN_SOURCES = {
  CONSULTANT_NAME: "CONSULTANT_NAME",
  COMPANY_NAME: "COMPANY_NAME",
  CONTACT_US_URL: "CONTACT_US_URL",
  LOCATIONS_URL: "LOCATIONS_URL",
  SERVICES_URL: "SERVICES_URL",
  BASE_URL: "BASE_URL",
  COMPANY_WEBSITE: "BASE_URL",
  // No config source: ASSISTANT_NAME came from the selected assistant's name
  // and CURRENT_DATE/YEAR from the clock. Left for the operator to define —
  // seeding a date would freeze a value that silently goes stale.
};

await initConfig();

let seeded = 0;
let skipped = 0;
let unchanged = 0;

for (const { name } of listCompanies()) {
  const config = getConfig(name);
  const template = config.SYSTEM_PROMPT || "";
  const used = collectPlaceholders(template);
  const existing = normalizePromptVariables(config.PROMPT_VARIABLES || []);

  if (existing.length && !force) {
    console.log(`⏭  ${name}: already defines ${existing.length} variable(s) — skipped`);
    skipped++;
    continue;
  }

  // Seed only the placeholders this company actually uses, keeping any
  // pre-existing (forced) definitions as the base layer.
  const additions = [];
  for (const key of used) {
    if (existing.some((v) => v.key === key)) continue;
    const source = LEGACY_BUILTIN_SOURCES[key];
    if (!source) {
      console.log(`   ⚠️  ${name}: {{${key}}} has no config source — add it manually`);
      continue;
    }
    const value = String(config[source] ?? "");
    if (!value) {
      console.log(`   ⚠️  ${name}: {{${key}}} → ${source} is empty — add it manually`);
      continue;
    }
    additions.push({ key, value });
  }

  if (!additions.length) {
    console.log(`➖ ${name}: no legacy built-ins to migrate`);
    unchanged++;
    continue;
  }

  const variables = normalizePromptVariables([...existing, ...additions]);
  console.log(
    `${apply ? "✏️ " : "🔍 dry-run:"} ${name}: ${additions.length} variable(s) → ` +
      additions.map((a) => `${a.key}=${JSON.stringify(a.value).slice(0, 40)}`).join(", ")
  );

  if (apply) {
    const result = await updateConfig({ PROMPT_VARIABLES: variables }, name);
    if (result.errors?.length) {
      console.error(`   ❌ ${name} write failed: ${result.errors.join("; ")}`);
      process.exitCode = 1;
      continue;
    }
  }
  seeded++;
}

console.log(
  `\n${apply ? "Applied" : "Dry run complete"}: ${seeded} company config(s) ${apply ? "updated" : "would be updated"}, ` +
    `${skipped} skipped, ${unchanged} unchanged.`
);
if (!apply) console.log("Re-run with --apply to write these to the config store.");

await closePool();
