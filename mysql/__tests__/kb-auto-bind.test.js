// --------------------------
// KB AUTO-BIND TESTS — pure-ESM, no node_modules, no MySQL.
// Exercises selectRebindCandidates (pure) and autoBindVectorResource
// (fake repos) to lock the create-time healing semantics:
//   • NULL / deleted / inactive / non-vector bindings → rebound
//   • healthy vector bindings + external-id KBs → never touched
//   • non-vector_index resources / incapable providers → no-op
//   • status error → active on heal
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectRebindCandidates, autoBindVectorResource } from "../services/kb-auto-bind.js";

// A vector-capable company resource map (provider keys mirror the adapter factory)
const R = (id, provider_key, resource_type = "vector_index", { active = true, key } = {}) => ({
  id,
  provider_key,
  resource_type,
  resource_key: key ?? `res-${id}`,
  is_active: active,
});

function makeKb(overrides = {}) {
  return {
    id: 1,
    kb_key: "kb-a",
    status: "active",
    vector_resource_id: null,
    vector_external_id: null,
    ...overrides,
  };
}

describe("selectRebindCandidates", () => {
  const newResource = R(19, "cloudflare", "vector_index", { key: "test-index-cf" });

  it("rebinds a KB with no vector store bound", () => {
    const kbs = [makeKb({ kb_key: "kb-null", vector_resource_id: null })];
    const { eligible, reasons } = selectRebindCandidates(kbs, new Map(), newResource);
    assert.equal(eligible.length, 1);
    assert.equal(reasons["kb-null"], "no vector store bound");
  });

  it("rebinds a KB bound to a non-vector provider (the testing-kb R2 case)", () => {
    const resources = new Map([[15, R(15, "cloudflare_r2", "vector_index", { key: "test-index" })]]);
    const kbs = [makeKb({ kb_key: "testing-kb", vector_resource_id: 15 })];
    const { eligible, reasons } = selectRebindCandidates(kbs, resources, newResource);
    assert.equal(eligible.length, 1);
    assert.match(reasons["testing-kb"], /non-vector provider 'cloudflare_r2'/);
  });

  it("rebinds a KB whose bound resource no longer exists", () => {
    const kbs = [makeKb({ kb_key: "kb-gone", vector_resource_id: 999 })];
    const { eligible, reasons } = selectRebindCandidates(kbs, new Map(), newResource);
    assert.equal(eligible.length, 1);
    assert.match(reasons["kb-gone"], /no longer exists/);
  });

  it("rebinds a KB whose bound resource is inactive", () => {
    const resources = new Map([[7, R(7, "qdrant", "vector_index", { active: false })]]);
    const kbs = [makeKb({ kb_key: "kb-off", vector_resource_id: 7 })];
    const { eligible } = selectRebindCandidates(kbs, resources, newResource);
    assert.equal(eligible.length, 1);
  });

  it("never rebinds a healthy vector binding", () => {
    const resources = new Map([[6, R(6, "qdrant", "vector_index", { key: "java-textbook" })]]);
    const kbs = [makeKb({ kb_key: "java-textbook", vector_resource_id: 6 })];
    const { eligible } = selectRebindCandidates(kbs, resources, newResource);
    assert.deepEqual(eligible, []);
  });

  it("still rebinds a broken binding even when the derived vector_external_id is set", () => {
    // vector_external_id is a JOIN alias of the bound resource's
    // external_resource_id — it follows the (broken) binding, so it must not
    // veto a rebind. This is the exact shape testing-kb had live.
    const resources = new Map([[15, R(15, "cloudflare_r2")]]);
    const kbs = [makeKb({ kb_key: "testing-kb", vector_resource_id: 15, vector_external_id: "test-index" })];
    const { eligible } = selectRebindCandidates(kbs, resources, newResource);
    assert.equal(eligible.length, 1);
  });

  it("skips a KB already pointing at the new resource", () => {
    const resources = new Map([[19, newResource]]);
    const kbs = [makeKb({ kb_key: "kb-same", vector_resource_id: 19 })];
    const { eligible } = selectRebindCandidates(kbs, resources, newResource);
    assert.deepEqual(eligible, []);
  });

  it("treats string resource ids from MySQL drivers (numeric coercion)", () => {
    // mysql2 may return strings depending on config — the helper must coerce.
    const kbs = [makeKb({ kb_key: "kb-str", vector_resource_id: "15" })];
    const resources = new Map([[15, R(15, "cloudflare_r2")]]);
    const { eligible } = selectRebindCandidates(kbs, resources, newResource);
    assert.equal(eligible.length, 1);
  });
});

