// --------------------------
// QDRANT VECTOR ADAPTER
// Adapts Qdrant's REST API for the dual-mode ingestion + query pipeline.
// Uses raw fetch (no SDK dependency) — consistent with the project's lean
// supply chain policy (ADR-012 §4).
//
// Credentials required: apiKey (optional), host (e.g. "https://xyz.cloud.qdrant.io:6333")
// Qdrant collection name is passed as vectorIndexName.
// --------------------------

import { chunkArray } from "../../../utils/helpers.js";
import { logToFile } from "../../../utils/logger.js";
import { normalizeVectorId } from "./vector-ids.js";
import { embedBatchWithFallback } from "../embed-fallback.js";

function cleanString(str = "") {
  return str.replace(/\n/g, " ").replace(/\r/g, " ").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
}

/** Provider error text for a failed REST call (Qdrant: { status: { error } }). */
async function errorText(res) {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text);
    return body?.status?.error || body?.message || text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

export class QdrantAdapter {
  constructor(credentials, { embeddingAdapter } = {}) {
    this.providerKey = "qdrant";
    // api_key (auth-schema field) → apiKey (camelCase, per adapter convention);
    // normalizeCredential in ingest/resolve.js does this too — both accepted.
    this.host = credentials.host || "http://localhost:6333";
    this.apiKey = credentials.apiKey || credentials.api_key || "";
    this.collectionName = credentials.vectorIndexName || "";
    this.embeddingAdapter = embeddingAdapter || null;
    this.companyName = credentials.companyName;
    // Optional EmbedFallbackStats collector — set by ingestion so KB-bound
    // embedding failures are visible on the KB detail page (not just logs).
    this.embedStats = credentials.embedStats || null;
    this.dimensions = credentials.dimensions || 768;
    // Distance metric for collection creation (ensureIndex). The resource
    // template's `distance` config flows through credentials; default Cosine.
    this.distance = credentials.distance || "Cosine";
    // Optional vector name for NAMED-vector collections. Qdrant collections
    // created externally (Dashboards, other tools) often define a named vector
    // (e.g. "abstract-dense-vector"); upserts/searches with an unnamed vector
    // then fail — or worse, get accepted async and silently dropped. Probed in
    // ensureIndex; credential config `vector_name` forces it.
    this.vectorName = credentials.vector_name || null;
  }

