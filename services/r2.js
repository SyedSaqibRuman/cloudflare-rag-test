import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

import { logToFile } from "../utils/logger.js";
import { getCFClient, getS3Client } from "../client.js";
import { resolveCreds } from "../config/index.js";
import { getConfig } from "../config/index.js";

/** Read R2_BUCKET_NAME from runtime config (hot-swappable). Falls back to env. */
export function getR2Bucket(companyName) {
  return getConfig(companyName).R2_BUCKET_NAME;
}

const accountId = (companyName) => resolveCreds(companyName).CLOUDFLARE_ACCOUNT_ID;

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream)
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

// 🔹 Bucket ops use the company's creds when provided, else env-level fallback

/**
 * Read a JSON object from the company's R2 bucket and parse it.
 * Returns null when the key is missing, the object is absent, or the body
 * cannot be parsed — callers treat null as "no chunk".
 */
export async function getChunk(key, companyName) {
  if (!key) return null;
  const bucket = getR2Bucket(companyName);
  if (!bucket) return null;
  try {
    const res = await getS3Client(companyName).send(
      new GetObjectCommand({ Bucket: bucket, Key: key.trim() })
    );
    if (!res.Body) return null;
    return JSON.parse(await streamToString(res.Body));
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.error(`❌ Chunk fetch error (${key}):`, error.message);
    return null;
  }
}


export async function uploadObject(key, data, companyName) {
  try {
    // --------------------------
    // 🔹 Check if object exists
    // --------------------------
    try {
      await getS3Client(companyName).send(
        new HeadObjectCommand({
          Bucket: getR2Bucket(companyName),
          Key: key,
        })
      );

      // If no error → object exists
      console.log(`⏭️ Skipping (already exists): ${key}`);
      logToFile("skipped.log", `Skipping R2 (already exists): ${key}`);
      return false;

    } catch (error) {
      // If NotFound → safe to upload
      if (error?.$metadata?.httpStatusCode !== 404) {
        logToFile("error.log", `Upload error: ${error}`);
        throw error; // real error
      }
    }

    // --------------------------
    // 🔹 Upload if NOT exists
    // --------------------------
    const command = new PutObjectCommand({
      Bucket: getR2Bucket(companyName),
      Key: key,
      Body: JSON.stringify(data),
      ContentType: "application/json",
    });

    await getS3Client(companyName).send(command);
    logToFile("r2-uploads.log", `Upload: ${key}`);

    console.log(`✅ Uploaded: ${key}`);
    return true;

  } catch (error) {
    logToFile("error.log", `Upload error: ${error}`);
    console.error("Upload error:", error);
    throw error; // re-throw so retry() wrapper can handle it
  }
}


export async function listBuckets(companyName) {
  try {
    const res = await getCFClient(companyName).r2.buckets.list({ account_id: accountId(companyName) });
    return res?.buckets || [];
  } catch (error) {
    logToFile("error.log", `Error listing buckets: ${error}`);
    console.error("Error listing buckets:", error);
    return [];
  }
}


export async function findBucket(name, companyName) {
  try {
    const buckets = await listBuckets(companyName);
    return buckets.find(b => b.name === name) || null;
  } catch (error) {
    logToFile("error.log", `Error finding buckets: ${error}`);
    console.error("Error finding bucket:", error);
    return null;
  }
}


export async function createBucket(name, companyName) {
  try {
    const existing = await findBucket(name, companyName);

    if (existing) {
      console.log("Bucket already exists");
      return existing;
    }

    console.log("Creating bucket...");

    return await getCFClient(companyName).r2.buckets.create({
      account_id: accountId(companyName),
      name,
    });
  } catch (error) {
    logToFile("error.log", `Error creating buckets: ${error}`);
    console.error("Error creating bucket:", error);
    return null;
  }
}


export async function clearBucket(bucketName, companyName) {
  try {
    console.log(`Clearing bucket: ${bucketName}`);

    let continuationToken;
    let totalDeleted = 0;

    do {
      const listRes = await getS3Client(companyName).send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        })
      );

      const objects = listRes.Contents || [];

      if (objects.length === 0) break;

      console.log(`Deleting ${objects.length} objects...`);

      await getS3Client(companyName).send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: { Objects: objects.map(obj => ({ Key: obj.Key })) },
        })
      );

      totalDeleted += objects.length;
      continuationToken = listRes.NextContinuationToken;

    } while (continuationToken);

    console.log(`✅ Bucket cleared. Total deleted: ${totalDeleted}`);
    return true;
  } catch (error) {
    logToFile("error.log", `Error clearing buckets: ${error}`);
    console.error("Error clearing bucket:", error);
    return false;
  }
}


export async function deleteBucket(name, companyName) {
  try {
    const bucket = await findBucket(name, companyName);

    if (!bucket) {
      console.log("Bucket not found");
      return false;
    }

    await clearBucket(name, companyName);

    // Fix #7: correct argument shape — name as path param, account_id in body
    await getCFClient(companyName).r2.buckets.delete(name, {
      account_id: accountId(companyName),
    });

    console.log("Bucket deleted successfully");
    return true;
  } catch (error) {
    logToFile("error.log", `Error deleting buckets: ${error}`);
    console.error("Error deleting bucket:", error);
    return false;
  }
}


// await deleteBucket();
// await createBucket();

