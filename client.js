import { S3Client } from "@aws-sdk/client-s3";
import Cloudflare from "cloudflare";
import { env } from "./env.js";

const cfClient = new Cloudflare({
	apiToken: env.CLOUDFLARE_API_TOKEN,
});

const s3Client = new S3Client({
	region: "auto",
	endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: {
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
	},
});

export function getCFClient() {
	return cfClient;
}

export function getS3Client() {
	return s3Client;
}
