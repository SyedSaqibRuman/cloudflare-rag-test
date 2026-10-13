-- ------------------------------------------------------------------
-- 029: Drop the GLOBAL unique index on credentials.credential_key.
--
-- ROOT CAUSE (hit live 2026-09-18): uk_credential_key made credential_key
-- unique across the WHOLE table, so once ANY company created a credential
-- with a given key (e.g. 'test'), no other company — nor the same company
-- under a different provider — could ever use that key again. INSERTs
-- failed with: Duplicate entry 'test' for key 'uk_credential_key'.
--
-- credential_key is a per-tenant label, not a global identifier. The real
-- scoping is already enforced by uk_company_provider_env_cred
-- (company_id, provider_id, environment_id, credential_key), which stays.
--
-- Recreate-after-delete is handled in code: CredentialRepository.create()
-- purges soft-deleted rows that would collide with the composite unique
-- (soft-deleted rows are invisible to the app but still occupy the index).
-- ------------------------------------------------------------------

ALTER TABLE credentials DROP INDEX uk_credential_key;
