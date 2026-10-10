// --------------------------
// KB HEALTH TESTS — pure stale-index detection (no MySQL, no network)
// Locks the semantics added after the 2026-09-29 max-test-index recreation:
// a KB whose last ingest predates its index's created_on is flagged.
// --------------------------
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateKbIndexHealth, assessKbIndexHealth, toEpochMs } from "../services/kb-health.js";

const INDEX_CREATED = "2026-09-29T07:11:41Z"; // max-test-index recreate moment
const BEFORE = "2026-09-28T10:21:03Z"; // kb#37's 963-URL ingest — lost
const AFTER = "2026-09-30T07:29:00Z"; // max-test-kb's post-recreate ingest — fine

function kb(overrides = {}) {
  return {
    kbKey: "kb-under-test",
    vectorIndexName: "max-test-index",
    lastIngestionAt: AFTER,
    documentsProcessed: 30,
    ...overrides,
  };
}

const INDEXES = { "max-test-index": INDEX_CREATED };

describe("toEpochMs", () => {
  test("parses naive MySQL datetime strings as UTC", () => {
    // "2026-09-29 07:11:41" with new Date() parses browser-local; the helper
    // must treat it as UTC (pool connects with timezone: "Z").
    assert.equal(toEpochMs("2026-09-29 07:11:41"), Date.parse("2026-09-29T07:11:41Z"));
  });

  test("passes through ISO strings, Date objects, numbers, and null", () => {
    assert.equal(toEpochMs("2026-09-29T07:11:41Z"), Date.parse("2026-09-29T07:11:41Z"));
    assert.equal(toEpochMs(new Date(Date.parse("2026-01-01T00:00:00Z"))), Date.parse("2026-01-01T00:00:00Z"));
    assert.equal(toEpochMs(1_000), 1_000);
    assert.equal(toEpochMs(null), null);
    assert.equal(toEpochMs(undefined), null);
  });

  test("returns null for garbage", () => {
    assert.equal(toEpochMs("not a date"), null);
  });
});

describe("evaluateKbIndexHealth", () => {
  test("flags a KB whose last ingest predates the index created_on", () => {
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: BEFORE, documentsProcessed: 963 }), INDEXES);
    assert.equal(r.staleIndex, true);
    assert.equal(r.checkable, true);
    assert.equal(r.indexMissing, false);
    assert.match(r.reason, /predates the recreation/);
    assert.match(r.reason, /963 processed document/);
    // epoch equality, not string equality — toISOString emits .000Z
    assert.equal(Date.parse(r.indexCreatedOn), Date.parse(INDEX_CREATED));
    assert.equal(Date.parse(r.lastIngestionAt), Date.parse(BEFORE));
  });

  test("healthy when the ingest postdates the recreate", () => {
    const r = evaluateKbIndexHealth(kb(), INDEXES);
    assert.equal(r.staleIndex, false);
    assert.match(r.reason, /healthy/);
  });

  test("ingest in the same millisecond as created_on is NOT stale", () => {
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: INDEX_CREATED }), INDEXES);
    assert.equal(r.staleIndex, false);
  });

  test("a KB that never ingested is uncheckable, never flagged", () => {
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: null }), INDEXES);
    assert.equal(r.staleIndex, false);
    assert.equal(r.checkable, false);
    assert.match(r.reason, /No completed ingest yet/);
  });

  test("unknown created_on (live CF list unavailable) is uncheckable, never flagged", () => {
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: BEFORE }), null);
    assert.equal(r.staleIndex, false);
    assert.equal(r.checkable, false);
    assert.match(r.reason, /cannot check/);
  });

  test("a missing index name in the live list reports indexMissing", () => {
    const r = evaluateKbIndexHealth(kb(), { "some-other-index": INDEX_CREATED });
    assert.equal(r.indexMissing, true);
    assert.equal(r.staleIndex, false); // created_on unknown → not provable
    assert.match(r.reason, /not in the live account index list/);
  });

  test("no vector index bound at all is uncheckable", () => {
    const r = evaluateKbIndexHealth(kb({ vectorIndexName: null }), INDEXES);
    assert.equal(r.checkable, false);
    assert.match(r.reason, /No vector index bound/);
  });

  test("every KB bound to the same index name is compared against the same created_on", () => {
    // Shared-index lesson (max-test-index bound 4 KBs): one recreation must
    // flag every KB that ingested into the shared name before it — the check
    // never keys off per-KB state, only the name → created_on map.
    const { flagged } = assessKbIndexHealth(
      [
        kb({ kbKey: "a", lastIngestionAt: BEFORE }),
        kb({ kbKey: "b", lastIngestionAt: AFTER }),
        kb({ kbKey: "c", lastIngestionAt: BEFORE }),
      ],
      INDEXES
    );
    assert.deepEqual(flagged.map((r) => r.kbKey).sort(), ["a", "c"]);
  });

  test("accepts Map input", () => {
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: BEFORE }), new Map([["max-test-index", Date.parse(INDEX_CREATED)]]));
    assert.equal(r.staleIndex, true);
  });

  test("naive MySQL datetime inputs compare correctly (UTC)", () => {
    const r = evaluateKbIndexHealth(
      kb({ lastIngestionAt: "2026-09-28 10:21:03" }),
      { "max-test-index": "2026-09-29 07:11:41" }
    );
    assert.equal(r.staleIndex, true);
  });
});

