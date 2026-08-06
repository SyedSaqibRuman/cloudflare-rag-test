// --------------------------
// OPENAPI 3.0.3 SPEC (Swagger UI)
// Served at /api-docs (UI) and /api-docs/openapi.json (raw JSON).
// Source of truth for routes: app.js, routes/cloudflare.js, routes/cron.js, routes/auth.js.
// Human-readable docs: docs/AI_API_REFERENCE.md and docs/api/*.md.
// --------------------------

const json = (schema) => ({ content: { "application/json": { schema } } });

const sse = (description) => ({
  description,
  content: {
    "text/event-stream": {
      schema: { type: "string" },
      examples: {
        tokens: {
          value: 'data: {"token":"__START_RESPONSE__"}\n\ndata: {"token":"hello"}\n\ndata: [DONE]\n\n',
        },
        error: { value: 'data: {"error":"Something went wrong"}\n\n' },
      },
    },
  },
});

const RESP = {
  ok: (schema, description = "Success.") => ({ description, ...json(schema) }),
  created: (schema, description = "Created.") => ({ description, ...json(schema) }),
  sse: (description = "Streaming response. See the wire format below.") => sse(description),
  bad: () => ({ $ref: "#/components/responses/BadRequest" }),
  unauthorized: () => ({ $ref: "#/components/responses/Unauthorized" }),
  notFound: () => ({ $ref: "#/components/responses/NotFound" }),
  rate: () => ({ $ref: "#/components/responses/RateLimited" }),
  server: () => ({ $ref: "#/components/responses/ServerError" }),
};

// ErrorBody may use `error`, `message`, or `errors` depending on the route.
const ErrBody = {
  type: "object",
  properties: {
    success: { type: "boolean", example: false },
    error: { type: "string" },
    message: { type: "string" },
    errors: { type: "array", items: { type: "string" } },
  },
};

const okBody = (extra = {}) => ({ type: "object", properties: { success: { type: "boolean", example: true }, ...extra } });

const companyHeader = {
  name: "x-company-name",
  in: "header",
  required: true,
  schema: { type: "string", pattern: "^[a-z0-9-]+$", example: "popularcert" },
  description:
    "Which tenant's credentials, index, and bucket to use. Must match /^[a-z0-9-]+$/. Resolved against the per-company SQLite config; unknown companies get a 400.",
};

const companyHeaderOrQuery = [
  {
    ...companyHeader,
    required: false,
    description: "Tenant selector. Required unless ?company= is supplied.",
  },
  {
    name: "company",
    in: "query",
    required: false,
    schema: { type: "string", example: "popularcert" },
    description: "Tenant selector (alternative to the x-company-name header).",
  },
];

const askApiKeyHeader = {
  name: "x-api-key",
  in: "header",
  required: false,
  schema: { type: "string" },
  description:
    "Per-company API key. Only required when the company has one set (see POST /cloudflare/companies/{name}/apikey); companies without a key are open. Browser requests must also come from the company's domain.",
};

const ChatMessage = {
  type: "object",
  properties: {
    role: { type: "string", enum: ["user", "assistant", "system"] },
    content: { type: "string" },
  },
};

const SSE_WIRE_NOTES =
  "SSE wire protocol: each token is `data: {\"token\":\"...\"}\\n\\n`; the first real token is preceded by the sentinel `data: {\"token\":\"__START_RESPONSE__\"}\\n\\n` (clears the frontend's Thinking state); errors are `data: {\"error\":\"...\"}\\n\\n`; the stream ends with `data: [DONE]\\n\\n`.";

