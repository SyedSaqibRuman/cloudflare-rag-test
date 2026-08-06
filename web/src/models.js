// Single source of truth for config key vocabulary and model lists:
// re-exported from the backend's config/schema.js so the frontend can never
// drift from the API. Add a model or key there, and it shows up here.
import {
  ALLOWED_MODELS,
  EMBEDDING_DIMENSIONS,
  URL_KEYS,
  STRING_KEYS,
  RESOURCE_KEYS,
  CREDENTIAL_KEYS,
} from "../../config/schema.js";

export const EMBEDDING_MODELS = ALLOWED_MODELS.EMBEDDING_MODEL;
export const LLM_MODELS = ALLOWED_MODELS.LLM_MODEL;
export const SMALL_LLMS = ALLOWED_MODELS.SMALL_LLM;
export const RERANKING_MODELS = ALLOWED_MODELS.RERANKING_MODEL;

export const GENERAL_KEYS = [...URL_KEYS, ...STRING_KEYS];
export const STORAGE_KEYS = RESOURCE_KEYS;

export { EMBEDDING_DIMENSIONS, CREDENTIAL_KEYS };

export const JOB_IDS = ["ingest", "testing"];
