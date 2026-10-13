-- =====================================================
-- 020: Standalone webhook notifications
-- Stores webhook endpoints for event notifications.
-- =====================================================

CREATE TABLE IF NOT EXISTS webhook_notifications (
    id          VARCHAR(64)  PRIMARY KEY,
    company_id  INT UNSIGNED NOT NULL,
    url         VARCHAR(2000) NOT NULL,
    events      JSON         NOT NULL DEFAULT ('[]'),
    secret      VARCHAR(255) DEFAULT '',
    is_active   TINYINT(1)   DEFAULT 1,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_wn_company (company_id)
);

CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    webhook_id  VARCHAR(64)  NOT NULL,
    company_id  INT UNSIGNED NOT NULL,
    event       VARCHAR(100) NOT NULL,
    status_code INT          DEFAULT 0,
    response    TEXT,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_wdl_webhook (webhook_id),
    INDEX idx_wdl_company (company_id)
);
