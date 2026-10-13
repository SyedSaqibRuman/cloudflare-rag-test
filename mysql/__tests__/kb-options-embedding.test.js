// --------------------------
// KB OPTIONS EMBEDDING PARTITION TESTS
// GET /gateway/kbs/options feeds the wizard's Storage & Search step. Its
// Embedding Model dropdown must list ONLY models this company can actually
// call — provider has an embedding adapter AND the company holds an active
// credential. The catalog is global, so without the partition an admin can
// bind e.g. a Jina/Voyage model to a company with no such connection and only
// find out at ingest time (unsupported provider / 401).
// Real express mount, stubbed repositories — no MySQL, no network.
// Run with: node --test mysql/__tests__/kb-options-embedding.test.js
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.MYSQL_HOST = "127.0.0.1";
process.env.MYSQL_DATABASE = "gateway_test";
process.env.MYSQL_USER = "test";
process.env.MYSQL_PASSWORD = "test";
process.env.APP_ENCRYPTION_KEY = "cd".repeat(32);

const {
  CompanyRepository,
  CredentialRepository,
  ResourceRepository,
  ModelRepository,
} = await import("../repositories.js");
const gatewayRouter = (await import("../gateway-router.js")).default;

const COMPANY = { id: 2, company_key: "acme" };

// Global catalog slice: two usable providers (cloudflare, nvidia) plus ones the
// company has no credential for / no adapter for.
const CATALOG_MODELS = [
  { id: 1, provider_key: "cloudflare", provider_name: "Cloudflare", model_name: "bge-base" },
  { id: 2, provider_key: "nvidia", provider_name: "NVIDIA NIM", model_name: "nemotron" },
  { id: 3, provider_key: "jina", provider_name: "Jina AI", model_name: "jina-embed-v3" },
  { id: 4, provider_key: "voyage", provider_name: "Voyage AI", model_name: "voyage-3" },
  { id: 5, provider_key: "openai", provider_name: "OpenAI", model_name: "text-embedding-3-small" },
];

function stubRepos({ credentials, credentialsThrow = false }) {
  const originals = {
    findByKey: CompanyRepository.findByKey,
    listByCompany: CredentialRepository.listByCompany,
    listByProvider: CredentialRepository.listByProvider,
    listResources: ResourceRepository.listByCompany,
    listByCategory: ModelRepository.listByCategory,
  };
  CompanyRepository.findByKey = async (key) => (key === COMPANY.company_key ? COMPANY : null);
  CredentialRepository.listByCompany = async () => {
    if (credentialsThrow) throw new Error("pool down");
    return credentials;
  };
  CredentialRepository.listByProvider = async () => [];
  ResourceRepository.listByCompany = async () => [];
  ModelRepository.listByCategory = async (category) =>
    category === "embedding" ? CATALOG_MODELS : [];
  return () => {
    CompanyRepository.findByKey = originals.findByKey;
    CredentialRepository.listByCompany = originals.listByCompany;
    CredentialRepository.listByProvider = originals.listByProvider;
    ResourceRepository.listByCompany = originals.listResources;
    ModelRepository.listByCategory = originals.listByCategory;
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function getOptions(server) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/gateway/kbs/options`, {
    headers: { "x-company-name": COMPANY.company_key },
  });
  return { status: res.status, json: await res.json() };
}

async function withOptions(stub, fn) {
  const restore = stubRepos(stub);
  const app = express();
  app.use(express.json());
  app.use("/gateway", gatewayRouter);
  const server = await listen(app);
  try {
    return await fn(server);
  } finally {
    restore();
    server.close();
  }
}

test("kbs/options offers only embedding models the company can call", async () => {
  await withOptions(
    {
      credentials: [
        { provider_key: "cloudflare", is_active: 1 },
        { provider_key: "nvidia", is_active: 1 },
        { provider_key: "qdrant", is_active: 1 },
      ],
    },
    async (server) => {
      const { status, json } = await getOptions(server);
      assert.equal(status, 200);
      const { availableEmbeddingModels, unavailableEmbeddingModels, embeddingModels } = json.options;
      // cloudflare + nvidia have adapters AND credentials.
      assert.deepEqual(availableEmbeddingModels.map((m) => m.id), [1, 2]);
      // jina/voyage: no adapter. openai: adapter but no credential here.
      assert.deepEqual(unavailableEmbeddingModels.map((m) => m.id), [3, 4, 5]);
      // The raw catalog is still returned for the review step / back-compat.
      assert.equal(embeddingModels.length, CATALOG_MODELS.length);
    }
  );
});

test("kbs/options hides everything when the company has no AI credentials", async () => {
  await withOptions({ credentials: [{ provider_key: "qdrant", is_active: 1 }] }, async (server) => {
    const { json } = await getOptions(server);
    assert.deepEqual(json.options.availableEmbeddingModels, []);
    assert.equal(json.options.unavailableEmbeddingModels.length, CATALOG_MODELS.length);
  });
});

test("kbs/options surfaces an openai model once the company connects openai", async () => {
  await withOptions(
    {
      credentials: [
        { provider_key: "cloudflare", is_active: 1 },
        { provider_key: "openai", is_active: 1 },
      ],
    },
    async (server) => {
      const { json } = await getOptions(server);
      // cloudflare + the newly connected openai model; nvidia still unconnected.
      assert.deepEqual(json.options.availableEmbeddingModels.map((m) => m.id), [1, 5]);
    }
  );
});

test("kbs/options degrades to an empty offer when the credential lookup fails", async () => {
  await withOptions({ credentials: [], credentialsThrow: true }, async (server) => {
    // The route's .catch() must swallow the read error and offer nothing rather
    // than 500 the whole options payload the wizard needs.
    const { status, json } = await getOptions(server);
    assert.equal(status, 200);
    assert.deepEqual(json.options.availableEmbeddingModels, []);
    assert.ok(Array.isArray(json.options.embeddingModels));
  });
});
