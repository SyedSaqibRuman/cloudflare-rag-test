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
        start: {
          value:
            'data: {"__start":true,"sources":[{"title":"ISO 9001 Guide","score":0.92}],"matches":[{"id":"chunk-1","score":0.92}],"graph":{"cypher":"MATCH (c) RETURN c","context":"3 related standards"}}\n\n',
        },
        token: { value: 'data: {"token":"Certification"}\n\n' },
        possibleQuestions: {
          value: 'data: {"possibleQuestions":["What are the ISO 9001 requirements?","How long does certification take?"]}\n\n',
        },
        done: { value: "data: [DONE]\n\n" },
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
  "SSE wire protocol: the stream opens with a structured start frame `data: {\"__start\":true,\"sources\":[...],\"matches\":[...],\"graph\":{...}}\\n\\n` carrying metadata; tokens arrive as `data: {\"token\":\"...\"}\\n\\n`; follow-up suggestions arrive as `data: {\"possibleQuestions\":[...]}\\n\\n`; errors are `data: {\"error\":\"...\"}\\n\\n`; the stream ends with `data: [DONE]\\n\\n`. The legacy `__START_RESPONSE__` sentinel is no longer emitted.";

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
      "- **Rate limits**: global 100/min, AI tier 20/min on `/ask` endpoints, login brute-force guard 10/min. Admin routes are **not** rate-limited - authenticated admin sessions bypass the global baseline.",
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
        summary: "LLM stream smoke test (admin only)",
        description:
          "ADMIN-GATED (requireAdmin + AI-tier rate limit). Streams raw tokens from a fixed Cloudflare AI model using the first configured company's credentials. Framed as `event: ...`/`data: ...` lines; errors surface as an `event: error` line.",
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
          "Returns `cached: true` for cached answers. Sources carry `{ title, score }`. Matches carry the full retrieval result set. Graph context is included when GraphRAG is enabled.",
          "`possibleQuestions` contains 3-5 suggested follow-up questions generated from the answer.",
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
    "/ask/reset": {
      post: {
        tags: ["Ask"],
        summary: "Reset a company's conversation cache",
        description:
          "Purges the in-memory answer cache for the company so the next question runs the full RAG pipeline again (no cached answers). Gated like /ask: x-company-name + the per-company API key when set. Returns how many cached entries were cleared.",
        parameters: [companyHeader, askApiKeyHeader],
        responses: {
          200: RESP.ok(okBody({ cleared: { type: "integer", description: "Number of cached answers purged for this company." } })),
          400: RESP.bad(),
          401: RESP.unauthorized(),
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
        description:
          "DESTRUCTIVE: deletes every company database and resets all config to defaults. Requires an explicit confirmation body: { \"confirm\": \"reset-all-companies\" } — any other body is rejected with 400.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["confirm"],
                properties: {
                  confirm: { type: "string", enum: ["reset-all-companies"] },
                },
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
    // ============================================================
    // Gateway (multi-tenant AI provider catalog) — behind requireAdmin
    // All gateway routes 503 when MYSQL_* env is unset. Admin routes carry no rate limiter.
    // ============================================================
    "/gateway/health": {
      get: {
        tags: ["Gateway"],
        summary: "Gateway health",
        description: "Reports the MySQL-backed gateway layer's status (503 when MySQL env vars are unset).",
        responses: {
          200: RESP.ok(okBody({ status: { type: "string", example: "ok" }, mysql: { type: "boolean" } })),
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/providers": {
      get: {
        tags: ["Gateway"],
        summary: "List providers",
        description: "Lightweight catalog rows: key, name, category, auth type, URLs. Used by the Catalog page's list view.",
        responses: {
          200: RESP.ok(okBody({ providers: { type: "array", items: { type: "object" } } })),
          401: { $ref: "#/components/responses/Unauthorized" },
          503: { description: "MySQL not configured." },
        },
      },
      post: {
        tags: ["Gateway"],
        summary: "Create a provider",
        description:
          "Blank-slate creation: no auth schema, models, or endpoints yet. providerKey must match /^[a-z0-9_]+$/ (3-50 chars); category is one of the 11 enums; authType one of 5 enums. Duplicate keys return 409. Audit-logged as provider.created.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["providerKey", "providerName", "category"],
                properties: {
                  providerKey: { type: "string", example: "openai" },
                  providerName: { type: "string", example: "OpenAI" },
                  category: { type: "string", enum: ["ai", "embedding", "vector", "storage", "graph", "image", "speech", "search", "database", "email", "analytics"] },
                  authType: { type: "string", enum: ["api_key", "bearer_token", "oauth2", "basic_auth", "custom"], default: "bearer_token" },
                  websiteUrl: { type: "string", format: "uri" },
                  documentationUrl: { type: "string", format: "uri" },
                  defaultApiBaseUrl: { type: "string", format: "uri" },
                  isActive: { type: "boolean", default: true },
                },
              },
            },
          },
        },
        responses: {
          201: RESP.ok(okBody({ message: { type: "string" }, providerId: { type: "integer" } }), "Created."),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          409: { description: "providerKey already exists." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/providers/{key}": {
      get: {
        tags: ["Gateway"],
        summary: "Provider detail",
        description: "Full metadata for one provider, including capabilities and resource templates.",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ provider: { type: "object" } })),
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Provider not found." },
          503: { description: "MySQL not configured." },
        },
      },
      put: {
        tags: ["Gateway"],
        summary: "Update a provider",
        description:
          "Edits the provider's metadata (name, category, auth type, URLs). providerKey is the route identity and is never editable; partial updates merge over the stored row. Same validation rules as create. Audit-logged as provider.updated.",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  providerName: { type: "string", example: "OpenAI" },
                  category: { type: "string", enum: ["ai", "embedding", "vector", "storage", "graph", "image", "speech", "search", "database", "email", "analytics"] },
                  authType: { type: "string", enum: ["api_key", "bearer_token", "oauth2", "basic_auth", "custom"] },
                  websiteUrl: { type: "string", format: "uri", nullable: true },
                  documentationUrl: { type: "string", format: "uri", nullable: true },
                  defaultApiBaseUrl: { type: "string", format: "uri", nullable: true },
                  isActive: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" }, providerId: { type: "integer" } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Provider not found." },
          503: { description: "MySQL not configured." },
        },
      },
      delete: {
        tags: ["Gateway"],
        summary: "Delete provider",
        description: "Hard-deletes a provider from the catalog (catalog child rows cascade; the key becomes reusable). Refused with 409 when tenant credentials or resources still reference the provider.",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Provider not found." },
          409: { description: "Provider is referenced by tenant credentials/resources." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/providers/{key}/models": {
      parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
      get: {
        tags: ["Gateway"],
        summary: "Provider models",
        description: "Models for a provider, each with its current price row (from pricing).",
        responses: {
          200: RESP.ok(okBody({ models: { type: "array", items: { type: "object" } } })),
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Provider not found." },
          503: { description: "MySQL not configured." },
        },
      },
      post: {
        tags: ["Gateway"],
        summary: "Upsert a provider model",
        description:
          "Creates (or refreshes in place, keyed on provider_id + model_key) a single model with optional pricing rows. modelKey must match /^[a-z0-9._-]+$/ (1-100 chars); category is one of chat/embedding/reranker/image/tts/stt/vision; pricing entries default effectiveFrom to today and currency to USD. Invalidates the registry and audits provider.model.upserted.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["key", "name", "category"],
                properties: {
                  key: { type: "string", example: "gpt-4o-mini", description: "Also accepted as modelKey. 1-100 chars, /^[a-z0-9._-]+$/." },
                  name: { type: "string", example: "GPT-4o Mini", description: "Also accepted as modelName; max 200 chars." },
                  category: { type: "string", enum: ["chat", "embedding", "reranker", "image", "tts", "stt", "vision"] },
                  family: { type: "string" },
                  streaming: { type: "boolean", default: false },
                  functionCalling: { type: "boolean", default: false },
                  vision: { type: "boolean", default: false },
                  maxContextWindow: { type: "integer" },
                  maxOutputTokens: { type: "integer" },
                  pricing: {
                    type: "array",
                    description: "Keys use inputPricePerMillion/outputPricePerMillion (not the pricePerMillionInput/output shape of POST /gateway/pricing); unknown keys are silently stored as null.",
                    items: {
                      type: "object",
                      properties: {
                        effectiveFrom: { type: "string", format: "date", description: "Defaults to today." },
                        inputPricePerMillion: { type: "number" },
                        outputPricePerMillion: { type: "number" },
                        priceCurrency: { type: "string", default: "USD" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          201: RESP.ok(okBody({ message: { type: "string" }, modelId: { type: "integer" } }), "Created."),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Provider not found." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/providers/{key}/test": {
      parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
      post: {
        tags: ["Gateway"],
        summary: "Test a catalog provider",
        description:
          "Tests a provider right after adding it to the catalog — same contract as the company-scoped connections/test. With body.fields the values are format-validated against the provider's auth schema, then run through the live probe (hand-written or schema-driven). Without a probe, the default API base URL is probed for reachability (any HTTP response = live). Read-only; audits provider.test. Returns mode = format | probe | connectivity | none.",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  fields: {
                    type: "object",
                    description: "Optional unsaved credential values to validate + probe, e.g. { api_key: \"sk-...\" }.",
                    additionalProperties: { type: "string" },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({
            status: { type: "string", enum: ["success", "failed"] },
            mode: { type: "string", enum: ["format", "probe", "connectivity", "none"] },
            error: { type: "string", nullable: true },
            latencyMs: { type: "number", nullable: true },
            checkedAt: { type: "string", format: "date-time" },
            warning: { type: "string" },
          })),
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Provider not found." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/credentials/test-batch": {
      post: {
        tags: ["Gateway"],
        summary: "Batch-test a company's connections (9Router 'Test All')",
        description:
          "Runs the same decrypt → auth-schema validation → live-probe pipeline as the per-credential verify endpoint over every ACTIVE credential of a company, filtered by the Providers page section (group: custom | oauth | apikey) or a single provider (providerKey). Each result is recorded + audited like a single verify. Returns a summary + per-credential results (valid, latencyMs, error, diagnosis: AUTH | 429 | 5XX | NET | RUNTIME | ERR) for the results modal.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["companyKey"],
                properties: {
                  companyKey: { type: "string", description: "The gateway company whose credentials to test." },
                  group: { type: "string", enum: ["custom", "oauth", "apikey"], description: "Section id from the Providers page. Mutually exclusive with providerKey." },
                  providerKey: { type: "string", description: "Test just this provider's credentials instead of a whole section." },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({
            mode: { type: "string", description: "providerKey passed → 'provider', else the group id (or 'all')." },
            summary: {
              type: "object",
              properties: {
                total: { type: "integer" },
                passed: { type: "integer" },
                failed: { type: "integer" },
              },
            },
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  credentialId: { type: "integer" },
                  credentialName: { type: "string" },
                  providerKey: { type: "string" },
                  valid: { type: "boolean" },
                  latencyMs: { type: "number", nullable: true },
                  error: { type: "string", nullable: true },
                  diagnosis: { type: "string", nullable: true, description: "9Router-style tag: AUTH | 429 | 5XX | NET | RUNTIME | ERR, or the literal HTTP code (e.g. 400, 500, 502) extracted from the provider error message." },
                },
              },
            },
          })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Company not found." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/providers/{key}/models/{id}": {
      parameters: [
        { name: "key", in: "path", required: true, schema: { type: "string" } },
        { name: "id", in: "path", required: true, schema: { type: "integer" } },
      ],
      put: {
        tags: ["Gateway"],
        summary: "Update a provider model",
        description:
          "Partial merge over the stored row: present fields are written, absent fields keep their current values; pass explicit null to clear optional fields (family, maxContextWindow, maxOutputTokens). modelKey is editable — a differing key in the body renames the model (pricing + credential model-access grants follow the row); renaming onto an existing key on the same provider returns 409. Category re-validated against the ENUM. Audits provider.model.updated. Pricing is managed via /gateway/pricing.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  key: { type: "string", description: "Editable — a differing key renames the model. Must match /^[a-zA-Z0-9@][a-zA-Z0-9._:@/-]*$/ (max 100 chars)." },
                  name: { type: "string", description: "Max 200 chars." },
                  category: { type: "string", enum: ["chat", "embedding", "reranker", "image", "tts", "stt", "vision"] },
                  family: { type: "string", nullable: true },
                  streaming: { type: "boolean" },
                  functionCalling: { type: "boolean" },
                  vision: { type: "boolean" },
                  maxContextWindow: { type: "integer", nullable: true },
                  maxOutputTokens: { type: "integer", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" }, modelId: { type: "integer" } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Provider or model not found (model must belong to the provider)." },
          409: { description: "Rename onto an existing model key on the same provider." },
          503: { description: "MySQL not configured." },
        },
      },
      delete: {
        tags: ["Gateway"],
        summary: "Delete a provider model",
        description:
          "Hard delete. Pricing rows and credential_model_access grants for the model CASCADE (schema/v5.sql FKs). Audits provider.model.deleted.",
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Provider or model not found (model must belong to the provider)." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/endpoints": {
      get: {
        tags: ["Gateway"],
        summary: "List endpoints",
        description: "Endpoints across providers; filter with ?provider= and ?model=.",
        responses: {
          200: RESP.ok(okBody({ endpoints: { type: "array", items: { type: "object" } } })),
          401: { $ref: "#/components/responses/Unauthorized" },
          503: { description: "MySQL not configured." },
        },
      },
      post: {
        tags: ["Gateway"],
        summary: "Create an endpoint",
        description: "endpointKey must match /^[a-z0-9_-]+$/ (2-100 chars); method one of GET/POST/PUT/DELETE/PATCH; bodyParams is a JSON string. Rejects keys that overlap an existing endpoint on the same provider+method (D3 overlap guard). Audit-logged.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["providerKey", "endpointKey", "method", "pathTemplate"],
                properties: {
                  providerKey: { type: "string" },
                  endpointKey: { type: "string", example: "chat_completions" },
                  method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"] },
                  pathTemplate: { type: "string", example: "/v1/chat/completions" },
                  description: { type: "string" },
                  category: { type: "string" },
                  isDeprecated: { type: "boolean", default: false },
                  bodyParams: { type: "string", description: "JSON-encoded body parameter schema" },
                  successCodes: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          201: RESP.ok(okBody({ message: { type: "string" }, endpointId: { type: "integer" } }), "Created."),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          409: { description: "Overlapping endpoint already exists on this provider+method." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/endpoints/{id}": {
      put: {
        tags: ["Gateway"],
        summary: "Update an endpoint",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Endpoint not found." },
          503: { description: "MySQL not configured." },
        },
      },
      delete: {
        tags: ["Gateway"],
        summary: "Delete an endpoint",
        description: "Refused (409) when a pricing row references this endpoint (F5 guard).",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Endpoint not found." },
          409: { description: "Endpoint is referenced by pricing." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/pricing": {
      get: {
        tags: ["Gateway"],
        summary: "List pricing",
        description: "Filter with ?modelId= and ?provider=.",
        responses: {
          200: RESP.ok(okBody({ pricing: { type: "array", items: { type: "object" } } })),
          401: { $ref: "#/components/responses/Unauthorized" },
          503: { description: "MySQL not configured." },
        },
      },
      post: {
        tags: ["Gateway"],
        summary: "Add a price",
        description: "Prices a model (and optionally an endpoint). DECIMAL fields arrive as numbers; effectiveAt/expiresAt are YYYY-MM-DD.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["modelId"],
                properties: {
                  modelId: { type: "integer" },
                  endpointId: { type: "integer" },
                  providerKey: { type: "string" },
                  pricePerMillionInput: { type: "number" },
                  pricePerMillionOutput: { type: "number" },
                  currency: { type: "string", default: "USD" },
                  effectiveAt: { type: "string", format: "date" },
                  expiresAt: { type: "string", format: "date" },
                },
              },
            },
          },
        },
        responses: {
          201: RESP.ok(okBody({ message: { type: "string" }, pricingId: { type: "integer" } }), "Created."),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/pricing/{id}": {
      put: {
        tags: ["Gateway"],
        summary: "Update a price",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Pricing row not found." },
          503: { description: "MySQL not configured." },
        },
      },
      delete: {
        tags: ["Gateway"],
        summary: "Delete a price",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Pricing row not found." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/kbs/options": {
      get: {
        tags: ["Gateway"],
        summary: "Knowledge base create options",
        description:
          "Bundles the company's vector_index + object_bucket + graph_database resources and the catalog embedding models in one round trip for the create modal (D14). Also drives the Config page's Vector Index / Storage / Graph DB selectors (resources come from every provider, plus live Cloudflare account rows). Requires x-company-name.",
        responses: {
          200: RESP.ok(okBody({ options: { type: "object" } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/kbs": {
      get: {
        tags: ["Gateway"],
        summary: "List knowledge bases",
        description: "All KBs for the company from the x-company-name header.",
        responses: {
          200: RESP.ok(okBody({ kbs: { type: "array", items: { $ref: "#/components/schemas/KnowledgeBase" } } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          503: { description: "MySQL not configured." },
        },
      },
      post: {
        tags: ["Gateway"],
        summary: "Create a knowledge base",
        description:
          "Validates kbKey (^[a-z0-9-]{3,63}$) + settings, enforces the company KB limit and resource ownership, snapshots the embedding provider, and audits kb.created.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["kbKey", "kbName"],
                properties: {
                  kbKey: { type: "string", example: "popularcert-kb", description: "3-63 chars, /^[a-z0-9-]+$/." },
                  kbName: { type: "string" },
                  description: { type: "string" },
                  vectorResourceId: { type: "integer", description: "provider_resources row of type vector_index; omit to use the company config." },
                  storageResourceId: { type: "integer", description: "provider_resources row of type object_bucket; omit to use the company config." },
                  embeddingModelId: { type: "integer", description: "Catalog model id in the embedding category; only @cf/ models with known dimensions override the config model (F9)." },
                  chunkSize: { type: "integer", default: 512, minimum: 1, maximum: 10000 },
                  chunkOverlap: { type: "integer", default: 50, minimum: 0, description: "Validated but a no-op in M2 (F10)." },
                  retrievalTopK: { type: "integer", default: 10, minimum: 1, maximum: 100 },
                  retrievalScoreThreshold: { type: "number", default: 0.7, minimum: 0, maximum: 1 },
                  enableHybridSearch: { type: "boolean", default: true },
                  enableGraphRag: { type: "boolean", default: false, description: "Graph is deferred in M2; stored as disabled." },
                  isActive: { type: "boolean", default: true },
                },
              },
            },
          },
        },
        responses: {
          201: RESP.ok(okBody({ message: { type: "string" }, kbId: { type: "integer" }, kbKey: { type: "string" } }), "Created."),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          409: { description: "KB key already exists, or the company KB limit is reached." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/kbs/{key}": {
      parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" }, description: "KB key (kbKey)." }],
      get: {
        tags: ["Gateway"],
        summary: "Get a knowledge base",
        responses: {
          200: RESP.ok(okBody({ kb: { $ref: "#/components/schemas/KnowledgeBase" } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Knowledge base not found." },
          503: { description: "MySQL not configured." },
        },
      },
      put: {
        tags: ["Gateway"],
        summary: "Update a knowledge base",
        description: "kbKey is the route identity and is never editable; partial updates merge over the stored row. Audits kb.updated.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/KnowledgeBaseInput" },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" }, kbId: { type: "integer" }, kbKey: { type: "string" } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Knowledge base not found." },
          503: { description: "MySQL not configured." },
        },
      },
      delete: {
        tags: ["Gateway"],
        summary: "Delete a knowledge base",
        description: "Hard delete (D10); the audit trail keeps kb.deleted. A running ingest is not auto-stopped.",
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Knowledge base not found." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/kbs/{key}/ingest": {
      post: {
        tags: ["Gateway"],
        summary: "Start a KB ingest job",
        description:
          "Starts a standalone ingest bound to the KB (R2 kb/<kbKey>/ prefix, per-KB registry processed-<company>-<kbKey>.json, KB resource resolution with company_config fallback). 409 while an ingest for the same KB is running (F11).",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" }, startedAt: { type: "string" } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Knowledge base not found." },
          409: { description: "Ingest for this KB is already running." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/kbs/{key}/status": {
      get: {
        tags: ["Gateway"],
        summary: "Knowledge base ingest status",
        description:
          "Live status: row status + running-job flag, registry document count, best-effort Vectorize vector count (null on API failure), lastSyncAt = row updated_at (last status flip, F12), lastError from the live job state.",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ status: { $ref: "#/components/schemas/KnowledgeBaseStatus" } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Knowledge base not found." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/companies/{key}/resources": {
      get: {
        tags: ["Gateway"],
        summary: "List company resources",
        description:
          "Provider resources (vector index, object bucket, …) provisioned for a company under its credentials. Filter with ?type= (e.g. vector_index). Rows are denormalized with credential/provider/environment names (D13).",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ companyKey: { type: "string" }, resources: { type: "array", items: { $ref: "#/components/schemas/ProviderResource" } } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          503: { description: "MySQL not configured." },
        },
      },
      post: {
        tags: ["Gateway"],
        summary: "Provision a provider resource",
        description:
          "Creates a provider_resources row under a company credential. The resource type must be one the provider's catalog advertises (provider_resource_types); the credential must belong to the company AND the provider; max_per_credential from the template is enforced (409). Audits resource.created.",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ProviderResourceInput" },
            },
          },
        },
        responses: {
          201: RESP.ok(okBody({ message: { type: "string" }, resourceId: { type: "integer" } }), "Created."),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          409: { description: "Resource key already exists, or the credential is at max_per_credential for this type." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/companies/{key}/cloudflare/resources/{type}": {
      parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
      get: {
        tags: ["Gateway"],
        summary: "List live Cloudflare resources",
        description:
          "Lists the account's ACTUAL Cloudflare infrastructure (Vectorize indexes, R2 buckets, D1 databases, KV namespaces) through the company's saved Cloudflare connection — unlike /resources (registry rows), this is a live read from the Cloudflare REST API. type ∈ vector_index | object_bucket | sql_database | kv_namespace. Rows are normalized to { id, name, … } for the portal tables.",
        parameters: [{ name: "type", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: RESP.ok(okBody({ companyKey: { type: "string" }, credentialKey: { type: "string" }, type: { type: "string" }, resources: { type: "array", items: { type: "object" } } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Company not found, or it has no active Cloudflare connection." },
          503: { description: "MySQL not configured." },
        },
      },
      post: {
        tags: ["Gateway"],
        summary: "Create a live Cloudflare resource",
        description:
          "Creates real infrastructure on the Cloudflare account (Vectorize index, R2 bucket, D1 database, KV namespace) via the company's Cloudflare connection. Body: { name, providerKey?, config? } — config carries type-specific options (dimensions/metric for vector_index, locationHint for object_bucket/sql_database). Duplicate names are refused (409). Audits cloudflare_resource.created.",
        parameters: [{ name: "type", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  providerKey: { type: "string" },
                  config: { type: "object", description: "e.g. { dimensions: 768, metric: \"cosine\" } or { locationHint: \"WEUR\" }" },
                },
                required: ["name"],
              },
            },
          },
        },
        responses: {
          201: RESP.ok(okBody({ message: { type: "string" }, resource: { type: "object" } }), "Created."),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Company not found, or it has no active Cloudflare connection." },
          409: { description: "A resource with that name already exists on the account." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/companies/{key}/cloudflare/resources/{type}/{id}": {
      delete: {
        tags: ["Gateway"],
        summary: "Delete a live Cloudflare resource",
        description:
          "Deletes the infrastructure from the Cloudflare account (Vectorize index / R2 bucket by name, D1 database / KV namespace by uuid). Irreversible — mirrors a dashboard delete. Audits cloudflare_resource.deleted.",
        parameters: [
          { name: "key", in: "path", required: true, schema: { type: "string" } },
          { name: "type", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Resource name (vector/bucket) or uuid (d1/kv)." },
        ],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Company not found, or it has no active Cloudflare connection." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/resources/{id}": {
      put: {
        tags: ["Gateway"],
        summary: "Update a provider resource",
        description:
          "Partial update of editable metadata (resourceName, external ids/urls/region, description, config, status, isDefault, isActive). resourceKey and the credential binding are immutable — recreate to move. Audits resource.updated.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  resourceName: { type: "string" },
                  externalResourceId: { type: "string" },
                  externalResourceUrl: { type: "string", format: "uri" },
                  externalRegion: { type: "string" },
                  description: { type: "string" },
                  config: { type: "object" },
                  status: { type: "string" },
                  isDefault: { type: "boolean" },
                  isActive: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Resource not found." },
          503: { description: "MySQL not configured." },
        },
      },
      delete: {
        tags: ["Gateway"],
        summary: "Delete a provider resource",
        description: "Soft delete — the row can no longer be resolved by lookups or KBs. Audits resource.deleted.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Resource not found." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/companies/{key}/execute/chat": {
      post: {
        tags: ["Gateway"],
        summary: "Execute a chat completion through a company credential",
        description:
          "Calls the provider's chat API with the credential's decrypted fields (9Router executor equivalent). The credential is resolved by credentialId OR providerKey (+ optional credentialKey/environmentKey); model defaults to the provider's first catalog chat model. Responses are normalized to an OpenAI-style shape; provider failures surface the upstream error message (502). Audits provider.execute.chat.",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  credentialId: { type: "integer" },
                  providerKey: { type: "string" },
                  credentialKey: { type: "string" },
                  environmentKey: { type: "string" },
                  model: { type: "string" },
                  messages: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { role: { type: "string" }, content: { type: "string" } },
                    },
                  },
                  options: { type: "object" },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({
            providerKey: { type: "string" },
            model: { type: "string" },
            content: { type: "string" },
            role: { type: "string" },
            usage: { type: "object" },
            latencyMs: { type: "number" },
          })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Company, credential, or provider not found." },
          502: { description: "The provider returned an error — the upstream message is surfaced." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/companies/{key}/execute/embeddings": {
      post: {
        tags: ["Gateway"],
        summary: "Execute an embeddings request through a company credential",
        description:
          "Calls the provider's embeddings API with the credential's decrypted fields. model defaults to the provider's first catalog embedding model. Returns the vector arrays. Audits provider.execute.embeddings.",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  credentialId: { type: "integer" },
                  providerKey: { type: "string" },
                  credentialKey: { type: "string" },
                  environmentKey: { type: "string" },
                  model: { type: "string" },
                  texts: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({
            providerKey: { type: "string" },
            model: { type: "string" },
            embeddings: { type: "array", items: { type: "array", items: { type: "number" } } },
            latencyMs: { type: "number" },
          })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Company, credential, or provider not found." },
          502: { description: "The provider returned an error — the upstream message is surfaced." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/assistants": {
      get: {
        tags: ["Gateway"],
        summary: "List assistants",
        description: "All assistants for the company from the x-company-name header (requireGatewayCompany → req.company).",
        responses: {
          200: RESP.ok(okBody({ assistants: { type: "array", items: { $ref: "#/components/schemas/Assistant" } } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          503: { description: "MySQL not configured." },
        },
      },
      post: {
        tags: ["Gateway"],
        summary: "Create an assistant",
        description:
          "Binds a company credential + a model (from that credential's provider) + knowledge bases into a runtime persona. Enforces the company assistant limit and ownership: credential ∈ company, model ∈ credential's provider, KBs (incl. primaryKbId) ∈ company. Audits assistant.created.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AssistantInput" },
            },
          },
        },
        responses: {
          201: RESP.ok(okBody({ message: { type: "string" }, assistantId: { type: "integer" }, assistantKey: { type: "string" } }), "Created."),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          409: { description: "Assistant key already exists, or the company assistant limit is reached." },
          503: { description: "MySQL not configured." },
        },
      },
    },
    "/gateway/assistants/{key}": {
      parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" }, description: "Assistant key (assistantKey)." }],
      get: {
        tags: ["Gateway"],
        summary: "Get an assistant",
        responses: {
          200: RESP.ok(okBody({ assistant: { $ref: "#/components/schemas/Assistant" } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Assistant not found." },
          503: { description: "MySQL not configured." },
        },
      },
      put: {
        tags: ["Gateway"],
        summary: "Update an assistant",
        description: "assistantKey is the route identity and is never editable; partial updates merge over the stored row. Ownership re-validated on changed refs. Audits assistant.updated.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AssistantInput" },
            },
          },
        },
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" }, assistantId: { type: "integer" }, assistantKey: { type: "string" } })),
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Assistant not found." },
          503: { description: "MySQL not configured." },
        },
      },
      delete: {
        tags: ["Gateway"],
        summary: "Delete an assistant",
        description: "Soft delete — the assistant can no longer be resolved. Audits assistant.deleted.",
        responses: {
          200: RESP.ok(okBody({ message: { type: "string" } })),
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { description: "Assistant not found." },
          503: { description: "MySQL not configured." },
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
        matches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              score: { type: "number" },
              metadata: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  url: { type: "string" },
                  type: { type: "string" },
                  slug: { type: "string" },
                  chunkIndex: { type: "integer" },
                },
              },
            },
          },
          description: "Full retrieval match set after reranking.",
        },
        graph: {
          type: "object",
          nullable: true,
          properties: {
            cypher: { type: "string", description: "The Cypher query executed." },
            context: { type: "string", description: "Formatted graph context injected into the prompt." },
          },
          description: "Present when GraphRAG is enabled and returns results.",
        },
        possibleQuestions: {
          type: "array",
          items: { type: "string" },
          description: "3-5 suggested follow-up questions generated from the answer.",
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
          "Flat key/value patch over COMPANY_KEYS: GENERAL (BASE_URL, CONTACT_US_URL, LOCATIONS_URL, SERVICES_URL, CONSULTANT_NAME, COMPANY_NAME), MODELS (EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, LLM_MODEL, SMALL_LLM, RERANKING_MODEL, AI_PROVIDER), STORAGE (VECTOR_INDEX, R2_BUCKET_NAME), ASSISTANT (ASSISTANT_KEY — the selected gateway assistant drives the chatbot's persona), CREDENTIALS (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_TOKEN_VALUE, R2_JURISDICTION_END_POINT, NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE).",
      },
      CompanyConfig: {
        type: "object",
        additionalProperties: true,
        description:
          "Grouped config: { GENERAL, MODELS, STORAGE, ASSISTANT, CREDENTIALS, AUTH: { API_KEY_ENABLED } }. Key lists match ConfigPatch; credentials are stored per-company and never seeded from env.",
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
      KnowledgeBaseInput: {
        type: "object",
        properties: {
          kbKey: { type: "string", description: "Create only; 3-63 chars, /^[a-z0-9-]+$/." },
          kbName: { type: "string" },
          description: { type: "string" },
          vectorResourceId: { type: "integer", description: "null → company config fallback." },
          storageResourceId: { type: "integer", description: "null → company config fallback." },
          embeddingModelId: { type: "integer", description: "null → company config fallback (F9 gate on @cf/ models)." },
          chunkSize: { type: "integer", default: 512 },
          chunkOverlap: { type: "integer", default: 50, description: "Validated no-op in M2." },
          retrievalTopK: { type: "integer", default: 10 },
          retrievalScoreThreshold: { type: "number", default: 0.7 },
          enableHybridSearch: { type: "boolean", default: true },
          enableGraphRag: { type: "boolean", default: false },
          isActive: { type: "boolean", default: true },
        },
      },
      KnowledgeBase: {
        type: "object",
        properties: {
          id: { type: "integer" },
          company_id: { type: "integer" },
          kb_key: { type: "string" },
          kb_name: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: ["active", "indexing", "error", "archived"] },
          vector_resource_name: { type: "string", description: "Denormalized from provider_resources (KB_SELECT join)." },
          vector_external_id: { type: "string" },
          graph_resource_name: { type: "string" },
          storage_resource_name: { type: "string" },
          storage_external_id: { type: "string" },
          embedding_model_key: { type: "string", description: "Denormalized catalog model key (F9 gate)." },
          embedding_model_name: { type: "string" },
          chunk_size: { type: "integer" },
          chunk_overlap: { type: "integer" },
          retrieval_top_k: { type: "integer" },
          retrieval_score_threshold: { type: "number" },
          enable_hybrid_search: { type: "boolean" },
          enable_graph_rag: { type: "boolean" },
          is_active: { type: "boolean" },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      KnowledgeBaseStatus: {
        type: "object",
        properties: {
          kbKey: { type: "string" },
          status: { type: "string", enum: ["active", "indexing", "error", "archived"] },
          inProgress: { type: "boolean" },
          lastSyncAt: { type: "string", format: "date-time", description: "Row updated_at (last status flip)." },
          documentCount: { type: "integer" },
          vectorCount: { type: "integer", nullable: true, description: "Best-effort; null when Vectorize is unreachable." },
          lastError: { type: "string", nullable: true },
        },
      },
      ProviderResourceInput: {
        type: "object",
        required: ["providerKey", "credentialId", "resourceType", "resourceKey", "resourceName"],
        properties: {
          providerKey: { type: "string", description: "Catalog provider key." },
          credentialId: { type: "integer", description: "Credential that owns this resource; must belong to the company AND the provider." },
          resourceType: { type: "string", enum: ["vector_index", "object_bucket", "sql_database", "kv_namespace", "graph_database", "embedding_index", "search_index", "cache_namespace"] },
          resourceKey: { type: "string", description: "3-63 chars, /^[a-z0-9-]+$/." },
          resourceName: { type: "string" },
          environmentKey: { type: "string", description: "Optional environment to attach the resource to." },
          externalResourceId: { type: "string" },
          externalResourceUrl: { type: "string", format: "uri" },
          externalRegion: { type: "string" },
          description: { type: "string" },
          config: { type: "object", description: "Type-specific settings per the provider's resource template config_schema." },
          isDefault: { type: "boolean", default: false },
        },
      },
      ProviderResource: {
        type: "object",
        properties: {
          id: { type: "integer" },
          company_id: { type: "integer" },
          credential_id: { type: "integer" },
          provider_id: { type: "integer" },
          environment_id: { type: "integer", nullable: true },
          resource_type: { type: "string" },
          resource_key: { type: "string" },
          resource_name: { type: "string" },
          external_resource_id: { type: "string" },
          external_resource_url: { type: "string" },
          external_region: { type: "string" },
          description: { type: "string" },
          config: { type: "object" },
          status: { type: "string" },
          is_default: { type: "boolean" },
          is_active: { type: "boolean" },
          last_health_check_at: { type: "string", format: "date-time", nullable: true },
          last_health_status: { type: "string", nullable: true },
          health_check_error: { type: "string", nullable: true },
          provisioned_at: { type: "string", format: "date-time", nullable: true },
          last_synced_at: { type: "string", format: "date-time", nullable: true },
          created_at: { type: "string", format: "date-time" },
          credential_key: { type: "string", description: "Denormalized from credentials." },
          credential_name: { type: "string" },
          provider_key: { type: "string", description: "Denormalized from providers." },
          provider_name: { type: "string" },
          env_key: { type: "string", nullable: true, description: "Denormalized from company_environments." },
        },
      },
      AssistantInput: {
        type: "object",
        required: ["assistantKey", "assistantName", "credentialId"],
        properties: {
          assistantKey: { type: "string", description: "3-63 chars, /^[a-z0-9-]+$/." },
          assistantName: { type: "string" },
          description: { type: "string" },
          credentialId: { type: "integer", description: "Must belong to the company." },
          modelId: { type: "integer", description: "Catalog model; must belong to the credential's provider. modelKey stored as a snapshot." },
          primaryKbId: { type: "integer", description: "Primary knowledge base; must belong to the company." },
          kbIds: { type: "array", items: { type: "integer" }, description: "Knowledge bases the assistant can retrieve from; each must belong to the company." },
          systemPrompt: { type: "string" },
          variables: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string", description: "Variable name used in {{KEY}} syntax." },
                value: { type: "string", description: "Value injected into the prompt." },
              },
              required: ["key", "value"],
            },
            description: "Custom prompt variables injected into the system prompt at runtime.",
          },
          temperature: { type: "number", default: 0.7, minimum: 0, maximum: 2 },
          maxTokens: { type: "integer", default: 4096 },
          enableFunctionCalling: { type: "boolean", default: true },
          enableStreaming: { type: "boolean", default: true },
          enableGraphContext: { type: "boolean", default: false },
          graphResourceId: { type: "integer", description: "Graph resource for graph context; must belong to the company." },
          isPublic: { type: "boolean", default: false },
          isActive: { type: "boolean", default: true },
        },
      },
      Assistant: {
        type: "object",
        properties: {
          id: { type: "integer" },
          company_id: { type: "integer" },
          assistant_key: { type: "string" },
          assistant_name: { type: "string" },
          description: { type: "string" },
          credential_id: { type: "integer" },
          model_id: { type: "integer", nullable: true },
          system_prompt: { type: "string" },
          assistant_variables: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                value: { type: "string" },
              },
            },
            description: "Custom prompt variables (JSON array of {key, value}).",
          },
          temperature: { type: "number" },
          max_tokens: { type: "integer" },
          enable_function_calling: { type: "boolean" },
          enable_streaming: { type: "boolean" },
          tools: { type: "array", items: { type: "object" } },
          primary_kb_id: { type: "integer", nullable: true },
          kb_ids: { type: "array", items: { type: "integer" }, description: "Parsed JSON array." },
          enable_graph_context: { type: "boolean" },
          graph_resource_id: { type: "integer", nullable: true },
          is_active: { type: "boolean" },
          is_public: { type: "boolean" },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
          credential_key: { type: "string", description: "Denormalized from credentials." },
          credential_name: { type: "string" },
          provider_key: { type: "string", description: "Denormalized from the credential's provider." },
          provider_name: { type: "string" },
          model_key: { type: "string", description: "Denormalized from provider_models." },
          model_name: { type: "string" },
          primary_kb_name: { type: "string", description: "Denormalized from knowledge_bases." },
        },
      },
    },
  },
};

export default openapi;
