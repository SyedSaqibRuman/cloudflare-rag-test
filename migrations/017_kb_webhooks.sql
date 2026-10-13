-- =====================================================
-- 017: Webhook configuration on knowledge_bases
-- Stores webhook URL and type for ingestion completion
-- notifications.
-- =====================================================

ALTER TABLE knowledge_bases
    ADD COLUMN webhook_url    VARCHAR(2000) DEFAULT NULL AFTER last_error,
    ADD COLUMN webhook_secret VARCHAR(255)  DEFAULT NULL AFTER webhook_url,
    ADD COLUMN webhook_events JSON          DEFAULT NULL AFTER webhook_secret;
