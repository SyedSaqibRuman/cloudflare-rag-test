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
  EndpointRepository,
  PricingRepository,
} from "../repositories.js";
import * as CatalogService from "./catalog-service.js";

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
 *
 * BULK-loaded: the five child tables are fetched with one query each (IN
 * clause over all provider ids) and grouped in memory, instead of the old
 * per-provider N+1 (122 providers × 5 queries = 610 round trips that took
 * ~4s against a remote MySQL). Six queries total now — the first load and
 * every post-invalidate rebuild are equally fast.
 * @returns {Promise<Array>} providers with nested capabilities/auth form/resource templates/models
 */
export async function refreshRegistry() {
  const providers = await ProviderRepository.list();
  const ids = providers.map((p) => p.id);
  const [capabilities, authForms, resourceTemplates, models, endpoints] = await Promise.all([
    ProviderRepository.capabilitiesByProviderIds(ids),
    ProviderRepository.authFormsByProviderIds(ids),
    ProviderRepository.resourceTemplatesByProviderIds(ids),
    ModelRepository.listByProviderIds(ids),
    EndpointRepository.listByProviderIds(ids),
  ]);
  const byProvider = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const list = map.get(row.provider_id);
      if (list) list.push(row);
      else map.set(row.provider_id, [row]);
    }
    return map;
  };
  const capByProvider = byProvider(capabilities);
  const formByProvider = byProvider(authForms);
  const tmplByProvider = byProvider(resourceTemplates);
  const modelsByProvider = byProvider(models);
  const endpointsByProvider = byProvider(endpoints);
  const entries = [];
  cache = {
    providers: entries,
    byKey: new Map(),
  };
  for (const provider of providers) {
    const entry = {
      ...provider,
      capabilities: capByProvider.get(provider.id) || [],
      authForm: formByProvider.get(provider.id) || [],
      resourceTemplates: tmplByProvider.get(provider.id) || [],
      models: modelsByProvider.get(provider.id) || [],
      endpoints: endpointsByProvider.get(provider.id) || [],
    };
    entries.push(entry);
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

/** All providers — lightweight list enriched with the stats the catalog UI needs
 * (models/endpoints/capability counts, supported capability keys, pricing flag).
 * Compute-only: the registry already eagerly loaded the nested data. */
export async function listProviders() {
  const state = await load();
  return state.providers.map((entry) => {
    const { id, provider_key, provider_name, primary_service_category, auth_type } = entry;
    const capabilityKeys = entry.capabilities.filter((c) => c.is_supported).map((c) => c.capability_key);
    return {
      id,
      providerKey: provider_key,
      providerName: provider_name,
      category: primary_service_category,
      authType: auth_type,
      logoUrl: entry.logo_url ?? null,
      websiteUrl: entry.website_url ?? null,
      documentationUrl: entry.documentation_url ?? null,
      isActive: entry.is_active,
      roundRobinEnabled: !!entry.round_robin_enabled,
      models: entry.models.length,
      endpoints: entry.endpoints.length,
      capabilities: capabilityKeys.length,
      capabilityKeys,
      hasPricing: entry.models.some(
        (m) => m.input_price_per_million != null || m.output_price_per_million != null
      ),
    };
  });
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

/**
 * Endpoints for one provider (from the cache) or for all providers when
 * providerKey is omitted.
 * @param {string} [providerKey]
 */
export async function listEndpoints(providerKey) {
  if (providerKey) {
    const p = await getProvider(providerKey);
    return p ? p.endpoints : null;
  }
  return EndpointRepository.list();
}

/** Full price history for one provider (flat query — history stays uncached, D1). */
export function listPricing(providerKey) {
  return PricingRepository.list({ providerKey });
}

/** Price history filtered by model id, provider key, or both. */
export function listPricingByModel(providerModelId, providerKey) {
  return PricingRepository.list({ providerModelId, providerKey });
}

/** Single endpoint row (used by routes for 404 checks + audit before-state). */
export async function getEndpointById(id) {
  return EndpointRepository.findById(id);
}

/** Single model row (used by routes for audit after-state enrichment). */
export async function getModelById(id) {
  return ModelRepository.findById(id);
}

/** Single pricing row (used by routes for 404 checks + audit before-state). */
export async function getPricingById(id) {
  return PricingRepository.findById(id);
}

/**
 * Create an endpoint. Validates, writes through the repository transaction,
 * then drops the registry cache (F7) so subsequent reads see it.
 * @returns {Promise<{id: number}>}
 */
export async function saveEndpoint(input) {
  const result = await CatalogService.saveEndpoint(input);
  invalidateRegistry();
  return result;
}

/** Update an endpoint and drop the registry cache (F7). */
export async function updateEndpoint(id, input) {
  const result = await CatalogService.updateEndpoint(id, input);
  invalidateRegistry();
  return result;
}

/** Remove an endpoint (guarded against resource-type references) + cache drop. */
export async function removeEndpoint(id, opts) {
  const result = await CatalogService.removeEndpoint(id, opts);
  invalidateRegistry();
  return result;
}

/** Create a pricing row (closing the open row on overlap) + cache drop. */
export async function savePricing(input) {
  const result = await CatalogService.savePricing(input);
  invalidateRegistry();
  return result;
}

/** Update a pricing row + cache drop. */
export async function updatePricing(id, input) {
  const result = await CatalogService.updatePricing(id, input);
  invalidateRegistry();
  return result;
}

/** Remove a pricing row + cache drop. */
export async function removePricing(id) {
  const result = await CatalogService.removePricing(id);
  invalidateRegistry();
  return result;
}
