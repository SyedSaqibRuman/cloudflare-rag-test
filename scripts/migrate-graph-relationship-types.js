// --------------------------
// NEO4J SCHEMA MIGRATION — RELATES_TO → real relationship types
// One-time script for knowledge bases ingested before the typed-relationship
// change. Old ingest/graph-extract.js wrote every edge as
// [r:RELATES_TO {type: "USES"|...}] — the semantic label lived on a property,
// so Neo4j Browser/Bloom and GraphRAG could never treat it as a real type.
//
// What this script does (Phase 1 of the knowledge layer):
//   STEP 1 — rewrite every [r:RELATES_TO {type: T}] edge into a real
//            [r:T]->(b) edge (type allowlisted via knowledge/graph-schema.js),
//            copying provenance and deleting the legacy edge. Rewrites stay
//            scoped by kb_key so cross-KB data is never glued together.
//   STEP 2 — merge duplicate Entity nodes per KB (same kb_key +
//            case-insensitive canonical name) into one survivor, moving each
//            relationship onto the survivor with its REAL type preserved.
//
// Usage:
//   node scripts/migrate-graph-relationship-types.js [company] [--dry-run]
//   - company:  company key whose NEO4J_* config to use (default: first
//               company in the runtime config store with a graph config)
//   - --dry-run: report what would change without writing anything
// --------------------------
import "dotenv/config";
import { initConfig, getConfig, runtimeConfig } from "../config/index.js";

