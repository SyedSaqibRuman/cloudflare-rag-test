// --------------------------
// NEO4J SESSION UTILS TESTS — pure-ESM tests for the session seam.
// Uses the `_setDriverFactoryForTests` seam (mirrors `_usePoolForTests` in
// mysql/pool.js) so these run with zero network and no real driver; they
// lock the pooling semantics: same config → same driver, refcounted close,
// distinct configs get distinct drivers, fail-fast on verifyConnectivity.
// --------------------------
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { openKnowledgeSession, closeAllKnowledgeDrivers, withKnowledgeSession, withTimeout, _setDriverFactoryForTests } =
  await import("../neo4j.js");

const GRAPH = { uri: "neo4j+s://example.databases.neo4j.io", username: "u", password: "p", database: "db1" };
const GRAPH2 = { uri: "neo4j+s://other.databases.neo4j.io", username: "u", password: "p", database: "db2" };

describe("neo4j session utils — shared driver pool", () => {
  let drivers;

  beforeEach(async () => {
    await closeAllKnowledgeDrivers();
    drivers = [];
    _setDriverFactoryForTests((graph) => {
      const d = {
        uri: graph.uri,
        closed: false,
        verifyConnectivity: async () => ({}),
        close: async () => {
          d.closed = true;
        },
        session: () => ({ close: async () => {} }),
      };
      drivers.push(d);
      return d;
    });
  });

  it("reuses one driver for sessions with the same config", async () => {
    const a = await openKnowledgeSession(GRAPH, { write: true });
    const b = await openKnowledgeSession(GRAPH);
    assert.equal(drivers.length, 1, `expected a single pooled driver, got ${drivers.length}`);
    await a.close();
    await b.close();
    assert.equal(drivers[0].closed, false, "driver stays open while refcount > 0");
  });

  it("keeps the driver open after the last session closes (idle timer owns it)", async () => {
    const a = await openKnowledgeSession(GRAPH);
    await a.close();
    assert.equal(drivers.length, 1);
    assert.equal(drivers[0].closed, false, "not closed eagerly — the idle timer owns the close");
  });

  it("opens separate drivers for distinct configs", async () => {
    const a = await openKnowledgeSession(GRAPH);
    const b = await openKnowledgeSession(GRAPH2);
    assert.equal(drivers.length, 2);
    await a.close();
    await b.close();
  });

  it("withKnowledgeSession releases the ref on success and on throw", async () => {
    const r = await withKnowledgeSession(GRAPH, { write: true }, async () => 42);
    assert.equal(r, 42);
    await assert.rejects(
      () =>
        withKnowledgeSession(GRAPH, {}, async () => {
          throw new Error("boom");
        }),
      /boom/
    );
    // refcount back to zero → next open reuses the same pooled driver
    const s = await openKnowledgeSession(GRAPH);
    assert.equal(drivers.length, 1);
    await s.close();
  });

  it("fails fast when the server is unreachable (verifyConnectivity throws)", async () => {
    _setDriverFactoryForTests((graph) => ({
      uri: graph.uri,
      verifyConnectivity: async () => {
        throw new Error("ServiceUnavailable");
      },
      close: async () => {},
      session: () => ({ close: async () => {} }),
    }));
    await assert.rejects(() => openKnowledgeSession(GRAPH), /Neo4j connection failed/);
  });

  it("withTimeout rejects with the label", async () => {
    await assert.rejects(() => withTimeout(new Promise(() => {}), 10, "Neo4j query"), /Neo4j query timed out/);
  });
});
