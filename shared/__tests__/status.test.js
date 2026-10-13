// --------------------------
// SHARED STATUS TESTS — pure-ESM tests for the kbLifecycle badge derivation
// and statusTone mapping. No deps, no DOM.
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kbLifecycle, statusTone } from "../status.js";

const KB = { is_active: true, status: "active" };

describe("statusTone", () => {
  it("maps known statuses to tones", () => {
    assert.equal(statusTone("active"), "green");
    assert.equal(statusTone("indexing"), "amber");
    assert.equal(statusTone("error"), "red");
    assert.equal(statusTone("archived"), "slate");
  });

  it("falls back to slate for unknown statuses", () => {
    assert.equal(statusTone("who-knows"), "slate");
    assert.equal(statusTone(undefined), "slate");
  });
});

describe("kbLifecycle", () => {
  it("Indexing wins over everything (live run)", () => {
    assert.deepEqual(kbLifecycle(KB, { inProgress: true, status: "indexing" }), {
      label: "Indexing",
      tone: "amber",
    });
  });

  it("PausedRun wins over Error and is_active=false (suspended ingest run)", () => {
    assert.deepEqual(kbLifecycle(KB, { paused: true, status: "active" }), {
      label: "PausedRun",
      tone: "amber",
    });
    assert.deepEqual(
      kbLifecycle({ is_active: false }, { paused: true, lastError: "boom" }),
      { label: "PausedRun", tone: "amber" }
    );
  });

  it("Error beats Paused/Active", () => {
    assert.deepEqual(kbLifecycle(KB, { status: "error" }), { label: "Error", tone: "red" });
    assert.deepEqual(kbLifecycle(KB, { lastError: "boom" }), { label: "Error", tone: "red" });
  });

  it("Paused (is_active=false) beats Active", () => {
    assert.deepEqual(kbLifecycle({ is_active: false }, { status: "active", documentCount: 5 }), {
      label: "Paused",
      tone: "slate",
    });
  });

  it("Active when ingested at least once, Ready otherwise", () => {
    assert.deepEqual(kbLifecycle(KB, { status: "active", documentCount: 3 }), {
      label: "Active",
      tone: "green",
    });
    // Ready: never ingested — no active status and zero documents.
    assert.deepEqual(kbLifecycle(KB, { status: null, documentCount: 0 }), {
      label: "Ready",
      tone: "indigo",
    });
  });
});
