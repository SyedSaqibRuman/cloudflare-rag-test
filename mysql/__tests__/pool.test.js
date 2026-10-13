// --------------------------
// POOL TESTS — the connection-lost retry helpers (isTransientConnectionError,
// withRetry). Pure functions; no MySQL connection is created.
// Run with: node --test "mysql/__tests__/*.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry, isTransientConnectionError } from "../pool.js";

const dropped = (code, message = "connection lost") =>
  Object.assign(new Error(message), { code });

test("isTransientConnectionError recognizes connection-lost codes and messages", () => {
  assert.equal(isTransientConnectionError(dropped("ECONNRESET")), true);
  assert.equal(isTransientConnectionError(dropped("EPIPE")), true);
  assert.equal(isTransientConnectionError(dropped("ETIMEDOUT")), true);
  assert.equal(isTransientConnectionError(dropped("PROTOCOL_CONNECTION_LOST")), true);
  assert.equal(isTransientConnectionError(dropped("ER_CONNECTION_LOST")), true);
  assert.equal(isTransientConnectionError(new Error("read ECONNRESET at TCPWrap.onread")), true);
  assert.equal(isTransientConnectionError(new Error("socket hang up")), true);
});

test("isTransientConnectionError does NOT treat app-level errors as dropped connections", () => {
  assert.equal(isTransientConnectionError(dropped("ER_DUP_ENTRY")), false);
  assert.equal(isTransientConnectionError(dropped("ER_ACCESS_DENIED_ERROR")), false);
  assert.equal(isTransientConnectionError(new Error("ER_NO_SUCH_TABLE: companies")), false);
  assert.equal(isTransientConnectionError(null), false);
  assert.equal(isTransientConnectionError(undefined), false);
});

test("withRetry retries exactly once on a transient error, then succeeds", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls === 1) throw dropped("ECONNRESET", "read ECONNRESET");
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withRetry propagates the error when the retry also fails transiently", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(async () => {
        calls += 1;
        throw dropped("ECONNRESET");
      }),
    (err) => err.code === "ECONNRESET"
  );
  assert.equal(calls, 2);
});

test("withRetry never retries non-transient errors", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(async () => {
        calls += 1;
        throw dropped("ER_DUP_ENTRY");
      }),
    (err) => err.code === "ER_DUP_ENTRY"
  );
  assert.equal(calls, 1);
});
