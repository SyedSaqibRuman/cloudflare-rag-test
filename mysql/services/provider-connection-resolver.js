// --------------------------
// PROVIDER CONNECTION RESOLVER
// Resolves credentials, providers, environments and encrypted fields into
// structured connection objects for ingestion pipeline adapters. This lives in
// the services layer (no SQL) and can be unit-tested without a database by
// mocking the repository calls.
// --------------------------

import { CredentialRepository } from "../repositories.js";
import { ProviderRepository } from "../repositories/provider.js";
import { ModelRepository } from "../repositories/model.js";
import { decryptCredential } from "./credential-service.js";
import { NotFoundError } from "../../shared/errors.js";

export async function resolveResourceConnection(resource) {
  // Resolve provider connection from a resource row
  // Returns: { providerKey, credentials: { decryptedFields }, provider, environment }

  const cred = await CredentialRepository.findWithEncrypted(resource.credential_id);
  if (!cred) throw new NotFoundError(`Credential not found for resource ${resource.id}`, "CREDENTIAL_NOT_FOUND");

  const provider = await ProviderRepository.findById(cred.provider_id);
  if (!provider) throw new NotFoundError(`Provider not found for credential ${cred.id}`, "PROVIDER_NOT_FOUND");

  const decrypted = decryptCredential(cred.encrypted_credentials);

  const env = cred.environment_id
    ? await import("../repositories/company-environment.js").then((m) => m.CompanyEnvironmentRepository.findById(cred.environment_id))
    : null;

  return {
    providerKey: provider.provider_key,
    provider,
    environment: env,
    credentials: decrypted,
    resource,
    credential: cred,
  };
}

export async function resolveEmbeddingModel(modelId) {
  // Resolve model + provider for embedding
  // Returns: { providerKey, modelKey, model, provider }

  const model = await ModelRepository.findById(modelId);
  if (!model) throw new NotFoundError(`Model not found: ${modelId}`, "MODEL_NOT_FOUND");

  const provider = await ProviderRepository.findById(model.provider_id);
  if (!provider) throw new NotFoundError(`Provider not found for model ${modelId}`, "PROVIDER_NOT_FOUND");

  return {
    providerKey: provider.provider_key,
    modelKey: model.model_key,
    model,
    provider,
  };
}

/**
 * Backfill a company’s RAG credentials from all its gateway connections.
 * This is used by rag-sync.js and tests to bootstrap the config store.
 * Returns { syncedKeys: string[] }
 */
export async function backfillRagCredentials(companyKey) {
  const company = await import("../repositories/company.js").then((m) => m.CompanyRepository.findByKey(companyKey));
  if (!company) throw new NotFoundError(`Gateway company '${companyKey}' not found.`, "COMPANY_NOT_FOUND");

  const rows = await CredentialRepository.listByCompany(company.id, {
    includeStored: true,
    includeInactive: true,
  });
  const patch = {};

  for (const row of rows) {
    try {
      const decrypted = decryptCredential(row.encrypted_credentials);
      Object.assign(patch, ragPatchFor(decrypted, { providerKey: row.provider_key }));
    } catch {
      /* malformed blob — skip */
    }
  }

  // Resources contribute RAG keys too (graph_database → NEO4J_DATABASE).
  const resources = await import("../repositories/resource.js").then((m) => m.ResourceRepository.listByCompany(company.id));
  for (const row of resources) {
    Object.assign(patch, ragPatchForResource(row));
  }

  await import("../../config/index.js").then((m) => m.updateCompany(companyKey, patch));
  return { syncedKeys: Object.keys(patch) };
}

// Functions from rag-sync.js to keep the module import-friendly
function ragPatchFor(fields, { providerKey = null } = {}) {
  const FIELD_TO_RAG_KEY = {
    api_token: "CLOUDFLARE_API_TOKEN",
    account_id: "CLOUDFLARE_ACCOUNT_ID",
    access_key_id: "R2_ACCESS_KEY_ID",
    secret_access_key: "R2_SECRET_ACCESS_KEY",
  };

  const NEO4J_FIELD_TO_RAG_KEY = {
    uri: "NEO4J_URI",
    username: "NEO4J_USERNAME",
    password: "NEO4J_PASSWORD",
  };

  const map = providerKey === "neo4j" ? { ...FIELD_TO_RAG_KEY, ...NEO4J_FIELD_TO_RAG_KEY } : FIELD_TO_RAG_KEY;

  const patch = {};
  for (const [field, ragKey] of Object.entries(map)) {
    const value = fields?.[field];
    if (value && String(value).trim()) patch[ragKey] = String(value).trim();
  }
  return patch;
}

function ragPatchForResource({ resourceType, config }) {
  if (resourceType !== "graph_database") return {};
  const database = config?.database_name;
  return database && String(database).trim() ? { NEO4J_DATABASE: String(database).trim() } : {};
}