describe("autoBindVectorResource", () => {
  function makeDeps({ kbs, resources, providerKey = "cloudflare", resourceType = "vector_index" }) {
    const updates = [];
    const statuses = [];
    const audits = [];
    const kbRepo = {
      listByCompany: async () => kbs,
      update: async (kbId, input) => updates.push({ kbId, input }),
      setStatus: async (kbId, status) => statuses.push({ kbId, status }),
    };
    const resourceRepo = {
      listByCompany: async () => resources,
      findById: async (id) => resources.find((r) => r.id === id),
    };
    const auditRepo = { log: async (entry) => audits.push(entry) };
    const newResource = R(19, providerKey, resourceType);
    return { kbRepo, resourceRepo, auditRepo, updates, statuses, audits, newResource };
  }

  const company = { id: 3, company_key: "test" };

  it("rebinds broken KBs, audits them, and flips error → active", async () => {
    const broken = makeKb({ id: 11, kb_key: "testing-kb", status: "error", vector_resource_id: 15, vector_external_id: "test-index" });
    const deps = makeDeps({
      kbs: [broken, makeKb({ id: 12, kb_key: "healthy", vector_resource_id: 6 })],
      resources: [R(15, "cloudflare_r2", "vector_index"), R(6, "qdrant", "vector_index")],
    });
    const rebound = await autoBindVectorResource({ ...deps, company, newResource: deps.newResource, actor: { actorType: "admin" } });

    assert.deepEqual(rebound.map((r) => r.kb_key), ["testing-kb"]);
    assert.deepEqual(deps.updates, [{ kbId: 11, input: { vectorResourceId: 19 } }]);
    assert.deepEqual(deps.statuses, [{ kbId: 11, status: "active" }]);
    assert.equal(deps.audits.length, 1);
    assert.equal(deps.audits[0].action, "kb.vector.autobound");
    assert.equal(deps.audits[0].entityId, 11);
    assert.deepEqual(deps.audits[0].beforeState, { vector_resource_id: 15 });
    assert.deepEqual(deps.audits[0].afterState, { vector_resource_id: 19 });
  });

  it("does not flip status for KBs that were not in error", async () => {
    const kb = makeKb({ id: 21, kb_key: "kb-null", status: "active", vector_resource_id: null });
    const deps = makeDeps({ kbs: [kb], resources: [] });
    await autoBindVectorResource({ ...deps, company, newResource: deps.newResource });
    assert.deepEqual(deps.statuses, []);
  });

  it("no-ops for object_bucket resources and incapable providers", async () => {
    const kb = makeKb({ id: 31, kb_key: "kb-x", vector_resource_id: null });
    const bucketDeps = makeDeps({ kbs: [kb], resources: [], resourceType: "object_bucket" });
    const r1 = await autoBindVectorResource({ ...bucketDeps, company, newResource: bucketDeps.newResource });
    assert.deepEqual(r1, []);
    assert.deepEqual(bucketDeps.updates, []);

    const r2Deps = makeDeps({ kbs: [kb], resources: [], providerKey: "cloudflare_r2" });
    const r2 = await autoBindVectorResource({ ...r2Deps, company, newResource: r2Deps.newResource });
    assert.deepEqual(r2, []);
    assert.deepEqual(r2Deps.updates, []);
  });

  it("survives audit failures (audit never breaks the create path)", async () => {
    const kb = makeKb({ id: 41, kb_key: "kb-audit-fail", vector_resource_id: 15 });
    const deps = makeDeps({ kbs: [kb], resources: [R(15, "cloudflare_r2")] });
    deps.auditRepo.log = async () => { throw new Error("audit down"); };
    const rebound = await autoBindVectorResource({ ...deps, company, newResource: deps.newResource });
    assert.equal(rebound.length, 1);
    assert.deepEqual(deps.updates, [{ kbId: 41, input: { vectorResourceId: 19 } }]);
  });
});
