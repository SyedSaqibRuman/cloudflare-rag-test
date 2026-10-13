// --------------------------
// CLOUDFLARE R2 ADAPTER
// Adapts Cloudflare R2 storage API for the ingestion pipeline.
// --------------------------

import { uploadObject } from "../../../services/r2.js";

export class CloudflareR2Adapter {
  constructor(credentials) {
    this.accountId = credentials.accountId;
    this.apiToken = credentials.apiToken;
    this.bucketName = credentials.bucketName;
    this.companyName = credentials.companyName;
  }

  async ensureBucket() {
    // R2 buckets are created on first upload, so no explicit creation needed
  }

  async saveContent(_name, _markdown) {
    // Save to local cache for fallback (optional)
  }

  async uploadChunk(r2Key, payload) {
    // Use the existing uploadObject function from services/r2.js
    return uploadObject(r2Key, payload, this.companyName, this.bucketName);
  }
}