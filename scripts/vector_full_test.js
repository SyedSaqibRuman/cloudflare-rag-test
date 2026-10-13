// vector_full_test.js
// Run: node vector_full_test.js

import "dotenv/config";

// 🔥 IMPORTANT: use Cloudflare embeddings ONLY
import { generateEmbeddings } from "../services/cloudflare_embeddings.js";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const VECTOR_INDEX = process.env.VECTOR_INDEX;

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${VECTOR_INDEX}`;

const HEADERS_JSON = {
  Authorization: `Bearer ${API_TOKEN}`,
  "Content-Type": "application/json",
};

const HEADERS_NDJSON = {
  Authorization: `Bearer ${API_TOKEN}`,
  "Content-Type": "application/x-ndjson",
};

// --------------------------
// 🔹 Test data
// --------------------------
const TEST_TEXT = "Halal certification process in India requires documentation and audit.";
const VECTOR_ID = "test-vector-" + Date.now();

// --------------------------
// 🔹 Step 1: Generate embedding
// --------------------------
async function createEmbedding([text]) {
  console.log("🧠 Generating embedding...");

  const embeddings = await generateEmbeddings([text]);

  if (!embeddings?.[0]) {
    throw new Error("❌ Embedding failed");
  }

  console.log("✅ Embedding generated");
  return embeddings[0];
}

// --------------------------
// 🔹 Step 2: Upsert vector
// --------------------------
async function upsertVector(vector) {
  console.log("\n📤 Upserting vector...");

  const payload = {
    id: VECTOR_ID,
    values: vector,
    metadata: {
      r2_key: "test/chunk.json",
      url: "https://example.com/halal-certification",
      title: "Halal Certification Process",
      preview: TEST_TEXT.slice(0, 100),
      type: "test",
      slug: "halal-certification",
      chunkIndex: 0,
    },
  };

  const ndjson = JSON.stringify(payload)+"\n";

  const res = await fetch(`${BASE_URL}/upsert`, {
    method: "POST",
    headers: HEADERS_NDJSON,
    body: ndjson,
  });

  const raw = await res.text();
  console.log("📥 Upsert response:", raw);

  if (!res.ok) {
    throw new Error("❌ Upsert failed");
  }

  console.log("✅ Vector upserted");
}

// --------------------------
// 🔹 Step 3: Wait for propagation
// --------------------------
async function wait(ms = 15000) {
  console.log(`\n⏳ Waiting ${ms / 1000}s for propagation...`);
  return new Promise(r => setTimeout(r, ms));
}

// --------------------------
// 🔹 Step 4: Query vector
// --------------------------
async function queryVector(vector) {
  console.log("\n🔎 Querying vector DB...");

  const res = await fetch(`${BASE_URL}/query`, {
    method: "POST",
    headers: HEADERS_JSON,
    body: JSON.stringify({
      vector,
      top_k: 1,
      returnMetadata: "all",
      returnValues: true,
    }),
  });

  const raw = await res.text();
  console.log("📥 Query raw response:", raw);

  if (!res.ok) {
    throw new Error("❌ Query failed");
  }

  const json = JSON.parse(raw);
  const match = json?.result?.matches?.[0];

  if (!match) {
    console.log("❌ No match found");
    return;
  }

  console.log("\n✅ Match found:");
  console.log("ID:", match.id);
  console.log("Score:", match.score);
  console.log("Metadata:", JSON.stringify(match.metadata, null, 2));

  // --------------------------
  // 🔥 FINAL CHECK
  // --------------------------
  if (!match.metadata) {
    console.log("\n❌ METADATA IS NULL → ISSUE IN PIPELINE");
  } else {
    console.log("\n🎉 SUCCESS → Metadata is stored and returned correctly!");
  }
}

// --------------------------
// 🔹 Run test
// --------------------------
(async () => {
  try {
    const embedding = await createEmbedding([TEST_TEXT]);
    await upsertVector(embedding);
    await wait(15000);
    await queryVector(embedding);
  } catch (err) {
    console.error("❌ Test failed:", err.message);
  }
})();
