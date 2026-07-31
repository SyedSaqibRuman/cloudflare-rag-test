import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "../client.js";
import { env } from "../env.js";
import { generateEmbeddings } from "../services/cloudflare_embeddings.js";
import { vectorQuery } from "../services/vectorize.js";
import { getConfig } from "../config/index.js";
import { rerankMatches } from "./reranker.js";
import { buildContext } from "./context.js";
import { keywordScore, hybridScore, dedupeMatches } from "./scoring.js";

// --------------------------
// CONFIGURATION
// --------------------------
const VECTOR_LIMIT = 10;
const FINAL_TOP_K = 5;
const SCORE_THRESHOLD = 0.75;
const ABSOLUTE_MIN_SCORE = 0.5;

// --------------------------
// CLIENTS
// --------------------------
const r2 = getS3Client();

// --------------------------
// STREAM UTILS
// --------------------------
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream)
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

// --------------------------
// R2 CHUNK FETCHER
// --------------------------
async function getChunk(key, companyName) {
  if (!key) return null;
  const bucket = getConfig(companyName).R2_BUCKET_NAME;
  if (!bucket) return null;
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key.trim() }));
    if (!res.Body) return null;
    return JSON.parse(await streamToString(res.Body));
  } catch (err) {
    if (env.NODE_ENV !== "production") console.error(`❌ Chunk fetch error (${key}):`, err.message);
    return null;
  }
}

// --------------------------
// RAG CONTEXT RETRIEVAL
// --------------------------
export async function retrieveContext(question, companyName) {
  const embeddings = await generateEmbeddings([question], companyName);
  if (!embeddings?.[0]) return { context: null, matches: [] };

  const res = await vectorQuery(embeddings[0], VECTOR_LIMIT, companyName);
  let matches = res?.matches || [];
  if (!matches.length) return { context: null, matches: [] };

  matches.sort((a, b) => b.score - a.score);
  const topScore = matches[0].score || 0;

  matches = matches.filter(
    (m) => (m.score || 0) >= topScore * SCORE_THRESHOLD && (m.score || 0) >= ABSOLUTE_MIN_SCORE
  );
  if (!matches.length) return { context: null, matches: [] };

  matches = matches.map((m) => ({ ...m, hybrid: hybridScore(m, question) }));
  matches.sort((a, b) => b.hybrid - a.hybrid);
  matches = dedupeMatches(matches);
  matches = await rerankMatches(matches.slice(0, 10), question, companyName);
  matches = matches.slice(0, FINAL_TOP_K);

  const chunks = await Promise.all(matches.map((m) => getChunk(m.metadata?.r2_key, companyName)));
  return { context: buildContext(chunks), matches };
}
