-- ============================================================
-- 011_provider_round_robin_thinking — 9Router provider-detail parity
--
-- Two catalog-level switches that the provider detail page needs to match
-- 9Router's Connections / Available Models cards:
--
--   1. providers.round_robin_enabled — when ON, the executor rotates chat
--      requests across the company's ACTIVE credentials for this provider
--      (instead of always resolving the single "best" credential). Drives the
--      "Round Robin" toggle on the Connections card header.
--
--   2. provider_models.thinking_mode — per-model reasoning preference for
--      chat completions: 'auto' (provider default), 'on' (force extended
--      thinking), 'off' (never). Drives the "Thinking" dropdown on the
--      Available Models card header. NULL = auto.
--
-- Checksummed by mysql/migrate.js — NEVER edit after applying. Add 012.
-- ============================================================

ALTER TABLE providers
    ADD COLUMN round_robin_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active;

ALTER TABLE provider_models
    ADD COLUMN thinking_mode ENUM('auto','on','off') DEFAULT 'auto' AFTER max_output_tokens;
