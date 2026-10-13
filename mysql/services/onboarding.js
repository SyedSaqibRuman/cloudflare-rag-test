// --------------------------
// ONBOARDING — auto-create default KB + assistant from company_config
// When a company has no KBs or assistants, this creates sensible defaults
// from the existing RAG config (VECTOR_INDEX, EMBEDDING_MODEL, etc.).
// --------------------------
import { KbRepository, AssistantRepository, AuditRepository } from "../repositories.js";
import { getCompanyConfig } from "../../config/index.js";

/**
 * Check if a company needs onboarding (no KBs or assistants).
 * @param {number} companyId
 * @returns {Promise<boolean>}
 */
export async function needsOnboarding(companyId) {
  const kbs = await KbRepository.listByCompany(companyId);
  const assistants = await AssistantRepository.listByCompany(companyId);
  return kbs.length === 0 && assistants.length === 0;
}

/**
 * Create default KB + assistant from company_config.
 * Idempotent — skips if KBs already exist.
 * @param {Object} company - { id, company_key }
 * @returns {Promise<{ kbCreated: boolean, assistantCreated: boolean }>}
 */
export async function onboardCompany(company) {
  const kbs = await KbRepository.listByCompany(company.id);
  if (kbs.length > 0) return { kbCreated: false, assistantCreated: false };

  const config = getCompanyConfig(company.company_key) || {};

  // Create a default KB from company_config
  const kbData = {
    kb_key: `${company.company_key}-default`,
    kb_name: `${company.company_key} Default KB`,
    description: "Default knowledge base created during onboarding",
    vector_external_id: config.VECTOR_INDEX || null,
    storage_external_id: config.R2_BUCKET_NAME || null,
    embedding_model_provider: config.EMBEDDING_MODEL || "bge-base",
    chunk_size: config.CHUNK_SIZE || 512,
    chunk_overlap: config.CHUNK_OVERLAP || 50,
    retrieval_top_k: config.RETRIEVAL_TOP_K || 10,
    retrieval_score_threshold: config.RETRIEVAL_SCORE_THRESHOLD || 0.7,
    enable_hybrid_search: config.ENABLE_HYBRID_SEARCH !== false,
    status: "active",
    is_active: true,
  };

  await KbRepository.create(company.id, kbData);

  // Create a default assistant
  const assistantData = {
    assistant_key: `${company.company_key}-assistant`,
    assistant_name: `${company.company_key} Assistant`,
    system_prompt: config.SYSTEM_PROMPT || "You are a helpful assistant.",
    temperature: config.TEMPERATURE || 0.7,
    max_tokens: config.MAX_TOKENS || 4096,
    is_active: true,
  };

  await AssistantRepository.create(company.id, assistantData);

  // Audit
  await AuditRepository.log({
    companyId: company.id,
    action: "company.onboarded",
    entityType: "company",
    entityId: String(company.id),
    afterState: { kbKey: kbData.kb_key, assistantKey: assistantData.assistant_key },
  }).catch(() => {});

  console.log(`🎉 Onboarded company '${company.company_key}': KB '${kbData.kb_key}', Assistant '${assistantData.assistant_key}'`);

  return { kbCreated: true, assistantCreated: true, kbKey: kbData.kb_key, assistantKey: assistantData.assistant_key };
}
