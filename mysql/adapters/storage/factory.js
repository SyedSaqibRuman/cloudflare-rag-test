// --------------------------
// STORAGE ADAPTER FACTORY
// Creates storage adapters for R2/S3/etc based on provider type.
// Each adapter implements: ensureBucket(), saveContent(name, markdown), uploadChunk(key, payload)
// --------------------------

import { CloudflareR2Adapter } from "./cloudflare-r2.js";
import { S3Adapter } from "./s3.js";

export function createStoreAdapter(providerKey, credentials) {
  switch (providerKey) {
    case "cloudflare":
      return new CloudflareR2Adapter(credentials);

    case "aws":
      return new S3Adapter(credentials);

    case "minio":
      return new S3Adapter(credentials);

    default:
      throw new Error(`Unsupported storage provider: ${providerKey}`);
  }
}