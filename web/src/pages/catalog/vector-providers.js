// --------------------------
// CATALOG — vector-store provider metadata (Qdrant / Pinecone / Weaviate).
// Pure JS (no JSX) so node --test can import it directly — the live
// VectorResourcesCard reads its labels/columns/create fields from here, and
// detail.jsx uses managesVectorResources() for gating.
//
// Kept in sync with the server: VECTOR_RESOURCE_NAME_RES in shared/patterns.js
// (name validation) and PROVIDER_META in mysql/routes/vector-resources.js.
// Relative (NOT the #shared alias): this module is imported by
// __tests__/vector-providers.test.js under bare `node --test`, which cannot
// resolve Vite aliases (same reason as utils.js/constants.js).
// --------------------------
import { VECTOR_RESOURCE_NAME_RES } from "../../../../shared/patterns.js";

export const VECTOR_PROVIDER_META = {
  pinecone: {
    label: "Pinecone Indexes",
    singular: "Pinecone index",
    createLabel: "Create Index",
    namePlaceholder: "acme-embeddings",
    nameHint: "Lowercase letters, digits and hyphens (1–45 chars, must start and end alphanumeric).",
    empty: "No indexes on the connected Pinecone project.",
    columns: [
      ["dimensions", "Dimensions"],
      ["metric", "Metric"],
      ["status", "Status"],
    ],
    configFields: [
      { key: "dimensions", label: "Dimensions", type: "number", placeholder: "768", defaultValue: "768" },
      { key: "metric", label: "Metric", type: "select", options: ["cosine", "euclidean", "dotproduct"], defaultValue: "cosine" },
      { key: "cloud", label: "Cloud", type: "select", options: ["aws", "gcp", "azure"], defaultValue: "aws" },
      {
        key: "region",
        label: "Region",
        type: "select",
        options: ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1"],
        defaultValue: "us-east-1",
      },
    ],
  },
  qdrant: {
    label: "Qdrant Collections",
    singular: "Qdrant collection",
    createLabel: "Create Collection",
    namePlaceholder: "acme-embeddings",
    nameHint: "Letters, digits, underscores, hyphens and dots (2–63 chars).",
    empty: "No collections on the connected Qdrant cluster.",
    columns: [
      ["dimensions", "Dimensions"],
      ["metric", "Distance"],
      ["vectorCount", "Vectors"],
    ],
    configFields: [
      { key: "dimensions", label: "Dimensions", type: "number", placeholder: "768", defaultValue: "768" },
      { key: "distance", label: "Distance", type: "select", options: ["Cosine", "Euclid", "Dot"], defaultValue: "Cosine" },
    ],
  },
  weaviate: {
    label: "Weaviate Classes",
    singular: "Weaviate class",
    createLabel: "Create Class",
    namePlaceholder: "AcmeKbVectors",
    nameHint: "Must start with an uppercase letter; letters, digits and underscores only.",
    empty: "No classes on the connected Weaviate cluster.",
    columns: [["vectorizer", "Vectorizer"]],
    configFields: [{ key: "vectorizer", label: "Vectorizer", type: "select", options: ["none"], defaultValue: "none" }],
  },
};

/**
 * Vector providers whose stores can be created/deleted live from the portal —
 * mirrors VECTOR_PROVIDERS in mysql/routes/vector-resources.js.
 */
export const LIVE_VECTOR_PROVIDERS = Object.keys(VECTOR_PROVIDER_META);

export function managesVectorResources(providerKey) {
  return LIVE_VECTOR_PROVIDERS.includes(String(providerKey || ""));
}

/** Client-side name validation — same regexes the server enforces. */
export function vectorNameError(providerKey, name) {
  if (!name) return undefined;
  const re = VECTOR_RESOURCE_NAME_RES[providerKey];
  return re && !re.test(name) ? VECTOR_PROVIDER_META[providerKey].nameHint : undefined;
}