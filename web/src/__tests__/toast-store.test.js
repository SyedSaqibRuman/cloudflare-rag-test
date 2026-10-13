// --------------------------
// TOAST STORE TESTS — pure-ESM tests for web/src/toast-store.js (no JSX, no
// node_modules). Locks the global notification contract: push/dismiss/subscribe,
// the stack cap, the dedupe window (api auto-toast + page notify of the same
// server message must not double-toast), and the newest-toast mirror used by
// the legacy useToast().toast render sites.
// --------------------------
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  pushToast,
  dismissToast,
  subscribeToasts,
  subscribeNewestToast,
} from "../toast-store.js";

// The store timers auto-dismiss toasts — run them eagerly and controlled.
const timers = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => {
  timers.push({ fn, ms });
  return timers.length;
};

async function flush(ms) {
  // Fire every timer scheduled with ms <= the flush target.
  for (const t of timers.splice(0).filter((x) => x.ms <= ms)) t.fn();
  await new Promise((r) => realSetTimeout(r, 0));
}

describe("pushToast / dismissToast", () => {
  beforeEach(() => {
    // Reset store state between tests by dismissing everything.
    subscribeToasts((list) => list.forEach((t) => dismissToast(t.id)))();
    timers.splice(0);
  });

  it("pushes a toast and notifies subscribers", () => {
    const seen = [];
    const unsub = subscribeToasts((list) => seen.push(list));
    const id = pushToast("Saved.", "green", { ttl: 0 });
    unsub();
    assert.equal(seen.at(-1).length, 1);
    assert.equal(seen.at(-1)[0].msg, "Saved.");
    assert.equal(seen.at(-1)[0].tone, "green");
    assert.notEqual(id, null);
  });

  it("ignores empty messages (legacy notify(\"\") cleared the slot)", () => {
    let list = null;
    const unsub = subscribeToasts((l) => (list = l));
    assert.equal(pushToast("", "green", { ttl: 0 }), null);
    assert.equal(pushToast(null, "red", { ttl: 0 }), null);
    assert.deepEqual(list, []);
    unsub();
  });

  it("dismisses by id and drops it from the list", () => {
    const id = pushToast("gone soon", "red", { ttl: 0 });
    let list = null;
    const unsub = subscribeToasts((l) => (list = l));
    dismissToast(id);
    unsub();
    assert.deepEqual(list, []);
  });

  it("auto-dismisses after the ttl fires", async () => {
    pushToast("timed", "green", { ttl: 3500 });
    let list = null;
    const unsub = subscribeToasts((l) => (list = l));
    await flush(3500);
    unsub();
    assert.deepEqual(list, []);
  });
});

describe("stack cap", () => {
  beforeEach(() => {
    subscribeToasts((list) => list.forEach((t) => dismissToast(t.id)))();
  });

  it("keeps at most 4 toasts (oldest dropped)", () => {
    let list = null;
    const unsub = subscribeToasts((l) => (list = l));
    for (const n of [1, 2, 3, 4, 5]) pushToast(`m${n}`, "green", { ttl: 0 });
    unsub();
    assert.equal(list.length, 4);
    assert.deepEqual(list.map((t) => t.msg), ["m2", "m3", "m4", "m5"]);
  });
});

describe("dedupe window", () => {
  beforeEach(() => {
    subscribeToasts((list) => list.forEach((t) => dismissToast(t.id)))();
  });

  it("swallows the identical message pushed again within the window", () => {
    const stamp = Date.now();
    let list = null;
    const unsub = subscribeToasts((l) => (list = l));
    const a = pushToast(`KB 'x${stamp}' deleted.`, "green", { ttl: 0 });
    const b = pushToast(`KB 'x${stamp}' deleted.`, "green", { ttl: 0 }); // page notify of same message
    unsub();
    assert.notEqual(a, null);
    assert.equal(b, null, "duplicate within window must be swallowed");
    assert.equal(list.length, 1);
  });

  it("allows the same message again after the window passes", async () => {
    const unsub = subscribeToasts(() => {});
    pushToast("again-later", "green", { ttl: 0 });
    await flush(1300); // > DEDUPE_WINDOW_MS (1200)
    let list = null;
    const unsub2 = subscribeToasts((l) => (list = l));
    pushToast("again-later", "green", { ttl: 0 });
    unsub();
    unsub2();
    assert.equal(list.length, 1);
  });

  it("does not dedupe different messages", () => {
    let list = null;
    const unsub = subscribeToasts((l) => (list = l));
    pushToast(`unique-a-${Date.now()}`, "green", { ttl: 0 });
    pushToast(`unique-b-${Date.now()}`, "green", { ttl: 0 });
    unsub();
    assert.equal(list.length, 2);
  });
});

describe("subscribeNewestToast (legacy useToast mirror)", () => {
  // NOTE: the sweeper subscription must self-unsubscribe immediately (the
  // `subscribeToasts(fn)()` trick) — a sweeper kept subscribed would dismiss
  // toasts the test pushes afterwards.
  it("mirrors only the newest toast as { msg, tone }", () => {
    subscribeToasts((list) => list.forEach((t) => dismissToast(t.id)))();
    const seen = [];
    const unsub = subscribeNewestToast((t) => seen.push(t));
    const stamp = Date.now();
    pushToast(`first-${stamp}`, "green", { ttl: 0 });
    pushToast(`second-${stamp}`, "red", { ttl: 0 });
    unsub();
    assert.deepEqual(seen.at(-1), { msg: `second-${stamp}`, tone: "red" });
  });

  it("mirrors null when the stack empties", () => {
    subscribeToasts((list) => list.forEach((t) => dismissToast(t.id)))();
    const seen = [];
    const unsub = subscribeNewestToast((t) => seen.push(t));
    const id = pushToast(`bye-${Date.now()}`, "green", { ttl: 0 });
    dismissToast(id);
    unsub();
    assert.equal(seen.at(-1), null);
  });
});
