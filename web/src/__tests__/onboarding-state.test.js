// --------------------------
// ONBOARDING REAL-STATE PROBE TESTS — pure ESM, no node_modules, no network.
//
// PURPOSE: lock the deliberate DIVERGENCE between the onboarding wizard's
// workspace probes (web/src/onboarding-state.js) and the setup checkpoints
// (routes/cloudflare/setup-status.js):
//
//   Scenario: a company completed onboarding, then its Cloudflare credential
//   was revoked (gateway connection deleted → rag-sync clears
//   CLOUDFLARE_API_TOKEN from the RAG config store).
//
//   - SetupCheckpoints ("AI Provider" step) flips back to INCOMPLETE —
//     config integrity broke, /ask would fail. (Asserted server-side in
//     routes/__tests__/setup-status.test.js — "revoked credential".)
//   - The wizard's "Connect AI Services" step stays DONE — a credential row
//     still exists in the gateway tables (the wizard probes artifacts, not
//     token health). Asserted here via the same fake-fetch shape.
//
// These can disagree on purpose: wizard = "did the user do the tour step",
// checkpoints = "is the tenant healthy".
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkWorkspaceState, countEnvelopeItems, checkpointForStep, checkpointLinkResolver, STEP_TO_CHECKPOINT } from "../onboarding-state.js";

// Fake listKbs/listCredentials/listAssistants mirroring web/src/api.js calls
// (fetch injected → no network, no token needed).
function makeApi({ kbs = 1, creds = 1, assistants = 1, fail = [] } = {}) {
  const env = (n) => ({ pagination: { total: n }, items: [] });
  const failable = (name, v) =>
    fail.includes(name) ? Promise.reject(new Error("api down")) : Promise.resolve(v);
  return {
    listKbs: () => failable("listKbs", env(kbs)),
    listCredentials: () => failable("listCredentials", creds > 0 ? [{ id: 1 }] : []),
    listAssistants: () => failable("listAssistants", env(assistants)),
  };
}

describe("checkpoint deep-link mapping", () => {
  it("every wizard step maps to its checkpoint (the bar now has an AI Assistant step)", () => {
    assert.deepEqual(STEP_TO_CHECKPOINT, { content: "content", "ai-setup": "credentials", assistant: "assistant", test: "chat" });
    assert.equal(checkpointForStep("content"), "content");
    assert.equal(checkpointForStep("ai-setup"), "credentials");
    assert.equal(checkpointForStep("assistant"), "assistant");
    assert.equal(checkpointForStep("test"), "chat");
  });

  const STATUS = {
    steps: [
      { id: "workspace", label: "Workspace", route: "companies", done: true, detail: "" },
      { id: "credentials", label: "AI Provider", route: "catalog", done: false, detail: "" },
      { id: "vector-index", label: "Vector Index", route: "config", done: true, detail: "idx" },
      { id: "storage", label: "Document Storage", route: "config", done: true, detail: "bucket" },
      { id: "content", label: "Ingest Content", route: "ingestion", done: true, detail: "2 KBs" },
      { id: "assistant", label: "AI Assistant", route: "assistants", done: false, detail: "" },
      { id: "chat", label: "Test Chat", route: "ask", done: false, detail: "" },
    ],
    next: { id: "credentials", label: "AI Provider", route: "catalog" },
    complete: false,
  };

  it("resolver returns the checkpoint's route/label/done state for covered steps", () => {
    const resolve = checkpointLinkResolver(STATUS);
    const ai = resolve("ai-setup");
    assert.equal(ai.checkpointId, "credentials");
    assert.equal(ai.route, "catalog");
    assert.equal(ai.label, "AI Provider");
    assert.equal(ai.done, false);
    assert.equal(ai.isNext, true, "revoked-credential case: this is the next blocker");
    assert.equal(ai.open, true);

    const content = resolve("content");
    assert.equal(content.done, true);
    assert.equal(content.isNext, false);

    const chat = resolve("test");
    assert.equal(chat.checkpointId, "chat");
    assert.equal(chat.done, false);

    const assistant = resolve("assistant");
    assert.equal(assistant.checkpointId, "assistant");
    assert.equal(assistant.route, "assistants");
    assert.equal(assistant.done, false);
  });

  it("unknown step ids still resolve to null", () => {
    assert.equal(checkpointLinkResolver(STATUS)("nonexistent"), null);
  });

  it("missing/failed status → resolver yields null so steps keep their own actions", () => {
    const resolve = checkpointLinkResolver(null);
    assert.equal(resolve("ai-setup"), null);
    assert.equal(checkpointLinkResolver(undefined)("content"), null);
    assert.equal(
      checkpointLinkResolver({ steps: [], next: null })("test"),
      null,
      "empty steps (unknown company) also falls back"
    );
  });
});

