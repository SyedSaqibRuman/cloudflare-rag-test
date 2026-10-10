// --------------------------
// OPENAI VECTOR STORE ADAPTER
// Adapts OpenAI's hosted Vector Stores (File Search) API to the dual-mode
// ingestion + query pipeline. Uses raw fetch (no SDK dependency) — consistent
// with the project's lean supply chain policy (ADR-012 §4).
//
// Unlike Pinecone/Qdrant/Weaviate, OpenAI Vector Stores are TEXT-based: there
// are no manually supplied embeddings or admin-named indexes.
//   - upsert()  → uploads chunk text via the Files API + attaches it to the
//                 store (OpenAI embeds internally). Chunk identity/metadata
//                 travel as file `attributes` (16 kv pairs, strings ≤512 chars)
//                 so query results can be mapped back to R2 chunks.
//   - query()   → POST /vector_stores/{id}/search with the raw question text;
//                 the embedded `vector` argument is IGNORED (OpenAI embeds +
//                 reranks server-side, returning 0..1 similarity scores).
//   - matches   → same shape as the other adapters: { id, score, metadata } so
//                 query/kb-retrieval.js needs no special-casing.
//
// Credentials required: apiKey (auth-schema `api_key`); resource config:
// vectorStoreId (vs_… — also accepted from the KB's vector_external_id).
// --------------------------

import { logToFile } from "../../../utils/logger.js";

const API_BASE = "https://api.openai.com/v1";
// OpenAI attributes: keys ≤64 chars, string values ≤512 chars.
const MAX_ATTR_VALUE = 512;

function cleanString(str = "") {
  return str.replace(/\n/g, " ").replace(/\r/g, " ").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
}

/** Chunk metadata → OpenAI file attributes (all values stringified+clamped). */
function buildAttributes(chunk) {
  const attrs = {
    r2_key: cleanString(chunk.r2_key || ""),
    url: cleanString(chunk.url || "").slice(0, MAX_ATTR_VALUE),
    title: cleanString(chunk.title || "").slice(0, 200),
    type: cleanString(chunk.metadata?.type || ""),
    slug: cleanString(chunk.metadata?.slug || ""),
    chunkIndex: String(Number(chunk.metadata?.chunkIndex ?? 0)),
  };
  // Drop empty values (attributes must be non-null; fewer pairs = less clutter)
  return Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== ""));
}

export class OpenAIVectorStoreAdapter {
  constructor(credentials, { embeddingAdapter } = {}) {
    this.providerKey = "openai";
    // Accept snake_case and camelCase (normalizeCredential maps api_key → apiKey).
    this.apiKey = credentials.apiKey || credentials.api_key || "";
    // Resource identity: config.vector_store_id wins, KB's vector_external_id
    // is the fallback (same precedence direction as the other adapters).
    this.vectorStoreId =
      credentials.vectorStoreId || credentials.vector_store_id || credentials.vectorIndexName || "";
    this.maxNumResults = Math.min(Math.max(Number(credentials.maxNumResults) || 10, 1), 50);
    this.companyName = credentials.companyName;
    // Kept for interface parity; OpenAI embeds internally so this is unused.
    this.embeddingAdapter = embeddingAdapter || null;
  }