describe("assessKbIndexHealth", () => {
  test("partitions a KB list into healthy / flagged / uncheckable", () => {
    const kbs = [
      kb({ kbKey: "lost", lastIngestionAt: BEFORE, documentsProcessed: 963 }),
      kb({ kbKey: "fine", lastIngestionAt: AFTER }),
      kb({ kbKey: "never-ran", lastIngestionAt: null }),
      kb({ kbKey: "other-index", vectorIndexName: "unlisted", lastIngestionAt: AFTER }),
    ];
    const { healthy, flagged, uncheckable } = assessKbIndexHealth(kbs, {
      "max-test-index": INDEX_CREATED,
      // "unlisted" absent → indexMissing path, still uncheckable for staleness
    });
    assert.deepEqual(flagged.map((r) => r.kbKey), ["lost"]);
    assert.deepEqual(healthy.map((r) => r.kbKey), ["fine"]);
    assert.deepEqual(uncheckable.map((r) => r.kbKey), ["never-ran", "other-index"]);
  });

  test("empty KB list yields empty partitions", () => {
    const { healthy, flagged, uncheckable } = assessKbIndexHealth([], INDEXES);
    assert.deepEqual(healthy, []);
    assert.deepEqual(flagged, []);
    assert.deepEqual(uncheckable, []);
  });

  test("null/undefined KB list yields empty partitions (route degenerates safely)", () => {
    for (const empty of [null, undefined]) {
      const { healthy, flagged, uncheckable } = assessKbIndexHealth(empty, INDEXES);
      assert.deepEqual(healthy, []);
      assert.deepEqual(flagged, []);
      assert.deepEqual(uncheckable, []);
    }
  });
});

describe("edge cases — timestamp boundaries", () => {
  test("stale by exactly 1ms is flagged (strict <)", () => {
    const r = evaluateKbIndexHealth(
      kb({ lastIngestionAt: "2026-09-29T07:11:40.999Z" }),
      INDEXES
    );
    assert.equal(r.staleIndex, true);
  });

  test("1ms AFTER created_on is not stale", () => {
    const r = evaluateKbIndexHealth(
      kb({ lastIngestionAt: "2026-09-29T07:11:41.569Z" }),
      INDEXES
    );
    assert.equal(r.staleIndex, false);
    assert.equal(r.checkable, true);
  });

  test("far-past ingest against far-future created_on is flagged", () => {
    const r = evaluateKbIndexHealth(
      kb({ lastIngestionAt: "2020-01-01T00:00:00Z" }),
      INDEXES
    );
    assert.equal(r.staleIndex, true);
  });

  test("naive datetime with T separator (no Z) parses as UTC", () => {
    const r = evaluateKbIndexHealth(
      kb({ lastIngestionAt: "2026-09-28T10:21:03" }),
      { "max-test-index": "2026-09-29T07:11:41" }
    );
    assert.equal(r.staleIndex, true);
  });

  test("fractional-seconds naive datetime parses as UTC", () => {
    const r = evaluateKbIndexHealth(
      kb({ lastIngestionAt: "2026-09-28 10:21:03.568" }),
      INDEXES
    );
    assert.equal(Date.parse(r.lastIngestionAt), Date.parse("2026-09-28T10:21:03.568Z"));
  });

  test("ISO string with explicit offset is respected as-is (not rewritten)", () => {
    // 09:11:41+02:00 == 07:11:41Z — must NOT be parsed as local-naive
    const r = evaluateKbIndexHealth(
      kb({ lastIngestionAt: "2026-09-29T09:11:41+02:00" }),
      INDEXES
    );
    assert.equal(Date.parse(r.lastIngestionAt), Date.parse("2026-09-29T07:11:41Z"));
  });
});