describe("countEnvelopeItems", () => {
  it("reads pagination.total, items arrays, and bare arrays", () => {
    assert.equal(countEnvelopeItems({ pagination: { total: 7 } }), 7);
    assert.equal(countEnvelopeItems({ items: [1, 2, 3] }), 3);
    assert.equal(countEnvelopeItems([1, 2]), 2);
    assert.equal(countEnvelopeItems({}), 0);
    assert.equal(countEnvelopeItems(null), 0);
  });
});

describe("checkWorkspaceState", () => {
  it("no company selected → all probes null (unknown), nothing probed", async () => {
    let probed = false;
    const state = await checkWorkspaceState({
      company: null,
      listKbs: () => { probed = true; return Promise.resolve({ pagination: { total: 1 } }); },
      listCredentials: () => Promise.resolve([]),
      listAssistants: () => Promise.resolve({ items: [] }),
    });
    assert.deepEqual(state, { content: null, "ai-setup": null, assistant: null });
    assert.equal(probed, false);
  });

  it("fresh workspace (nothing exists) → every step not done", async () => {
    const state = await checkWorkspaceState({ company: "acme", ...makeApi({ kbs: 0, creds: 0, assistants: 0 }) });
    assert.deepEqual(state, { content: false, "ai-setup": false, assistant: false });
  });

  it("onboarded workspace → content + ai-setup + assistant all done", async () => {
    const state = await checkWorkspaceState({ company: "acme", ...makeApi({}) });
    assert.deepEqual(state, { content: true, "ai-setup": true, assistant: true });
  });

  // THE DIVERGENCE CASE — see the file header. A revoked Cloudflare token
  // means the RAG config store lost CLOUDFLARE_API_TOKEN (setup-status's
  // credentials step → false), but the gateway credential ROW still exists,
  // so the wizard's ai-setup probe — which counts rows — stays true.
  it("revoked credential: ai-setup stays DONE (row exists) while the checkpoint goes incomplete", async () => {
    // Post-revocation state: credential row present (gateway table), but the
    // server-side config check (setup-status) would report credentials=false.
    const state = await checkWorkspaceState({ company: "acme", ...makeApi({ creds: 1 }) });
    assert.equal(state["ai-setup"], true);

    // Server-side counterpart, computed the way routes/cloudflare/setup-status.js does:
    const cfg = { CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_API_TOKEN: "" }; // cleared by rag-sync
    const checkpointCredentialsDone = !!(cfg.CLOUDFLARE_ACCOUNT_ID && cfg.CLOUDFLARE_API_TOKEN);
    assert.equal(checkpointCredentialsDone, false);
    // → SetupCheckpoints shows "AI Provider" open; wizard shows the step done. Divergence locked.
  });

  it("a failing probe yields null for that step only — never false", async () => {
    const state = await checkWorkspaceState({
      company: "acme",
      ...makeApi({ fail: ["listKbs"] }),
    });
    assert.equal(state.content, null);
    assert.equal(state["ai-setup"], true);
    assert.equal(state.assistant, true);
  });

  it("all probes failing → all unknown (wizard shows 'checking', blocks nothing)", async () => {
    const state = await checkWorkspaceState({
      company: "acme",
      listKbs: () => Promise.reject(new Error("down")),
      listCredentials: () => Promise.reject(new Error("down")),
      listAssistants: () => Promise.reject(new Error("down")),
    });
    assert.deepEqual(state, { content: null, "ai-setup": null, assistant: null });
  });

  it("credentials returned as an envelope (not an array) still count", async () => {
    const api = makeApi({});
    const state = await checkWorkspaceState({
      company: "acme",
      listKbs: api.listKbs,
      listCredentials: () => Promise.resolve({ pagination: { total: 2 } }),
      listAssistants: api.listAssistants,
    });
    assert.equal(state["ai-setup"], true);
  });
});
