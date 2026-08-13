-- 005: v_credentials_full must show unassigned credentials.
-- The original view INNER JOINs company_environments, so credentials created
-- without an environment (environment_id IS NULL) were invisible through it.
-- Runtime repositories already read the credentials table directly with a
-- LEFT JOIN; this brings the view in line with that behavior.
CREATE OR REPLACE VIEW v_credentials_full AS
SELECT
    c.id AS credential_id,
    c.credential_key,
    c.credential_name,
    c.credential_type,
    c.priority,
    c.is_active,
    c.is_default,
    c.last_verified_at,
    c.last_verification_status,
    c.expires_at,

    co.id AS company_id,
    co.company_key,
    co.company_name,

    p.id AS provider_id,
    p.provider_key,
    p.provider_name,
    p.primary_service_category,

    ce.env_key,
    ce.env_name,
    ce.is_production,

    COALESCE(c.endpoint_override_url, p.default_api_base_url) AS effective_endpoint_url
FROM credentials c
JOIN companies         co ON c.company_id     = co.id   AND co.deleted_at IS NULL
JOIN providers         p  ON c.provider_id    = p.id    AND p.is_active = TRUE
LEFT JOIN company_environments ce ON c.environment_id = ce.id AND ce.deleted_at IS NULL
WHERE c.is_active = TRUE AND c.deleted_at IS NULL;