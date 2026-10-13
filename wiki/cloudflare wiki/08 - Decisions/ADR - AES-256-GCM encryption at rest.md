# ADR - AES-256-GCM encryption at rest

## Status
Accepted

## Context
Tenant configs and gateway credential blobs hold cloud API tokens and ask keys. Flat files/DB rows are read-able by anyone with host or dump access; historical plaintext values must remain loadable to avoid bricking upgrades.

## Decision
Per-value AES-256-GCM using master key from `APP_ENCRYPTION_KEY` (64-hex recommended, arbitrary strings sha256-derived). Format `gcm:<iv>:<tag>:<data>` base64 triplets; shared codec applies to both config stores; gateway service reuses same primitives inside JSON blobs with version marker. Missing key ⇒ passthrough with boot warning; decrypt failure fails loudly naming company/key context rather than returning garbage.

## Rationale
Auth-tag enforcement chosen over plain AES-CBC style to make tampering/wrong-key detectable — comment states "never silently return garbage". Key derivation flexibility documented in-code. Broader KMS/HSM tradeoff discussion absent from repo.

## Consequences
### Positive
Confidential-at-rest posture in dumps/backups; per-field rotation via rotate() preserving un-provided fields; graceful plaintext legacy reads; loud misconfiguration surfacing at boot/load time.
### Negative
Key loss = unrecoverable credentials (documented operator duty); single static master key without rotation ceremony implemented; in-memory plaintext exposure unchanged (expected).

## Alternatives
Envelope/KMS integration rejected implicitly by zero cloud-KMS references; app-level field hashing useless since values must be usable verbatim at runtime.

## Related Code
`config/encryption.js`, `config/codec.js`, `mysql/services/credential-service.js`, tests `config/__tests__/encryption.test.js`, `credential-service.test.js`.

## Related Documentation
[[Security Model]], [[Config Store Schema]], [[Data Lifecycle]].