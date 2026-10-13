// --------------------------
// VECTOR ID NORMALIZER
// The pipeline's makeVectorId (ingest/pipeline.js) emits `<48-hex>-<n>` —
// accepted by Cloudflare Vectorize and Pinecone (<=40 chars? NO — 48+ chars)
// and REJECTED by Qdrant (ids must be unsigned ints or UUIDs) and Weaviate
// (ids must be UUIDs). Pinecone tolerates the length but caps ids at 40 chars
// in some API versions.
//
// normalizeVectorId derives a spec-compliant id deterministically from the
// pipeline id: same input → same output, so re-ingestion overwrites the same
// point/object instead of duplicating it (the upsert semantics both the
// ingestion registry and Vectorize rely on).
// --------------------------

import { createHash } from "node:crypto";

/** RFC-4122-shaped v5-style UUID from any string (deterministic). */
export function uuidFromString(input) {
  const hash = createHash("sha1").update(String(input)).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    // version 5 nibble + preserved low bits
    `5${hash.slice(13, 16)}`,
    // variant bits (8/9/a/b) + preserved low bits
    ((parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join("-");
}

/** Deterministic unsigned-int id in Qdrant's u64 range (up to 2^63-1). */
export function uintFromString(input) {
  const hash = createHash("sha256").update(String(input)).digest();
  // Use 63 bits (sign-safe for JSON number round-trips) of the hash.
  const big = BigInt(`0x${hash.slice(0, 8).toString("hex")}`) & 0x7fffffffffffffffn;
  return Number(big);
}

/**
 * Normalize a pipeline chunk id for the given provider.
 * - qdrant:   unsigned int (u64-safe)
 * - weaviate: UUID
 * - anything else: unchanged (Vectorize / Pinecone accept the raw id)
 */
export function normalizeVectorId(rawId, providerKey) {
  if (!rawId) return rawId;
  if (providerKey === "qdrant") return uintFromString(rawId);
  if (providerKey === "weaviate") return uuidFromString(rawId);
  return rawId;
}
