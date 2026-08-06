// Tests for config/encryption.js (AES-256-GCM at-rest credential encryption)
// plus an integration check that db/<company>.db never contains plaintext.
// Run: node --test "config/__tests__/encryption.test.js"
import test from "node:test";
import assert from "node:assert/strict";

process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || "test-master-key-for-encryption";

const { encryptSecret, decryptSecret, hasEncryptionKey, SENSITIVE_KEYS, SENSITIVE_KEY_SET } =
  await import("../encryption.js");

test("SENSITIVE_KEYS covers provider credentials and the ask API key", () => {
  for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_TOKEN_VALUE", "R2_JURISDICTION_END_POINT", "API_KEY"]) {
    assert.ok(SENSITIVE_KEY_SET.has(key), `missing ${key}`);
  }
  assert.ok(!SENSITIVE_KEY_SET.has("LLM_MODEL"));
});

test("encrypt → decrypt roundtrip", () => {
  const secret = "sk-abc123-secret-token";
  const stored = encryptSecret(secret);
  assert.notEqual(stored, secret);
  assert.equal(decryptSecret(stored), secret);
});

test("stored format is gcm:<iv>:<tag>:<data> with base64 parts", () => {
  const stored = encryptSecret("sk-xyz");
  assert.ok(stored.startsWith("gcm:"));
  const parts = stored.slice(4).split(":");
  assert.equal(parts.length, 3);
  for (const part of parts) {
    assert.doesNotThrow(() => Buffer.from(part, "base64").toString("base64") === part);
  }
});

test("each encryption uses a fresh IV (same plaintext, different ciphertext)", () => {
  const a = encryptSecret("sk-same");
  const b = encryptSecret("sk-same");
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), "sk-same");
  assert.equal(decryptSecret(b), "sk-same");
});

test("legacy plaintext values pass through decryptSecret unchanged", () => {
  assert.equal(decryptSecret("sk-legacy-plaintext"), "sk-legacy-plaintext");
});

test("empty / non-string values pass through unchanged", () => {
  assert.equal(encryptSecret(""), "");
  assert.equal(decryptSecret(""), "");
  assert.equal(decryptSecret(123), 123);
  assert.equal(decryptSecret(undefined), undefined);
});

test("without APP_ENCRYPTION_KEY encryption falls back to plaintext (backwards compatible)", () => {
  const prev = process.env.APP_ENCRYPTION_KEY;
  delete process.env.APP_ENCRYPTION_KEY;
  try {
    assert.equal(hasEncryptionKey(), false);
    assert.equal(encryptSecret("sk-plain"), "sk-plain");
    assert.equal(decryptSecret("sk-plain"), "sk-plain");
  } finally {
    process.env.APP_ENCRYPTION_KEY = prev;
  }
});

test("decrypting with the wrong key throws (GCM auth failure)", () => {
  const stored = encryptSecret("sk-wrong-key-test");
  const prev = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = "a completely different master key";
  try {
    assert.throws(() => decryptSecret(stored), /Failed to decrypt credential/);
  } finally {
    process.env.APP_ENCRYPTION_KEY = prev;
  }
});

test("tampered ciphertext throws", () => {
  const stored = encryptSecret("sk-tamper-test");
  const tampered = stored.slice(0, -2) + (stored.endsWith("AA") ? "BB" : "AA");
  assert.throws(() => decryptSecret(tampered), /Failed to decrypt credential/);
});

test("encrypting with no key then decrypting after setting one stays plaintext", () => {
  const prev = process.env.APP_ENCRYPTION_KEY;
  delete process.env.APP_ENCRYPTION_KEY;
  const stored = encryptSecret("sk-late-key");
  process.env.APP_ENCRYPTION_KEY = prev;
  try {
    // Was stored as plaintext (no key at write time) — decrypt passes it through.
    assert.equal(decryptSecret(stored), "sk-late-key");
  } finally {
    process.env.APP_ENCRYPTION_KEY = prev;
  }
});

test("64-char hex key is accepted (openssl rand -hex 32 style)", () => {
  const prev = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = "ab".repeat(32);
  try {
    const stored = encryptSecret("sk-hex-key");
    assert.equal(decryptSecret(stored), "sk-hex-key");
  } finally {
    process.env.APP_ENCRYPTION_KEY = prev;
  }
});

// ---------------------------------------------------------------------------
// Integration: the SQLite file must never contain plaintext credentials.
// Runs in a temp cwd so db/ is isolated (same pattern as routes/__tests__).
// ---------------------------------------------------------------------------
test("credentials are encrypted at rest in db/<company>.db and decrypt on load", async (t) => {
  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enc-store-"));
  const oldCwd = process.cwd();
  process.chdir(dir);
  process.env.APP_ENCRYPTION_KEY = "cd".repeat(32);
  t.after(() => {
    process.chdir(oldCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const { createCompany } = await import("../company.js");
  const { loadCompanyConfig, companyDbPath } = await import("../sqlite.js");

  const result = await createCompany("acme", {
    CLOUDFLARE_API_TOKEN: "sk-super-secret-token",
    CLOUDFLARE_ACCOUNT_ID: "account-123",
  });
  assert.ok(!result.error, result.error);

  const raw = fs.readFileSync(companyDbPath("acme"), "utf8");
  assert.ok(!raw.includes("sk-super-secret-token"), "plaintext token leaked into the db file");
  assert.ok(raw.includes("gcm:"), "no encrypted blob found in the db file");

  // Fresh read from disk decrypts back to plaintext.
  const reloaded = loadCompanyConfig("acme");
  assert.equal(reloaded.CLOUDFLARE_API_TOKEN, "sk-super-secret-token");
  assert.equal(reloaded.CLOUDFLARE_ACCOUNT_ID, "account-123");
});
