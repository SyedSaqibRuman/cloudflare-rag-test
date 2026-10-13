// --------------------------
// GRAPH CONFIG RESOLUTION — the company's Neo4j connection from the RAG
// config store. Lives here (not in query/graph.js or knowledge/) so both the
// query-time GraphRAG path and the knowledge layer can import it without a
// module cycle.
// --------------------------
import { getCompanyConfig } from "./index.js";

/**
 * The company's Neo4j connection from the RAG config store, or null when the
 * graph isn't configured (no URI/username/password). Database name is
 * optional — Aura defaults to 'neo4j'. `database` overrides the stored
 * NEO4J_DATABASE (used when a selected assistant points at a specific graph
 * resource).
 */
export function getGraphConfig(companyName, database = null) {
  const config = getCompanyConfig(companyName);
  if (!config) return null;
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE } = config;
  if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) return null;
  return {
    uri: NEO4J_URI,
    username: NEO4J_USERNAME,
    password: NEO4J_PASSWORD,
    database: database || NEO4J_DATABASE || "neo4j",
  };
}

/** True when the company has a usable Neo4j connection in its config store. */
export function graphEnabled(companyName) {
  return getGraphConfig(companyName) !== null;
}
