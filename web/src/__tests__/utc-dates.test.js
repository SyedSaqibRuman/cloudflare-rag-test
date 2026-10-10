// --------------------------
// UTC DATE PARSING TESTS — pure-ESM tests for web/src/util.js parseUtcDate /
// timeAgo / formatDate and the catalog utils duplicate timeAgo. Locks the DB
// timestamp contract: MySQL DATETIME strings ("YYYY-MM-DD HH:MM:SS", no
// timezone marker) are UTC and must NOT parse as browser-local time — the
// bug that made "LAST RUN 5h ago" show for a run 5 minutes old on IST
// browsers. Everything already-marked (ISO T/Z, offsets, HTTP-dates, Date
// objects, epoch numbers) must pass through unchanged.
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseUtcDate, timeAgo, formatDate } from "../util.js";
import { timeAgo as catalogTimeAgo } from "../pages/catalog/utils.js";

// MySQL DATETIME → what the API actually returns for last_ingestion_at.
const NAIVE = "2026-09-28 08:19:40";
const NAIVE_MS = "2026-09-28 08:19:40.123";
const EXPECTED_EPOCH = Date.UTC(2026, 8, 28, 8, 19, 40); // month 8 = September

describe("parseUtcDate — naive DB datetimes", () => {
  it("parses 'YYYY-MM-DD HH:MM:SS' as UTC, not browser-local", () => {
    const d = parseUtcDate(NAIVE);
    assert.ok(d instanceof Date);
    assert.equal(d.getTime(), EXPECTED_EPOCH);
  });

  it("parses fractional-seconds DATETIME(3) output as UTC too", () => {
    const d = parseUtcDate(NAIVE_MS);
    assert.equal(d.getTime(), EXPECTED_EPOCH + 123);
  });

  it("gives the same instant as the equivalent ISO-Z string", () => {
    assert.equal(
      parseUtcDate(NAIVE).getTime(),
      parseUtcDate("2026-09-28T08:19:40Z").getTime()
    );
  });
});

describe("parseUtcDate — passthrough of already-marked formats", () => {
  it("parses ISO with offset at its UTC instant", () => {
    // 13:49:40+05:30 === 08:19:40Z — an IST-marked string must NOT shift again.
    assert.equal(
      parseUtcDate("2026-09-28T13:49:40+05:30").getTime(),
      EXPECTED_EPOCH
    );
  });

  it("treats date-only 'YYYY-MM-DD' as UTC (spec behavior, unchanged)", () => {
    assert.equal(parseUtcDate("2026-09-28").getTime(), Date.UTC(2026, 8, 28));
  });

  it("passes Date objects through", () => {
    const d = new Date("2026-09-28T08:19:40Z");
    assert.equal(parseUtcDate(d).getTime(), EXPECTED_EPOCH);
  });

  it("passes epoch numbers through", () => {
    assert.equal(parseUtcDate(EXPECTED_EPOCH).getTime(), EXPECTED_EPOCH);
  });
});

describe("parseUtcDate — invalid input", () => {
  it("returns null for empty/falsy values", () => {
    assert.equal(parseUtcDate(null), null);
    assert.equal(parseUtcDate(undefined), null);
    assert.equal(parseUtcDate(""), null);
    assert.equal(parseUtcDate(0), null);
  });

  it("returns null for garbage strings", () => {
    assert.equal(parseUtcDate("not-a-date"), null);
    assert.equal(parseUtcDate("2026-13-45 99:99:99"), null);
  });
});

describe("timeAgo — relative time is TZ-independent", () => {
  // Build timestamps relative to *now*, then render them in both the naive
  // DB shape and ISO-Z — both must yield the same relative label regardless
  // of the process timezone.
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
  const naiveOf = (d) => d.toISOString().replace("T", " ").replace(/\..+$/, "");

  it("renders a naive DB timestamp 5 minutes old as '5m ago'", () => {
    assert.equal(timeAgo(naiveOf(fiveMinAgo)), "5m ago");
  });

  it("renders the same instant as ISO-Z identically", () => {
    assert.equal(timeAgo(fiveMinAgo.toISOString()), "5m ago");
    assert.equal(
      timeAgo(naiveOf(fiveMinAgo)),
      timeAgo(fiveMinAgo.toISOString())
    );
  });

  it("renders 90 minutes old as '1h ago'", () => {
    assert.equal(timeAgo(naiveOf(new Date(Date.now() - 90 * 60_000))), "1h ago");
  });

  it("returns '—' for empty and unparseable values", () => {
    assert.equal(timeAgo(null), "—");
    assert.equal(timeAgo(""), "—");
    assert.equal(timeAgo("garbage"), "—");
  });
});

describe("formatDate", () => {
  it("formats naive DB timestamps without returning the raw string", () => {
    const out = formatDate(NAIVE);
    assert.equal(typeof out, "string");
    assert.notEqual(out, NAIVE); // would be the case if parsing failed
  });

  it("falls back to '—' for empty and echoes unparseable input", () => {
    assert.equal(formatDate(null), "—");
    assert.equal(formatDate(""), "—");
    assert.equal(formatDate("garbage"), "garbage");
  });
});

describe("catalog utils timeAgo — same UTC contract, null-on-invalid contract", () => {
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
  const naiveOf = (d) => d.toISOString().replace("T", " ").replace(/\..+$/, "");

  it("renders a naive DB timestamp as '5m ago'", () => {
    assert.equal(catalogTimeAgo(naiveOf(fiveMinAgo)), "5m ago");
  });

  it("matches the shared timeAgo for the same instant", () => {
    assert.equal(catalogTimeAgo(naiveOf(fiveMinAgo)), timeAgo(naiveOf(fiveMinAgo)));
  });

  it("returns null (not '—') for empty/unparseable values", () => {
    assert.equal(catalogTimeAgo(null), null);
    assert.equal(catalogTimeAgo(""), null);
    assert.equal(catalogTimeAgo("garbage"), null);
  });
});
