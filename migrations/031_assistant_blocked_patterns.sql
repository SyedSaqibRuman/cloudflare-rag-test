-- --------------------------
-- 031_assistant_blocked_patterns.sql
-- Make the intent fast-path's blocked patterns configurable per tier instead
-- of hardcoded globally:
--   assistants.blocked_patterns — newline-separated patterns that REPLACE the
--     built-in BLOCKED_PATTERNS set for this assistant. Each line is either a
--     literal substring ("crypto", matched case-insensitively, regex-escaped)
--     or a raw JavaScript regex delimited by slashes ("/write\s+a\s+poem/i"
--     — flags optional, i assumed). This is what turns the recipes persona
--     hack (bypass when blocked_topics is set) into a real configuration:
--     a cooking assistant ships its own pattern set that does NOT veto food.
-- Company-level override lives in config BLOCKED_PATTERNS (same format,
-- schema.js GUARDRAIL_KEYS); the resolution order is
-- assistant.blocked_patterns > company BLOCKED_PATTERNS > built-ins, and
-- company BLOCKED_TOPICS (plain substring vetoes) always apply on top.
-- NULL = inherit (company BLOCKED_PATTERNS, else built-ins).
-- --------------------------

ALTER TABLE assistants
    ADD COLUMN blocked_patterns TEXT DEFAULT NULL
        AFTER blocked_topics;
