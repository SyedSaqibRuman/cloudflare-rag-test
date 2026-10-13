import { S3Client } from "@aws-sdk/client-s3";
import Cloudflare from "cloudflare";
import crypto from "node:crypto";
import { resolveCreds } from "./config/index.js";

// Per-company cached SDK clients. Entries are keyed by company AND the
// fingerprint of the credentials they were built from — rotating a gateway
// connection (rag-sync) produces a new fingerprint on the next resolveCreds()
// call, so stale clients with revoked keys are rebuilt instead of reused.
const cfClients = new Map();
const s3Clients = new Map();

function clientKey(companyName) {
  return companyName || "_default";
}

/** Stable fingerprint over the credential values a client was built from. */
function fingerprint(values) {
  return crypto.createHash("sha256").update(values.join("\u0000")).digest("hex");
}

function cachedClient(map, key, fp, create) {
  const entry = map.get(key);
  if (entry && entry.fingerprint === fp) return entry.client;
  const client = create();
  map.set(key, { fingerprint: fp, client });
  return client;
}

export function getCFClient(companyName) {
  const key = clientKey(companyName);
  const { CLOUDFLARE_API_TOKEN } = resolveCreds(companyName);
  return cachedClient(cfClients, key, fingerprint([CLOUDFLARE_API_TOKEN]), () => new Cloudflare({ apiToken: CLOUDFLARE_API_TOKEN }));
}

export function getS3Client(companyName) {
  const key = clientKey(companyName);
  const { CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = resolveCreds(companyName);
  return cachedClient(
    s3Clients,
    key,
    fingerprint([CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY]),
    () => new S3Client({
      region: "auto",
      endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  );
}
