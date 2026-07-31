import "dotenv/config";

export const env = Object.freeze({
  // Cloudflare (secrets — must stay in .env)
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,

  // R2 Storage (secrets)
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_TOKEN_VALUE: process.env.R2_TOKEN_VALUE,
  R2_JURISDICTION_END_POINT: process.env.R2_JURISDICTION_END_POINT,

  // Server
  PORT: process.env.PORT || "3000",
  NODE_ENV: process.env.NODE_ENV || "development",

  // Admin
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,

  // Rate Limiting
  RATE_LIMIT_GLOBAL: process.env.RATE_LIMIT_GLOBAL || "100",
  RATE_LIMIT_AI: process.env.RATE_LIMIT_AI || "20",
  RATE_LIMIT_ADMIN: process.env.RATE_LIMIT_ADMIN || "30",

  // Ingestion tuning
  DELAY_MS: process.env.DELAY_MS,
  BATCH_SIZE: process.env.BATCH_SIZE,
})
