// inspect_vectors.js
// Usage: node inspect_vectors.js
import "dotenv/config";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const VECTOR_INDEX = process.env.VECTOR_INDEX;

// --------------------------
// 🔹 Fetch vectors by IDs
// --------------------------
async function getVectorsByIds(ids) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${VECTOR_INDEX}/get-by-ids`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids }),
    }
  );

  const json = await res.json();
  return json;
}

// --------------------------
// 🔹 Query and inspect top matches
// --------------------------
async function inspectIndex() {
  console.log("🔎 Querying index with dummy vector...\n");

  // Use a zero vector just to get some results back
  const dummyVector = Array(768).fill(0.01);

  const queryRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${VECTOR_INDEX}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        vector: dummyVector,
        top_k: 5,
        return_metadata: "all",
        return_values: false,
      }),
    }
  );

  const queryJson = await queryRes.json();
  const matches = queryJson?.result?.matches ?? [];

  console.log(`📊 Total matches returned: ${matches.length}`);
  console.log("━".repeat(60));

  if (!matches.length) {
    console.log("❌ No vectors found in index.");
    return;
  }

  matches.forEach((m, i) => {
    console.log(`\n[${i + 1}] ID: ${m.id}`);
    console.log(`    Score: ${m.score}`);
    console.log(`    Metadata: ${JSON.stringify(m.metadata, null, 2) ?? "❌ NONE"}`);
  });

  // --------------------------
  // 🔹 Fetch full vector details by ID
  // --------------------------
  console.log("\n━".repeat(60));
  console.log("🔍 Fetching vectors by ID to check stored metadata...\n");

  const ids = matches.map(m => m.id);
  const byId = await getVectorsByIds(ids);

  console.log("📥 get-by-ids response:");
  console.log(JSON.stringify(byId?.result, null, 2));
}

inspectIndex().catch(err => {
  console.error("❌ Error:", err.message);
});
