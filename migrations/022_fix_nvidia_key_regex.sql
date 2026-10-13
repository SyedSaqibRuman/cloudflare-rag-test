-- 022: Fix the NVIDIA API key validation regex.
-- Real NVIDIA NIM keys ("nvapi-…") contain UNDERSCORES as well as letters,
-- digits and hyphens (confirmed against a live key shape: the payload charset
-- is [A-Za-z0-9_-]). The seeded regex '^nvapi-[A-Za-z0-9-]{20,}$' rejected any
-- key containing '_', so saving/verifying a valid NVIDIA credential failed
-- with "NVIDIA API Key does not match the expected format for this provider.".
-- Adds '_' to the character class in both the provider-level format regex and
-- the provider_auth_schemas field regex. Idempotent: re-running is a no-op
-- (the UPDATE matches nothing once applied).

UPDATE providers
   SET api_key_format_regex = '^nvapi-[A-Za-z0-9_-]{20,}$'
 WHERE provider_key = 'nvidia'
   AND api_key_format_regex = '^nvapi-[A-Za-z0-9-]{20,}$';

UPDATE provider_auth_schemas pas
   JOIN providers p ON p.id = pas.provider_id
   SET pas.validation_regex = '^nvapi-[A-Za-z0-9_-]{20,}$'
 WHERE p.provider_key = 'nvidia'
   AND pas.field_name = 'api_key'
   AND pas.validation_regex = '^nvapi-[A-Za-z0-9-]{20,}$';