describe("edge cases — unparseable / hostile inputs never flag", () => {
  test("garbage lastIngestionAt is uncheckable, never flagged", () => {
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: "not a date" }), INDEXES);
    assert.equal(r.staleIndex, false);
    assert.equal(r.checkable, false);
  });

  test("shape-valid but impossible datetime is uncheckable (regex passes, Date invalid)", () => {
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: "2026-13-45 99:99:99" }), INDEXES);
    assert.equal(r.staleIndex, false);
    assert.equal(r.checkable, false);
    assert.equal(r.lastIngestionAt, null);
  });

  test("garbage created_on in the map is uncheckable, never flagged", () => {
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: BEFORE }), {
      "max-test-index": "garbage",
    });
    assert.equal(r.staleIndex, false);
    assert.equal(r.checkable, false);
    assert.match(r.reason, /No created_on known/);
  });

  test("null created_on entry (index listed without created_on) is uncheckable, NOT indexMissing", () => {
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: BEFORE }), {
      "max-test-index": null,
    });
    assert.equal(r.staleIndex, false);
    assert.equal(r.checkable, false);
    assert.equal(r.indexMissing, false);
    assert.match(r.reason, /No created_on known for vector index/);
  });

  test("empty live list (account has no indexes) stays uncheckable, NOT indexMissing", () => {
    // Conservative: an empty list could be a partial/failed listing — the
    // check refuses to declare the index missing without a non-empty witness.
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: BEFORE }), {});
    assert.equal(r.indexMissing, false);
    assert.equal(r.staleIndex, false);
    assert.equal(r.checkable, false);
  });

  test("both dates garbage → uncheckable with the ingest reason (branch order)", () => {
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: "junk" }), null);
    assert.match(r.reason, /No completed ingest yet/);
  });

  test("never-ingested KB with a MISSING index reports 'never ingested', not indexMissing", () => {
    // Branch order matters: the useful reason for a KB that never ran is
    // "nothing to lose", even though the index is also absent.
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: null }), {
      "some-other-index": INDEX_CREATED,
    });
    assert.match(r.reason, /No completed ingest yet/);
  });

  test("documentsProcessed 0/null flags WITHOUT a document count in the reason", () => {
    const r0 = evaluateKbIndexHealth(kb({ lastIngestionAt: BEFORE, documentsProcessed: 0 }), INDEXES);
    assert.equal(r0.staleIndex, true);
    assert.match(r0.reason, /Vectors from that run are gone/);
    assert.doesNotMatch(r0.reason, /processed document/);

    const rNull = evaluateKbIndexHealth(kb({ lastIngestionAt: BEFORE, documentsProcessed: null }), INDEXES);
    assert.equal(rNull.staleIndex, true);
    assert.match(rNull.reason, /Vectors from that run are gone/);
  });

  test("negative documentsProcessed (corrupt row) does not appear as a count", () => {
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: BEFORE, documentsProcessed: -5 }), INDEXES);
    assert.equal(r.staleIndex, true);
    assert.doesNotMatch(r.reason, /-5/);
  });

  test("epoch 0 (1970) is a valid timestamp, not null", () => {
    assert.equal(toEpochMs(0), 0);
    const r = evaluateKbIndexHealth(kb({ lastIngestionAt: 0 }), INDEXES);
    assert.equal(r.staleIndex, true); // 1970 predates 2026 recreate
    assert.equal(Date.parse(r.lastIngestionAt), 0);
  });

  test("undefined vectorIndexName behaves like null (no index bound)", () => {
    const r = evaluateKbIndexHealth(kb({ vectorIndexName: undefined }), INDEXES);
    assert.equal(r.checkable, false);
    assert.equal(r.vectorIndexName, null);
    assert.match(r.reason, /No vector index bound/);
  });

  test("accepts Map with naive datetime values (route feeds pool dateStrings)", () => {
    const r = evaluateKbIndexHealth(
      kb({ lastIngestionAt: "2026-09-28 10:21:03" }),
      new Map([["max-test-index", "2026-09-29 07:11:41.568"]])
    );
    assert.equal(r.staleIndex, true);
    assert.equal(r.indexCreatedOn, "2026-09-29T07:11:41.568Z");
  });
});
