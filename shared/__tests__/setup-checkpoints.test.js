// --------------------------
// SETUP CHECKPOINTS TESTS — pure-ESM tests for shared/setup-checkpoints.js.
// No I/O, no node_modules needed.
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SETUP_CHECKPOINT_DEFS, computeSetupCheckpoints } from "../setup-checkpoints.js";

describe("SETUP_CHECKPOINT_DEFS", () => {
  it("defines the checkpoints in the fixed configuration order", () => {
    assert.deepEqual(
      SETUP_CHECKPOINT_DEFS.map((d) => d.id),
      ["workspace", "credentials", "vector-index", "storage", "content", "assistant", "chat"]
    );
  });

  it("gives every checkpoint a label, portal route, and description", () => {
    for (const def of SETUP_CHECKPOINT_DEFS) {
      assert.ok(def.label, `label missing for ${def.id}`);
      assert.ok(def.route, `route missing for ${def.id}`);
      assert.ok(def.description, `description missing for ${def.id}`);
    }
  });
});

describe("computeSetupCheckpoints", () => {
  it("returns everything incomplete for an empty state", () => {
    const r = computeSetupCheckpoints({});
    assert.equal(r.complete, false);
    assert.equal(r.doneCount, 0);
    assert.equal(r.steps.length, SETUP_CHECKPOINT_DEFS.length);
    assert.equal(r.next.id, "workspace"); // first step in order
    assert.ok(r.steps.every((s) => !s.done));
  });

  it("preserves definition order regardless of state key order", () => {
    const r = computeSetupCheckpoints({ chat: true, storage: true, workspace: true });
    assert.deepEqual(
      r.steps.map((s) => s.id),
      SETUP_CHECKPOINT_DEFS.map((d) => d.id)
    );
    // next = first incomplete in sequence, not the first key in the state map
    assert.equal(r.next.id, "credentials");
    assert.equal(r.doneCount, 3);
  });

  it("marks only the provided flags done and carries details through", () => {
    const r = computeSetupCheckpoints(
      { workspace: true, credentials: true, "vector-index": true, storage: true },
      { "vector-index": "max-test-index", storage: "max-test-data" }
    );
    assert.deepEqual(r.steps.map((s) => s.done), [true, true, true, true, false, false, false]);
    assert.equal(r.steps[2].detail, "max-test-index");
    assert.equal(r.steps[3].detail, "max-test-data");
    assert.equal(r.next.id, "content");
  });

  it("is complete with next=null when every flag is done", () => {
    const all = Object.fromEntries(SETUP_CHECKPOINT_DEFS.map((d) => [d.id, true]));
    const r = computeSetupCheckpoints(all);
    assert.equal(r.complete, true);
    assert.equal(r.next, null);
    assert.equal(r.doneCount, SETUP_CHECKPOINT_DEFS.length);
  });

  it("treats truthy and falsy flags strictly as booleans", () => {
    const r = computeSetupCheckpoints({ workspace: 1, credentials: "", "vector-index": undefined });
    assert.equal(r.steps[0].done, true);
    assert.equal(r.steps[1].done, false);
    assert.equal(r.steps[2].done, false);
  });
});