const openapi = {
  openapi: "3.0.3",
  info: {
    title: "PopularCert RAG API",
    description: [
      "Multi-tenant Retrieval-Augmented Generation backend. Each company (`x-company-name`) has its own Cloudflare credentials, vector index, R2 bucket, and config, stored per-company in SQLite.",
      "",
      "- **Company selector**: most admin endpoints take `x-company-name` (header) or `?company=` (query). `/ask` and `/ask-stream` always require the header.",
      "- **Ask API key**: optional per-company key gating only `POST /ask` and `POST /ask-stream`.",
      "- **Admin auth**: `POST /auth/login` issues an HMAC token (`x-auth-token` header). Enforced on `/cloudflare/*` **only when** `ADMIN_USERNAME`/`ADMIN_PASSWORD` are set in `.env`; otherwise those routes are open (as documented in AGENTS.md).",
      "- **Rate limits** (env-tunable): global 100/min, AI tier on `/ask` endpoints, admin tier on `/cloudflare`.",
      "",
      "Full pipeline and architecture notes: `docs/architecture.md`, `docs/AI_API_REFERENCE.md`.",
    ].join("\n\n"),
    version: "1.0.0",
  },
  servers: [{ url: "/", description: "Same origin as this server" }],
  tags: [
    { name: "System", description: "Health and smoke-test endpoints" },
    { name: "Ask", description: "RAG question answering (JSON + SSE)" },
    { name: "Admin Auth", description: "Admin portal login/session" },
    { name: "Companies", description: "Multi-tenant company CRUD + API keys" },
    { name: "Indexes", description: "Cloudflare Vectorize indexes" },
    { name: "Buckets", description: "Cloudflare R2 buckets" },
    { name: "Config", description: "Runtime config + system prompt" },
    { name: "Scheduler", description: "Standalone jobs, cron schedules, presets" },
  ],
  paths: {
    "/": {
      get: {
        tags: ["System"],
        summary: "Root / health",
        description: "Serves the built admin portal for browsers (Accept: text/html) or a JSON health payload for API clients.",
        responses: {
          200: RESP.ok({ $ref: "#/components/schemas/HealthBody" }, "HTML portal or JSON health."),
        },
      },
    },
    "/_health": {
      get: {
        tags: ["System"],
        summary: "Health check",
        responses: {
          200: RESP.ok({ $ref: "#/components/schemas/HealthBody" }),
        },
      },
    },
    "/test": {
      post: {
        tags: ["System"],
        summary: "LLM stream smoke test",
        description:
          "Streams raw tokens from a fixed Cloudflare AI model using app-level env credentials (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN), not the per-company seam. Framed as `event: ...`/`data: ...` lines; errors surface as an `event: error` line.",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { prompt: { type: "string", default: "Hello" } },
              },
            },
          },
        },
        responses: {
          200: RESP.sse("Streamed LLM tokens."),
          429: RESP.rate(),
          500: RESP.server(),
        },
      },
    },
    "/ask": {
      post: {
        tags: ["Ask"],
        summary: "Ask the RAG assistant (JSON)",
        description: [
          "Answers a question using the company's RAG pipeline: intent fast-path, followup rewrite, cache, vector + keyword retrieval, rerank, R2 context, LLM.",
          "Returns `cached: true` for cached answers. Sources carry `{ title, score }`.",
        ].join("\n"),
        parameters: [companyHeader, askApiKeyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["question"],
                properties: {
                  question: { type: "string", example: "What services do you offer?" },
                  history: { type: "array", items: { $ref: "#/components/schemas/ChatMessage" }, description: "Conversation history (max 6 messages used)." },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok({ $ref: "#/components/schemas/AskBody" }),
          400: RESP.bad(),
          401: RESP.unauthorized(),
          429: RESP.rate(),
          500: RESP.server(),
        },
      },
    },
    "/ask-stream": {
      post: {
        tags: ["Ask"],
        summary: "Ask the RAG assistant (SSE stream)",
        description: SSE_WIRE_NOTES,
        parameters: [companyHeader, askApiKeyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["question"],
                properties: {
                  question: { type: "string", example: "What services do you offer?" },
                  history: { type: "array", items: { $ref: "#/components/schemas/ChatMessage" } },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.sse(),
          400: RESP.bad(),
          401: RESP.unauthorized(),
          429: RESP.rate(),
          500: RESP.server(),
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Admin Auth"],
        summary: "Admin login",
        description:
          "Returns an HMAC-signed session token (send it as `x-auth-token`). Returns 503 when admin credentials are not configured in .env. Brute-force limited to 10 attempts/min.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["username", "password"],
                properties: {
                  username: { type: "string" },
                  password: { type: "string", format: "password" },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ token: { type: "string" }, expiresIn: { type: "integer" } })),
          400: RESP.bad(),
          401: RESP.unauthorized(),
          429: RESP.rate(),
          503: RESP.ok(ErrBody, "Admin auth not configured."),
        },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Admin Auth"],
        summary: "Session check",
        description: "Reports whether a valid admin session exists. When admin auth is disabled it returns `{ authenticated: true, bypass: true }` so the portal stays open.",
        responses: {
          200: RESP.ok(okBody({ authenticated: { type: "boolean" }, username: { type: "string" }, bypass: { type: "boolean" } })),
          401: RESP.unauthorized(),
        },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Admin Auth"],
        summary: "Logout",
        description: "Tokens are stateless (HMAC-signed) — the client discards it.",
        responses: {
          200: RESP.ok(okBody()),
        },
      },
    },
    "/cloudflare/companies": {
      get: {
        tags: ["Companies"],
        summary: "List companies",
        responses: {
          200: RESP.ok(okBody({ companies: { type: "array", items: { $ref: "#/components/schemas/CompanySummary" } } })),
          500: RESP.server(),
        },
      },
      post: {
        tags: ["Companies"],
        summary: "Create a company",
        description: "Creates `db/<name>.db` with default model/URL values and empty credentials. Names must match /^[a-z0-9-]+$/ and be 3-63 chars.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", pattern: "^[a-z0-9-]+$", example: "popularcert" },
                  config: { $ref: "#/components/schemas/ConfigPatch", description: "Optional initial config overrides." },
                },
              },
            },
          },
        },
        responses: {
          201: RESP.created(okBody({ message: { type: "string" }, config: { $ref: "#/components/schemas/CompanyConfig" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/companies/{name}": {
      get: {
        tags: ["Companies"],
        summary: "Get a company's config",
        description: "The API key is never returned; `hasApiKey` indicates whether one is set.",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ config: { $ref: "#/components/schemas/CompanyConfig" }, hasApiKey: { type: "boolean" } })),
          404: RESP.notFound(),
          500: RESP.server(),
        },
      },
      put: {
        tags: ["Companies"],
        summary: "Update a company's config",
        description: "Body is a flat key/value patch of COMPANY_KEYS. Unknown keys are rejected; changing EMBEDDING_MODEL auto-follows EMBEDDING_DIMENSIONS.",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ConfigPatch" } } },
        },
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" }, config: { $ref: "#/components/schemas/CompanyConfig" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
      delete: {
        tags: ["Companies"],
        summary: "Delete a company",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/companies/{name}/reset": {
      post: {
        tags: ["Companies"],
        summary: "Reset a company's config to defaults",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" }, config: { $ref: "#/components/schemas/CompanyConfig" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/companies/{name}/apikey": {
      post: {
        tags: ["Companies"],
        summary: "Generate/rotate the company ask API key",
        description: "The key is returned exactly once; it gates POST /ask and POST /ask-stream when set.",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ apiKey: { type: "string" }, message: { type: "string" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
      get: {
        tags: ["Companies"],
        summary: "Check whether a company has an ask API key",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ hasApiKey: { type: "boolean" } })),
          404: RESP.notFound(),
          500: RESP.server(),
        },
      },
      delete: {
        tags: ["Companies"],
        summary: "Revoke the company ask API key",
        description: "After revocation /ask and /ask-stream are open again.",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/indexes": {
      get: {
        tags: ["Indexes"],
        summary: "List Vectorize indexes",
        parameters: [companyHeader],
        responses: {
          200: RESP.ok(okBody({ indexes: { type: "array", items: { type: "object", additionalProperties: true } } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
      post: {
        tags: ["Indexes"],
        summary: "Create a Vectorize index",
        description: "Returns 200 with the existing index if it already exists. `dimensions` defaults to the company's EMBEDDING_DIMENSIONS and must match the model's.",
        parameters: [companyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", pattern: "^[a-z0-9-]+$", example: "popularcert-index" },
                  dimensions: { type: "integer", example: 768 },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ index: { type: "object", additionalProperties: true }, message: { type: "string" } }), "Index already exists."),
          201: RESP.created(okBody({ index: { type: "object", additionalProperties: true } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/indexes/{name}": {
      delete: {
        tags: ["Indexes"],
        summary: "Delete a Vectorize index",
        parameters: [companyHeader, { name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: RESP.bad(),
          404: RESP.notFound(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/buckets": {
      get: {
        tags: ["Buckets"],
        summary: "List R2 buckets",
        parameters: [companyHeader],
        responses: {
          200: RESP.ok(okBody({ buckets: { type: "array", items: { type: "object", additionalProperties: true } } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
      post: {
        tags: ["Buckets"],
        summary: "Create an R2 bucket",
        parameters: [companyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["name"], properties: { name: { type: "string", pattern: "^[a-z0-9-]+$" } } },
            },
          },
        },
        responses: {
          201: RESP.created(okBody({ bucket: { type: "object", additionalProperties: true } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/buckets/{name}": {
      delete: {
        tags: ["Buckets"],
        summary: "Delete an R2 bucket",
        parameters: [companyHeader, { name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: RESP.bad(),
          404: RESP.notFound(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/buckets/{name}/clear": {
      post: {
        tags: ["Buckets"],
        summary: "Empty an R2 bucket",
        parameters: [companyHeader, { name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/config": {
      get: {
        tags: ["Config"],
        summary: "Get a company's runtime config",
        description: "Returns the config grouped into GENERAL / MODELS / STORAGE / CREDENTIALS sections plus AUTH.API_KEY_ENABLED. Credentials are exposed here — the admin API is only protected when admin auth is enabled.",
        parameters: companyHeaderOrQuery,
        responses: {
          200: RESP.ok(okBody({ config: { $ref: "#/components/schemas/CompanyConfig" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
      put: {
        tags: ["Config"],
        summary: "Update a company's runtime config",
        description: [
          "Three body shapes are accepted:",
          "- `{ key, value }` — one whitelisted config key.",
          "- `{ models: { LLM_MODEL, ... } }` — shorthand for model keys.",
          "- `{ baseUrl }` — legacy shorthand for BASE_URL.",
          "Unknown keys are rejected; EMBEDDING_MODEL changes auto-follow EMBEDDING_DIMENSIONS.",
        ].join("\n"),
        parameters: companyHeaderOrQuery,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { type: "object", required: ["key"], properties: { key: { type: "string" }, value: { type: "string" } } },
                  { type: "object", properties: { models: { $ref: "#/components/schemas/ConfigPatch" } } },
                  { type: "object", properties: { baseUrl: { type: "string" } } },
                ],
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" }, config: { $ref: "#/components/schemas/CompanyConfig" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/config/reset": {
      post: {
        tags: ["Config"],
        summary: "Reset runtime config to env defaults",
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" }, config: { $ref: "#/components/schemas/CompanyConfig" } })),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/prompt": {
      get: {
        tags: ["Config"],
        summary: "Get a company's system prompt",
        description: "Returns the raw template, the {{VARIABLE}}-resolved version, and the available variable values.",
        parameters: companyHeaderOrQuery,
        responses: {
          200: RESP.ok(okBody({ prompt: { $ref: "#/components/schemas/PromptBody" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
      put: {
        tags: ["Config"],
        summary: "Update a company's system prompt",
        parameters: companyHeaderOrQuery,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["template"], properties: { template: { type: "string", example: "You are {{CONSULTANT_NAME}} at {{COMPANY_NAME}}..." } } },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" }, prompt: { $ref: "#/components/schemas/PromptBody" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/prompt/reset": {
      post: {
        tags: ["Config"],
        summary: "Reset a company's system prompt to default",
        parameters: companyHeaderOrQuery,
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" }, prompt: { $ref: "#/components/schemas/PromptBody" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/presets": {
      get: {
        tags: ["Scheduler"],
        summary: "List scheduler presets",
        responses: {
          200: RESP.ok(okBody({ presets: { type: "array", items: { $ref: "#/components/schemas/Preset" } } })),
          500: RESP.server(),
        },
      },
      post: {
        tags: ["Scheduler"],
        summary: "Create a scheduler preset",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "schedule"],
                properties: {
                  name: { type: "string" },
                  schedule: { type: "string", example: "0 */6 * * *", description: "Valid node-cron expression." },
                },
              },
            },
          },
        },
        responses: {
          201: RESP.created(okBody({ preset: { $ref: "#/components/schemas/Preset" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/presets/{id}": {
      put: {
        tags: ["Scheduler"],
        summary: "Update a scheduler preset",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "schedule"],
                properties: { name: { type: "string" }, schedule: { type: "string" } },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: RESP.bad(),
          404: RESP.notFound(),
          500: RESP.server(),
        },
      },
      delete: {
        tags: ["Scheduler"],
        summary: "Delete a scheduler preset",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: RESP.bad(),
          404: RESP.notFound(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/job/start": {
      post: {
        tags: ["Scheduler"],
        summary: "Start a standalone job immediately",
        description: "Runs in the background (max 6 concurrent); tracked per company. Abortable via POST /cloudflare/job/stop.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["jobId"],
                properties: {
                  jobId: { type: "string", enum: ["testing", "ingest"], example: "ingest" },
                  companyName: { type: "string", example: "popularcert" },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ jobId: { type: "string" }, message: { type: "string" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/job/stop": {
      post: {
        tags: ["Scheduler"],
        summary: "Stop a running standalone job",
        description: "Stops a specific job (jobId + companyName) or the first running one when no params are given.",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  jobId: { type: "string" },
                  companyName: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: RESP.bad(),
        },
      },
    },
    "/cloudflare/jobs/running": {
      get: {
        tags: ["Scheduler"],
        summary: "List running standalone jobs",
        responses: {
          200: RESP.ok(okBody({ jobs: { type: "array", items: { $ref: "#/components/schemas/RunningJob" } } })),
        },
      },
    },
    "/cloudflare/cron/start": {
      post: {
        tags: ["Scheduler"],
        summary: "Schedule a job on a cron expression",
        description: "Registers a node-cron schedule for a job, keyed by jobId + companyName. Overlapping ticks are skipped.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["jobId", "schedule"],
                properties: {
                  jobId: { type: "string", enum: ["testing", "ingest"] },
                  schedule: { type: "string", example: "0 3 * * *" },
                  companyName: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: RESP.bad(),
          500: RESP.server(),
        },
      },
    },
    "/cloudflare/cron/stop": {
      post: {
        tags: ["Scheduler"],
        summary: "Stop a scheduled cron",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  jobId: { type: "string" },
                  companyName: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: RESP.bad(),
        },
      },
    },
    "/cloudflare/jobs": {
      get: {
        tags: ["Scheduler"],
        summary: "List registered job types",
        responses: {
          200: RESP.ok(okBody({ jobs: { type: "array", items: { type: "object" } } })),
        },
      },
    },
    "/cloudflare/status": {
      get: {
        tags: ["Scheduler"],
        summary: "Scheduler status",
        description: "`mode` is `idle` when nothing is running/scheduled, `running` otherwise. Frontend reads `standalone` and `cron` arrays.",
        responses: {
          200: RESP.ok(okBody({
            mode: { type: "string", enum: ["idle", "running"] },
            standalone: { type: "array", items: { $ref: "#/components/schemas/RunningJob" } },
            cron: { type: "array", items: { $ref: "#/components/schemas/RunningJob" } },
            jobs: { type: "array", items: { type: "object" } },
          })),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      adminToken: {
        type: "apiKey",
        in: "header",
        name: "x-auth-token",
        description: "Admin session token from POST /auth/login. Enforced on /cloudflare/* only when admin auth is enabled.",
      },
    },
    responses: {
      BadRequest: {
        description: "Validation error or missing/invalid company.",
        ...json(ErrBody),
      },
      Unauthorized: {
        description: "Missing/invalid API key or admin token.",
        ...json(ErrBody),
      },
      NotFound: {
        description: "Resource not found.",
        ...json(ErrBody),
      },
      RateLimited: {
        description: "Rate limit exceeded (429 with X-RateLimit-* headers).",
        ...json(ErrBody),
      },
      ServerError: {
        description: "Unexpected server error.",
        ...json(ErrBody),
      },
    },
    schemas: {
      ErrorBody: ErrBody,
      HealthBody: okBody({
        status: { type: "string", example: "ok" },
        message: { type: "string" },
        uptime: { type: "number" },
        timestamp: { type: "integer" },
      }),
      ChatMessage,
      AskBody: okBody({
        answer: { type: "string" },
        sources: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, score: { type: "number" } },
          },
        },
        cached: { type: "boolean", description: "Present when the answer came from the in-memory cache." },
        error: { type: "string", description: "Present when the pipeline failed (fallback message)." },
      }),
      CompanySummary: {
        type: "object",
        additionalProperties: true,
        description: "Company name plus config summary.",
      },
      ConfigPatch: {
        type: "object",
        additionalProperties: true,
        description:
          "Flat key/value patch over COMPANY_KEYS: GENERAL (BASE_URL, CONTACT_US_URL, LOCATIONS_URL, SERVICES_URL, CONSULTANT_NAME, COMPANY_NAME), MODELS (EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, LLM_MODEL, SMALL_LLM, RERANKING_MODEL), STORAGE (VECTOR_INDEX, R2_BUCKET_NAME), CREDENTIALS (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_TOKEN_VALUE, R2_JURISDICTION_END_POINT).",
      },
      CompanyConfig: {
        type: "object",
        additionalProperties: true,
        description:
          "Grouped config: { GENERAL, MODELS, STORAGE, CREDENTIALS, AUTH: { API_KEY_ENABLED } }. Key lists match ConfigPatch; credentials are stored per-company and never seeded from env.",
      },
      PromptBody: {
        type: "object",
        properties: {
          template: { type: "string" },
          resolved: { type: "string" },
          variables: {
            type: "object",
            additionalProperties: true,
            description: "{{VARIABLE}} → value map.",
          },
        },
      },
      Preset: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          schedule: { type: "string" },
        },
      },
      RunningJob: {
        type: "object",
        properties: {
          jobId: { type: "string" },
          companyName: { type: "string" },
          startedAt: { type: "integer" },
          schedule: { type: "string", description: "Present on cron entries." },
        },
      },
    },
  },
};

export default openapi;
