import { S3Client } from "@aws-sdk/client-s3";
import Cloudflare from "cloudflare";
import { resolveCreds } from "./config/index.js";

const cfClients = new Map();
const s3Clients = new Map();

function clientKey(companyName) {
  return companyName || "_default";
}

export function getCFClient(companyName) {
  const key = clientKey(companyName);
  if (cfClients.has(key)) return cfClients.get(key);

  const { CLOUDFLARE_API_TOKEN } = resolveCreds(companyName);
  const client = new Cloudflare({ apiToken: CLOUDFLARE_API_TOKEN });
  cfClients.set(key, client);
  return client;
}

export function getS3Client(companyName) {
  const key = clientKey(companyName);
  if (s3Clients.has(key)) return s3Clients.get(key);

  const { CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = resolveCreds(companyName);
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  s3Clients.set(key, client);
  return client;
}
