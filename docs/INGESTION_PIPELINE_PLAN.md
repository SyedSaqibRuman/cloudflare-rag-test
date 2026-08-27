# Ingestion Pipeline v5 Implementation Plan

**Status:** 📋 Planning  
**Last Updated:** 2026-08-20  
**Author:** Hermes Agent  
**Target:** Refactor ingestion pipeline to follow v5 architecture where Knowledge Base controls all infrastructure bindings

---

## Table of Contents

1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [v5 Architecture Requirements](#v5-architecture-requirements)
4. [Implementation Phases](#implementation-phases)
5. [Detailed Tasks](#detailed-tasks)
6. [Testing Strategy](#testing-strategy)
7. [Rollout Plan](#rollout-plan)

---

## Overview

The current ingestion pipeline (`ingest.js`/`ingest/pipeline.js`) hardcodes Cloudflare R2 and Vectorize in its execution path. This violates the v5 architectural principle where:

> **Knowledge Base controls all resource bindings**

This plan details the refactoring needed to make the ingestion pipeline infrastructure-agnostic.

---

## Problem Statement

### Current State (Violating v5)

```
ingest.js:main()
  ├── Calls getR2Bucket(companyName) directly
  ├── Calls getVectorIndex(companyName) directly
  ├── Hardcodes embedding model from company_config
  └── No provider/credential resolution
```

### v5 Expected State

```
ingest.js:main()
  ├── Resolve KB row by kbKey
  ├── Resolve resource_id → credential_id → provider
  ├── Resolve credential → decrypted fields
  ├── Resolve embedding_model_id → provider
  └── Inject appropriate adapters (storage/embedding/index)
```

### Missing Abstractions

1. **Storage adapter factory** - R2/S3/other object stores
2. **Embedding adapter factory** - Cloudflare AI/OpenAI/NVIDIA/etc.
3. **Vector adapter factory** - Vectorize/Pinecone/Weaviate/etc.
4. **Source adapter factory** - WordPress/API/mixed documents

---

## v5 Architecture Requirements

### Knowledge Base Schema Reference

```sql
knowledge_bases (
  kb_key,
  embedding_model_id → provider_models.id → provider
  vector_resource_id → provider_resources (storage)
  storage_resource_id → provider_resources (storage)
  graph_resource_id → provider_resources (optional)
)
```

### Resource Binding Resolution Path

```
KB Row
  ├─> Resource Row (via *resource_id)
  │     ├─> Credential Row (credential_id)
  │     │     ├─> Provider Row (via credential.provider_id)
  │     │     └─> encrypted_credentials → decrypt → fields
  │     └─> Provider Row (provider_id)
  └─> Model Row (via embedding_model_id)
        ├─> Provider Row (provider_id)
        └─> category='embedding'
```

### Adapter Contract

Each adapter must implement:

```typescript
// Storage Adapter
interface StorageAdapter {
  ensureBucket(): Promise<void>;
  saveContent(name: string, markdown: string): Promise<void>;
  uploadChunk(r2Key: string, payload: object): Promise<void>;
}

// Embedding Adapter
interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
}

// Vector Adapter
interface VectorAdapter {
  ensureIndex(): Promise<void>;
  upsert(chunks: Array<{id, text, metadata}>): Promise<void>;
}

// Source Adapter
interface SourceAdapter {
  fetchPages(type: 'posts'|'pages', page: number): Promise<Article[]>;
}
```

---

## Implementation Phases

### Phase 1: Credential & Provider Resolution Layer

**Goal:** Build factories to resolve providers from credentials

**Deliverables:**
- `mysql/services/provider-connection-resolver.js` - DB resolution logic
- `mysql/adapters/storage/factory.js` - Storage client factory
- `mysql/adapters/embedding/factory.js` - Embedding client factory
- `mysql/adapters/vector/factory.js` - Vector client factory
- `mysql/adapters/source/factory.js` - Source client factory

### Phase 2: Adapter Implementations

**Goal:** Implement concrete adapters for each infrastructure type

**Deliverables:**
- `mysql/adapters/storage/cloudflare-r2.js`
- `mysql/adapters/storage/s3.js`
- `mysql/adapters/embedding/cloudflare-ai.js`
- `mysql/adapters/embedding/openai.js`
- `mysql/adapters/vector/cloudflare-vectorize.js`
- `mysql/adapters/vector/pinecone.js`
- `mysql/adapters/source/wordpress.js`

### Phase 3: Ingestion Orchestrator Refactor

**Goal:** Wire adapters into the ingestion pipeline

**Deliverables:**
- Updated `ingest.js:main()` with KB-driven resolution
- Updated `ingest/pipeline.js` with injected adapters
- Fallback handling for legacy company-config-only mode

### Phase 4: Testing & Validation

**Goal:** Ensure backward compatibility and new functionality

**Deliverables:**
- Unit tests for all adapters
- Integration tests for resolution path
- E2E test for cross-provider ingestion
- Migration guide for existing companies

---

## Detailed Tasks

### Task 1.1: Create Provider Connection Resolver

**File:** `mysql/services/provider-connection-resolver.js`

```javascript
/**
 * Resolve provider connection from resource ID
 * Returns { providerKey, credentials, decryptedFields }
 */
export async function resolveResourceConnection(resourceId) {
  // 1. Fetch resource row
  // 2. Fetch credential row
  // 3. Fetch provider row
  // 4. Decrypt credentials
  // 5. Return resolved connection
}

/**
 * Resolve embedding model connection from model_id
 */
export async function resolveEmbeddingModel(modelId) {
  // 1. Fetch model row
  // 2. Fetch provider row
  // 3. Return { providerKey, modelKey }
}
```

**Estimated time:** 30 min

### Task 1.2: Create Storage Adapter Factory

**File:** `mysql/adapters/storage/factory.js`

```javascript
import { CloudflareR2Adapter } from "./cloudflare-r2.js";
import { S3Adapter } from "./s3.js";

export function createStoreAdapter(providerKey, credentials) {
  switch (providerKey) {
    case "cloudflare":
      return new CloudflareR2Adapter(credentials);
    case "aws":
      return new S3Adapter(credentials);
    default:
      throw new Error(`Unsupported storage provider: ${providerKey}`);
  }
}
```

**Estimated time:** 20 min

### Task 1.3: Create Storage: Cloudflare R2 Adapter

**File:** `mysql/adapters/storage/cloudflare-r2.js`

```javascript
import { S3Client, PutObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

export class CloudflareR2Adapter {
  constructor({ accountId, apiToken, bucketName, endpoint }) {
    this.bucketName = bucketName;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: apiToken.accessKeyId,
        secretAccessKey: apiToken.secretAccessKey,
      },
    });
  }

  async ensureBucket() {
    // R2 buckets are created on first upload
  }

  async saveContent(name, markdown) {
    // Save to local cache for fallback
  }

  async uploadChunk(r2Key, payload) {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: r2Key,
      Body: JSON.stringify(payload),
      ContentType: "application/json",
    });
    return this.client.send(command);
  }
}
```

**Estimated time:** 45 min

### Task 1.4: Create Storage: AWS S3 Adapter

**File:** `mysql/adapters/storage/s3.js`

```javascript
import { S3Client, PutObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

export class S3Adapter {
  constructor({ accessKeyId, secretAccessKey, region, bucketName, endpoint }) {
    this.bucketName = bucketName;
    this.client = new S3Client({
      region: region || "us-east-1",
      endpoint: endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async ensureBucket() {
    if (this.bucketName) return;
    throw new Error("S3 bucket name not configured");
  }

  async uploadChunk(key, payload) {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: JSON.stringify(payload),
      ContentType: "application/json",
    });
    return this.client.send(command);
  }
}
```

**Estimated time:** 30 min

### Task 1.5: Create Embedding Adapter Factory

**File:** `mysql/adapters/embedding/factory.js`

```javascript
import { CloudflareAIEmbeddingAdapter } from "./cloudflare-ai.js";
import { OpenAIEmbeddingAdapter } from "./openai.js";

export function createEmbeddingAdapter(providerKey, credentials, modelKey) {
  switch (providerKey) {
    case "cloudflare":
      return new CloudflareAIEmbeddingAdapter(credentials, modelKey);
    case "openai":
      return new OpenAIEmbeddingAdapter(credentials, modelKey);
    default:
      throw new Error(`Unsupported embedding provider: ${providerKey}`);
  }
}
```

**Estimated time:** 15 min

### Task 1.6: Create Embedding: Cloudflare AI Adapter

**File:** `mysql/adapters/embedding/cloudflare-ai.js`

```javascript
import { Cloudflare } from "cloudflare";

export class CloudflareAIEmbeddingAdapter {
  constructor({ accountId, apiToken }, modelKey) {
    this.cf = new Cloudflare({
      apiToken: apiToken,
    });
    this.accountId = accountId;
    this.modelKey = modelKey;
  }

  async embed(text) {
    const response = await this.cf.ai.run(`@cf/${this.modelKey}`, {
      text: text,
    });
    return response.data;
  }
}
```

**Estimated time:** 30 min

### Task 1.7: Create Embedding: OpenAI Adapter

**File:** `mysql/adapters/embedding/openai.js`

```javascript
import OpenAI from "openai";

export class OpenAIEmbeddingAdapter {
  constructor({ apiKey }, modelKey) {
    this.client = new OpenAI({ apiKey });
    this.modelKey = modelKey;
  }

  async embed(text) {
    const response = await this.client.embeddings.create({
      model: this.modelKey,
      input: text,
    });
    return response.data[0].embedding;
  }
}
```

**Estimated time:** 20 min

### Task 1.8: Create Vector Adapter Factory

**File:** `mysql/adapters/vector/factory.js`

```javascript
import { CloudflareVectorAdapter } from "./cloudflare-vectorize.js";

export function createVectorAdapter(providerKey, credentials) {
  switch (providerKey) {
    case "cloudflare":
      return new CloudflareVectorAdapter(credentials);
    default:
      throw new Error(`Unsupported vector provider: ${providerKey}`);
  }
}
```

**Estimated time:** 15 min

### Task 1.9: Create Vector: Cloudflare Vectorize Adapter

**File:** `mysql/adapters/vector/cloudflare-vectorize.js`

```javascript
import { Cloudflare } from "cloudflare";

export class CloudflareVectorAdapter {
  constructor({ accountId, apiToken, vectorIndexName, embeddingModel }) {
    this.cf = new Cloudflare({
      apiToken: apiToken,
    });
    this.accountId = accountId;
    this.vectorIndexName = vectorIndexName;
    this.embeddingModel = embeddingModel;
  }

  async ensureIndex() {
    // Vectorize indexes are created on first upsert
  }

  async upsert(chunks) {
    const vectors = chunks.map((chunk) => ({
      id: chunk.id,
      embedding: await this.embeddings(chunk.text),
      metadata: chunk.metadata,
    }));

    await this.cf.vectorize.upsert(this.vectorIndexName, {
      vectors: vectors,
    });
  }

  async embeddings(text) {
    // Call embedding adapter, or inline for simplicity
    // This is a simplified version - in production, compose adapters
  }
}
```

**Estimated time:** 45 min

### Task 1.10: Update ingest.js Main

**File:** `ingest.js` (modified)

```javascript
import {
  CompanyRepository,
  KbRepository,
  CredentialRepository,
  ResourceRepository,
  ModelRepository,
} from "./mysql/repositories.js";

import {
  resolveResourceConnection,
  resolveEmbeddingModel,
} from "./mysql/services/provider-connection-resolver.js";

import { createStoreAdapter } from "./mysql/adapters/storage/factory.js";
import { createEmbeddingAdapter } from "./mysql/adapters/embedding/factory.js";
import { createVectorAdapter } from "./mysql/adapters/vector/factory.js";

export async function main({ signal, companyName, kbKey } = {}) {
  let bucketName, vectorIndex, embeddingModel, r2Prefix, chunkOptions, registry;

  if (kbKey) {
    // NEW: Resolve from KB
    const kb = await KbRepository.findByKey(
      (await CompanyRepository.findByKey(companyName)).id,
      kbKey
    );

    // Resolve storage resource
    if (kb.storage_resource_id) {
      const storageConn = await resolveResourceConnection(kb.storage_resource_id);
      const storageAdapter = createStoreAdapter(
        storageConn.providerKey,
        storageConn.credentials
      );
      bucketName = storageConn.credentials.bucket_name || storageConn.credentials.name;
    }

    // Resolve vector resource
    if (kb.vector_resource_id) {
      const vectorConn = await resolveResourceConnection(kb.vector_resource_id);
      const vectorAdapter = createVectorAdapter(
        vectorConn.providerKey,
        vectorConn.credentials
      );
      vectorIndex = vectorConn.credentials.vector_index_name;
    }

    // Resolve embedding model
    if (kb.embedding_model_id) {
      const modelInfo = await resolveEmbeddingModel(kb.embedding_model_id);
      embeddingModel = modelInfo.modelKey;
    }

    r2Prefix = `kb/${kbKey}`;
    chunkOptions = { size: kb.chunk_size || 512 };
    registry = createRegistry(companyName, kbKey, { chunkSize: chunkOptions.size });
  } else {
    // FALLBACK: Legacy company-config mode
    bucketName = getR2Bucket(companyName);
    vectorIndex = getVectorIndex(companyName);
    // ... existing logic
  }

  // Continue with adapter-injected pipeline
}
```

**Estimated time:** 45 min

### Task 1.11: Unit Tests for Validators

**File:** `mysql/__tests__/adapter-builders.test.js`

```javascript
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

describe("Adapter Factories", () => {
  describe("createStoreAdapter", () => {
    it("should create Cloudflare R2 adapter for cloudflare provider", () => {
      // Test
    });

    it("should create S3 adapter for aws provider", () => {
      // Test
    });
  });
});
```

**Estimated time:** 30 min

---

## Testing Strategy

### Unit Tests (DB-free)

| File | Tests | Description |
|------|-------|-------------|
| `mysql/adapters/storage/factory.js` | 2 | Provider resolution |
| `mysql/adapters/embedding/factory.js` | 2 | Model resolution |
| `mysql/adapters/vector/factory.js` | 1 | Index resolution |
| `ingest/registry.js` | 3 | Change detection |

### Integration Tests (With MySQL)

| Test | Description |
|------|-------------|
| `ingest:resolve-kb-resources` | Full KB → resources → credentials path |
| `ingest:ingest-kb` | End-to-end KB ingestion |
| `ingest:company-fallback` | Legacy mode still works |

### E2E Tests

| Scenario | Expectation |
|----------|-------------|
| Create KB with Cloudflare resources | Ingestion succeeds |
| Create KB with S3 resources | Ingestion succeeds |
| Switch embedding model | Re-ingest produces different vectors |
| Delete KB | Resources cleaned up |

---

## Rollout Plan

### Step 1: Implement Core Adapters (Tasks 1.1-1.9)

**Success criteria:**
- All adapter classes pass unit tests
- Factory functions correctly instantiate adapters
- No changes to existing `ingest.js` flow

**Verification:**
```bash
npm run test -- mysql/__tests__/adapter-builders.test.js
```

### Step 2: Refactor Ingestion Orchestrator (Task 1.10)

**Success criteria:**
- KB mode works for Cloudflare resources
- Legacy mode still works
- Fallback logging for missing resources

**Verification:**
```bash
npm run test -- mysql/__tests__/gateway-kb.test.js
cd web && npm run build
```

### Step 3: Add Multi-Provider Support (Tasks 1.4, 1.7, 1.9 additions)

**Success criteria:**
- S3 uploads work
- OpenAI embeddings work
- Pinecone/VecDB compatible

**Verification:**
```bash
# Create test company with AWS resources
# Run ingestion manually
npm run dev
# POST /gateway/kbs/:key/ingest
```

### Step 4: Documentation & Migration

**Deliverables:**
- Update `docs/platform-buildout.md` with new flow
- Add migration guide for existing companies
- README: "Switching from company-config to KB-controlled resources"

---

## Risk Assessment & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Breaking legacy company mode | Medium | High | Maintain fallback, add explicit test |
| Credential resolution failures | Medium | Medium | Add verbose logging, fail gracefully |
| Adapter injection errors | Low | High | Use TypeScript interfaces, validate early |
| Performance regression | Low | Medium | Benchmark before/after, optimize batching |

---

## Open Questions

1. **Chunking strategy:** Should chunking happen in source adapter or pipeline?
   - Recommendation: Pipeline (already structured this way)

2. **Embedding dimensions:** How to validate index dimensions match model?
   - Add dimension check in `ensureIndex()`
   - Throw descriptive error if mismatch

3. **Graph RAG extraction:** When to extract entities?
   - After content stored, before vector upsert
   - Parallel: `transformItem` returns embedded graph data

---

## Appendix: File Structure After Changes

```
mysql/
├─ adapters/
│  ├─ storage/
│  │  ├─ factory.js
│  │  ├─ cloudflare-r2.js
│  │  └─ s3.js
│  ├─ embedding/
│  │  ├─ factory.js
│  │  ├─ cloudflare-ai.js
│  │  └─ openai.js
│  ├─ vector/
│  │  ├─ factory.js
│  │  └─ cloudflare-vectorize.js
│  └─ source/
│     └─ wordpress.js (future)
├─ services/
│  └─ provider-connection-resolver.js
├─ repositories/
│  └─ (unchanged)
├─ routes/
│  └─ (unchanged)
└─ __tests__/
   ├─ adapter-builders.test.js
   └─ (existing tests)
```

---

## Execution Log

| Task | ETA | Status | Notes |
|------|-----|--------|-------|
| 1.1 | 30min | ⬜ | |
| 1.2 | 20min | ⬜ | |
| 1.3 | 45min | ⬜ | |
| 1.4 | 30min | ⬜ | |
| 1.5 | 15min | ⬜ | |
| 1.6 | 30min | ⬜ | |
| 1.7 | 20min | ⬜ | |
| 1.8 | 15min | ⬜ | |
| 1.9 | 45min | ⬜ | |
| 1.10 | 45min | ⬜ | |
| 1.11 | 30min | ⬜ | |

**Total Estimated Time:** 4 hours 30 minutes

---

## Next Steps

1. Confirm this plan aligns with your vision
2. Prioritize Phase 1 tasks (credential resolution layer)
3. Set up test database with sample KB/resources
4. Begin implementation