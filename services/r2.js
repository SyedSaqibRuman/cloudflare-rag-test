import {
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

import { logToFile } from "../utils/logger.js";
import { getCFClient, getS3Client } from "../client.js";
import { env } from "../env.js";
import { getConfig } from "../config/index.js";

const ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;

/** Read R2_BUCKET_NAME from runtime config (hot-swappable). Falls back to env. */
export function getR2Bucket(companyName) {
  return getConfig(companyName).R2_BUCKET_NAME;
}

// 🔹 Use shared clients from client.js (single instances for the process)
const r2 = getS3Client();
const cfClient = getCFClient();


export async function uploadObject(key, data, companyName) {
  try {
    // --------------------------
    // 🔹 Check if object exists
    // --------------------------
    try {
      await r2.send(
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

    await r2.send(command);
    logToFile("r2-uploads.log", `Upload: ${key}`);

    console.log(`✅ Uploaded: ${key}`);
    return true;

  } catch (error) {
    logToFile("error.log", `Upload error: ${error}`);
    console.error("Upload error:", error);
    throw error; // re-throw so retry() wrapper can handle it
  }
}


export async function listBuckets() {
  try {
    const res = await cfClient.r2.buckets.list({ account_id: ACCOUNT_ID });
    return res?.buckets || [];
  } catch (error) {
    logToFile("error.log", `Error listing buckets: ${error}`);
    console.error("Error listing buckets:", error);
    return [];
  }
}


export async function findBucket(name) {
  try {
    const buckets = await listBuckets();
    return buckets.find(b => b.name === name) || null;
  } catch (error) {
    logToFile("error.log", `Error finding buckets: ${error}`);
    console.error("Error finding bucket:", error);
    return null;
  }
}


export async function createBucket(name) {
  try {
    const existing = await findBucket(name);

    if (existing) {
      console.log("Bucket already exists");
      return existing;
    }

    console.log("Creating bucket...");

    return await cfClient.r2.buckets.create({
      account_id: ACCOUNT_ID,
      name,
    });
  } catch (error) {
    logToFile("error.log", `Error creating buckets: ${error}`);
    console.error("Error creating bucket:", error);
    return null;
  }
}


export async function clearBucket(bucketName) {
  try {
    console.log(`Clearing bucket: ${bucketName}`);

    let continuationToken;
    let totalDeleted = 0;

    do {
      const listRes = await r2.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        })
      );

      const objects = listRes.Contents || [];

      if (objects.length === 0) break;

      console.log(`Deleting ${objects.length} objects...`);

      await r2.send(
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


export async function deleteBucket(name) {
  try {
    const bucket = await findBucket(name);

    if (!bucket) {
      console.log("Bucket not found");
      return false;
    }

    await clearBucket(name);

    // Fix #7: correct argument shape — name as path param, account_id in body
    await cfClient.r2.buckets.delete(name, {
      account_id: ACCOUNT_ID,
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

