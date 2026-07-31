// test_upsert.js
// Run: node test_upsert.js
import "dotenv/config";
import { getVectorByID } from "./services/vectorize.js";
import { getCFClient } from "./client.js";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const VECTOR_INDEX = process.env.VECTOR_INDEX;

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${VECTOR_INDEX}`;
const HEADERS = {
  Authorization: `Bearer ${API_TOKEN}`,
  "Content-Type": "application/json",
};


const client = getCFClient();

// --------------------------
// 1. Upsert a single test vector WITH metadata
// --------------------------
async function upsertTest() {
  console.log("📤 Upserting test vector with metadata...\n");

  const vector = {
    id: "debug-test-vector-001",
    values: Array(768).fill(0.05),
    metadata: {
      r2_key: "test/chunk-0.json",
      url: "https://example.com/test",
      title: "Debug Test Title",
      preview: "This is a debug test preview",
      type: "page",
      slug: "debug-test",
      chunkIndex: 0,
    },
  };

  const ndjson = JSON.stringify(vector);
  console.log("NDJSON payload:\n", ndjson, "\n");

  const res = await fetch(`${BASE_URL}/upsert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/x-ndjson",
    },
    body: ndjson,
  });

  const raw = await res.text();
  console.log("📥 Upsert raw response:", raw);

  let json;
  try {
    json = JSON.parse(raw);
    console.log("📥 Upsert parsed response:", JSON.stringify(json, null, 2));
  } catch {
    console.log("⚠️ Could not parse upsert response as JSON");
  }

  return res.ok;
}

async function upsertVectorTest() {
  console.log("📤 Upserting test vector with metadata...\n");
  const vector = {
    id: "debug-test-vector-001",
    values: Array(768).fill(0.05),
    metadata: {
      r2_key: "test/chunk-0.json",
      url: "https://example.com/test",
      title: "Debug Test Title",
      preview: "This is a debug test preview",
      type: "page",
      slug: "debug-test",
      chunkIndex: 0,
    },
  };

  const ndjson = JSON.stringify(vector);
  console.log("NDJSON payload:\n", ndjson, "\n");

  const res = await client.vectorize.indexes.upsert(
    VECTOR_INDEX,
    {
      account_id: ACCOUNT_ID,
      "unparsable-behavior": "error",
      body: ndjson,
    }
  );

  const raw = res;
  console.log("📥 Upsert raw response:", raw);

  let json;
  try {
    json = JSON.parse(raw);
    console.log("📥 Upsert parsed response:", JSON.stringify(json, null, 2));
  } catch {
    console.log("⚠️ Could not parse upsert response as JSON");
  }

  return res;
}

// --------------------------
// 2. Wait for propagation
// --------------------------
async function wait(ms) {
  console.log(`\n⏳ Waiting ${ms / 1000}s for index propagation...`);
  return new Promise(r => setTimeout(r, ms));
}

// --------------------------
// 3. Query back and check metadata
// --------------------------
async function queryTest() {
  console.log("\n🔎 Querying for test vector...");

  const res = await client.vectorize.indexes.query(VECTOR_INDEX, {
    account_id: ACCOUNT_ID,
    vector: Array(768).fill(0.05),
    returnMetadata: "all",
    topK: 1,
    returnValues: true
  }).catch((e) => {

  });

  // const res = await fetch(`${BASE_URL}/query`, {
  //   method: "POST",
  //   headers: HEADERS,
  //   body: JSON.stringify({
  //     vector: Array(768).fill(0.05),
  //     top_k: 1,
  //     returnMetadata: "all",
  //     returnValues: true,
  //   }),
  // });

  const raw = res;
  console.log("📥 Query raw response:", raw);

  try {
    // const json = JSON.parse(raw);
    const match = raw?.matches?.[0];
    if (!match) {
      console.log("❌ No matches returned");
      return;
    }
    console.log("\n✅ Match found:");
    console.log("  ID:", match.id);
    console.log("  Score:", match.score);
    console.log("  Metadata:", JSON.stringify(match.metadata, null, 2));

    if (!match.metadata) {
      console.log("\n❌ METADATA IS NULL — Cloudflare is not storing it");
    } else {
      console.log("\n✅ METADATA IS PRESENT — pipeline is working!");
    }
  } catch {
    console.log("⚠️ Could not parse query response as JSON");
  }
}

// --------------------------
// 4. get-by-ids (returns NDJSON)
// --------------------------
async function getById() {
  console.log("\n🔍 Fetching vector by ID (get-by-ids)...");

  const url = `${BASE_URL}/vectors/get-by-ids`;

  const res = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      ids: ["debug-test-vector-001"]
    }),
  });

  console.log("Status:", res.status);

  const raw = await res.text();
  console.log("📥 get-by-ids raw response:\n", raw);

  const lines = raw.trim().split("\n").filter(Boolean);

  lines.forEach((line, i) => {
    try {
      const parsed = JSON.parse(line);
      console.log(`\n[Line ${i + 1}]:`, JSON.stringify(parsed, null, 2));
    } catch {
      console.log(`[Line ${i + 1}] (unparseable):`, line);
    }
  });
}

// --------------------------
// Run all steps
// --------------------------
// const ok = await upsertVectorTest();
// if (ok) {
//   await wait(15000); // wait 15s for propagation
//   await queryTest();
//   // await getById();
// } else {
//   console.log("❌ Upsert failed, skipping query test");
// }

// console.log(await getVectorByID(["debug-test-vector-001"]));
console.log(await queryTest());