  _headers(extra = {}) {
    return {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  _requireId() {
    if (!this.vectorStoreId) {
      throw new Error(
        "OpenAI vector store id is not configured — bind a vector_index resource (vs_… id) to the KB."
      );
    }
  }

  _requireKey() {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is missing — set the 'api_key' credential.");
    }
  }

  // ------------------------------------------------------------------
  // 🔹 ensureIndex — verify the vector store exists and is reachable
  // ------------------------------------------------------------------
  async ensureIndex() {
    this._requireId();
    this._requireKey();
    const res = await fetch(`${API_BASE}/vector_stores/${this.vectorStoreId}`, {
      method: "GET",
      headers: this._headers(),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`OpenAI vector store lookup failed (${res.status}): ${msg.slice(0, 200)}`);
    }
    const store = await res.json();
    console.log(`📌 OpenAI: vector store '${store.name || this.vectorStoreId}' ready (${store.file_counts?.completed ?? "?"} file(s))`);
  }

  // ------------------------------------------------------------------
  // 🔹 upsert — upload chunk text as files + attach to the store
  //    (dedupe: one file per chunk id, deterministic names so re-ingestion
  //    replaces content by uploading a new file version — OpenAI files are
  //    immutable, so we delete-then-reupload when the file already exists)
  // ------------------------------------------------------------------
  async upsert(chunks) {
    if (!chunks.length) return;
    this._requireId();
    this._requireKey();

    // Index existing files by display name → id (cheap: list once per run).
    const existing = new Map();
    let after = undefined;
    try {
      while (true) {
        const url = `${API_BASE}/vector_stores/${this.vectorStoreId}/files?limit=100${after ? `&after=${after}` : ""}`;
        const res = await fetch(url, { headers: this._headers() });
        if (!res.ok) break;
        const json = await res.json();
        for (const f of json.data || []) existing.set(f.filename, f.id);
        if (!json.has_more || !json.data?.length) break;
        after = json.data[json.data.length - 1].id;
      }
    } catch {
      /* listing is best-effort — worst case we create duplicate files */
    }

    for (const chunk of chunks) {
      if (!chunk.id) throw new Error("Missing chunk.id");
      try {
        const filename = `kb-chunk-${chunk.id}.txt`;

        // 1. Upload the chunk text as a file (multipart).
        const form = new FormData();
        form.append("file", new Blob([chunk.text], { type: "text/plain" }), filename);
        form.append("purpose", "assistants");
        const uploadRes = await fetch(`${API_BASE}/files`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}` },
          body: form,
        });
        if (!uploadRes.ok) {
          const msg = await uploadRes.text().catch(() => "");
          throw new Error(`OpenAI file upload failed (${uploadRes.status}): ${msg.slice(0, 200)}`);
        }
        const file = await uploadRes.json();

        // 2. Attach it to the vector store WITH attributes (metadata).
        const attachRes = await fetch(
          `${API_BASE}/vector_stores/${this.vectorStoreId}/files`,
          {
            method: "POST",
            headers: this._headers(),
            body: JSON.stringify({
              file_id: file.id,
              attributes: buildAttributes(chunk),
            }),
          }
        );
        if (!attachRes.ok) {
          const msg = await attachRes.text().catch(() => "");
          throw new Error(`OpenAI attach failed (${attachRes.status}): ${msg.slice(0, 200)}`);
        }

        // 3. Replace any previous version of this chunk (files are immutable).
        const oldId = existing.get(filename);
        if (oldId && oldId !== file.id) {
          await fetch(
            `${API_BASE}/vector_stores/${this.vectorStoreId}/files/${oldId}`,
            { method: "DELETE", headers: this._headers() }
          ).catch(() => {});
        }

        logToFile("vector.log", `✅ OpenAI chunk attached: ${filename}`);
      } catch (error) {
        console.error(`❌ OpenAI chunk failed (${chunk.id}):`, error.message);
        logToFile("error.log", `OpenAI upsert error: ${error.message}`);
        throw error;
      }
    }
    console.log(`✅ OpenAI upserted ${chunks.length} chunk(s)`);
  }

  // ------------------------------------------------------------------
  // 🔹 query — text search against the store (vector arg ignored)
  // ------------------------------------------------------------------
  async query(_vector, topK = 10, { queryText = null } = {}) {
    this._requireId();
    this._requireKey();
    const question = typeof queryText === "string" && queryText.trim() ? queryText.trim() : null;
    if (!question) {
      throw new Error(
        "OpenAI vector search needs the question text (queryText) — the embedded vector is not used by this provider."
      );
    }

    const res = await fetch(`${API_BASE}/vector_stores/${this.vectorStoreId}/search`, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify({
        query: question,
        max_num_results: Math.min(Math.max(topK, 1), 50),
      }),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`OpenAI vector search failed (${res.status}): ${msg.slice(0, 200)}`);
    }

    const json = await res.json();

    // Map OpenAI results to the adapter match contract. r2_key lives in the
    // file attributes attached at upsert time; content text is returned
    // inline (used only as a preview fallback when R2 has no chunk).
    return {
      matches: (json.data || []).map((m) => ({
        id: m.file_id,
        score: m.score,
        metadata: {
          r2_key: m.attributes?.r2_key || "",
          title: m.attributes?.title || m.filename || "",
          url: m.attributes?.url || "",
          type: m.attributes?.type || "",
          slug: m.attributes?.slug || "",
          chunkIndex: Number(m.attributes?.chunkIndex ?? 0),
          // Inline content: lets the context builder work even before the
          // R2 chunk is fetched (or if the chunk was deleted server-side).
          preview: (m.content || []).map((c) => c.text || "").join("\n").slice(0, 400),
        },
        values: null,
      })),
    };
  }

  // ------------------------------------------------------------------
  // 🔹 countVectors — best-effort completed-file count
  // ------------------------------------------------------------------
  async countVectors() {
    try {
      this._requireId();
      const res = await fetch(`${API_BASE}/vector_stores/${this.vectorStoreId}`, {
        headers: this._headers(),
      });
      if (!res.ok) return null;
      const store = await res.json();
      return store.file_counts?.completed ?? null;
    } catch {
      return null;
    }
  }
}
