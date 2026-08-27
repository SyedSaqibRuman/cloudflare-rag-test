#!/usr/bin/env node
// Generate an APP_ENCRYPTION_KEY (AES-256-GCM master key) for .env.
//
// Usage:
//   node gen-key.js          # print a fresh key
//   node gen-key.js --set    # generate and write it into .env
//
// No dependencies — just node:crypto. The key is 32 random bytes as hex
// (64 chars), as recommended in .env.example (openssl rand -hex 32).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, ".."); // repo root (scripts/ sits one level down)
const ENV_PATH = path.join(ROOT, ".env");

const key = crypto.randomBytes(32).toString("hex");
console.log(`APP_ENCRYPTION_KEY=${key}`);
console.log("Copy it into .env, then restart the server.");

if (process.argv.includes("--set")) {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(`❌ ${ENV_PATH} not found — create it first.`);
    process.exit(1);
  }

  const lines = fs.readFileSync(ENV_PATH, "utf8").split("\n");
  const idx = lines.findIndex((l) => /^\s*#?\s*APP_ENCRYPTION_KEY\s*=/.test(l));

  if (idx !== -1) {
    lines[idx] = `APP_ENCRYPTION_KEY=${key}`;
  } else {
    lines.push("", `# Optional — encrypts company credentials at rest.`, `APP_ENCRYPTION_KEY=${key}`);
  }

  fs.writeFileSync(ENV_PATH, lines.join("\n"));
  console.log(`✅ Wrote APP_ENCRYPTION_KEY into ${ENV_PATH}`);
  console.log("Restart the server to start encrypting credentials at rest.");
}