  _headers() {
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers["api-key"] = this.apiKey;
    }
    return headers;
  }

  // ------------------------------------------------------------------
  // 🔹 ensureIndex — create collection if it doesn't exist
  // ------------------------------------------------------------------
  async ensureIndex() {
    try {
      // Check if collection exists
      const res = await fetch(`${this.host}/collections/${this.collectionName}`, {
        method: "GET",
        headers: this._headers(),
      });

      if (res.ok) {
        // Collection already exists — probe its vectors config. A named-vector
        // schema requires every upsert/search to address that vector name;
        // syncing here keeps upsert/query correct without a re-ingest.
        try {
          const info = await res.clone().json();
          this._syncVectorSchema(info?.result?.config?.params?.vectors);
        } catch { /* schema probe is best-effort */ }
        console.log(`📌 Qdrant: collection '${this.collectionName}' already exists${this.vectorName ? ` (named vector '${this.vectorName}')` : ""}`);
        return;
      }

      // Create collection
      const createRes = await fetch(`${this.host}/collections/${this.collectionName}`, {
        method: "PUT",
        headers: this._headers(),
        body: JSON.stringify({
          vectors: {
            size: this.dimensions,
            distance: this.distance,
          },
        }),
      });

      if (!createRes.ok) {
        const msg = await createRes.text().catch(() => "");
        throw new Error(`Qdrant create collection failed (${createRes.status}): ${msg.slice(0, 200)}`);
      }

      // The create call returned 200 — adopt the schema we just created
      // (unnamed unless the resource config supplied vector_name).
      this.vectorName = this.vectorName || null;
      console.log(`✅ Qdrant: created collection '${this.collectionName}' with ${this.dimensions} dimensions`);
    } catch (error) {
      console.error(`❌ Qdrant ensureIndex failed:`, error.message);
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // 🔹 listIndexes — live collection list for the portal's vector card
  // GET /collections returns names only, so each collection is described
  // individually for dimensions/metric/count. Best-effort per collection: an
  // unreadable one still appears with null stats instead of failing the list.
  // @returns {Promise<Array<{ id, name, dimensions, metric, vectorCount, createdAt }>>}
  // ------------------------------------------------------------------
  async listIndexes() {
    const res = await fetch(`${this.host}/collections`, { headers: this._headers() });
    if (!res.ok) throw new Error(`Qdrant list collections failed (${res.status}): ${await errorText(res)}`);
    const json = await res.json().catch(() => null);
    const collections = json?.result?.collections || [];

    return Promise.all(
      collections.map(async (c) => {
        const name = c?.name;
        const row = { id: name, name, dimensions: null, metric: null, vectorCount: null, createdAt: null };
        try {
          const detail = await fetch(`${this.host}/collections/${encodeURIComponent(name)}`, {
            headers: this._headers(),
          });
          if (!detail.ok) return row;
          const info = (await detail.json())?.result || {};
          const vectors = info.config?.params?.vectors;
          // Unnamed configs are `{ size, distance }`; named-vector configs are
          // `{ <name>: { size, distance } }` — take the first entry either way.
          const first = vectors?.size ? vectors : Object.values(vectors || {})[0];
          row.dimensions = first?.size ?? null;
          row.metric = first?.distance ?? null;
          row.vectorCount = info.points_count ?? null;
        } catch { /* stats are best-effort */ }
        return row;
      })
    );
  }

  // ------------------------------------------------------------------
  // 🔹 createIndex — create a collection (live portal card; the ingestion
  // path's ensureIndex covers KB-driven auto-creation).
  // @param {{ name, dimensions?, distance? }} input
  // ------------------------------------------------------------------
  async createIndex({ name, dimensions, distance } = {}) {
    if (!name) throw new Error("Qdrant collection name is required.");
    const size = Number(dimensions) || this.dimensions || 768;
    const metric = distance || this.distance;
    const res = await fetch(`${this.host}/collections/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: this._headers(),
      body: JSON.stringify({ vectors: { size, distance: metric } }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.status === "error") {
      throw new Error(`Qdrant create collection failed (${res.status}): ${await errorText(res)}`);
    }
    return { id: name, name, dimensions: size, metric, vectorCount: 0, createdAt: null };
  }

  // ------------------------------------------------------------------
  // 🔹 deleteIndex — drop a collection and everything in it
  // ------------------------------------------------------------------
  async deleteIndex(name) {
    if (!name) throw new Error("Qdrant collection name is required.");
    const res = await fetch(`${this.host}/collections/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: this._headers(),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.status === "error") {
      throw new Error(`Qdrant delete collection failed (${res.status}): ${await errorText(res)}`);
    }
    return true;
  }

  /**
   * Adopt a collection's vectors config. Three shapes arrive here:
   *   - number                     → unnamed vectors, that size
   *   - { size, distance, … }      → unnamed vectors (single-vector params object:
   *                                  `size`/`distance` are CONFIG keys, not vector names)
   *   - { <name>: { size, … }, … } → NAMED vectors (values are per-vector config objects)
   * Misreading shape 2 as named is fatal: upserts would address vector name
   * "size" and Qdrant 400s every batch ("Not existing vector name error: size").
   * A params object is told apart from a named map by its values: config
   * entries are scalars/objects-with-`size`, never scalars at the top level…
   * the reliable discriminator is the `size` key itself — real Qdrant vector
   * names can be anything, but an unnamed params object ALWAYS has `size`.
   * @param {Object|null|number} vectorsParam  collection config `params.vectors`
   */
  _syncVectorSchema(vectorsParam) {
    if (typeof vectorsParam === "number") {
      this.dimensions = vectorsParam;
      return;
    }
    if (!vectorsParam || typeof vectorsParam !== "object" || Array.isArray(vectorsParam)) {
      return; // null/undefined → unnamed default, nothing to learn
    }
    if ("size" in vectorsParam) {
      // Shape 2: unnamed single-vector params object
      const size = Number(vectorsParam.size);
      if (size) this.dimensions = size;
      return;
    }
    // Shape 3: named vectors — first name wins as the working vector
    const names = Object.keys(vectorsParam).filter(
      (n) => vectorsParam[n] && typeof vectorsParam[n] === "object"
    );
    if (names.length) {
      this.vectorName = this.vectorName || names[0];
      const size = Number(vectorsParam[names[0]]?.size);
      if (size) this.dimensions = size;
    }
  }

  /** Wrap a raw vector for upsert/search per the probed schema. */
  _wrapVector(vector) {
    return this.vectorName ? { [this.vectorName]: vector } : vector;
  }

  /**
   * Probe the live collection schema (used by query path which never runs
   * ensureIndex). Best-effort: leaves state unchanged on failure.
   */
  async _probeSchema() {
    if (this.vectorName) return;
    try {
      const res = await fetch(`${this.host}/collections/${this.collectionName}`, {
        method: "GET",
        headers: this._headers(),
      });
      if (!res.ok) return;
      const json = await res.json();
      this._syncVectorSchema(json?.result?.config?.params?.vectors);
    } catch { /* best-effort */ }
  }

  // ------------------------------------------------------------------
  // 🔹 upsert — embed + upsert batches
  // ------------------------------------------------------------------
  async upsert(chunks) {
    if (!chunks.length) return;
    if (!this.collectionName) {
      throw new Error(
        "Qdrant collection is not configured — bind a vector index resource to the KB."
      );
    }

    const batches = chunkArray(chunks, 100);

    for (const batch of batches) {
      try {
        logToFile("vector.log", `➡️ Qdrant batch of ${batch.length}`);

        // Generate embeddings
        const texts = batch.map((c) => c.text);
        // KB adapter → CF fallback on failure (shared contract with the query
        // path — query/kb-retrieval.js embedQuestion).
        const embeddings = await embedBatchWithFallback(this.embeddingAdapter, texts, this.companyName,
          { stats: this.embedStats });

        if (!embeddings || embeddings.length !== batch.length) {
          throw new Error("Embedding mismatch");
        }

        // Build Qdrant points — ids must be unsigned ints or UUIDs, so the
        // pipeline's `<48hex>-<n>` id is hashed into a deterministic u64
        // (same id → same point on re-ingestion).
        const points = batch.map((chunk, i) => {
          if (!chunk.id) throw new Error("Missing chunk.id");
          return {
            id: normalizeVectorId(chunk.id, "qdrant"),
            vector: this._wrapVector(embeddings[i]),
            payload: {
              r2_key: cleanString(chunk.r2_key || ""),
              url: cleanString(chunk.url || ""),
              title: cleanString(chunk.title || "").slice(0, 200),
              preview: cleanString(chunk.text).slice(0, 200),
              type: cleanString(chunk.metadata?.type || ""),
              slug: cleanString(chunk.metadata?.slug || ""),
              chunkIndex: Number(chunk.metadata?.chunkIndex ?? i),
            },
          };
        });

        // Upsert via REST API (?wait=true makes failures synchronous — the
        // default 202-accept can silently drop points that violate the schema)
        const url = `${this.host}/collections/${this.collectionName}/points?wait=true`;
        const body = { points };

        const res = await fetch(url, {
          method: "PUT",
          headers: this._headers(),
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          throw new Error(`Qdrant upsert failed (${res.status}): ${msg.slice(0, 200)}`);
        }
        // 200 but failed operation → named-vector mismatch style errors surface here
        const opJson = await res.json().catch(() => null);
        if (opJson?.status !== "ok") {
          throw new Error(`Qdrant upsert not applied: ${JSON.stringify(opJson).slice(0, 200)}`);
        }

        console.log(`✅ Qdrant upserted batch (${batch.length})`);
        logToFile("vector.log", `✅ Qdrant batch success (${batch.length})`);
      } catch (error) {
        console.error("❌ Qdrant batch failed:", error.message);
        logToFile("error.log", `Qdrant upsert error: ${error.message}`);
        throw error;
      }
    }
  }

  // ------------------------------------------------------------------
  // 🔹 query — search by vector
  // ------------------------------------------------------------------
  async query(vector, topK = 10, { indexName = null } = {}) {
    const collection = indexName || this.collectionName;
    if (!collection) throw new Error("Qdrant collection name is not configured.");

    // Query path never runs ensureIndex — probe so named-vector collections
    // are addressed correctly on the first search.
    if (collection === this.collectionName) {
      await this._probeSchema();
    }

    const url = `${this.host}/collections/${collection}/points/search`;

    const body = {
      vector: this._wrapVector(vector),
      limit: topK,
      with_payload: true,
      with_vector: false,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`Qdrant query failed (${res.status}): ${msg.slice(0, 200)}`);
    }

    const json = await res.json();

    return {
      matches: (json.result || []).map((m) => ({
        id: m.id,
        score: m.score,
        metadata: m.payload || {},
        values: null,
      })),
    };
  }

  // ------------------------------------------------------------------
  // 🔹 countVectors — best-effort vector count
  // ------------------------------------------------------------------
  async countVectors() {
    try {
      const url = `${this.host}/collections/${this.collectionName}`;
      const res = await fetch(url, {
        method: "GET",
        headers: this._headers(),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json?.result?.points_count ?? null;
    } catch {
      return null;
    }
  }
}
