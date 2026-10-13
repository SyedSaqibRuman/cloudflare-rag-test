// --------------------------
// WP SOURCE FETCHER FAILURE CONTRACT — pure ESM; node-fetch talks to a LOCAL
// http server (BASE_URL → 127.0.0.1), no external network.
// Regression lock for the 2026-09-28 maxicert-test-kb incident: maxicert.com's
// WP REST API returned HTTP 200 + Content-Type application/json with an
// Elementor HTML BODY (origin/WAF hijack). fetchWP swallowed the resulting
// res.json() parse error, returned null, and the ingestion pipeline treated
// that as "no more items" — the run completed "successfully" with 0 documents,
// a fresh lastSyncAt, and status "active". Source failures must THROW
// (ExternalServiceError → KB row status=error + last_error + audit), while
// legitimate listing exhaustion must keep returning null.
// --------------------------
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

// Isolate config store in a temp dir BEFORE importing config (each test file
// runs in its own process, so this cannot leak).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-fetch-"));
process.chdir(tmpDir);

const { initConfig, createCompany, updateConfig } = await import("../../config/index.js");
const { fetchPost, fetchPage, fetchWpByIds } = await import("../../services/wp.js");
const { ExternalServiceError, ValidationError } = await import("../../shared/errors.js");

const TEST_COMPANY = "wp-fetch-test";

// Local WP stand-in: each test installs a `nextResponse` the handler serves.
let server;
let port;
let nextResponse = { status: 200, body: "[]" };

function serve(res) {
  nextResponse = res;
}

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(nextResponse.status, {
      "content-type": nextResponse.contentType || "application/json; charset=UTF-8",
      "x-wp-totalpages": nextResponse.totalPages || "1",
    });
    res.end(nextResponse.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;

  await initConfig();
  await createCompany(TEST_COMPANY);
  await updateConfig({ BASE_URL: `http://127.0.0.1:${port}` }, TEST_COMPANY);
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  nextResponse = { status: 200, body: "[]" };
});

describe("WP source fetcher failure contract", () => {
  test("HTML-instead-of-JSON body throws ExternalServiceError (the maxicert hijack shape)", async () => {
    serve({ status: 200, body: '<style id="elementor-post-36891">.x{}</style><html><body>home</body></html>' });

    await assert.rejects(
      () => fetchPost(1, TEST_COMPANY),
      (err) => {
        assert.ok(err instanceof ExternalServiceError, "expected ExternalServiceError");
        assert.match(err.message, /HTML instead of JSON/);
        assert.match(err.message, new RegExp(`127\\.0\\.0\\.1:${port}`));
        assert.equal(err.status, 502);
        return true;
      }
    );
  });

  test("HTML body throws even when Content-Type lies about application/json", async () => {
    // The hijacked site sent Content-Type: application/json with an HTML body —
    // the body shape check is what catches it (headers are not trusted).
    serve({ status: 200, body: "<!DOCTYPE html><html>", contentType: "application/json; charset=UTF-8" });
    await assert.rejects(() => fetchPage(1, TEST_COMPANY), ExternalServiceError);
  });

  test("invalid JSON (parse failure) throws ExternalServiceError", async () => {
    serve({ status: 200, body: "{not-json" });
    await assert.rejects(
      () => fetchPost(1, TEST_COMPANY),
      (err) => {
        assert.ok(err instanceof ExternalServiceError);
        assert.match(err.message, /invalid JSON/);
        return true;
      }
    );
  });

  test("HTTP 500 exhausts retries and throws ExternalServiceError (was: silent null)", async () => {
    serve({ status: 500, body: "boom" });
    await assert.rejects(
      () => fetchPost(1, TEST_COMPANY),
      (err) => {
        assert.ok(err instanceof ExternalServiceError);
        assert.match(err.message, /HTTP 500/);
        return true;
      }
    );
  });

  test("listing exhaustion still returns null (end-of-pages contract kept)", async () => {
    serve({ status: 200, body: "[]", totalPages: "1" });
    const items = await fetchPost(1, TEST_COMPANY);
    assert.equal(items, null); // page >= totalPages + empty data → null
  });

  test("successful page returns items array", async () => {
    serve({ status: 200, body: JSON.stringify([{ id: 1 }, { id: 2 }]), totalPages: "3" });
    const items = await fetchPost(1, TEST_COMPANY);
    assert.equal(items.length, 2);
  });

  test("fetchWpByIds refuses a company with no BASE_URL (was: silent [])", async () => {
    await assert.rejects(
      () => fetchWpByIds("pages", [1, 2], "no-such-company"),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /BASE_URL/);
        return true;
      }
    );
  });

  test("fetchWpByIds still returns items for a configured company", async () => {
    serve({ status: 200, body: JSON.stringify([{ id: 7 }]) });
    const items = await fetchWpByIds("pages", [7], TEST_COMPANY);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 7);
  });
});
