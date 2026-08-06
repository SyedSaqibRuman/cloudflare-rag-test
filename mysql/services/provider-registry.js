// --------------------------
// PROVIDER REGISTRY
// Single source of truth for provider metadata, backed by the global catalog
// tables (providers, provider_auth_schemas, provider_resource_types,
// provider_capabilities, provider_models + pricing). Loads once, caches, and
// exposes the shapes that drive the dynamic credential forms and resource
// provisioning UI. Call refresh() after catalog changes (e.g. a migration or
// a provider row insert) or let the health worker do it periodically.
// --------------------------
import {
  ProviderRepository,
  ModelRepository,
} from "../repositories.js";

let cache = null;
let loading = null;

export function isRegistryLoaded() {
  return cache !== null;
}

/** Drop the in-memory cache so the next access re-reads the catalog. */
export function invalidateRegistry() {
  cache = null;
}

/**
 * Load (or refresh) the provider catalog into memory.
 * @returns {Promise<Array>} providers with nested capabilities/auth form/resource templates/models
 */
export async function refreshRegistry() {
  const providers = await ProviderRepository.list();
  cache = {
    providers,
    byKey: new Map(),
  };
  for (const provider of providers) {
    const [capabilities, authForm, resourceTemplates, models] = await Promise.all([
      ProviderRepository.capabilities(provider.id),
      ProviderRepository.authForm(provider.id),
      ProviderRepository.resourceTemplates(provider.id),
      ModelRepository.listByProvider(provider.id),
    ]);
    const entry = {
      ...provider,
      capabilities,
      authForm,
      resourceTemplates,
      models,
    };
    cache.byKey.set(provider.provider_key, entry);
  }
  return providers;
}

async function load() {
  if (cache) return cache;
  if (!loading) {
    loading = refreshRegistry().finally(() => {
      loading = null;
    });
  }
  await loading;
  return cache;
}

/** All providers (lightweight — id/key/name/category). */
export async function listProviders() {
  const state = await load();
  return state.providers.map(({ id, provider_key, provider_name, primary_service_category, auth_type }) => ({
    id,
    providerKey: provider_key,
    providerName: provider_name,
    category: primary_service_category,
    authType: auth_type,
  }));
}

/** Full provider entry (capabilities, auth form, resource templates, models). */
export async function getProvider(providerKey) {
  const state = await load();
  return state.byKey.get(providerKey) || null;
}

/** Auth-form rows for the dynamic credential form. */
export async function getAuthForm(providerKey) {
  const p = await getProvider(providerKey);
  return p ? p.authForm : null;
}

/** Resource-provisioning templates for the wizard UI. */
export async function getResourceTemplates(providerKey) {
  const p = await getProvider(providerKey);
  return p ? p.resourceTemplates : null;
}

/** Active models with current pricing for the model-access picker. */
export async function getModels(providerKey) {
  const p = await getProvider(providerKey);
  return p ? p.models : null;
}

/** Convenience: resolve provider_key from a provider id (null when unknown). */
export async function providerKeyById(providerId) {
  const state = await load();
  for (const p of state.providers) {
    if (p.id === providerId) return p.provider_key;
  }
  return null;
}
