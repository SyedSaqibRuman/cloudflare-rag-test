export const EMBEDDING_MODELS = [
  "@cf/baai/bge-base-en-v1.5",
  "@cf/baai/bge-large-en-v1.5",
  "@cf/baai/bge-small-en-v1.5",
  "@cf/baai/bge-m3",
  "@cf/llmware/bge-small-en-v1.5",
  "@cloudflare/coding-gemma",
];

export const LLM_MODELS = [
  "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/meta/llama-3.3-70b-instruct-fp8",
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/meta/llama-3.1-70b-instruct",
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
];

export const SMALL_LLMS = [
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/meta/llama-3.2-1b-instruct",
];

export const RERANKING_MODELS = [
  "@cf/baai/bge-reranker-base",
  "@cf/baai/bge-reranker-large",
];

export const EMBEDDING_DIMENSIONS = {
  "@cf/baai/bge-base-en-v1.5": 768,
  "@cf/baai/bge-large-en-v1.5": 1024,
  "@cf/baai/bge-small-en-v1.5": 384,
  "@cf/baai/bge-m3": 1024,
  "@cf/llmware/bge-small-en-v1.5": 384,
};

export const GENERAL_KEYS = [
  "BASE_URL",
  "CONTACT_US_URL",
  "LOCATIONS_URL",
  "SERVICES_URL",
  "CONSULTANT_NAME",
  "COMPANY_NAME",
];

export const STORAGE_KEYS = ["VECTOR_INDEX", "R2_BUCKET_NAME"];

export const JOB_IDS = ["ingest", "testing"];