const QUERY_TIMEOUT_MS = 30_000;
const MAX_DUPLICATE_GROUPS = 500;

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const requestedCompany = positional[0] || null;

  // Load company configs from the configured store (SQLite sync, MySQL async).
  await initConfig();

  let companyName = requestedCompany;
  if (!companyName) {
    const withGraph = Object.entries(runtimeConfig.COMPANIES || {}).find(
      ([, cfg]) => cfg?.NEO4J_URI && cfg?.NEO4J_USERNAME && cfg?.NEO4J_PASSWORD
    );
    if (withGraph) companyName = withGraph[0];
  }

  if (!companyName) {
    console.error("❌ No company specified and no company has a Neo4j graph config.");
    console.error("   Usage: node scripts/migrate-graph-relationship-types.js [company] [--dry-run]");
    process.exit(1);
  }

  const cfg = getConfig(companyName);
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE } = cfg || {};
  if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
    console.error(`❌ Company '${companyName}' has no Neo4j credentials in its config store.`);
    process.exit(1);
  }
  const graph = { uri: NEO4J_URI, username: NEO4J_USERNAME, password: NEO4J_PASSWORD, database: NEO4J_DATABASE || "neo4j" };

  console.log(`${dryRun ? "🔍 DRY RUN — " : ""}Migrating graph for company '${companyName}'`);

  const neo4j = (await import("neo4j-driver")).default;
  const driver = neo4j.driver(graph.uri, neo4j.auth.basic(graph.username, graph.password), {
    connectionTimeout: 10_000,
    disableLosslessIntegers: true,
  });
  const session = driver.session({ database: graph.database, defaultAccessMode: neo4j.session.WRITE });

  const summary = {
    relationsRewritten: 0,
    relationsSkippedUnmapped: 0,
    duplicateGroups: 0,
    duplicateNodesDeleted: 0,
  };

  const { normalizeRelationshipType, isValidRelationshipType } = await import("../knowledge/graph-schema.js");

  try {
    // ------------------------------------------------------------------
    // STEP 1 — rewrite legacy RELATES_TO {type} edges into real typed edges
    // ------------------------------------------------------------------
    const legacyTypes = (
      await session.run(
        `MATCH (:Entity)-[r:RELATES_TO]->(:Entity)
         RETURN DISTINCT coalesce(r.type, 'RELATED_TO') AS t`
      )
    ).records.map((r) => String(r.get("t")));

    console.log(`📋 STEP 1 — found ${legacyTypes.length} legacy RELATES_TO type(s).`);
    for (const rawType of legacyTypes) {
      const mapped = normalizeRelationshipType(rawType);
      if (!mapped) {
        console.error(`  ⚠️ Skipping unmapped legacy type "${rawType}" (no allowlist match).`);
        summary.relationsSkippedUnmapped++;
        continue;
      }
      if (dryRun) {
        console.log(`  ↳ [dry-run] RELATES_TO {type:"${rawType}"} → [:${mapped}]`);
        continue;
      }
      try {
        const res = await session.run(
          `MATCH (a:Entity)-[r:RELATES_TO]->(b:Entity)
           WHERE coalesce(r.type, 'RELATED_TO') = $legacyType
           WITH a, b, r
           // kb-scoped MERGE so identical endpoints from different KBs never
           // collapse onto a single cross-tenant edge.
           MERGE (a)-[nr:${mapped} {kb_key: coalesce(r.kb_key, a.kb_key, '')}]->(b)
           ON CREATE SET
             nr.company = coalesce(r.company, a.company),
             nr.source_title = r.source_title,
             nr.source_url = r.source_url,
             nr.chunk_id = r.chunk_id,
             nr.extracted_by = coalesce(r.extracted_by, 'migration'),
             nr.confidence = coalesce(r.confidence, 0.8),
             nr.created_at = coalesce(r.created_at, datetime())
           SET nr.updated_at = coalesce(nr.updated_at, r.updated_at, datetime())
           DELETE r`,
          { legacyType: rawType },
          { timeout: QUERY_TIMEOUT_MS }
        );
        const rewritten = res.summary?.counters?.relationshipsDeleted ?? 0;
        summary.relationsRewritten += rewritten;
        console.log(`  ✅ RELATES_TO {type:"${rawType}"} → [:${mapped}] (${rewritten} edges)`);
      } catch (err) {
        console.error(`  ⚠️ Failed rewriting "${rawType}" → [:${mapped}]: ${err.message}`);
      }
    }

    // ------------------------------------------------------------------
    // STEP 2 — merge duplicate entities per (kb_key, canonical name)
    // ------------------------------------------------------------------
    // Old MERGE identity was (name, type) without kb_key: the same canonical
    // name can exist several times (different types, case variants, or
    // cross-KB nodes that share a name). Relationships are moved type-by-type
    // onto one survivor because Cypher cannot parameterize a rel type.
    const dupGroups = (
      await session.run(
        `MATCH (e:Entity)
         WHERE e.name IS NOT NULL AND e.kb_key IS NOT NULL
         WITH e.kb_key AS kb, toLower(trim(e.name)) AS canonical, count(e) AS n
         WHERE n > 1
         RETURN kb, canonical, n
         ORDER BY kb, canonical`
      )
    ).records.map((r) => ({ kb: r.get("kb"), canonical: r.get("canonical"), n: Number(r.get("n")) }));

    console.log(`\n📋 STEP 2 — found ${dupGroups.length} duplicate entity group(s).`);
    for (const group of dupGroups.slice(0, MAX_DUPLICATE_GROUPS)) {
      if (dryRun) {
        console.log(`  ↳ [dry-run] ${group.kb} / "${group.canonical}": ${group.n} nodes → 1`);
        summary.duplicateGroups++;
        summary.duplicateNodesDeleted += group.n - 1;
        continue;
      }
      try {
        // Survivor = most recently updated node in the group.
        const keepRow = (
          await session.run(
            `MATCH (keep:Entity)
             WHERE keep.kb_key = $kb AND toLower(trim(keep.name)) = $canonical
             RETURN keep.id AS id
             ORDER BY coalesce(keep.updated_at, keep.created_at, datetime()) DESC
             LIMIT 1`,
            { kb: group.kb, canonical: group.canonical }
          )
        ).records[0];
        if (!keepRow) continue;
        const keepId = String(keepRow.get("id"));

        // Relationship types currently present in the graph (typed rewrite ran
        // above, so RELATES_TO should be gone — if any remain they are moved
        // as RELATED_TO by STEP 1 of the next run).
        const relTypes = (
          await session.run("CALL db.relationshipTypes()")
        ).records.map((r) => String(r.get(0)));

        let movedEdges = 0;
        for (const relType of relTypes) {
          if (!isValidRelationshipType(relType)) continue;
          // Outgoing: dup -[type]-> target  →  keep -[type]-> target
          const out = await session.run(
            `MATCH (dup:Entity)
             WHERE dup.kb_key = $kb AND toLower(trim(dup.name)) = $canonical AND dup.id <> $keepId
             MATCH (dup)-[r:${relType}]->(target:Entity)
             WITH dup, r, target
             MERGE (keep:Entity {id: $keepId})-[nr:${relType} {kb_key: $kb}]->(target)
             ON CREATE SET
               nr.company = coalesce(r.company, dup.company),
               nr.source_title = r.source_title,
               nr.source_url = r.source_url,
               nr.chunk_id = r.chunk_id,
               nr.extracted_by = r.extracted_by,
               nr.confidence = r.confidence,
               nr.created_at = coalesce(r.created_at, datetime())
             DELETE r`,
            { kb: group.kb, canonical: group.canonical, keepId },
            { timeout: QUERY_TIMEOUT_MS }
          );
          movedEdges += out.summary?.counters?.relationshipsDeleted ?? 0;

          // Incoming: source -[type]-> dup  →  source -[type]-> keep
          const inc = await session.run(
            `MATCH (dup:Entity)
             WHERE dup.kb_key = $kb AND toLower(trim(dup.name)) = $canonical AND dup.id <> $keepId
             MATCH (source:Entity)-[r:${relType}]->(dup)
             WITH dup, r, source
             MERGE (source)-[nr:${relType} {kb_key: $kb}]->(keep:Entity {id: $keepId})
             ON CREATE SET
               nr.company = coalesce(r.company, dup.company),
               nr.source_title = r.source_title,
               nr.source_url = r.source_url,
               nr.chunk_id = r.chunk_id,
               nr.extracted_by = r.extracted_by,
               nr.confidence = r.confidence,
               nr.created_at = coalesce(r.created_at, datetime())
             DELETE r`,
            { kb: group.kb, canonical: group.canonical, keepId },
            { timeout: QUERY_TIMEOUT_MS }
          );
          movedEdges += inc.summary?.counters?.relationshipsDeleted ?? 0;
        }

        // Remove the duplicates now that their edges moved (or they had none).
        const del = await session.run(
          `MATCH (dup:Entity)
           WHERE dup.kb_key = $kb AND toLower(trim(dup.name)) = $canonical AND dup.id <> $keepId
           DETACH DELETE dup`,
          { kb: group.kb, canonical: group.canonical, keepId },
          { timeout: QUERY_TIMEOUT_MS }
        );
        const deleted = del.summary?.counters?.nodesDeleted ?? 0;
        if (deleted > 0) {
          summary.duplicateGroups++;
          summary.duplicateNodesDeleted += deleted;
          console.log(`  ✅ ${group.kb} / "${group.canonical}": ${deleted} duplicate(s) merged (${movedEdges} edges moved)`);
        }
      } catch (err) {
        console.error(`  ⚠️ Failed to merge ${group.kb} / "${group.canonical}": ${err.message}`);
      }
    }
  } finally {
    await session.close();
    await driver.close();
  }

  console.log(`\n${dryRun ? "DRY RUN summary (nothing written)" : "Migration summary"}:`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
