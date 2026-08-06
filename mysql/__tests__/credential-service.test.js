// --------------------------
// CREDENTIAL SERVICE TESTS — pure crypto/validation, no MySQL needed.
// Run with: node --test "mysql/__tests__/*.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encryptCredential,
  decryptCredential,
  rotateCredential,
  validateFieldsAgainstSchema,
  verifyCredential,
  buildEncryptMap,
  ENCRYPTION_VERSION,
} from "../services/credential-service.js";

const CLOUDFLARE_SCHEMA = [
  {
    field_name: "api_token",
    field_label: "Cloudflare API Token",
    is_required: true,
    is_encrypted: true,
    validation_regex: null,
  },
  {
    field_name: "account_id",
    field_label: "Cloudflare Account ID",
    is_required: true,
    is_encrypted: true,
    validation_regex: null,
  },
  {
    field_name: "zone_id",
    field_label: "Zone ID (optional)",
    is_required: false,
    is_encrypted: true,
    validation_regex: null,
  },
];

const OPENAI_SCHEMA = [
  {
    field_name: "api_key",
    field_label: "OpenAI API Key",
    is_required: true,
    is_encrypted: true,
    validation_regex: "^sk-[A-Za-z0-9]{20,}$",
  },
];

test("encryptCredential encrypts each field and returns the JSON blob", () => {
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  try {
    const { blob, version } = encryptCredential(
      { api_token: "secret-token", account_id: "acc-123", zone_id: "z" },
      buildEncryptMap(CLOUDFLARE_SCHEMA)
    );
    assert.equal(version, ENCRYPTION_VERSION);
    const parsed = JSON.parse(blob);
    assert.ok(parsed.api_token.startsWith("gcm:"), "field should be encrypted at rest");
    assert.ok(parsed.account_id.startsWith("gcm:"));
    assert.ok(!parsed.api_token.includes("secret-token"), "plaintext must not appear in the blob");
  } finally {
    delete process.env.APP_ENCRYPTION_KEY;
  }
});

test("non-encrypted fields are stored as plain JSON values", () => {
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  try {
    const { blob } = encryptCredential(
      { api_key: "sk-abc", region: "us-east-1" },
      buildEncryptMap([
        { field_name: "api_key", is_encrypted: true },
        { field_name: "region", is_encrypted: false },
      ])
    );
    const parsed = JSON.parse(blob);
    assert.ok(parsed.api_key.startsWith("gcm:"));
    assert.equal(parsed.region, "us-east-1");
  } finally {
    delete process.env.APP_ENCRYPTION_KEY;
  }
});

test("decryptCredential round-trips with APP_ENCRYPTION_KEY set", () => {
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  try {
    const { blob } = encryptCredential({ api_token: "tok", account_id: "acc" }, buildEncryptMap(CLOUDFLARE_SCHEMA));
    const decrypted = decryptCredential(blob);
    assert.deepEqual(decrypted, { api_token: "tok", account_id: "acc" });
  } finally {
    delete process.env.APP_ENCRYPTION_KEY;
  }
});

test("without APP_ENCRYPTION_KEY values stay plaintext (backwards compatible)", () => {
  delete process.env.APP_ENCRYPTION_KEY;
  const { blob } = encryptCredential({ api_key: "sk-plain" }, buildEncryptMap(OPENAI_SCHEMA));
  assert.equal(JSON.parse(blob).api_key, "sk-plain");
});

test("decryptCredential throws on malformed blob", () => {
  process.env.APP_ENCRYPTION_KEY = "b".repeat(64);
  try {
    assert.throws(() => decryptCredential("not-json"), /expected a JSON object/);
    assert.throws(() => decryptCredential('["array"]'), /expected a JSON object/);
  } finally {
    delete process.env.APP_ENCRYPTION_KEY;
  }
});

test("decryptCredential throws when encrypted value cannot be decrypted (wrong key)", () => {
  process.env.APP_ENCRYPTION_KEY = "c".repeat(64);
  const { blob } = encryptCredential({ api_key: "secret" }, buildEncryptMap(OPENAI_SCHEMA));
  process.env.APP_ENCRYPTION_KEY = "d".repeat(64);
  try {
    assert.throws(() => decryptCredential(blob), /wrong APP_ENCRYPTION_KEY|Failed to decrypt/);
  } finally {
    delete process.env.APP_ENCRYPTION_KEY;
  }
});

test("rotateCredential merges existing + updates and re-encrypts", () => {
  const existing = { api_token: "old-token", account_id: "acc" };
  const { blob } = rotateCredential(existing, { api_token: "new-token" }, buildEncryptMap(CLOUDFLARE_SCHEMA));
  const parsed = JSON.parse(blob);
  assert.ok(!parsed.api_token.includes("old-token"));
  assert.notEqual(parsed.api_token, "old-token");
  // account_id re-encrypted with the merged value
  const { blob: blob2 } = encryptCredential({ ...existing, api_token: "new-token" }, buildEncryptMap(CLOUDFLARE_SCHEMA));
  assert.equal(blob, blob2);
});

test("validateFieldsAgainstSchema enforces required + format regex", () => {
  const missing = validateFieldsAgainstSchema({}, CLOUDFLARE_SCHEMA);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.api_token);
  assert.ok(missing.errors.account_id);

  const badFormat = validateFieldsAgainstSchema({ api_key: "not-an-openai-key" }, OPENAI_SCHEMA);
  assert.equal(badFormat.ok, false);
  assert.ok(badFormat.errors.api_key);

  const valid = validateFieldsAgainstSchema({ api_key: "sk-abcdefghijklmnopqrstuvwxyz" }, OPENAI_SCHEMA);
  assert.equal(valid.ok, true);

  // optional field omitted is fine
  const cf = validateFieldsAgainstSchema(
    { api_token: "tok", account_id: "acc" },
    CLOUDFLARE_SCHEMA
  );
  assert.equal(cf.ok, true);
});

test("verifyCredential reports success with fields + plaintext warning when no key", () => {
  delete process.env.APP_ENCRYPTION_KEY;
  const { blob } = encryptCredential({ api_token: "tok", account_id: "acc" }, buildEncryptMap(CLOUDFLARE_SCHEMA));
  const result = verifyCredential(blob, CLOUDFLARE_SCHEMA);
  assert.equal(result.status, "success");
  assert.deepEqual(result.fields, { api_token: "tok", account_id: "acc" });
  assert.match(result.warning, /APP_ENCRYPTION_KEY/);
});

test("verifyCredential reports failed on malformed blob", () => {
  const result = verifyCredential("garbage", CLOUDFLARE_SCHEMA);
  assert.equal(result.status, "failed");
  assert.ok(result.error);
});

test("verifyCredential reports failed when required field missing", () => {
  process.env.APP_ENCRYPTION_KEY = "e".repeat(64);
  try {
    const { blob } = encryptCredential({ api_token: "tok" }, buildEncryptMap(CLOUDFLARE_SCHEMA));
    const result = verifyCredential(blob, CLOUDFLARE_SCHEMA);
    assert.equal(result.status, "failed");
    assert.match(result.error, /Account ID is required/);
  } finally {
    delete process.env.APP_ENCRYPTION_KEY;
  }
});

test("buildEncryptMap flips is_encrypted into per-field flags", () => {
  const map = buildEncryptMap(CLOUDFLARE_SCHEMA);
  assert.deepEqual(map, { api_token: true, account_id: true, zone_id: true });
});
