import "dotenv/config";

// All company + AI/RAG config (companies, models, URLs, prompts, Cloudflare
// credentials, ask API keys) lives in MySQL (or SQLite) — never in env vars.
// The environment only carries the MySQL connection, the admin login, and
// operational knobs (PORT, NODE_ENV, CONFIG_STORE).
export const env = Object.freeze({
  // Server
  PORT: process.env.PORT || "3000",
  NODE_ENV: process.env.NODE_ENV || "development",

  // Config store backend: "mysql" (default for new deploys) or "sqlite"
  CONFIG_STORE: process.env.CONFIG_STORE || "sqlite",

  // Admin login (opt-in: routes stay open until both are set)
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  ADMIN_SECRET: process.env.ADMIN_SECRET,
  ADMIN_TOKEN_TTL_HOURS: process.env.ADMIN_TOKEN_TTL_HOURS || "12",

  // MySQL — single source of truth for companies + AI config
  MYSQL_HOST: process.env.MYSQL_HOST,
  MYSQL_PORT: process.env.MYSQL_PORT || "3306",
  MYSQL_USER: process.env.MYSQL_USER,
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD,
  MYSQL_DATABASE: process.env.MYSQL_DATABASE,
})
