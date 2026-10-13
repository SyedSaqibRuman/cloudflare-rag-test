// --------------------------
// S3 STORAGE ADAPTER
// Adapts AWS S3 (or compatible) storage API for the ingestion pipeline.
// Requires @aws-sdk/client-s3 (already in package.json)
// --------------------------

import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";

export class S3Adapter {
  constructor(credentials) {
    this.bucketName = credentials.bucketName;
    this.companyName = credentials.companyName;
    this.region = credentials.region || "us-east-1";
    this.endpoint = credentials.endpoint; // For MinIO or custom endpoints
    this.accessKeyId = credentials.accessKeyId;
    this.secretAccessKey = credentials.secretAccessKey;

    this.client = new S3Client({
      region: this.region,
      endpoint: this.endpoint,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
      // For S3 compatible services that force path style
      forcePathStyle: !!this.endpoint,
    });
  }

  async ensureBucket() {
    try {
      await this.client.send(
        new HeadBucketCommand({
          Bucket: this.bucketName,
        })
      );
    } catch (err) {
      if (err.name === "NotFound" || err.statusCode === 404) {
        // Bucket does not exist, create it
        await this.client.send(
          new CreateBucketCommand({
            Bucket: this.bucketName,
            CreateBucketConfiguration: this.region !== "us-east-1"
              ? { LocationConstraint: this.region }
              : undefined,
          })
        );
      } else {
        throw err;
      }
    }
  }

  async saveContent(_name, _markdown) {
    // Save to local cache for fallback (optional)
    // We can implement a local file cache if needed, but for now we skip.
  }

  async uploadChunk(r2Key, payload) {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: r2Key,
      Body: JSON.stringify(payload),
      ContentType: "application/json",
    });
    return this.client.send(command);
  }
}