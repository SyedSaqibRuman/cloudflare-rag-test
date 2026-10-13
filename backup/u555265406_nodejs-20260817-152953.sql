/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19-12.3.2-MariaDB, for Linux (x86_64)
--
-- Host: srv1398.hstgr.io    Database: u555265406_nodejs
-- ------------------------------------------------------
-- Server version	11.8.8-MariaDB-log

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;

--
-- Current Database: `u555265406_nodejs`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `u555265406_nodejs` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */;

USE `u555265406_nodejs`;

--
-- Table structure for table `agent_workflows`
--

DROP TABLE IF EXISTS `agent_workflows`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `agent_workflows` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` int(10) unsigned NOT NULL,
  `workflow_key` varchar(100) NOT NULL,
  `workflow_name` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `definition` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`definition`)),
  `primary_assistant_id` bigint(20) unsigned DEFAULT NULL,
  `trigger_type` enum('manual','webhook','schedule','event','chatbot') DEFAULT 'manual',
  `trigger_config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`trigger_config`)),
  `status` enum('draft','active','paused','archived') DEFAULT 'draft',
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_workflow` (`company_id`,`workflow_key`),
  KEY `idx_company` (`company_id`,`is_active`),
  KEY `idx_alive` (`deleted_at`),
  KEY `primary_assistant_id` (`primary_assistant_id`),
  CONSTRAINT `agent_workflows_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `agent_workflows_ibfk_2` FOREIGN KEY (`primary_assistant_id`) REFERENCES `assistants` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `agent_workflows`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `agent_workflows` WRITE;
/*!40000 ALTER TABLE `agent_workflows` DISABLE KEYS */;
/*!40000 ALTER TABLE `agent_workflows` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `assistants`
--

DROP TABLE IF EXISTS `assistants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `assistants` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` int(10) unsigned NOT NULL,
  `assistant_key` varchar(100) NOT NULL,
  `assistant_name` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `credential_id` bigint(20) unsigned NOT NULL,
  `model_id` int(10) unsigned DEFAULT NULL,
  `model_key` varchar(100) DEFAULT NULL,
  `credential_model_access_id` bigint(20) unsigned DEFAULT NULL,
  `system_prompt` text DEFAULT NULL,
  `temperature` decimal(3,2) DEFAULT 0.70,
  `max_tokens` int(10) unsigned DEFAULT 4096,
  `enable_function_calling` tinyint(1) DEFAULT 1,
  `enable_streaming` tinyint(1) DEFAULT 1,
  `tools` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`tools`)),
  `primary_kb_id` bigint(20) unsigned DEFAULT NULL,
  `kb_ids` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`kb_ids`)),
  `enable_graph_context` tinyint(1) DEFAULT 0,
  `graph_resource_id` bigint(20) unsigned DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `is_public` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_assistant` (`company_id`,`assistant_key`),
  KEY `idx_company` (`company_id`,`is_active`),
  KEY `idx_alive` (`deleted_at`),
  KEY `credential_id` (`credential_id`),
  KEY `model_id` (`model_id`),
  KEY `credential_model_access_id` (`credential_model_access_id`),
  KEY `primary_kb_id` (`primary_kb_id`),
  KEY `graph_resource_id` (`graph_resource_id`),
  CONSTRAINT `assistants_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `assistants_ibfk_2` FOREIGN KEY (`credential_id`) REFERENCES `credentials` (`id`),
  CONSTRAINT `assistants_ibfk_3` FOREIGN KEY (`model_id`) REFERENCES `provider_models` (`id`) ON DELETE SET NULL,
  CONSTRAINT `assistants_ibfk_4` FOREIGN KEY (`credential_model_access_id`) REFERENCES `credential_model_access` (`id`) ON DELETE SET NULL,
  CONSTRAINT `assistants_ibfk_5` FOREIGN KEY (`primary_kb_id`) REFERENCES `knowledge_bases` (`id`) ON DELETE SET NULL,
  CONSTRAINT `assistants_ibfk_6` FOREIGN KEY (`graph_resource_id`) REFERENCES `provider_resources` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `assistants`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `assistants` WRITE;
/*!40000 ALTER TABLE `assistants` DISABLE KEYS */;
INSERT INTO `assistants` VALUES
(1,2,'smoke-mspxeqqb','Smoke Assistant',NULL,8,NULL,NULL,NULL,'You are a test assistant.',0.50,512,1,1,NULL,NULL,NULL,0,NULL,1,0,'2026-08-12 10:08:05','2026-08-12 10:08:05','2026-08-12 10:08:05'),
(2,2,'smoke-mspxf1pf','Smoke Assistant',NULL,8,NULL,NULL,NULL,'You are a test assistant.',0.50,512,1,1,NULL,NULL,NULL,0,NULL,1,0,'2026-08-12 10:08:19','2026-08-12 10:08:19','2026-08-12 10:08:19'),
(3,2,'sarah','Sarah',NULL,9,NULL,'@cf/meta/llama-3.3-70b-instruct-fp8-fast',NULL,'Testing',0.70,4096,1,1,NULL,7,NULL,0,NULL,1,1,'2026-08-17 07:33:32','2026-08-17 08:28:11',NULL);
/*!40000 ALTER TABLE `assistants` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` int(10) unsigned DEFAULT NULL,
  `actor_type` enum('user','system','api_key','admin','webhook') NOT NULL,
  `actor_id` varchar(100) DEFAULT NULL,
  `actor_ip` varchar(45) DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `entity_type` varchar(50) NOT NULL,
  `entity_id` bigint(20) unsigned DEFAULT NULL,
  `before_state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`before_state`)),
  `after_state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`after_state`)),
  `diff` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`diff`)),
  `request_id` varchar(100) DEFAULT NULL,
  `trace_id` varchar(100) DEFAULT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `is_sensitive` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_company_time` (`company_id`,`created_at`),
  KEY `idx_entity` (`entity_type`,`entity_id`,`created_at`),
  KEY `idx_actor` (`actor_type`,`actor_id`,`created_at`),
  KEY `idx_action` (`action`,`created_at`),
  KEY `idx_sensitive` (`is_sensitive`,`created_at`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=324 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
INSERT INTO `audit_logs` VALUES
(1,NULL,'admin',NULL,NULL,'endpoint.created','endpoint',8,NULL,'{\"endpoint_key\":\"test-endpoint\",\"provider_key\":\"cloudflare\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:36:55'),
(2,NULL,'admin',NULL,NULL,'endpoint.deleted','endpoint',8,NULL,'{\"endpoint_key\":\"test-endpoint\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:36:56'),
(3,NULL,'admin',NULL,NULL,'endpoint.created','endpoint',9,NULL,'{\"endpoint_key\":\"test-endpoint\",\"provider_key\":\"cloudflare\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:37:54'),
(4,NULL,'admin',NULL,NULL,'endpoint.deleted','endpoint',9,NULL,'{\"endpoint_key\":\"test-endpoint\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:37:54'),
(5,NULL,'admin',NULL,NULL,'pricing.created','pricing',16,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-01-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:37:55'),
(6,NULL,'admin',NULL,NULL,'pricing.deleted','pricing',16,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-01-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:37:55'),
(7,NULL,'admin',NULL,NULL,'pricing.created','pricing',17,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-02-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:37:55'),
(8,NULL,'admin',NULL,NULL,'pricing.created','pricing',18,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-03-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:37:56'),
(9,NULL,'admin',NULL,NULL,'pricing.deleted','pricing',17,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-02-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:37:56'),
(10,NULL,'admin',NULL,NULL,'pricing.deleted','pricing',18,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-03-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:37:56'),
(11,NULL,'admin',NULL,NULL,'endpoint.created','endpoint',10,NULL,'{\"endpoint_key\":\"test-endpoint\",\"provider_key\":\"cloudflare\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:38:05'),
(12,NULL,'admin',NULL,NULL,'pricing.created','pricing',19,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-01-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:39:19'),
(13,NULL,'admin',NULL,NULL,'pricing.deleted','pricing',19,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-01-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:39:20'),
(14,NULL,'admin',NULL,NULL,'pricing.created','pricing',20,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-02-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:39:20'),
(15,NULL,'admin',NULL,NULL,'pricing.created','pricing',21,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-03-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:39:20'),
(16,NULL,'admin',NULL,NULL,'pricing.deleted','pricing',20,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-02-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:39:20'),
(17,NULL,'admin',NULL,NULL,'pricing.deleted','pricing',21,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-03-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:39:20'),
(18,NULL,'admin',NULL,NULL,'endpoint.created','endpoint',11,NULL,'{\"endpoint_key\":\"test-endpoint\",\"provider_key\":\"cloudflare\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:40:43'),
(19,NULL,'admin',NULL,NULL,'endpoint.updated','endpoint',11,'{\"endpoint_key\":\"test-endpoint\",\"endpoint_url\":\"https://example.com/test\",\"http_method\":\"GET\",\"is_default\":0,\"is_active\":1}','{\"endpoint_key\":\"test-endpoint\",\"endpoint_url\":\"https://example.com/test\",\"http_method\":\"GET\",\"is_default\":0,\"is_active\":1}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:40:43'),
(20,NULL,'admin',NULL,NULL,'endpoint.deleted','endpoint',11,NULL,'{\"endpoint_key\":\"test-endpoint\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:40:44'),
(21,NULL,'admin',NULL,NULL,'pricing.created','pricing',22,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-01-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:40:44'),
(22,NULL,'admin',NULL,NULL,'pricing.updated','pricing',22,'{\"effective_from\":\"2026-01-01\",\"effective_to\":null,\"input_price_per_million\":\"1.500000\",\"output_price_per_million\":\"3.000000\"}','{\"effective_from\":\"2026-01-01\",\"effective_to\":\"2026-06-30\",\"input_price_per_million\":\"1.500000\",\"output_price_per_million\":2.75}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:40:45'),
(23,NULL,'admin',NULL,NULL,'pricing.deleted','pricing',22,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-01-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:40:45'),
(24,NULL,'admin',NULL,NULL,'pricing.created','pricing',23,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-02-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:40:45'),
(25,NULL,'admin',NULL,NULL,'pricing.created','pricing',24,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-03-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:40:45'),
(26,NULL,'admin',NULL,NULL,'pricing.deleted','pricing',23,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-02-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:40:45'),
(27,NULL,'admin',NULL,NULL,'pricing.deleted','pricing',24,NULL,'{\"model_key\":\"gpt-4o\",\"effective_from\":\"2026-03-01\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:40:46'),
(28,NULL,'admin',NULL,NULL,'provider.created','provider',16,NULL,'{\"provider_key\":\"e2e_test_provider_1786082192351\",\"category\":\"ai\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 05:56:32'),
(29,2,'admin',NULL,'::1','kb.created','kb',1,NULL,'{\"kb_key\":\"popularcert-kb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 07:50:58'),
(30,NULL,'admin',NULL,NULL,'kb.ingest.started','kb',1,NULL,NULL,NULL,NULL,NULL,'admin action',0,'2026-08-07 07:50:58'),
(31,NULL,'admin',NULL,NULL,'kb.ingest.started','kb',1,NULL,NULL,NULL,NULL,NULL,'admin action',0,'2026-08-07 07:50:58'),
(32,2,'admin',NULL,'::1','kb.updated','kb',1,'{\"kb_key\":\"popularcert-kb\",\"status\":\"active\"}','{\"kb_key\":\"popularcert-kb\",\"kbKey\":\"popularcert-kb\",\"kbName\":\"Popularcert KB\",\"description\":null,\"vectorResourceId\":null,\"graphResourceId\":null,\"storageResourceId\":null,\"embeddingModelId\":null,\"chunkSize\":600,\"chunkOverlap\":50,\"retrievalTopK\":10,\"retrievalScoreThreshold\":0.7,\"enableGraphRag\":false,\"enableHybridSearch\":true,\"isActive\":true}',NULL,NULL,NULL,'admin action',0,'2026-08-07 07:51:00'),
(33,2,'admin',NULL,'::1','kb.deleted','kb',1,NULL,'{\"kb_key\":\"popularcert-kb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 07:51:00'),
(34,2,'admin',NULL,'::1','kb.created','kb',2,NULL,'{\"kb_key\":\"popularcert-kb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:12:17'),
(35,NULL,'admin',NULL,NULL,'kb.ingest.started','kb',2,NULL,NULL,NULL,NULL,NULL,'admin action',0,'2026-08-07 08:12:17'),
(36,NULL,'admin',NULL,NULL,'kb.ingest.started','kb',2,NULL,NULL,NULL,NULL,NULL,'admin action',0,'2026-08-07 08:12:17'),
(37,2,'admin',NULL,'::1','kb.updated','kb',2,'{\"kb_key\":\"popularcert-kb\",\"status\":\"indexing\"}','{\"kb_key\":\"popularcert-kb\",\"kbKey\":\"popularcert-kb\",\"kbName\":\"Popularcert KB\",\"description\":null,\"vectorResourceId\":null,\"graphResourceId\":null,\"storageResourceId\":null,\"embeddingModelId\":null,\"chunkSize\":600,\"chunkOverlap\":50,\"retrievalTopK\":10,\"retrievalScoreThreshold\":0.7,\"enableGraphRag\":false,\"enableHybridSearch\":true,\"isActive\":true}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:12:29'),
(38,NULL,'admin',NULL,NULL,'kb.ingest.started','kb',2,NULL,NULL,NULL,NULL,NULL,'admin action',0,'2026-08-07 08:15:34'),
(39,NULL,'system',NULL,NULL,'kb.ingest.failed','kb',2,NULL,'{\"error\":\"R2_BUCKET_NAME is not configured for KB \'popularcert-kb\'.\"}',NULL,NULL,NULL,'ingest failure',0,'2026-08-07 08:15:34'),
(40,2,'admin',NULL,'::1','kb.updated','kb',2,'{\"kb_key\":\"popularcert-kb\",\"status\":\"error\"}','{\"kb_key\":\"popularcert-kb\",\"kbKey\":\"popularcert-kb\",\"kbName\":\"Popularcert KB\",\"description\":null,\"vectorResourceId\":null,\"graphResourceId\":null,\"storageResourceId\":null,\"embeddingModelId\":null,\"chunkSize\":600,\"chunkOverlap\":50,\"retrievalTopK\":10,\"retrievalScoreThreshold\":0.7,\"enableGraphRag\":false,\"enableHybridSearch\":true,\"isActive\":true}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:15:37'),
(41,2,'admin',NULL,'::1','kb.deleted','kb',2,NULL,'{\"kb_key\":\"popularcert-kb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:15:39'),
(42,2,'admin',NULL,'::1','kb.created','kb',3,NULL,'{\"kb_key\":\"popularcert-kb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:17:02'),
(43,2,'admin',NULL,NULL,'kb.ingest.started','kb',3,NULL,NULL,NULL,NULL,NULL,'admin action',0,'2026-08-07 08:17:02'),
(44,2,'system',NULL,NULL,'kb.ingest.failed','kb',3,NULL,'{\"error\":\"R2_BUCKET_NAME is not configured for KB \'popularcert-kb\'.\"}',NULL,NULL,NULL,'ingest failure',0,'2026-08-07 08:17:02'),
(45,2,'admin',NULL,'::1','kb.updated','kb',3,'{\"kb_key\":\"popularcert-kb\",\"status\":\"error\"}','{\"kb_key\":\"popularcert-kb\",\"kbKey\":\"popularcert-kb\",\"kbName\":\"Popularcert KB\",\"description\":null,\"vectorResourceId\":null,\"graphResourceId\":null,\"storageResourceId\":null,\"embeddingModelId\":null,\"chunkSize\":600,\"chunkOverlap\":50,\"retrievalTopK\":10,\"retrievalScoreThreshold\":0.7,\"enableGraphRag\":false,\"enableHybridSearch\":true,\"isActive\":true}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:17:05'),
(46,2,'admin',NULL,'::1','kb.deleted','kb',3,NULL,'{\"kb_key\":\"popularcert-kb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:17:07'),
(47,2,'admin',NULL,'::1','kb.created','kb',4,NULL,'{\"kb_key\":\"popularcert-kb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:17:31'),
(48,2,'admin',NULL,NULL,'kb.ingest.started','kb',4,NULL,NULL,NULL,NULL,NULL,'admin action',0,'2026-08-07 08:17:31'),
(49,2,'system',NULL,NULL,'kb.ingest.failed','kb',4,NULL,'{\"error\":\"R2_BUCKET_NAME is not configured for KB \'popularcert-kb\'.\"}',NULL,NULL,NULL,'ingest failure',0,'2026-08-07 08:17:31'),
(50,2,'admin',NULL,'::1','kb.updated','kb',4,'{\"kb_key\":\"popularcert-kb\",\"status\":\"error\"}','{\"kb_key\":\"popularcert-kb\",\"kbKey\":\"popularcert-kb\",\"kbName\":\"Popularcert KB\",\"description\":null,\"vectorResourceId\":null,\"graphResourceId\":null,\"storageResourceId\":null,\"embeddingModelId\":null,\"chunkSize\":600,\"chunkOverlap\":50,\"retrievalTopK\":10,\"retrievalScoreThreshold\":0.7,\"enableGraphRag\":false,\"enableHybridSearch\":true,\"isActive\":true}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:17:34'),
(51,2,'admin',NULL,'::1','kb.deleted','kb',4,NULL,'{\"kb_key\":\"popularcert-kb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:17:36'),
(52,2,'admin',NULL,'::1','kb.created','kb',5,NULL,'{\"kb_key\":\"popularcert-kb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:18:06'),
(53,2,'admin',NULL,NULL,'kb.ingest.started','kb',5,NULL,NULL,NULL,NULL,NULL,'admin action',0,'2026-08-07 08:18:06'),
(54,2,'system',NULL,NULL,'kb.ingest.failed','kb',5,NULL,'{\"error\":\"R2_BUCKET_NAME is not configured for KB \'popularcert-kb\'.\"}',NULL,NULL,NULL,'ingest failure',0,'2026-08-07 08:18:07'),
(55,2,'admin',NULL,'::1','kb.updated','kb',5,'{\"kb_key\":\"popularcert-kb\",\"status\":\"error\"}','{\"kb_key\":\"popularcert-kb\",\"kbKey\":\"popularcert-kb\",\"kbName\":\"Popularcert KB\",\"description\":null,\"vectorResourceId\":null,\"graphResourceId\":null,\"storageResourceId\":null,\"embeddingModelId\":null,\"chunkSize\":600,\"chunkOverlap\":50,\"retrievalTopK\":10,\"retrievalScoreThreshold\":0.7,\"enableGraphRag\":false,\"enableHybridSearch\":true,\"isActive\":true}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:18:09'),
(56,2,'admin',NULL,'::1','kb.deleted','kb',5,NULL,'{\"kb_key\":\"popularcert-kb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:18:11'),
(57,2,'admin',NULL,'::1','kb.created','kb',6,NULL,'{\"kb_key\":\"popularcert-kb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:18:41'),
(58,2,'admin',NULL,NULL,'kb.ingest.started','kb',6,NULL,NULL,NULL,NULL,NULL,'admin action',0,'2026-08-07 08:18:41'),
(59,2,'system',NULL,NULL,'kb.ingest.failed','kb',6,NULL,'{\"error\":\"R2_BUCKET_NAME is not configured for KB \'popularcert-kb\'.\"}',NULL,NULL,NULL,'ingest failure',0,'2026-08-07 08:18:41'),
(60,2,'admin',NULL,'::1','kb.updated','kb',6,'{\"kb_key\":\"popularcert-kb\",\"status\":\"error\"}','{\"kb_key\":\"popularcert-kb\",\"kbKey\":\"popularcert-kb\",\"kbName\":\"Popularcert KB\",\"description\":null,\"vectorResourceId\":null,\"graphResourceId\":null,\"storageResourceId\":null,\"embeddingModelId\":null,\"chunkSize\":600,\"chunkOverlap\":50,\"retrievalTopK\":10,\"retrievalScoreThreshold\":0.7,\"enableGraphRag\":false,\"enableHybridSearch\":true,\"isActive\":true}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:18:44'),
(61,2,'admin',NULL,'::1','kb.deleted','kb',6,NULL,'{\"kb_key\":\"popularcert-kb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 08:18:46'),
(62,NULL,'admin',NULL,NULL,'pricing.deleted','pricing',2,NULL,'{\"model_key\":\"claude-3-haiku\",\"effective_from\":\"2024-03-07\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 12:20:03'),
(63,NULL,'admin',NULL,NULL,'provider.created','provider',17,NULL,'{\"provider_key\":\"del_test\",\"category\":\"storage\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 12:25:38'),
(64,NULL,'admin',NULL,NULL,'provider.deleted','provider',17,'{\"provider_key\":\"del_test\",\"category\":\"storage\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-07 12:25:39'),
(65,NULL,'admin',NULL,NULL,'provider.created','provider',19,NULL,'{\"provider_key\":\"del_test\",\"category\":\"storage\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 12:27:18'),
(66,NULL,'admin',NULL,NULL,'provider.deleted','provider',19,'{\"provider_key\":\"del_test\",\"category\":\"storage\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-07 12:27:19'),
(67,NULL,'admin',NULL,NULL,'provider.created','provider',20,NULL,'{\"provider_key\":\"del_test\",\"category\":\"storage\"}',NULL,NULL,NULL,'admin action',0,'2026-08-07 12:27:19'),
(68,NULL,'admin',NULL,NULL,'provider.deleted','provider',20,'{\"provider_key\":\"del_test\",\"category\":\"storage\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-07 12:27:20'),
(69,NULL,'admin',NULL,NULL,'provider.deleted','provider',7,'{\"provider_key\":\"cloudflare_vectorize\",\"category\":\"vector\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:14:43'),
(70,NULL,'admin',NULL,NULL,'provider.deleted','provider',8,'{\"provider_key\":\"cloudflare_r2\",\"category\":\"storage\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:21:02'),
(71,NULL,'admin',NULL,NULL,'provider.deleted','provider',13,'{\"provider_key\":\"aws_s3\",\"category\":\"storage\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:21:05'),
(72,NULL,'admin',NULL,NULL,'provider.deleted','provider',11,'{\"provider_key\":\"weaviate\",\"category\":\"vector\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:21:07'),
(73,NULL,'admin',NULL,NULL,'provider.deleted','provider',10,'{\"provider_key\":\"pinecone\",\"category\":\"vector\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:21:10'),
(74,NULL,'admin',NULL,NULL,'provider.deleted','provider',12,'{\"provider_key\":\"qdrant\",\"category\":\"vector\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:21:12'),
(75,NULL,'admin',NULL,NULL,'provider.deleted','provider',14,'{\"provider_key\":\"neo4j\",\"category\":\"graph\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:21:15'),
(76,NULL,'admin',NULL,NULL,'provider.deleted','provider',9,'{\"provider_key\":\"cloudflare_d1\",\"category\":\"database\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:21:18'),
(77,NULL,'admin',NULL,NULL,'provider.deleted','provider',5,'{\"provider_key\":\"mistral\",\"category\":\"ai\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:21:21'),
(78,NULL,'admin',NULL,NULL,'provider.deleted','provider',3,'{\"provider_key\":\"gemini\",\"category\":\"ai\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:21:23'),
(79,NULL,'admin',NULL,NULL,'provider.deleted','provider',2,'{\"provider_key\":\"anthropic\",\"category\":\"ai\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:21:25'),
(80,NULL,'admin',NULL,NULL,'provider.deleted','provider',6,'{\"provider_key\":\"cloudflare\",\"category\":\"ai\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:21:27'),
(81,NULL,'admin',NULL,NULL,'provider.deleted','provider',4,'{\"provider_key\":\"groq\",\"category\":\"ai\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:21:29'),
(82,NULL,'admin',NULL,NULL,'provider.deleted','provider',1,'{\"provider_key\":\"openai\",\"category\":\"ai\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:21:32'),
(83,NULL,'admin',NULL,NULL,'provider.created','provider',21,NULL,'{\"provider_key\":\"cloudflare\",\"category\":\"ai\"}',NULL,NULL,NULL,'admin action',0,'2026-08-10 05:22:46'),
(84,NULL,'admin',NULL,NULL,'provider.deleted','provider',21,'{\"provider_key\":\"cloudflare\",\"category\":\"ai\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-10 05:46:51'),
(85,NULL,'admin',NULL,NULL,'provider.created','provider',22,NULL,'{\"provider_key\":\"cloudflare\",\"category\":\"ai\"}',NULL,NULL,NULL,'admin action',0,'2026-08-10 05:51:50'),
(86,1,'admin',NULL,NULL,'credential.created','credential',1,NULL,'{\"credential_key\":\"e2e-test\",\"provider_key\":\"cloudflare\"}',NULL,NULL,NULL,'admin action',1,'2026-08-10 05:52:56'),
(87,1,'admin',NULL,NULL,'credential.verified.success','credential',1,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-10 05:52:57'),
(88,1,'admin',NULL,NULL,'credential.rotated','credential',1,'{}','{\"last_rotated_at\":\"2026-08-10T05:52:57.466Z\"}',NULL,NULL,NULL,'manual rotation',1,'2026-08-10 05:52:57'),
(89,1,'admin',NULL,NULL,'credential.deleted','credential',1,NULL,'{\"credential_key\":\"e2e-test\"}',NULL,NULL,NULL,'admin action',1,'2026-08-10 05:52:57'),
(90,1,'admin',NULL,NULL,'credential.created','credential',2,NULL,'{\"credential_key\":\"browser_e2e_key\",\"provider_key\":\"cloudflare\"}',NULL,NULL,NULL,'admin action',1,'2026-08-10 06:14:17'),
(91,1,'admin',NULL,NULL,'credential.deleted','credential',2,NULL,'{\"credential_key\":\"browser_e2e_key\"}',NULL,NULL,NULL,'admin action',1,'2026-08-10 06:14:34'),
(92,2,'admin',NULL,NULL,'credential.created','credential',3,NULL,'{\"credential_key\":\"cloudflare_api_key\",\"provider_key\":\"cloudflare\"}',NULL,NULL,NULL,'admin action',1,'2026-08-10 06:15:51'),
(93,2,'admin',NULL,NULL,'credential.deleted','credential',3,NULL,'{\"credential_key\":\"cloudflare_api_key\"}',NULL,NULL,NULL,'admin action',1,'2026-08-10 06:16:02'),
(94,1,'admin',NULL,NULL,'credential.created','credential',4,NULL,'{\"credential_key\":\"openai_main\",\"provider_key\":\"openai\"}',NULL,NULL,NULL,'admin action',1,'2026-08-10 06:25:30'),
(95,1,'admin',NULL,NULL,'model_access.granted','credential_model_access',4,NULL,'{\"model_key\":\"gpt-4o\",\"isEnabled\":true}',NULL,NULL,NULL,'admin action',0,'2026-08-10 06:26:15'),
(96,1,'admin',NULL,NULL,'model_access.granted','credential_model_access',4,NULL,'{\"model_key\":\"gpt-4o\",\"isEnabled\":false}',NULL,NULL,NULL,'admin action',0,'2026-08-10 06:26:24'),
(97,1,'admin',NULL,NULL,'credential.deleted','credential',4,NULL,'{\"credential_key\":\"openai_main\"}',NULL,NULL,NULL,'admin action',1,'2026-08-10 06:26:43'),
(98,1,'admin',NULL,NULL,'environment.created','environment',7,NULL,'{\"company_key\":\"maxicert\",\"env_key\":\"sandbox\"}',NULL,NULL,NULL,'admin action',0,'2026-08-11 06:45:31'),
(99,1,'admin',NULL,NULL,'environment.updated','environment',NULL,NULL,'{\"company_key\":\"maxicert\",\"env_key\":\"sandbox\",\"env_name\":\"Sandbox EU\"}',NULL,NULL,NULL,'admin action',0,'2026-08-11 06:45:31'),
(100,1,'admin',NULL,NULL,'environment.deleted','environment',NULL,NULL,'{\"company_key\":\"maxicert\",\"env_key\":\"sandbox\"}',NULL,NULL,NULL,'admin action',0,'2026-08-11 06:45:32'),
(101,NULL,'admin',NULL,NULL,'provider.imported','provider',38,NULL,'{\"provider_key\":\"azure_openai\",\"provider_id\":38,\"imported\":\"created\",\"counts\":{\"authFields\":3,\"endpoints\":1,\"capabilities\":3,\"resources\":0,\"models\":2,\"pricing\":2}}',NULL,NULL,NULL,'admin action',0,'2026-08-11 06:46:49'),
(102,NULL,'admin',NULL,NULL,'provider.imported','provider',38,NULL,'{\"provider_key\":\"azure_openai\",\"provider_id\":38,\"imported\":\"refreshed\",\"counts\":{\"authFields\":1,\"endpoints\":0,\"capabilities\":0,\"resources\":0,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-11 06:48:32'),
(103,NULL,'admin',NULL,NULL,'provider.imported','provider',38,NULL,'{\"provider_key\":\"azure_openai\",\"provider_id\":38,\"imported\":\"refreshed\",\"counts\":{\"authFields\":3,\"endpoints\":1,\"capabilities\":3,\"resources\":0,\"models\":2,\"pricing\":2}}',NULL,NULL,NULL,'admin action',0,'2026-08-11 06:53:04'),
(104,1,'admin',NULL,NULL,'credential.created','credential',6,NULL,'{\"credential_key\":\"env_probe\",\"provider_key\":\"openai\"}',NULL,NULL,NULL,'admin action',1,'2026-08-11 07:06:55'),
(105,1,'admin',NULL,NULL,'credential.deleted','credential',6,NULL,'{\"credential_key\":\"env_probe\"}',NULL,NULL,NULL,'admin action',1,'2026-08-11 07:06:55'),
(106,2,'admin',NULL,NULL,'environment.deleted','environment',NULL,NULL,'{\"company_key\":\"popularcert\",\"env_key\":\"production\"}',NULL,NULL,NULL,'admin action',0,'2026-08-11 07:13:59'),
(107,2,'admin',NULL,NULL,'environment.deleted','environment',NULL,NULL,'{\"company_key\":\"popularcert\",\"env_key\":\"staging\"}',NULL,NULL,NULL,'admin action',0,'2026-08-11 07:14:02'),
(108,2,'admin',NULL,NULL,'environment.deleted','environment',NULL,NULL,'{\"company_key\":\"popularcert\",\"env_key\":\"development\"}',NULL,NULL,NULL,'admin action',0,'2026-08-11 07:14:05'),
(109,NULL,'admin',NULL,NULL,'provider.deleted','provider',24,'{\"provider_key\":\"anthropic\",\"category\":\"ai\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-11 07:14:31'),
(110,NULL,'admin',NULL,NULL,'provider.deleted','provider',38,'{\"provider_key\":\"azure_openai\",\"category\":\"ai\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-11 07:14:34'),
(111,NULL,'admin',NULL,NULL,'provider.deleted','provider',25,'{\"provider_key\":\"gemini\",\"category\":\"ai\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-11 07:14:51'),
(112,NULL,'admin',NULL,NULL,'provider.deleted','provider',26,'{\"provider_key\":\"groq\",\"category\":\"ai\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-11 07:14:53'),
(113,NULL,'admin',NULL,NULL,'provider.deleted','provider',27,'{\"provider_key\":\"mistral\",\"category\":\"ai\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-11 07:14:56'),
(114,NULL,'admin',NULL,NULL,'provider.deleted','provider',35,'{\"provider_key\":\"neo4j\",\"category\":\"graph\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-11 07:15:56'),
(115,NULL,'admin',NULL,NULL,'provider.deleted','provider',34,'{\"provider_key\":\"aws_s3\",\"category\":\"storage\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-11 07:15:59'),
(116,NULL,'admin',NULL,NULL,'provider.deleted','provider',29,'{\"provider_key\":\"cloudflare_r2\",\"category\":\"storage\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-11 07:16:05'),
(117,NULL,'admin',NULL,NULL,'provider.deleted','provider',30,'{\"provider_key\":\"cloudflare_d1\",\"category\":\"database\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-11 07:16:12'),
(118,NULL,'admin',NULL,NULL,'provider.imported','provider',23,NULL,'{\"provider_key\":\"openai\",\"provider_id\":23,\"imported\":\"refreshed\",\"counts\":{\"authFields\":1,\"endpoints\":0,\"capabilities\":2,\"resources\":0,\"models\":1,\"pricing\":1}}',NULL,NULL,NULL,'admin action',0,'2026-08-11 07:48:51'),
(119,NULL,'admin',NULL,NULL,'provider.deleted','provider',28,'{\"provider_key\":\"cloudflare_vectorize\",\"category\":\"vector\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-11 08:15:27'),
(120,NULL,'admin',NULL,NULL,'provider.deleted','provider',31,'{\"provider_key\":\"pinecone\",\"category\":\"vector\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-11 08:15:30'),
(121,NULL,'admin',NULL,NULL,'provider.deleted','provider',33,'{\"provider_key\":\"qdrant\",\"category\":\"vector\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-11 08:15:32'),
(122,NULL,'admin',NULL,NULL,'provider.deleted','provider',32,'{\"provider_key\":\"weaviate\",\"category\":\"vector\"}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-11 08:15:38'),
(123,1,'admin',NULL,NULL,'credential.deleted','credential',1,NULL,'{\"credential_key\":\"e2e-test\",\"provider_key\":\"cloudflare\",\"forced\":true}',NULL,NULL,NULL,'admin action (force provider delete)',1,'2026-08-11 12:30:20'),
(124,1,'admin',NULL,NULL,'credential.deleted','credential',2,NULL,'{\"credential_key\":\"browser_e2e_key\",\"provider_key\":\"cloudflare\",\"forced\":true}',NULL,NULL,NULL,'admin action (force provider delete)',1,'2026-08-11 12:30:20'),
(125,2,'admin',NULL,NULL,'credential.deleted','credential',3,NULL,'{\"credential_key\":\"cloudflare_api_key\",\"provider_key\":\"cloudflare\",\"forced\":true}',NULL,NULL,NULL,'admin action (force provider delete)',1,'2026-08-11 12:30:20'),
(126,1,'admin',NULL,NULL,'credential.deleted','credential',4,NULL,'{\"credential_key\":\"openai_main\",\"provider_key\":\"openai\",\"forced\":false}',NULL,NULL,NULL,'provider delete (soft-deleted credential cleanup)',1,'2026-08-12 05:37:20'),
(127,1,'admin',NULL,NULL,'credential.deleted','credential',6,NULL,'{\"credential_key\":\"env_probe\",\"provider_key\":\"openai\",\"forced\":false}',NULL,NULL,NULL,'provider delete (soft-deleted credential cleanup)',1,'2026-08-12 05:37:20'),
(128,NULL,'admin',NULL,NULL,'provider.deleted','provider',23,'{\"provider_key\":\"openai\",\"category\":\"ai\",\"forced\":false}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-12 05:37:20'),
(129,NULL,'admin',NULL,NULL,'provider.created','provider',42,NULL,'{\"provider_key\":\"cloudflare\",\"category\":\"ai\"}',NULL,NULL,NULL,'admin action',0,'2026-08-12 06:23:07'),
(130,NULL,'admin',NULL,NULL,'provider.updated','provider',42,'{\"provider_name\":\"Cloudflare\",\"category\":\"ai\",\"auth_type\":\"bearer_token\",\"website_url\":null,\"documentation_url\":null,\"default_api_base_url\":null}','{\"provider_name\":\"Cloudflare\",\"category\":\"ai\",\"auth_type\":\"api_key\",\"website_url\":null,\"documentation_url\":null,\"default_api_base_url\":null}',NULL,NULL,NULL,'admin action',0,'2026-08-12 06:34:31'),
(131,2,'admin',NULL,NULL,'credential.created','credential',7,NULL,'{\"credential_key\":\"test\",\"provider_key\":\"cloudflare\"}',NULL,NULL,NULL,'admin action',1,'2026-08-12 06:35:50'),
(132,2,'admin',NULL,NULL,'credential.verified.success','credential',7,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-12 06:35:50'),
(133,2,'admin',NULL,NULL,'credential.verified.failed','credential',7,NULL,'{\"last_verification_status\":\"failed\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-12 07:04:14'),
(134,2,'admin',NULL,NULL,'credential.deleted','credential',7,NULL,'{\"credential_key\":\"test\"}',NULL,NULL,NULL,'admin action',1,'2026-08-12 07:04:22'),
(135,NULL,'admin',NULL,NULL,'provider.imported','provider',43,NULL,'{\"provider_key\":\"wizard_test_ai\",\"provider_id\":43,\"imported\":\"created\",\"counts\":{\"authFields\":1,\"endpoints\":1,\"capabilities\":0,\"resources\":1,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-12 07:19:14'),
(136,NULL,'admin',NULL,NULL,'provider.deleted','provider',43,'{\"provider_key\":\"wizard_test_ai\",\"category\":\"ai\",\"forced\":false}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-12 07:19:43'),
(137,NULL,'admin',NULL,NULL,'provider.imported','provider',44,NULL,'{\"provider_key\":\"smoke_test\",\"provider_id\":44,\"imported\":\"created\",\"counts\":{\"authFields\":1,\"endpoints\":1,\"capabilities\":0,\"resources\":1,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-12 07:21:49'),
(138,NULL,'admin',NULL,NULL,'provider.deleted','provider',44,'{\"provider_key\":\"smoke_test\",\"category\":\"ai\",\"forced\":false}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-12 07:21:49'),
(139,2,'admin',NULL,NULL,'credential.deleted','credential',7,NULL,'{\"credential_key\":\"test\",\"provider_key\":\"cloudflare\",\"forced\":false}',NULL,NULL,NULL,'provider delete (soft-deleted credential cleanup)',1,'2026-08-12 07:22:39'),
(140,NULL,'admin',NULL,NULL,'provider.deleted','provider',42,'{\"provider_key\":\"cloudflare\",\"category\":\"ai\",\"forced\":false}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-12 07:22:39'),
(141,NULL,'admin',NULL,NULL,'provider.imported','provider',45,NULL,'{\"provider_key\":\"cloudflare\",\"provider_id\":45,\"imported\":\"created\",\"counts\":{\"authFields\":0,\"endpoints\":0,\"capabilities\":0,\"resources\":0,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-12 07:28:43'),
(142,NULL,'admin',NULL,NULL,'provider.deleted','provider',45,'{\"provider_key\":\"cloudflare\",\"category\":\"ai\",\"forced\":false}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-12 07:28:52'),
(143,NULL,'admin',NULL,NULL,'provider.imported','provider',46,NULL,'{\"provider_key\":\"test_provider\",\"provider_id\":46,\"imported\":\"created\",\"counts\":{\"authFields\":0,\"endpoints\":0,\"capabilities\":0,\"resources\":0,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-12 07:35:45'),
(144,NULL,'admin',NULL,NULL,'provider.imported','provider',46,NULL,'{\"provider_key\":\"test_provider\",\"provider_id\":46,\"imported\":\"refreshed\",\"counts\":{\"authFields\":0,\"endpoints\":0,\"capabilities\":0,\"resources\":0,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-12 07:36:29'),
(145,NULL,'admin',NULL,NULL,'provider.deleted','provider',46,'{\"provider_key\":\"test_provider\",\"category\":\"ai\",\"forced\":false}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-12 07:57:24'),
(146,NULL,'admin',NULL,NULL,'provider.imported','provider',48,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"provider_id\":48,\"imported\":\"created\",\"counts\":{\"authFields\":1,\"endpoints\":0,\"capabilities\":0,\"resources\":0,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-12 08:25:21'),
(147,2,'admin',NULL,NULL,'credential.created','credential',8,NULL,'{\"credential_key\":\"smoke-mspxeeco\",\"provider_key\":\"cloudflare_worker_ai\"}',NULL,NULL,NULL,'admin action',1,'2026-08-12 10:07:49'),
(148,2,'admin',NULL,'::1','assistant.created','assistant',1,NULL,'{\"assistant_key\":\"smoke-mspxeqqb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-12 10:08:05'),
(149,2,'admin',NULL,'::1','assistant.deleted','assistant',1,NULL,'{\"assistant_key\":\"smoke-mspxeqqb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-12 10:08:05'),
(150,2,'admin',NULL,NULL,'resource.created','provider_resource',1,NULL,'{\"resource_key\":\"smoke-mspxf1en\",\"resource_type\":\"vector_index\",\"provider_key\":\"cloudflare_worker_ai\",\"credential_key\":\"smoke-mspxeeco\"}',NULL,NULL,NULL,'admin action',0,'2026-08-12 10:08:19'),
(151,2,'admin',NULL,NULL,'resource.deleted','provider_resource',1,NULL,'{\"resource_key\":\"smoke-mspxf1en\"}',NULL,NULL,NULL,'admin action',0,'2026-08-12 10:08:19'),
(152,2,'admin',NULL,'::1','assistant.created','assistant',2,NULL,'{\"assistant_key\":\"smoke-mspxf1pf\"}',NULL,NULL,NULL,'admin action',0,'2026-08-12 10:08:19'),
(153,2,'admin',NULL,'::1','assistant.deleted','assistant',2,NULL,'{\"assistant_key\":\"smoke-mspxf1pf\"}',NULL,NULL,NULL,'admin action',0,'2026-08-12 10:08:19'),
(154,2,'admin',NULL,NULL,'credential.deleted','credential',8,NULL,'{\"credential_key\":\"smoke-mspxeeco\"}',NULL,NULL,NULL,'admin action',1,'2026-08-12 10:08:27'),
(155,2,'admin',NULL,NULL,'credential.created','credential',9,NULL,'{\"credential_key\":\"cloudflare\",\"provider_key\":\"cloudflare_worker_ai\"}',NULL,NULL,NULL,'admin action',1,'2026-08-12 11:13:17'),
(156,2,'admin',NULL,NULL,'credential.verified.success','credential',9,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-12 11:13:17'),
(157,2,'admin',NULL,NULL,'credential.verified.success','credential',9,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-12 11:13:24'),
(158,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":null,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare v2\",\"environment_id\":null,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-12 11:19:34'),
(159,2,'admin',NULL,NULL,'credential.verified.success','credential',9,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-12 11:19:34'),
(160,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare v2\",\"environment_id\":null,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":null,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-12 11:19:43'),
(161,2,'admin',NULL,NULL,'credential.verified.success','credential',9,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-12 11:19:44'),
(162,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',36,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"test-verify-model\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-12 12:08:10'),
(163,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',37,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"test-ui-model\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-12 12:14:25'),
(164,NULL,'admin',NULL,NULL,'provider.model.updated','provider_model',37,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"test-ui-model\"}','{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"test-ui-model\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-12 12:14:38'),
(165,NULL,'admin',NULL,NULL,'provider.model.deleted','provider_model',37,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"test-ui-model\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-12 12:14:52'),
(166,2,'admin',NULL,NULL,'environment.created','environment',8,NULL,'{\"company_key\":\"popularcert\",\"env_key\":\"testing\"}',NULL,NULL,NULL,'admin action',0,'2026-08-13 05:38:01'),
(167,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":null,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',1,'2026-08-13 05:38:08'),
(168,2,'admin',NULL,NULL,'credential.verified.success','credential',9,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-13 05:38:09'),
(169,NULL,'admin',NULL,NULL,'provider.created','provider',49,NULL,'{\"provider_key\":\"force_smoke_t\",\"category\":\"ai\"}',NULL,NULL,NULL,'admin action',0,'2026-08-13 06:04:00'),
(170,NULL,'admin',NULL,NULL,'provider.deleted','provider',49,'{\"provider_key\":\"force_smoke_t\",\"category\":\"ai\",\"forced\":false}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-13 06:04:00'),
(171,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',39,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"cf-moondream-moondream3.1-9b-a2b\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 06:42:01'),
(172,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',40,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/moondream/moondream3.1-9B-A2B\",\"category\":\"embedding\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 06:48:19'),
(173,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',41,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"blankpage-test-model\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 06:52:02'),
(174,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',42,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"priced-test-model\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 06:54:22'),
(175,NULL,'admin',NULL,NULL,'provider.imported','provider',50,NULL,'{\"provider_key\":\"emptytest\",\"provider_id\":50,\"imported\":\"created\",\"counts\":{\"authFields\":0,\"endpoints\":0,\"capabilities\":0,\"resources\":0,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-13 06:55:42'),
(176,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',43,NULL,'{\"provider_key\":\"emptytest\",\"model_key\":\"first-model\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 06:56:02'),
(177,NULL,'admin',NULL,NULL,'provider.imported','provider',51,NULL,'{\"provider_key\":\"openai\",\"provider_id\":51,\"imported\":\"created\",\"counts\":{\"authFields\":0,\"endpoints\":0,\"capabilities\":0,\"resources\":0,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-13 06:59:04'),
(178,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',44,NULL,'{\"provider_key\":\"openai\",\"model_key\":\"context-test\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 06:59:41'),
(179,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',45,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/moondream/moondream3.1-9b-a2b\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 07:04:16'),
(180,NULL,'admin',NULL,NULL,'provider.model.updated','provider_model',45,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/moondream/moondream3.1-9b-a2b\"}','{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/moondream/moondream3.1-9b-a2b\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 07:04:28'),
(181,NULL,'admin',NULL,NULL,'provider.model.updated','provider_model',45,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/moondream/moondream3.1-9b-a2b\"}','{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/moondream/moondream3.1-9b-a2b\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 07:05:03'),
(182,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',46,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"rename-test-model\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 07:12:02'),
(183,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',47,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/baai/bge-reranker-base\",\"category\":\"embedding\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 07:29:31'),
(184,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',47,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/baai/bge-reranker-base\",\"category\":\"reranker\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 07:30:00'),
(185,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',49,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/baai/bge-base-en-v1.5\",\"category\":\"embedding\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 07:31:04'),
(186,2,'admin',NULL,NULL,'model_access.granted','credential_model_access',9,NULL,'{\"model_key\":\"@cf/moondream/moondream3.1-9b-a2b\",\"isEnabled\":true}',NULL,NULL,NULL,'admin action',0,'2026-08-13 08:09:42'),
(187,2,'admin',NULL,NULL,'model_access.granted','credential_model_access',9,NULL,'{\"model_key\":\"@cf/baai/bge-base-en-v1.5\",\"isEnabled\":true}',NULL,NULL,NULL,'admin action',0,'2026-08-13 08:09:43'),
(188,2,'admin',NULL,NULL,'model_access.granted','credential_model_access',9,NULL,'{\"model_key\":\"@cf/baai/bge-reranker-base\",\"isEnabled\":true}',NULL,NULL,NULL,'admin action',0,'2026-08-13 08:09:44'),
(189,2,'admin',NULL,NULL,'credential.rotated','credential',9,'{}','{\"last_rotated_at\":\"2026-08-13T08:10:09.124Z\"}',NULL,NULL,NULL,'manual rotation (portal)',1,'2026-08-13 08:10:09'),
(190,2,'admin',NULL,NULL,'credential.rotated','credential',9,'{}','{\"last_rotated_at\":\"2026-08-13T08:11:10.174Z\"}',NULL,NULL,NULL,'manual rotation (portal)',1,'2026-08-13 08:11:10'),
(191,2,'admin',NULL,NULL,'credential.verified.success','credential',9,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-13 08:11:21'),
(192,NULL,'admin',NULL,NULL,'provider.imported','provider',52,NULL,'{\"provider_key\":\"nvidia\",\"provider_id\":52,\"imported\":\"created\",\"counts\":{\"authFields\":0,\"endpoints\":0,\"capabilities\":0,\"resources\":0,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-13 10:33:18'),
(193,NULL,'admin',NULL,NULL,'provider.imported','provider',52,NULL,'{\"provider_key\":\"nvidia\",\"provider_id\":52,\"imported\":\"refreshed\",\"counts\":{\"authFields\":0,\"endpoints\":0,\"capabilities\":0,\"resources\":0,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-13 10:43:15'),
(194,NULL,'admin',NULL,NULL,'provider.imported','provider',52,NULL,'{\"provider_key\":\"nvidia\",\"provider_id\":52,\"imported\":\"created\",\"counts\":{\"authFields\":1,\"endpoints\":0,\"capabilities\":0,\"resources\":0,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-13 10:44:14'),
(195,2,'admin',NULL,NULL,'credential.created','credential',10,NULL,'{\"credential_key\":\"nvidia_api_key\",\"provider_key\":\"nvidia\"}',NULL,NULL,NULL,'admin action',1,'2026-08-13 10:45:39'),
(196,2,'admin',NULL,NULL,'credential.verified.success','credential',10,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-13 10:45:40'),
(197,2,'admin',NULL,NULL,'credential.verified.success','credential',10,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-13 10:45:45'),
(198,NULL,'admin',NULL,NULL,'provider.imported','provider',52,NULL,'{\"provider_key\":\"nvidia\",\"provider_id\":52,\"imported\":\"created\",\"counts\":{\"authFields\":1,\"endpoints\":0,\"capabilities\":0,\"resources\":0,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-13 10:46:39'),
(199,2,'admin',NULL,NULL,'credential.deleted','credential',10,NULL,'{\"credential_key\":\"nvidia_api_key\"}',NULL,NULL,NULL,'admin action',1,'2026-08-13 10:46:48'),
(200,2,'admin',NULL,NULL,'credential.created','credential',13,NULL,'{\"credential_key\":\"nvidia_api_key2\",\"provider_key\":\"nvidia\"}',NULL,NULL,NULL,'admin action',1,'2026-08-13 10:48:03'),
(201,2,'admin',NULL,NULL,'credential.verified.success','credential',13,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-13 10:48:03'),
(202,2,'admin',NULL,NULL,'credential.rotated','credential',13,'{}','{\"last_rotated_at\":\"2026-08-13T10:48:15.654Z\"}',NULL,NULL,NULL,'manual rotation (portal)',1,'2026-08-13 10:48:15'),
(203,2,'admin',NULL,NULL,'credential.verified.success','credential',13,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-13 10:48:20'),
(204,2,'admin',NULL,NULL,'credential.verified.success','credential',13,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-13 10:48:21'),
(205,2,'admin',NULL,NULL,'credential.created','credential',14,NULL,'{\"credential_key\":\"testing_nvidia_key\",\"provider_key\":\"nvidia\"}',NULL,NULL,NULL,'admin action',1,'2026-08-13 10:54:27'),
(206,2,'admin',NULL,NULL,'credential.verified.success','credential',14,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-13 10:54:27'),
(207,2,'admin',NULL,NULL,'credential.verified.success','credential',14,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-13 10:54:34'),
(208,2,'admin',NULL,NULL,'credential.verified.success','credential',14,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-13 10:54:38'),
(209,NULL,'admin',NULL,NULL,'provider.imported','provider',56,NULL,'{\"provider_key\":\"ph_test_provider\",\"provider_id\":56,\"imported\":\"created\",\"counts\":{\"authFields\":1,\"endpoints\":0,\"capabilities\":0,\"resources\":0,\"models\":0,\"pricing\":0}}',NULL,NULL,NULL,'admin action',0,'2026-08-13 10:56:49'),
(210,NULL,'admin',NULL,NULL,'provider.deleted','provider',56,'{\"provider_key\":\"ph_test_provider\",\"category\":\"ai\",\"forced\":false}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-13 10:56:55'),
(211,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":false}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-13 10:58:07'),
(212,2,'admin',NULL,NULL,'credential.verified.success','credential',13,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-13 10:58:07'),
(213,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',50,NULL,'{\"provider_key\":\"nvidia\",\"model_key\":\"meta/llama-3.2-1b-instruct\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 11:00:17'),
(214,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',51,NULL,'{\"provider_key\":\"nvidia\",\"model_key\":\"z-ai/glm-5.2\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 11:01:03'),
(215,NULL,'admin',NULL,NULL,'provider.model.updated','provider_model',51,'{\"provider_key\":\"nvidia\",\"model_key\":\"z-ai/glm-5.2\"}','{\"provider_key\":\"nvidia\",\"model_key\":\"z-ai/glm-5.2\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-13 11:01:52'),
(216,2,'admin',NULL,NULL,'credential.updated','credential',14,'{\"credential_key\":\"testing_nvidia_key\",\"credential_name\":\"Testing Nvidia KEY\",\"environment_id\":8,\"is_default\":false}','{\"credential_key\":\"testing_nvidia_key\",\"credential_name\":\"Testing Nvidia KEY\",\"environment_id\":8,\"is_default\":false}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:38:05'),
(217,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:38:06'),
(218,2,'admin',NULL,NULL,'credential.updated','credential',14,'{\"credential_key\":\"testing_nvidia_key\",\"credential_name\":\"Testing Nvidia KEY\",\"environment_id\":8,\"is_default\":false}','{\"credential_key\":\"testing_nvidia_key\",\"credential_name\":\"Testing Nvidia KEY\",\"environment_id\":8,\"is_default\":false}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:38:06'),
(219,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:38:06'),
(220,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:38:40'),
(221,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:38:41'),
(222,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:38:42'),
(223,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:38:42'),
(224,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:38:43'),
(225,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:38:44'),
(226,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:38:45'),
(227,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:38:46'),
(228,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:50:36'),
(229,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:50:44'),
(230,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:51:03'),
(231,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:51:04'),
(232,2,'admin',NULL,NULL,'credential.verified.success','credential',13,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-14 10:54:27'),
(233,2,'admin',NULL,NULL,'credential.verified.success','credential',14,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-14 10:54:38'),
(234,2,'admin',NULL,NULL,'credential.verified.success','credential',14,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-14 10:54:41'),
(235,2,'admin',NULL,NULL,'provider.execute.chat','credential',13,NULL,'{\"provider_key\":\"nvidia\",\"model\":\"z-ai/glm-5.2\"}',NULL,NULL,NULL,'admin action',0,'2026-08-14 10:54:52'),
(236,NULL,'admin',NULL,NULL,'provider.model.deleted','provider_model',54,NULL,'{\"provider_key\":\"nvidia\",\"model_key\":\"nvidia/llama-3.1-nemotron-70b-instruct\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-14 10:55:00'),
(237,2,'admin',NULL,NULL,'provider.execute.chat','credential',13,NULL,'{\"provider_key\":\"nvidia\",\"model\":\"z-ai/glm-5.2\"}',NULL,NULL,NULL,'admin action',0,'2026-08-14 10:55:14'),
(238,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:55:21'),
(239,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:55:22'),
(240,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:55:23'),
(241,2,'admin',NULL,NULL,'credential.updated','credential',14,'{\"credential_key\":\"testing_nvidia_key\",\"credential_name\":\"Testing Nvidia KEY\",\"environment_id\":8,\"is_default\":false}','{\"credential_key\":\"testing_nvidia_key\",\"credential_name\":\"Testing Nvidia KEY\",\"environment_id\":8,\"is_default\":false}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:55:24'),
(242,2,'admin',NULL,NULL,'credential.updated','credential',14,'{\"credential_key\":\"testing_nvidia_key\",\"credential_name\":\"Testing Nvidia KEY\",\"environment_id\":8,\"is_default\":false}','{\"credential_key\":\"testing_nvidia_key\",\"credential_name\":\"Testing Nvidia KEY\",\"environment_id\":8,\"is_default\":false}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:55:25'),
(243,2,'admin',NULL,NULL,'credential.updated','credential',13,'{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"nvidia_api_key2\",\"credential_name\":\"Nvidia API Key2\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-14 10:55:26'),
(244,2,'admin',NULL,NULL,'credential.created','credential',15,NULL,'{\"credential_key\":\"popularcert_graph\",\"provider_key\":\"neo4j\"}',NULL,NULL,NULL,'admin action',1,'2026-08-14 10:57:49'),
(245,2,'admin',NULL,NULL,'credential.verified.success','credential',15,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-14 10:57:49'),
(246,2,'admin',NULL,NULL,'credential.verified.failed','credential',9,NULL,'{\"last_verification_status\":\"failed\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-14 11:20:29'),
(247,2,'admin',NULL,NULL,'credential.verified.failed','credential',9,NULL,'{\"last_verification_status\":\"failed\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-14 11:21:00'),
(248,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',1,'2026-08-14 11:21:57'),
(249,2,'admin',NULL,NULL,'credential.verified.success','credential',9,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-14 11:21:58'),
(250,2,'admin',NULL,NULL,'credential.verified.success','credential',9,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-14 11:22:02'),
(251,2,'admin',NULL,NULL,'credential.verified.success','credential',9,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-14 12:00:01'),
(252,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',1,'2026-08-14 12:00:44'),
(253,2,'admin',NULL,NULL,'credential.verified.success','credential',9,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-14 12:00:45'),
(254,2,'admin',NULL,NULL,'provider.execute.chat','credential',9,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model\":\"@cf/moondream/moondream3.1-9B-A2B\"}',NULL,NULL,NULL,'admin action',0,'2026-08-14 12:08:58'),
(255,2,'admin',NULL,NULL,'provider.execute.chat','credential',9,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model\":\"@cf/moondream/moondream3.1-9B-A2B\"}',NULL,NULL,NULL,'admin action',0,'2026-08-14 12:18:03'),
(256,2,'admin',NULL,NULL,'provider.execute.chat','credential',13,NULL,'{\"provider_key\":\"nvidia\",\"model\":\"z-ai/glm-5.2\"}',NULL,NULL,NULL,'admin action',0,'2026-08-14 12:23:50'),
(257,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-17 05:20:05'),
(258,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-17 05:20:06'),
(259,NULL,'admin',NULL,NULL,'credential.verified.failed','credential',9,NULL,'{\"last_verification_status\":\"failed\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 05:24:44'),
(260,NULL,'admin',NULL,NULL,'credential.verified.failed','credential',13,NULL,'{\"last_verification_status\":\"failed\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 05:24:44'),
(261,NULL,'admin',NULL,NULL,'credential.verified.failed','credential',15,NULL,'{\"last_verification_status\":\"failed\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 05:24:45'),
(262,NULL,'admin',NULL,NULL,'credential.verified.failed','credential',14,NULL,'{\"last_verification_status\":\"failed\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 05:24:45'),
(263,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-17 05:32:07'),
(264,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-17 05:32:09'),
(265,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-17 05:32:22'),
(266,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-17 05:32:24'),
(267,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare rename-test\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',1,'2026-08-17 06:08:47'),
(268,2,'admin',NULL,NULL,'credential.verified.success','credential',9,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 06:08:48'),
(269,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare rename-test\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',1,'2026-08-17 06:10:08'),
(270,2,'admin',NULL,NULL,'credential.verified.success','credential',9,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 06:10:09'),
(271,2,'admin',NULL,NULL,'model_access.granted','credential_model_access',9,NULL,'{\"model_key\":\"@cf/moondream/moondream3.1-9B-A2B\",\"isEnabled\":false}',NULL,NULL,NULL,'admin action',0,'2026-08-17 06:22:57'),
(272,2,'admin',NULL,NULL,'model_access.granted','credential_model_access',9,NULL,'{\"model_key\":\"@cf/moondream/moondream3.1-9B-A2B\",\"isEnabled\":true}',NULL,NULL,NULL,'admin action',0,'2026-08-17 06:23:18'),
(273,2,'admin',NULL,NULL,'environment.created','environment',9,NULL,'{\"company_key\":\"popularcert\",\"env_key\":\"testenv\"}',NULL,NULL,NULL,'admin action',0,'2026-08-17 06:23:31'),
(274,2,'admin',NULL,NULL,'environment.deleted','environment',NULL,NULL,'{\"company_key\":\"popularcert\",\"env_key\":\"testenv\"}',NULL,NULL,NULL,'admin action',0,'2026-08-17 06:24:06'),
(275,NULL,'admin',NULL,NULL,'provider.updated','provider',134,'{\"provider_name\":\"Claude Code\",\"category\":\"ai\",\"auth_type\":\"oauth2\",\"website_url\":null,\"documentation_url\":null,\"default_api_base_url\":\"https://api.anthropic.com\"}','{\"provider_name\":\"Claude Code\",\"category\":\"ai\",\"auth_type\":\"oauth2\",\"website_url\":null,\"documentation_url\":\"https://claude.com/download\",\"default_api_base_url\":\"https://api.anthropic.com\"}',NULL,NULL,NULL,'admin action',0,'2026-08-17 06:32:11'),
(276,NULL,'admin',NULL,NULL,'provider.updated','provider',134,'{\"provider_name\":\"Claude Code\",\"category\":\"ai\",\"auth_type\":\"oauth2\",\"website_url\":null,\"documentation_url\":\"https://claude.com/download\",\"default_api_base_url\":\"https://api.anthropic.com\"}','{\"provider_name\":\"Claude Code\",\"category\":\"ai\",\"auth_type\":\"oauth2\",\"website_url\":null,\"documentation_url\":\"https://claude.com/download\",\"default_api_base_url\":\"https://api.anthropic.com\"}',NULL,NULL,NULL,'admin action',0,'2026-08-17 06:32:58'),
(277,NULL,'admin',NULL,NULL,'provider.updated','provider',134,'{\"provider_name\":\"Claude Code\",\"category\":\"ai\",\"auth_type\":\"oauth2\",\"website_url\":null,\"documentation_url\":\"https://claude.com/download\",\"default_api_base_url\":\"https://api.anthropic.com\"}','{\"provider_name\":\"Claude Code\",\"category\":\"ai\",\"auth_type\":\"oauth2\",\"website_url\":null,\"documentation_url\":\"https://claude.com/download\",\"default_api_base_url\":\"https://api.anthropic.com\"}',NULL,NULL,NULL,'admin action',0,'2026-08-17 06:33:05'),
(278,NULL,'admin',NULL,NULL,'provider.updated','provider',134,'{\"provider_name\":\"Claude Code\",\"category\":\"ai\",\"auth_type\":\"oauth2\",\"website_url\":null,\"documentation_url\":\"https://claude.com/download\",\"default_api_base_url\":\"https://api.anthropic.com\"}','{\"provider_name\":\"Claude Code\",\"category\":\"ai\",\"auth_type\":\"oauth2\",\"website_url\":null,\"documentation_url\":\"https://claude.com/download\",\"default_api_base_url\":\"https://api.anthropic.com\"}',NULL,NULL,NULL,'admin action',0,'2026-08-17 06:33:10'),
(279,NULL,'admin',NULL,NULL,'provider.updated','provider',134,'{\"provider_name\":\"Claude Code\",\"category\":\"ai\",\"auth_type\":\"oauth2\",\"website_url\":null,\"documentation_url\":\"https://claude.com/download\",\"default_api_base_url\":\"https://api.anthropic.com\"}','{\"provider_name\":\"Claude Code\",\"category\":\"ai\",\"auth_type\":\"oauth2\",\"website_url\":null,\"documentation_url\":\"https://claude.com/download\",\"default_api_base_url\":\"https://api.anthropic.com\"}',NULL,NULL,NULL,'admin action',0,'2026-08-17 06:33:23'),
(280,NULL,'admin',NULL,NULL,'provider.updated','provider',134,'{\"provider_name\":\"Claude Code\",\"category\":\"ai\",\"auth_type\":\"oauth2\",\"website_url\":null,\"documentation_url\":\"https://claude.com/download\",\"default_api_base_url\":\"https://api.anthropic.com\"}','{\"provider_name\":\"Claude Code\",\"category\":\"ai\",\"auth_type\":\"oauth2\",\"website_url\":null,\"documentation_url\":\"https://claude.com/download\",\"default_api_base_url\":\"https://api.anthropic.com\"}',NULL,NULL,NULL,'admin action',0,'2026-08-17 06:33:58'),
(281,NULL,'admin',NULL,NULL,'provider.model.updated','provider_model',132,'{\"provider_key\":\"claude\",\"model_key\":\"claude-opus-5\"}','{\"provider_key\":\"claude\",\"model_key\":\"claude-opus-5\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-17 06:34:06'),
(282,NULL,'admin',NULL,NULL,'provider.model.updated','provider_model',132,'{\"provider_key\":\"claude\",\"model_key\":\"claude-opus-5\"}','{\"provider_key\":\"claude\",\"model_key\":\"claude-opus-5\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-17 06:34:16'),
(283,2,'admin',NULL,NULL,'model_access.bulk_updated','credential_model_access',NULL,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"enabled\":false,\"affected_grants\":3}',NULL,NULL,NULL,'admin action (9Router Disable All)',0,'2026-08-17 06:34:28'),
(284,2,'admin',NULL,NULL,'model_access.bulk_updated','credential_model_access',NULL,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"enabled\":true,\"affected_grants\":3}',NULL,NULL,NULL,'admin action (9Router Disable All)',0,'2026-08-17 06:34:28'),
(285,2,'admin',NULL,NULL,'model_access.bulk_updated','credential_model_access',NULL,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"enabled\":false,\"affected_grants\":3}',NULL,NULL,NULL,'admin action (9Router Disable All)',0,'2026-08-17 06:34:41'),
(286,2,'admin',NULL,NULL,'model_access.bulk_updated','credential_model_access',NULL,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"enabled\":true,\"affected_grants\":3}',NULL,NULL,NULL,'admin action (9Router Disable All)',0,'2026-08-17 06:34:48'),
(287,2,'admin',NULL,NULL,'credential.verified.success','credential',15,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 07:28:47'),
(288,2,'admin',NULL,NULL,'credential.verified.success','credential',13,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 07:29:05'),
(289,2,'admin',NULL,NULL,'credential.verified.success','credential',14,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 07:29:06'),
(290,2,'admin',NULL,NULL,'provider.execute.chat','credential',13,NULL,'{\"provider_key\":\"nvidia\",\"model\":\"z-ai/glm-5.2\"}',NULL,NULL,NULL,'admin action',0,'2026-08-17 07:29:56'),
(291,2,'admin',NULL,'::1','assistant.created','assistant',3,NULL,'{\"assistant_key\":\"sarah\"}',NULL,NULL,NULL,'admin action',0,'2026-08-17 07:33:32'),
(292,2,'admin',NULL,'::1','assistant.updated','assistant',3,'{\"assistant_key\":\"sarah\",\"model_id\":45}','{\"assistant_key\":\"sarah\",\"model_id\":45}',NULL,NULL,NULL,'admin action',0,'2026-08-17 07:33:42'),
(293,2,'admin',NULL,'::1','kb.created','kb',7,NULL,'{\"kb_key\":\"popularcert-kb\"}',NULL,NULL,NULL,'admin action',0,'2026-08-17 07:34:17'),
(294,2,'admin',NULL,'::1','assistant.updated','assistant',3,'{\"assistant_key\":\"sarah\",\"model_id\":45}','{\"assistant_key\":\"sarah\",\"model_id\":45}',NULL,NULL,NULL,'admin action',0,'2026-08-17 07:34:27'),
(295,2,'admin',NULL,NULL,'credential.created','credential',16,NULL,'{\"credential_key\":\"@cf/meta/llama-3.3-70b-instruct-fp8-fast\",\"provider_key\":\"cloudflare_worker_ai\"}',NULL,NULL,NULL,'admin action',1,'2026-08-17 07:41:37'),
(296,2,'admin',NULL,NULL,'credential.verified.success','credential',16,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 07:41:37'),
(297,2,'admin',NULL,NULL,'credential.deleted','credential',16,NULL,'{\"credential_key\":\"@cf/meta/llama-3.3-70b-instruct-fp8-fast\"}',NULL,NULL,NULL,'admin action',1,'2026-08-17 07:41:55'),
(298,NULL,'admin',NULL,NULL,'provider.model.upserted','provider_model',210,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/meta/llama-3.3-70b-instruct-fp8-fast\",\"category\":\"chat\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-17 07:43:05'),
(299,2,'admin',NULL,NULL,'provider.execute.chat','credential',9,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model\":\"@cf/moondream/moondream3.1-9B-A2B\"}',NULL,NULL,NULL,'admin action',0,'2026-08-17 07:43:11'),
(300,2,'admin',NULL,NULL,'provider.execute.chat','credential',9,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model\":\"@cf/meta/llama-3.3-70b-instruct-fp8-fast\"}',NULL,NULL,NULL,'admin action',0,'2026-08-17 07:43:26'),
(301,NULL,'admin',NULL,NULL,'credential.verified.failed','credential',9,NULL,'{\"last_verification_status\":\"failed\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 07:56:28'),
(302,NULL,'admin',NULL,NULL,'credential.verified.failed','credential',13,NULL,'{\"last_verification_status\":\"failed\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 07:56:28'),
(303,NULL,'admin',NULL,NULL,'credential.verified.failed','credential',15,NULL,'{\"last_verification_status\":\"failed\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 07:56:28'),
(304,NULL,'admin',NULL,NULL,'credential.verified.failed','credential',14,NULL,'{\"last_verification_status\":\"failed\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 07:56:28'),
(305,2,'admin',NULL,NULL,'credential.verified.success','credential',9,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 08:03:57'),
(306,2,'admin',NULL,NULL,'credential.verified.success','credential',13,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 08:04:13'),
(307,2,'admin',NULL,NULL,'credential.verified.success','credential',14,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 08:04:14'),
(308,2,'admin',NULL,NULL,'credential.created','credential',17,NULL,'{\"credential_key\":\"popularcert\",\"provider_key\":\"cloudflare_vectorize\"}',NULL,NULL,NULL,'admin action',1,'2026-08-17 08:25:22'),
(309,2,'admin',NULL,NULL,'credential.verified.success','credential',17,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 08:25:22'),
(310,2,'admin',NULL,NULL,'credential.created','credential',19,NULL,'{\"credential_key\":\"popularcert_r2\",\"provider_key\":\"cloudflare_r2\"}',NULL,NULL,NULL,'admin action',1,'2026-08-17 08:27:25'),
(311,2,'admin',NULL,NULL,'credential.verified.success','credential',19,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 08:27:26'),
(312,2,'admin',NULL,NULL,'credential.verified.success','credential',19,NULL,'{\"last_verification_status\":\"success\"}',NULL,NULL,NULL,'verification probe',0,'2026-08-17 08:27:38'),
(313,2,'admin',NULL,'::1','assistant.updated','assistant',3,'{\"assistant_key\":\"sarah\",\"model_id\":45}','{\"assistant_key\":\"sarah\",\"model_id\":210}',NULL,NULL,NULL,'admin action',0,'2026-08-17 08:28:11'),
(314,2,'admin',NULL,NULL,'credential.updated','credential',9,'{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}','{\"credential_key\":\"cloudflare\",\"credential_name\":\"cloudflare\",\"environment_id\":8,\"is_default\":true}',NULL,NULL,NULL,'admin update',0,'2026-08-17 09:50:18'),
(315,2,'admin',NULL,NULL,'credential.deleted','credential',9,NULL,'{\"credential_key\":\"cloudflare\"}',NULL,NULL,NULL,'admin action',1,'2026-08-17 09:50:30'),
(316,NULL,'admin',NULL,NULL,'provider.model.deleted','provider_model',45,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/moondream/moondream3.1-9B-A2B\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-17 09:50:40'),
(317,NULL,'admin',NULL,NULL,'provider.model.deleted','provider_model',210,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/meta/llama-3.3-70b-instruct-fp8-fast\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-17 09:50:43'),
(318,NULL,'admin',NULL,NULL,'provider.model.deleted','provider_model',49,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/baai/bge-base-en-v1.5\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-17 09:50:45'),
(319,NULL,'admin',NULL,NULL,'provider.model.deleted','provider_model',47,NULL,'{\"provider_key\":\"cloudflare_worker_ai\",\"model_key\":\"@cf/baai/bge-reranker-base\"}',NULL,NULL,NULL,'catalog update',0,'2026-08-17 09:50:47'),
(320,2,'admin',NULL,NULL,'credential.deleted','credential',17,NULL,'{\"credential_key\":\"popularcert\"}',NULL,NULL,NULL,'admin action',1,'2026-08-17 09:55:50'),
(321,2,'admin',NULL,NULL,'credential.deleted','credential',17,NULL,'{\"credential_key\":\"popularcert\",\"provider_key\":\"cloudflare_vectorize\",\"forced\":false}',NULL,NULL,NULL,'provider delete (soft-deleted credential cleanup)',1,'2026-08-17 09:55:53'),
(322,NULL,'admin',NULL,NULL,'provider.deleted','provider',63,'{\"provider_key\":\"cloudflare_vectorize\",\"category\":\"vector\",\"forced\":false}',NULL,NULL,NULL,NULL,'admin action',0,'2026-08-17 09:55:53'),
(323,2,'admin',NULL,NULL,'credential.deleted','credential',19,NULL,'{\"credential_key\":\"popularcert_r2\"}',NULL,NULL,NULL,'admin action',1,'2026-08-17 09:56:02');
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `chatbots`
--

DROP TABLE IF EXISTS `chatbots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chatbots` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` int(10) unsigned NOT NULL,
  `assistant_id` bigint(20) unsigned NOT NULL,
  `chatbot_key` varchar(100) NOT NULL,
  `chatbot_name` varchar(200) NOT NULL,
  `web_widget_enabled` tinyint(1) DEFAULT 0,
  `api_endpoint_path` varchar(200) DEFAULT NULL,
  `welcome_message` text DEFAULT NULL,
  `placeholder_text` varchar(200) DEFAULT NULL,
  `theme_config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`theme_config`)),
  `enable_history` tinyint(1) DEFAULT 1,
  `max_history_messages` int(10) unsigned DEFAULT 20,
  `rate_limit_per_user` int(10) unsigned DEFAULT 60,
  `rate_limit_window` varchar(20) DEFAULT 'minute',
  `status` enum('draft','live','paused','archived') DEFAULT 'draft',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_chatbot` (`company_id`,`chatbot_key`),
  KEY `idx_company` (`company_id`,`status`),
  KEY `idx_alive` (`deleted_at`),
  KEY `assistant_id` (`assistant_id`),
  CONSTRAINT `chatbots_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chatbots_ibfk_2` FOREIGN KEY (`assistant_id`) REFERENCES `assistants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `chatbots`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `chatbots` WRITE;
/*!40000 ALTER TABLE `chatbots` DISABLE KEYS */;
/*!40000 ALTER TABLE `chatbots` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `companies`
--

DROP TABLE IF EXISTS `companies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `companies` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `company_key` varchar(100) NOT NULL,
  `company_name` varchar(200) NOT NULL,
  `legal_name` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `billing_email` varchar(255) DEFAULT NULL,
  `website` varchar(500) DEFAULT NULL,
  `plan_tier` enum('free','starter','pro','enterprise','custom') DEFAULT 'free',
  `status` enum('active','suspended','trial','cancelled') DEFAULT 'active',
  `is_active` tinyint(1) DEFAULT 1,
  `max_credentials` int(10) unsigned DEFAULT 50,
  `max_storage_gb` decimal(10,2) DEFAULT 10.00,
  `max_monthly_requests` bigint(20) unsigned DEFAULT 100000,
  `max_knowledge_bases` int(10) unsigned DEFAULT 10,
  `max_assistants` int(10) unsigned DEFAULT 25,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `company_key` (`company_key`),
  KEY `idx_company_key` (`company_key`),
  KEY `idx_status` (`status`,`is_active`),
  KEY `idx_alive` (`deleted_at`)
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `companies`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `companies` WRITE;
/*!40000 ALTER TABLE `companies` DISABLE KEYS */;
INSERT INTO `companies` VALUES
(1,'maxicert','Maxicert',NULL,NULL,NULL,NULL,'free','active',1,50,10.00,100000,10,25,'2026-08-06 07:47:32','2026-08-11 12:21:19','2026-08-11 12:21:19'),
(2,'popularcert','Popularcert',NULL,NULL,NULL,NULL,'free','active',1,50,10.00,100000,10,25,'2026-08-06 07:47:32','2026-08-12 05:38:12',NULL);
/*!40000 ALTER TABLE `companies` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `company_config`
--

DROP TABLE IF EXISTS `company_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `company_config` (
  `company_id` int(10) unsigned NOT NULL,
  `config_key` varchar(120) NOT NULL,
  `config_value` mediumtext NOT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`company_id`,`config_key`),
  KEY `idx_company_config_key` (`config_key`),
  CONSTRAINT `fk_company_config_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `company_config`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `company_config` WRITE;
/*!40000 ALTER TABLE `company_config` DISABLE KEYS */;
INSERT INTO `company_config` VALUES
(2,'AI_PROVIDER','\"cloudflare_worker_ai\"','2026-08-13 08:12:19'),
(2,'API_KEY','\"gcm:QtP1zDpr+b9A8ZNq:FqOgYis2i4EH+xiE1wlc1A==:F4eKx9vFDUuRE/bJZgL1DJjMKEptkVzZQMdzIBSbsMb+sz4=\"','2026-08-13 08:12:19'),
(2,'BASE_URL','\"https://popularcert.com\"','2026-08-13 08:12:19'),
(2,'COMPANY_NAME','\"Popularcert\"','2026-08-13 08:12:19'),
(2,'CONSULTANT_NAME','\"Sarah\"','2026-08-13 08:12:19'),
(2,'CONTACT_US_URL','\"https://popularcert.com/contact-us/\"','2026-08-13 08:12:19'),
(2,'EMBEDDING_DIMENSIONS','768','2026-08-13 08:12:19'),
(2,'EMBEDDING_MODEL','\"@cf/baai/bge-base-en-v1.5\"','2026-08-13 08:12:19'),
(2,'LLM_MODEL','\"@cf/moondream/moondream3.1-9b-a2b\"','2026-08-13 08:12:19'),
(2,'LOCATIONS_URL','\"https://popularcert.com/locations/\"','2026-08-13 08:12:19'),
(2,'R2_BUCKET_NAME','\"\"','2026-08-13 08:12:19'),
(2,'RERANKING_MODEL','\"@cf/baai/bge-reranker-base\"','2026-08-13 08:12:19'),
(2,'SERVICES_URL','\"https://popularcert.com/services/\"','2026-08-13 08:12:19'),
(2,'SMALL_LLM','\"@cf/moondream/moondream3.1-9b-a2b\"','2026-08-13 08:12:19'),
(2,'SYSTEM_PROMPT','\"You are {{CONSULTANT_NAME}}, an AI assistant for {{COMPANY_NAME}}. Do not deny being an AI if asked.\\n\\n## Rules\\n- Answer only from available information. Never reveal your source.\\n- Reply in the user\'s language; switch if asked.\\n- Be concise, clear, and professional. No jokes, opinions, or assumptions.\\n\\n## Formatting\\n- Markdown only. Use ## for multi-section headings, - for bullets, **bold** for key terms, numbered lists for steps only.\\n- No raw HTML, code blocks, or underline headings (=== / ---).\\n\\n## Greetings & Introductions\\nIf the user greets you or introduces themselves, respond warmly, acknowledge them by name if given, and ask how you can help with their certification goals. Do NOT treat greetings or introductions as vague queries.\\n\\n## Clarification\\nIf a message is vague: acknowledge what you understood, then ask one focused question about the missing part. Never ask multiple questions at once.\\n\\n## Discovery\\nIf a user wants certification WITHOUT specifying a standard, ask these one at a time:\\n1. Which standard? (ISO 9001, 14001, 27001, CE Mark, Halal, etc.)\\n2. What industry/sector?\\n3. Primary country/location?\\nDo NOT outline steps or processes until the standard is confirmed.\\n\\n## Pricing\\nIf asked about cost:\\n\\\"Certification costs depend on your organization\'s size, number of employees, standards, and industry scope. We offer a **Free Cost Calculator** on our website. Would you like to share an email or phone number so a consultant can prepare a precise quote?\\\"\\n\\n## Contact\\n[Contact Us]({{CONTACT_US_URL}})\\n\\n## Locations\\n[Our Locations]({{LOCATIONS_URL}})\\n\\n## Services\\n[Our Services]({{SERVICES_URL}})\\n\\n## No Information Found\\n\\\"I\'m not able to find relevant information regarding your query. Please contact our team directly.\\\"\\n[Contact Us]({{CONTACT_US_URL}})\"','2026-08-13 08:12:19'),
(2,'VECTOR_INDEX','\"\"','2026-08-13 08:12:19');
/*!40000 ALTER TABLE `company_config` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `company_environments`
--

DROP TABLE IF EXISTS `company_environments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `company_environments` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` int(10) unsigned NOT NULL,
  `env_key` varchar(50) NOT NULL,
  `env_name` varchar(100) NOT NULL,
  `description` varchar(500) DEFAULT NULL,
  `is_production` tinyint(1) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `sort_order` tinyint(3) unsigned DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_env` (`company_id`,`env_key`),
  KEY `idx_company` (`company_id`,`is_active`),
  KEY `idx_alive` (`deleted_at`),
  CONSTRAINT `company_environments_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `company_environments`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `company_environments` WRITE;
/*!40000 ALTER TABLE `company_environments` DISABLE KEYS */;
INSERT INTO `company_environments` VALUES
(1,1,'production','Production',NULL,1,1,10,'2026-08-11 06:45:06','2026-08-11 06:45:06',NULL),
(2,1,'staging','Staging',NULL,0,1,20,'2026-08-11 06:45:06','2026-08-11 06:45:06',NULL),
(3,1,'development','Development',NULL,0,1,30,'2026-08-11 06:45:06','2026-08-11 06:45:06',NULL),
(4,2,'production','Production',NULL,1,0,10,'2026-08-11 06:45:06','2026-08-11 07:13:59','2026-08-11 07:13:59'),
(5,2,'staging','Staging',NULL,0,0,20,'2026-08-11 06:45:06','2026-08-11 07:14:02','2026-08-11 07:14:02'),
(6,2,'development','Development',NULL,0,0,30,'2026-08-11 06:45:06','2026-08-11 07:14:05','2026-08-11 07:14:05'),
(7,1,'sandbox','Sandbox EU',NULL,0,0,0,'2026-08-11 06:45:31','2026-08-11 06:45:32','2026-08-11 06:45:32'),
(8,2,'testing','Testing',NULL,0,1,0,'2026-08-13 05:38:01','2026-08-13 05:38:01',NULL),
(9,2,'testenv','Test Env',NULL,0,0,0,'2026-08-17 06:23:31','2026-08-17 06:24:06','2026-08-17 06:24:06');
/*!40000 ALTER TABLE `company_environments` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `credential_model_access`
--

DROP TABLE IF EXISTS `credential_model_access`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `credential_model_access` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `credential_id` bigint(20) unsigned NOT NULL,
  `provider_model_id` int(10) unsigned NOT NULL,
  `company_id` int(10) unsigned NOT NULL,
  `rate_limit_per_min` int(10) unsigned DEFAULT NULL,
  `rate_limit_per_day` int(10) unsigned DEFAULT NULL,
  `monthly_quota_tokens` bigint(20) unsigned DEFAULT NULL,
  `monthly_quota_used_tokens` bigint(20) unsigned DEFAULT 0,
  `is_enabled` tinyint(1) DEFAULT 1,
  `is_default_for_category` tinyint(1) DEFAULT 0,
  `notes` varchar(500) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_credential_model` (`credential_id`,`provider_model_id`),
  KEY `idx_company` (`company_id`,`is_enabled`),
  KEY `idx_credential` (`credential_id`,`is_enabled`),
  KEY `idx_default` (`credential_id`,`is_default_for_category`),
  KEY `idx_alive` (`deleted_at`),
  KEY `provider_model_id` (`provider_model_id`),
  CONSTRAINT `credential_model_access_ibfk_1` FOREIGN KEY (`credential_id`) REFERENCES `credentials` (`id`) ON DELETE CASCADE,
  CONSTRAINT `credential_model_access_ibfk_2` FOREIGN KEY (`provider_model_id`) REFERENCES `provider_models` (`id`) ON DELETE CASCADE,
  CONSTRAINT `credential_model_access_ibfk_3` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `credential_model_access`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `credential_model_access` WRITE;
/*!40000 ALTER TABLE `credential_model_access` DISABLE KEYS */;
/*!40000 ALTER TABLE `credential_model_access` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `credential_usage_logs`
--

DROP TABLE IF EXISTS `credential_usage_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `credential_usage_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `credential_id` bigint(20) unsigned NOT NULL,
  `company_id` int(10) unsigned NOT NULL,
  `provider_resource_id` bigint(20) unsigned DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `endpoint` varchar(500) DEFAULT NULL,
  `model_used` varchar(100) DEFAULT NULL,
  `resource_type` varchar(50) DEFAULT NULL,
  `request_method` varchar(10) DEFAULT NULL,
  `response_status` int(11) DEFAULT NULL,
  `input_units` bigint(20) unsigned DEFAULT NULL,
  `output_units` bigint(20) unsigned DEFAULT NULL,
  `duration_ms` int(10) unsigned DEFAULT NULL,
  `cost_usd` decimal(12,6) DEFAULT NULL,
  `error_code` varchar(100) DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `user_id` varchar(100) DEFAULT NULL,
  `client_ip` varchar(45) DEFAULT NULL,
  `user_agent` varchar(500) DEFAULT NULL,
  `trace_id` varchar(100) DEFAULT NULL,
  `request_id` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_credential_time` (`credential_id`,`created_at`),
  KEY `idx_company_time` (`company_id`,`created_at`),
  KEY `idx_resource_time` (`provider_resource_id`,`created_at`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_status` (`response_status`),
  KEY `idx_trace` (`trace_id`),
  KEY `idx_cost_company_day` (`company_id`,`created_at`,`cost_usd`),
  CONSTRAINT `credential_usage_logs_ibfk_1` FOREIGN KEY (`credential_id`) REFERENCES `credentials` (`id`) ON DELETE CASCADE,
  CONSTRAINT `credential_usage_logs_ibfk_2` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `credential_usage_logs_ibfk_3` FOREIGN KEY (`provider_resource_id`) REFERENCES `provider_resources` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `credential_usage_logs`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `credential_usage_logs` WRITE;
/*!40000 ALTER TABLE `credential_usage_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `credential_usage_logs` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `credentials`
--

DROP TABLE IF EXISTS `credentials`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `credentials` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` int(10) unsigned NOT NULL,
  `provider_id` int(10) unsigned NOT NULL,
  `environment_id` int(10) unsigned DEFAULT NULL,
  `credential_key` varchar(100) NOT NULL,
  `credential_name` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `encrypted_credentials` text NOT NULL,
  `encryption_version` int(10) unsigned DEFAULT 1,
  `config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`config`)),
  `endpoint_override_url` varchar(500) DEFAULT NULL,
  `endpoint_override_headers` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`endpoint_override_headers`)),
  `credential_type` enum('primary','secondary','fallback','rotating') DEFAULT 'primary',
  `priority` tinyint(3) unsigned DEFAULT 100,
  `is_active` tinyint(1) DEFAULT 1,
  `is_default` tinyint(1) DEFAULT 0,
  `last_verified_at` datetime DEFAULT NULL,
  `last_verification_status` enum('success','failed','pending','expired') DEFAULT NULL,
  `verification_error` text DEFAULT NULL,
  `verified_by` varchar(100) DEFAULT NULL,
  `last_test_latency_ms` int(10) unsigned DEFAULT NULL,
  `last_rotated_at` datetime DEFAULT NULL,
  `next_rotation_at` datetime DEFAULT NULL,
  `rotation_policy` enum('never','manual','30_days','60_days','90_days','180_days','365_days') DEFAULT 'manual',
  `auto_rotate_enabled` tinyint(1) DEFAULT 0,
  `created_source` enum('admin','onboarding','oauth_exchange','api_import','migration') DEFAULT 'admin',
  `expires_at` datetime DEFAULT NULL,
  `rate_limit_requests` int(10) unsigned DEFAULT NULL,
  `rate_limit_window` varchar(20) DEFAULT NULL,
  `created_by` varchar(100) DEFAULT NULL,
  `updated_by` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_credential_key` (`credential_key`),
  UNIQUE KEY `uk_company_provider_env_cred` (`company_id`,`provider_id`,`environment_id`,`credential_key`),
  KEY `idx_company` (`company_id`),
  KEY `idx_provider_env` (`provider_id`,`environment_id`,`is_active`),
  KEY `idx_company_provider` (`company_id`,`provider_id`),
  KEY `idx_expires` (`expires_at`),
  KEY `idx_rotation` (`next_rotation_at`,`auto_rotate_enabled`),
  KEY `idx_default` (`company_id`,`provider_id`,`environment_id`,`is_default`),
  KEY `idx_verification` (`last_verified_at`,`last_verification_status`),
  KEY `idx_alive` (`deleted_at`),
  KEY `environment_id` (`environment_id`),
  CONSTRAINT `credentials_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `credentials_ibfk_2` FOREIGN KEY (`provider_id`) REFERENCES `providers` (`id`),
  CONSTRAINT `credentials_ibfk_3` FOREIGN KEY (`environment_id`) REFERENCES `company_environments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `credentials`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `credentials` WRITE;
/*!40000 ALTER TABLE `credentials` DISABLE KEYS */;
INSERT INTO `credentials` VALUES
(8,2,48,NULL,'smoke-mspxeeco','Smoke Credential',NULL,'{\"api_key\":\"gcm:ATtZzGWYneFyhGoE:HCHvpRkE9/ZCjyQQx4UxSw==:VUm3QUeWp27rsi+6eNZ5bIE1L7SSjT8g\"}',1,NULL,NULL,NULL,'primary',100,1,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'manual',0,'admin',NULL,NULL,NULL,NULL,NULL,'2026-08-12 10:07:49','2026-08-12 10:08:27','2026-08-12 10:08:27'),
(9,2,48,8,'cloudflare','cloudflare',NULL,'{\"api_key\":\"gcm:plVefkXhFEjFwFBr:n0B1v3wb7CamGHrhg0hfZQ==:PA5ATiP8H1Wdi4qJ2K3y8yYjUn4NecG7uoA5ldazYxN0374=\",\"api_token\":\"gcm:hFwxkg4Wnkrxokz8:4Jzwaeox39BsfzE/zxSaBw==:/G4Dln/lwRQHLH5m15Jm0Q3xtq+ZJIVc2CTJOLgxMAcbPUaRbTWAndrB/8G+ONsYngTnIo0=\",\"account_id\":\"gcm:eYSq0WYjKlfd5LTY:IKtpwLnMOvpj9hyf2ZBhsQ==:9Wfu3eRruKoD1kVABofHf7cT1jS831yU04FD89hfJYs=\",\"base_url\":\"https://api.cloudflare.com/client/v4\"}',3,NULL,NULL,NULL,'primary',100,0,1,'2026-08-17 08:03:57','success',NULL,NULL,497,'2026-08-13 08:11:10',NULL,'manual',0,'admin',NULL,NULL,NULL,NULL,NULL,'2026-08-12 11:13:17','2026-08-17 09:50:30','2026-08-17 09:50:30'),
(10,2,52,8,'nvidia_api_key','Nvidia API key',NULL,'{\"api_key\":\"gcm:+5yOFYTOjLVHVuk2:DyFOERwnRibq6boEsgFZCw==:bwe2YRi5fsP11Al3QjWFs4DDiKA9dpRxrRsUeFS1483UkZon27aM4qPuGHOCc7ks2PMLYWVoIPhBLX0GuGfy9Ls0oHgaBw==\"}',1,NULL,NULL,NULL,'primary',100,1,1,'2026-08-13 10:45:45','success',NULL,NULL,NULL,NULL,NULL,'manual',0,'admin',NULL,NULL,NULL,NULL,NULL,'2026-08-13 10:45:39','2026-08-13 10:46:48','2026-08-13 10:46:48'),
(13,2,52,8,'nvidia_api_key2','Nvidia API Key2',NULL,'{\"api_key\":\"gcm:QlAeQoec6BAycNHP:513/ZAboRSYedlALu9ii6A==:ZVSOkyXJn2LKce8C2YAiVji0boSGKjOoTfPhVPnv5Qej4iMAbR2gxegKTR3WdRzXbW9Sc61LMxlqtn7259Kp3b8tccSTPg==\"}',2,NULL,NULL,NULL,'primary',100,1,1,'2026-08-17 08:04:13','success',NULL,NULL,210,'2026-08-13 10:48:15',NULL,'manual',0,'admin',NULL,NULL,NULL,NULL,NULL,'2026-08-13 10:48:03','2026-08-17 08:04:13',NULL),
(14,2,52,8,'testing_nvidia_key','Testing Nvidia KEY',NULL,'{\"api_key\":\"gcm:Y1nZ+Sm0/g5oZrpr:VlaOGE3lGrk4Vlmk8WPgDQ==:esgQoQyPRPc=\"}',1,NULL,NULL,NULL,'primary',100,1,0,'2026-08-17 08:04:14','success',NULL,NULL,56,NULL,NULL,'manual',0,'admin',NULL,NULL,NULL,NULL,NULL,'2026-08-13 10:54:27','2026-08-17 08:04:14',NULL),
(15,2,70,8,'popularcert_graph','Popularcert Graph',NULL,'{\"password\":\"gcm:mlYrBQ3FfMA9ngCM:CNjwGQtkGik9O7MQiYgSsA==:7rLjFaOV9R3uLCUm4My736vqzBUtUkEdoYtJOsmjDZOa9nmx7dwz/De54A==\",\"uri\":\"gcm:wxpq77rhs8vjXfoa:ONXx7lnKD02fDISUi+nemw==:QlvlRug3w0JjqOmzaUmdIBFwp3MfemE0JlDxgBYBDZS7Z4oFtA==\",\"username\":\"gcm:9V7yOuFzH7AuJ6Io:I6iQp6B4Qx8j5zLvG+I8XA==:0X0SHnpwCi8=\"}',1,NULL,NULL,NULL,'primary',100,1,0,'2026-08-17 07:56:28','failed','Malformed encrypted_credentials (expected a JSON object)',NULL,NULL,NULL,NULL,'manual',0,'admin',NULL,NULL,NULL,NULL,NULL,'2026-08-14 10:57:49','2026-08-17 07:56:28',NULL),
(16,2,48,8,'@cf/meta/llama-3.3-70b-instruct-fp8-fast','@cf/meta/llama-3.3-70b-instruct-fp8-fast',NULL,'{\"api_token\":\"gcm:UJdDeb9mF2Oa8sRm:fqnlTKFvecTNvQv9/DhfxA==:wJGau4I0Hki9cH/7ca0Lj8sXDQ8pqkk8yMMku3+bO0TfScr/idKcmSYO0ZcLU6+t0Exskq4=\",\"account_id\":\"gcm:Pk1M6Lolc/9FEt+v:1vwl8v5EJ0nw3PcDZP/SIA==:aNqtCZFtAo8M8tD0TH9p2x5jt/bziBERo04YKcjZzmE=\",\"base_url\":\"https://api.cloudflare.com/client/v4\"}',1,NULL,NULL,NULL,'primary',100,1,0,'2026-08-17 07:41:37','success',NULL,NULL,448,NULL,NULL,'manual',0,'admin',NULL,NULL,NULL,NULL,NULL,'2026-08-17 07:41:37','2026-08-17 07:41:55','2026-08-17 07:41:55'),
(19,2,64,8,'popularcert_r2','Popularcert',NULL,'{\"api_token\":\"gcm:NJ4UpFdelID+ReGm:x5lCdENmVLGWKyVGtUD1HQ==:krabn8dhZNQSmetk6lMsSnou7WvqPvY8+/tDgWH+qUIihm9P4Xz30p5QKFyqnaxTmHE8Ivw=\",\"account_id\":\"gcm:C5UQ9Y7cdPrGCp/q:5iNehHLs0KPmgWtWOD2+WQ==:6VGan49oBUpa2OuFK97km9b9+fGTuGuCZGiaU2swmgE=\",\"access_key_id\":\"gcm:FCrMdgg8n8+Oh5Ww:UN7hcgN5dQexJ29LLruz5A==:xFyJX+gQBhWs75hbboTa/6xjjAHgR8CzgM95PQ1Xb1o=\",\"secret_access_key\":\"gcm:uZfHQLfiPeRu1xmw:a6eCQXmPD464RKK6LmEmSA==:10ms+Z/jdbvgfX9wTfIjLpCxgDaWb+9n2yFIvB1tDaWIWSV5Nzotobhj7sWaP1JZkDL5n8rMjb3ifkap9LS1Tw==\"}',1,NULL,NULL,NULL,'primary',100,1,0,'2026-08-17 08:27:38','success',NULL,NULL,529,NULL,NULL,'manual',0,'admin',NULL,NULL,NULL,NULL,NULL,'2026-08-17 08:27:25','2026-08-17 09:56:02','2026-08-17 09:56:02');
/*!40000 ALTER TABLE `credentials` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `knowledge_bases`
--

DROP TABLE IF EXISTS `knowledge_bases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `knowledge_bases` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `company_id` int(10) unsigned NOT NULL,
  `kb_key` varchar(100) NOT NULL,
  `kb_name` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `vector_resource_id` bigint(20) unsigned DEFAULT NULL,
  `graph_resource_id` bigint(20) unsigned DEFAULT NULL,
  `storage_resource_id` bigint(20) unsigned DEFAULT NULL,
  `embedding_model_id` int(10) unsigned DEFAULT NULL,
  `embedding_model_provider` varchar(50) DEFAULT NULL,
  `chunk_size` int(10) unsigned DEFAULT 512,
  `chunk_overlap` int(10) unsigned DEFAULT 50,
  `retrieval_top_k` int(10) unsigned DEFAULT 10,
  `retrieval_score_threshold` decimal(5,4) DEFAULT 0.7000,
  `enable_graph_rag` tinyint(1) DEFAULT 0,
  `enable_hybrid_search` tinyint(1) DEFAULT 1,
  `status` enum('active','indexing','error','archived') DEFAULT 'active',
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_kb` (`company_id`,`kb_key`),
  KEY `idx_company` (`company_id`,`is_active`),
  KEY `idx_status` (`status`),
  KEY `idx_alive` (`deleted_at`),
  KEY `vector_resource_id` (`vector_resource_id`),
  KEY `graph_resource_id` (`graph_resource_id`),
  KEY `storage_resource_id` (`storage_resource_id`),
  KEY `embedding_model_id` (`embedding_model_id`),
  CONSTRAINT `knowledge_bases_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `knowledge_bases_ibfk_2` FOREIGN KEY (`vector_resource_id`) REFERENCES `provider_resources` (`id`) ON DELETE SET NULL,
  CONSTRAINT `knowledge_bases_ibfk_3` FOREIGN KEY (`graph_resource_id`) REFERENCES `provider_resources` (`id`) ON DELETE SET NULL,
  CONSTRAINT `knowledge_bases_ibfk_4` FOREIGN KEY (`storage_resource_id`) REFERENCES `provider_resources` (`id`) ON DELETE SET NULL,
  CONSTRAINT `knowledge_bases_ibfk_5` FOREIGN KEY (`embedding_model_id`) REFERENCES `provider_models` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `knowledge_bases`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `knowledge_bases` WRITE;
/*!40000 ALTER TABLE `knowledge_bases` DISABLE KEYS */;
INSERT INTO `knowledge_bases` VALUES
(7,2,'popularcert-kb','Popularcert',NULL,NULL,NULL,NULL,NULL,'cloudflare_worker_ai',512,50,10,0.7000,0,1,'active',1,'2026-08-17 07:34:17','2026-08-17 07:34:17',NULL);
/*!40000 ALTER TABLE `knowledge_bases` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `provider_auth_schemas`
--

DROP TABLE IF EXISTS `provider_auth_schemas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `provider_auth_schemas` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `provider_id` int(10) unsigned NOT NULL,
  `field_name` varchar(100) NOT NULL,
  `field_label` varchar(200) NOT NULL,
  `field_type` enum('text','password','textarea','select','url','email','numeric','json','file') NOT NULL,
  `field_placeholder` varchar(255) DEFAULT NULL,
  `field_help_text` varchar(1000) DEFAULT NULL,
  `field_default_value` text DEFAULT NULL,
  `is_required` tinyint(1) DEFAULT 1,
  `validation_regex` varchar(500) DEFAULT NULL,
  `validation_min_length` int(10) unsigned DEFAULT NULL,
  `validation_max_length` int(10) unsigned DEFAULT NULL,
  `is_encrypted` tinyint(1) DEFAULT 1,
  `encryption_storage_path` varchar(100) DEFAULT NULL,
  `display_order` smallint(5) unsigned DEFAULT 0,
  `field_group` varchar(50) DEFAULT 'main',
  `field_width` enum('full','half','third','quarter') DEFAULT 'full',
  `select_options` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`select_options`)),
  `show_when` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`show_when`)),
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_provider_field` (`provider_id`,`field_name`),
  KEY `idx_provider_group` (`provider_id`,`field_group`,`display_order`),
  CONSTRAINT `provider_auth_schemas_ibfk_1` FOREIGN KEY (`provider_id`) REFERENCES `providers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=224 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `provider_auth_schemas`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `provider_auth_schemas` WRITE;
/*!40000 ALTER TABLE `provider_auth_schemas` DISABLE KEYS */;
INSERT INTO `provider_auth_schemas` VALUES
(45,52,'api_key','API Key','password','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',NULL,NULL,1,NULL,NULL,NULL,1,'api_key',0,'main','full',NULL,NULL,1,'2026-08-13 10:44:13','2026-08-13 10:46:39'),
(48,48,'base_url','API Base URL','url','https://api.cloudflare.com/client/v4','Defaults to https://api.cloudflare.com/client/v4',NULL,0,NULL,NULL,NULL,0,'base_url',30,'main','full',NULL,NULL,1,'2026-08-13 11:15:42','2026-08-13 11:15:42'),
(49,48,'account_id','Cloudflare Account ID','text',NULL,'Found in the Cloudflare dashboard URL after /accounts/',NULL,1,NULL,NULL,NULL,1,'account_id',20,'main','full',NULL,NULL,1,'2026-08-13 11:15:42','2026-08-13 11:15:42'),
(50,48,'api_token','Cloudflare API Token','password',NULL,'Generate at https://dash.cloudflare.com/profile/api-tokens',NULL,1,NULL,NULL,NULL,1,'api_token',10,'main','full',NULL,NULL,1,'2026-08-13 11:15:42','2026-08-13 11:15:42'),
(51,58,'api_key','Anthropic API Key','password',NULL,'Generate at https://console.anthropic.com/settings/keys',NULL,1,'^sk-ant-[A-Za-z0-9-]{40,}$',NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(52,69,'region','AWS Region','select',NULL,NULL,NULL,1,NULL,NULL,NULL,0,'region',30,'main','full','[{\"value\": \"us-east-1\", \"label\": \"US East (N. Virginia)\"}, {\"value\": \"us-east-2\", \"label\": \"US East (Ohio)\"}, {\"value\": \"us-west-1\", \"label\": \"US West (N. California)\"}, {\"value\": \"us-west-2\", \"label\": \"US West (Oregon)\"}, {\"value\": \"eu-west-1\", \"label\": \"Europe (Ireland)\"}, {\"value\": \"eu-central-1\", \"label\": \"Europe (Frankfurt)\"}, {\"value\": \"ap-southeast-1\", \"label\": \"Asia Pacific (Singapore)\"}, {\"value\": \"ap-northeast-1\", \"label\": \"Asia Pacific (Tokyo)\"}]',NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(53,69,'secret_access_key','AWS Secret Access Key','password',NULL,NULL,NULL,1,NULL,NULL,NULL,1,'secret_access_key',20,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(54,69,'access_key_id','AWS Access Key ID','text',NULL,NULL,NULL,1,NULL,NULL,NULL,1,'access_key_id',10,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(55,62,'zone_id','Zone ID (optional)','text',NULL,'Only needed for zone-scoped resources',NULL,0,NULL,NULL,NULL,1,'zone_id',30,'advanced','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(56,62,'account_id','Cloudflare Account ID','text',NULL,'Found in the Cloudflare dashboard URL after /accounts/',NULL,1,NULL,NULL,NULL,1,'account_id',20,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(57,62,'api_token','Cloudflare API Token','password',NULL,'Generate at https://dash.cloudflare.com/profile/api-tokens',NULL,1,NULL,NULL,NULL,1,'api_token',10,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(58,64,'secret_access_key','R2 Secret Access Key','password',NULL,'Only needed for S3 API access to buckets',NULL,0,NULL,NULL,NULL,1,'secret_access_key',40,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(59,64,'access_key_id','R2 Access Key ID','text',NULL,'Only needed for S3 API access to buckets',NULL,0,NULL,NULL,NULL,1,'access_key_id',30,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(60,64,'account_id','Cloudflare Account ID','text',NULL,'Found in the Cloudflare dashboard URL after /accounts/',NULL,1,NULL,NULL,NULL,1,'account_id',20,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(61,64,'api_token','Cloudflare API Token','password',NULL,'Generate at https://dash.cloudflare.com/profile/api-tokens',NULL,1,NULL,NULL,NULL,1,'api_token',10,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(64,59,'api_key','Google AI API Key','password',NULL,'Generate at https://aistudio.google.com/app/apikey',NULL,1,'^AIza[A-Za-z0-9_-]{35}$',NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(65,70,'password','Password','password',NULL,NULL,NULL,1,NULL,NULL,NULL,1,'password',30,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(66,70,'username','Username','text',NULL,'Default: neo4j',NULL,1,NULL,NULL,NULL,1,'username',20,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(67,70,'uri','Neo4j URI','url',NULL,'bolt://localhost:7687 or neo4j+s://xxx.databases.neo4j.io',NULL,1,NULL,NULL,NULL,1,'uri',10,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(68,57,'api_key','OpenAI API Key','password',NULL,'Generate at https://platform.openai.com/api-keys',NULL,1,'^sk-[A-Za-z0-9]{20,}$',NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(82,72,'api_key','DeepSeek API Key','password',NULL,'Generate at https://platform.deepseek.com/api_keys',NULL,1,'^sk-[A-Za-z0-9]{20,}$',NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(83,73,'api_key','xAI API Key','password',NULL,'Generate at https://console.x.ai/settings/api-keys',NULL,1,'^xai-[A-Za-z0-9]{20,}$',NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(84,74,'api_key','Perplexity API Key','password',NULL,'Generate at https://www.perplexity.ai/settings/api',NULL,1,'^pplx-[A-Za-z0-9]{20,}$',NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(85,75,'api_key','Together API Key','password',NULL,'Generate at https://api.together.xyz/settings/api-keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(86,76,'api_key','Fireworks API Key','password',NULL,'Generate at https://fireworks.ai/account/api-keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(87,77,'api_key','Cerebras API Key','password',NULL,'Generate at https://cloud.cerebras.ai/platform/account/api-keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(88,78,'api_key','Cohere API Key','password',NULL,'Generate at https://dashboard.cohere.com/api-keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(89,79,'api_key','OpenRouter API Key','password',NULL,'Generate at https://openrouter.ai/settings/keys',NULL,1,'^sk-or-v1-[A-Za-z0-9-]{20,}$',NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(90,80,'api_key','MiniMax API Key','password',NULL,'Generate at https://platform.minimaxi.com/user-center/basic-information',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(91,81,'api_key','GLM API Key','password',NULL,'Generate at https://z.ai/console/keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(92,82,'api_key','Kimi API Key','password',NULL,'Generate at https://platform.moonshot.cn/console/api-keys',NULL,1,'^sk-[A-Za-z0-9]{20,}$',NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(93,83,'api_key','Nebius API Key','password',NULL,'Generate at https://studio.nebius.ai/settings/api-keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(94,84,'api_key','SiliconFlow API Key','password',NULL,'Generate at https://cloud.siliconflow.cn/account/ak',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(95,85,'api_key','Hyperbolic API Key','password',NULL,'Generate at https://app.hyperbolic.xyz/settings',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(97,87,'api_key','Azure OpenAI API Key','password',NULL,'Generate at https://portal.azure.com (Azure OpenAI service keys)',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(98,87,'resource','Azure Resource Name','text',NULL,'The {resource} in https://{resource}.openai.azure.com',NULL,1,NULL,NULL,NULL,1,'resource',20,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(99,88,'api_key','SambaNova API Key','password',NULL,'Generate at https://cloud.sambanova.ai/apis',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(100,89,'api_key','Tencent Hunyuan API Key','password',NULL,'Generate at https://console.cloud.tencent.com/hunyuan/api-key',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(101,90,'api_key','Baidu Qianfan API Key','password',NULL,'Generate at https://console.bce.baidu.com/qianfan',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(102,91,'api_key','Venice API Key','password',NULL,'Generate at https://venice.ai/settings/api',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(103,92,'api_key','Hugging Face Token','password',NULL,'Generate at https://huggingface.co/settings/tokens',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(104,93,'api_key','Poolside API Key','password',NULL,'Generate at https://platform.poolside.ai/api-keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(105,94,'api_key','Chutes API Key','password',NULL,'Generate at https://chutes.ai/app/api',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(106,95,'api_key','Featherless API Key','password',NULL,'Generate at https://featherless.ai/account/api-keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(107,96,'api_key','Blackbox API Key','password',NULL,'Generate at https://www.blackbox.ai/api-management',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(108,97,'api_key','GLM (China) API Key','password',NULL,'Generate at https://open.bigmodel.cn/usercenter/apikeys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(109,98,'api_key','MiniMax (China) API Key','password',NULL,'Generate at https://platform.minimaxi.com/user-center/basic-information',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(110,99,'api_key','Alibaba Studio API Key','password',NULL,'Generate at https://modelstudio.console.alibabacloud.com',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(111,100,'api_key','Alibaba Coding API Key','password',NULL,'Generate at https://bailian.console.aliyun.com',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(112,101,'api_key','Alibaba Coding Intl API Key','password',NULL,'Generate at https://www.alibabacloud.com/product/coding',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(113,102,'api_key','BytePlus API Key','password',NULL,'Generate at https://console.byteplus.com/ark',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(114,103,'api_key','Volcengine Ark API Key','password',NULL,'Generate at https://console.volcengine.com/ark',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(115,104,'api_key','TokenRouter API Key','password',NULL,'Generate at https://www.tokenrouter.com',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(116,105,'api_key','API.airforce API Key','password',NULL,'Generate at https://api.airforce',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(117,106,'api_key','Bazaarlink API Key','password',NULL,'Generate at https://bazaarlink.ai',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(118,107,'api_key','BluesMinds API Key','password',NULL,'Generate at https://bluesminds.com',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(119,108,'api_key','Kilo Gateway API Key','password',NULL,'Generate at https://kilo.ai/dashboard?tab=apiKeys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(120,109,'api_key','LLM7 API Key','password',NULL,'Generate at https://llm7.io',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(121,110,'api_key','Morph API Key','password',NULL,'Generate at https://morphllm.com',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(122,111,'api_key','NanoBanana API Key','password',NULL,'Generate at https://nanobananaapi.ai/dashboard',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(123,112,'api_key','Xiaomi MiMo API Key','password',NULL,'Generate at https://platform.xiaomimimo.com/console/api-keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(124,113,'api_key','MiMo Token Plan API Key','password',NULL,'Token Plan keys start with tp-; get one at https://mimo.xiaomi.com',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(125,114,'api_key','MiMo Free API Key (optional)','password',NULL,'Free channel - a key may not be required',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(126,115,'token','iFlow Token','password',NULL,'OAuth subscription - paste a session token if available',NULL,0,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(127,116,'token','Qoder Personal Access Token','password',NULL,'PAT (pt-...) from https://qoder.com/account/integrations',NULL,1,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(128,117,'token','Zed Access Token','password',NULL,'OAuth subscription - paste the access token from zed.dev',NULL,1,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(129,118,'api_key','Command Code API Key','password',NULL,'CLI key (user_...) from https://commandcode.ai/studio',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(130,119,'api_key','ClinePass API Key','password',NULL,'Generate at https://app.cline.bot',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(131,120,'api_key','Perplexity API Key','password',NULL,'Generate at https://www.perplexity.ai/settings/api',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(132,121,'api_key','OpenCode Free Key (optional)','password',NULL,'No auth required for the free tier',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(133,122,'api_key','OpenCode Go API Key','password',NULL,'Generate at https://opencode.ai/auth',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(134,123,'api_key','Vercel AI Gateway API Key','password',NULL,'Generate at https://vercel.com/dashboard/~/ai-gateway',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(135,124,'api_key','Vertex AI API Key','password',NULL,'GCP service account key; generate at https://console.cloud.google.com/iam-admin/serviceaccounts',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(136,125,'api_key','Vertex Partner API Key','password',NULL,'GCP service account key; generate at https://console.cloud.google.com/iam-admin/serviceaccounts',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(137,126,'token','Kiro Token','password',NULL,'OAuth subscription - paste the Kiro session token from kiro.dev',NULL,1,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(138,127,'token','Grok Web SSO Cookie','password',NULL,'Paste the sso= cookie value from grok.com (SuperGrok subscription)',NULL,1,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(139,128,'token','Grok CLI Token','password',NULL,'OAuth subscription - sign in via device code at https://grok.com/supergrok',NULL,1,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(140,129,'api_key','Ollama Cloud API Key','password',NULL,'Generate at https://ollama.com/settings/keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(141,130,'api_key','Ollama Local Key (optional)','password',NULL,'Local server at http://localhost:11434 - key is not checked',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(142,131,'api_key','Local Device Key (optional)','password',NULL,'On-device TTS - no key required',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(143,132,'api_key','Jina AI API Key','password',NULL,'Generate at https://jina.ai (10M free tokens on signup)',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(144,133,'token','Perplexity Session Cookie','password',NULL,'Paste the __Secure-next-auth.session-token cookie value from perplexity.ai (Pro/Max)',NULL,1,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(145,134,'token','Claude Code Token','password',NULL,'OAuth subscription - paste the Claude Code session token',NULL,0,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(146,135,'token','Codex Token','password',NULL,'OAuth subscription - paste the ChatGPT Codex session token',NULL,0,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(147,136,'token','Cursor Access Token','password',NULL,'OAuth subscription - paste the Cursor session token',NULL,0,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(148,137,'token','Antigravity Token','password',NULL,'OAuth subscription - paste the Google Antigravity token',NULL,0,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(149,138,'token','GitHub Copilot Token','password',NULL,'OAuth subscription - paste the GitHub Copilot session token',NULL,0,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(150,139,'api_key','Kimchi API Key','password',NULL,'Generate at https://app.kimchi.dev',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(151,140,'token','Gemini CLI Token','password',NULL,'OAuth subscription - paste the Google Gemini CLI access token',NULL,0,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(152,141,'api_key','Cline API Key','password',NULL,'Generate at https://cline.bot',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(153,142,'api_key','Kilo Code API Key','password',NULL,'Generate at https://kilocode.ai',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(154,143,'api_key','Voyage AI API Key','password',NULL,'Generate at https://dash.voyageai.com/api-keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(155,144,'api_key','Brave Search API Key','password',NULL,'Generate at https://api.search.brave.com',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(156,145,'api_key','Tavily API Key','password',NULL,'Generate at https://app.tavily.com',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(157,146,'api_key','Serper API Key','password',NULL,'Generate at https://serper.dev',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(158,147,'api_key','SearXNG Key (optional)','password',NULL,'Self-hosted at http://localhost:8080 - key usually not required',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(159,148,'api_key','Exa API Key','password',NULL,'Generate at https://dashboard.exa.ai',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(160,149,'api_key','Linkup API Key','password',NULL,'Generate at https://app.linkup.so/api-keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(161,150,'api_key','SearchAPI Key','password',NULL,'Generate at https://www.searchapi.io/dashboard',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(162,151,'api_key','You.com API Key','password',NULL,'Generate at https://api.you.com',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(163,152,'api_key','Google PSE API Key','password',NULL,'Generate at https://programmablesearchengine.google.com',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(164,153,'api_key','Firecrawl API Key','password',NULL,'Generate at https://firecrawl.dev',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(165,154,'api_key','Jina Reader API Key','password',NULL,'Generate at https://jina.ai',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(166,155,'token','GitLab Personal Access Token','password',NULL,'OAuth subscription - paste a GitLab PAT for Duo',NULL,0,NULL,NULL,NULL,1,'token',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(167,156,'api_key','ElevenLabs API Key','password',NULL,'Generate at https://elevenlabs.io',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(168,157,'api_key','PlayHT API Key','password',NULL,'Generate at https://play.ai',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(169,158,'api_key','Edge TTS Key (optional)','password',NULL,'Local python lib - no key required',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(170,159,'api_key','Google TTS Key (optional)','password',NULL,'Local gTTS - no key required',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(171,160,'access_key_id','AWS Access Key ID','text',NULL,NULL,NULL,1,NULL,NULL,NULL,1,'access_key_id',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(172,160,'secret_access_key','AWS Secret Access Key','password',NULL,NULL,NULL,1,NULL,NULL,NULL,1,'secret_access_key',20,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(173,161,'api_key','Cartesia API Key','password',NULL,'Generate at https://play.cartesia.ai',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(174,162,'api_key','Coqui Key (optional)','password',NULL,'Local server at http://localhost:5002 - no key required',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(175,163,'api_key','Tortoise Key (optional)','password',NULL,'Local server - no key required',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(176,164,'api_key','Inworld API Key','password',NULL,'Generate at https://platform.inworld.ai/api-keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(177,165,'api_key','Self-hosted TTS Key (optional)','password',NULL,'Local server - any non-empty value works; base URL lives in the provider row',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(178,166,'api_key','AssemblyAI API Key','password',NULL,'Generate at https://www.assemblyai.com',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(179,167,'api_key','Deepgram API Key','password',NULL,'Generate at https://console.deepgram.com',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(180,168,'api_key','Self-hosted STT Key (optional)','password',NULL,'Local server - any non-empty value works',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(181,169,'api_key','BFL API Key','password',NULL,'Generate at https://api.bfl.ml',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(182,170,'api_key','Stability AI API Key','password',NULL,'Generate at https://platform.stability.ai',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(183,171,'api_key','Recraft API Key','password',NULL,'Generate at https://recraft.ai',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(184,172,'api_key','Runway API Key','password',NULL,'Generate at https://dev.runwayml.com',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(185,173,'api_key','fal.ai API Key','password',NULL,'Generate at https://fal.ai/dashboard/keys',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(186,174,'api_key','Topaz API Key','password',NULL,'Generate at https://topazlabs.com/account',NULL,1,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(187,175,'api_key','ComfyUI Key (optional)','password',NULL,'Local server at http://localhost:8188 - no key required',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(188,176,'api_key','SD WebUI Key (optional)','password',NULL,'Local server at http://localhost:7860 - no key required',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(189,177,'api_key','MMF Key (optional)','password',NULL,'Free channel - a key may not be required',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(190,178,'api_key','Self-hosted Embedding Key (optional)','password',NULL,'Local server - any non-empty value works; give it the OpenAI base (/v1) URL',NULL,0,NULL,NULL,NULL,1,'api_key',10,'main','full',NULL,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39');
/*!40000 ALTER TABLE `provider_auth_schemas` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `provider_capabilities`
--

DROP TABLE IF EXISTS `provider_capabilities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `provider_capabilities` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `provider_id` int(10) unsigned NOT NULL,
  `capability_key` varchar(50) NOT NULL,
  `is_supported` tinyint(1) DEFAULT 1,
  `config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`config`)),
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_provider_capability` (`provider_id`,`capability_key`),
  KEY `idx_capability` (`capability_key`,`is_supported`),
  KEY `idx_provider` (`provider_id`),
  CONSTRAINT `provider_capabilities_ibfk_1` FOREIGN KEY (`provider_id`) REFERENCES `providers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=363 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `provider_capabilities`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `provider_capabilities` WRITE;
/*!40000 ALTER TABLE `provider_capabilities` DISABLE KEYS */;
INSERT INTO `provider_capabilities` VALUES
(142,58,'reasoning',1,'{\"mode\": \"extended_thinking\"}',1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(143,58,'vision',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(144,58,'function_calling',1,'{\"max_tools\": 64}',1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(145,58,'streaming',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(146,58,'chat',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(147,69,'object_bucket_resource',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(148,69,'object_storage',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(149,62,'kv_namespace_resource',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(150,62,'sql_database_resource',1,'{\"engine\": \"sqlite-compatible\"}',1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(151,62,'object_bucket_resource',1,'{\"s3_compatible\": true}',1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(152,62,'vector_index_resource',1,'{\"max_indexes_per_account\": 100}',1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(153,62,'embeddings',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(154,62,'streaming',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(155,62,'chat',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(156,65,'sql_database_resource',1,'{\"engine\": \"sqlite-compatible\"}',1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(157,64,'object_bucket_resource',1,'{\"s3_compatible\": true}',1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(158,64,'object_storage',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(161,70,'graph_storage',1,'{\"supports_cypher\": true}',1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(162,70,'graph_database_resource',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(163,57,'reasoning',1,'{\"series\": [\"o1\", \"o3\"]}',1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(164,57,'audio_output',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(165,57,'vision',1,'{\"max_image_size_mb\": 20}',1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(166,57,'function_calling',1,'{\"max_tools\": 128}',1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(167,57,'embeddings',1,'{\"default_dimensions\": 1536}',1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(168,57,'streaming',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(169,57,'chat',1,'{\"default_max_tokens\": 4096}',1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(170,66,'vector_index_resource',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(171,66,'vector_search',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(172,68,'vector_index_resource',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(173,68,'vector_search',1,NULL,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(205,72,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(206,72,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(207,73,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(208,73,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(209,52,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(210,52,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(211,74,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(212,74,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(213,75,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(214,75,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(215,76,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(216,76,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(217,77,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(218,77,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(219,78,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(220,78,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(221,78,'embeddings',1,'{\"default_dimensions\": 1024}',1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(222,79,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(223,79,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(224,80,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(225,80,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(226,81,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(227,81,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(228,82,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(229,82,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(230,83,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(231,83,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(232,84,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(233,84,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(234,85,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(235,85,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(236,87,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(237,87,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(238,88,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(239,88,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(240,89,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(241,89,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(242,90,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(243,90,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(244,91,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(245,91,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(246,91,'embeddings',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(247,92,'image_generation',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(248,92,'speech_to_text',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(249,93,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(250,93,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(251,94,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(252,94,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(253,95,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(254,95,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(255,96,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(256,96,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(257,97,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(258,97,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(259,98,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(260,98,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(261,99,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(262,99,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(263,100,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(264,100,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(265,101,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(266,101,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(267,102,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(268,102,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(269,103,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(270,103,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(271,104,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(272,104,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(273,105,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(274,105,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(275,106,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(276,106,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(277,107,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(278,107,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(279,108,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(280,108,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(281,109,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(282,109,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(283,110,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(284,110,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(285,111,'image_generation',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(286,112,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(287,112,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(288,113,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(289,113,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(290,114,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(291,115,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(292,116,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(293,117,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(294,118,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(295,119,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(296,119,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(297,120,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(298,120,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(299,120,'web_search',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(300,121,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(301,122,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(302,122,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(303,123,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(304,123,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(305,123,'embeddings',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(306,124,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(307,125,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(308,126,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(309,127,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(310,128,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(311,129,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(312,129,'streaming',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(313,130,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(314,132,'embeddings',1,'{\"default_dimensions\": 1024}',1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(315,133,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(316,134,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(317,135,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(318,136,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(319,137,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(320,138,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(321,139,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(322,140,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(323,141,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(324,142,'chat',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(325,143,'embeddings',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(326,144,'web_search',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(327,145,'web_search',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(328,146,'web_search',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(329,147,'web_search',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(330,148,'web_search',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(331,149,'web_search',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(332,150,'web_search',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(333,151,'web_search',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(334,152,'web_search',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(335,153,'web_search',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(336,154,'web_search',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(337,156,'text_to_speech',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(338,157,'text_to_speech',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(339,158,'text_to_speech',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(340,159,'text_to_speech',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(341,160,'text_to_speech',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(342,161,'text_to_speech',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(343,162,'text_to_speech',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(344,163,'text_to_speech',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(345,164,'text_to_speech',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(346,165,'text_to_speech',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(347,131,'text_to_speech',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(348,166,'speech_to_text',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(349,167,'speech_to_text',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(350,168,'speech_to_text',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(351,169,'image_generation',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(352,170,'image_generation',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(353,171,'image_generation',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(354,172,'image_generation',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(355,173,'image_generation',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(356,174,'image_generation',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(357,175,'image_generation',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(358,176,'image_generation',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(359,178,'embeddings',1,NULL,1,'2026-08-14 07:38:39','2026-08-14 07:38:39');
/*!40000 ALTER TABLE `provider_capabilities` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `provider_endpoints`
--

DROP TABLE IF EXISTS `provider_endpoints`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `provider_endpoints` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `provider_id` int(10) unsigned NOT NULL,
  `endpoint_key` varchar(50) NOT NULL,
  `endpoint_name` varchar(100) NOT NULL,
  `endpoint_url` varchar(500) NOT NULL,
  `http_method` enum('GET','POST','PUT','DELETE','PATCH') DEFAULT 'POST',
  `default_timeout_seconds` int(10) unsigned DEFAULT 30,
  `is_default` tinyint(1) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_provider_endpoint` (`provider_id`,`endpoint_key`),
  KEY `idx_provider` (`provider_id`),
  CONSTRAINT `provider_endpoints_ibfk_1` FOREIGN KEY (`provider_id`) REFERENCES `providers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=30 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `provider_endpoints`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `provider_endpoints` WRITE;
/*!40000 ALTER TABLE `provider_endpoints` DISABLE KEYS */;
/*!40000 ALTER TABLE `provider_endpoints` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `provider_model_pricing`
--

DROP TABLE IF EXISTS `provider_model_pricing`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `provider_model_pricing` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `provider_model_id` int(10) unsigned NOT NULL,
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `input_price_per_million` decimal(12,6) DEFAULT NULL,
  `output_price_per_million` decimal(12,6) DEFAULT NULL,
  `cached_input_price_per_million` decimal(12,6) DEFAULT NULL,
  `image_price` decimal(12,6) DEFAULT NULL,
  `audio_input_price_per_million` decimal(12,6) DEFAULT NULL,
  `audio_output_price_per_million` decimal(12,6) DEFAULT NULL,
  `request_price` decimal(12,6) DEFAULT NULL,
  `price_currency` varchar(10) DEFAULT 'USD',
  `billing_unit` varchar(50) DEFAULT 'tokens',
  `tier_name` varchar(50) DEFAULT 'standard',
  `min_units` bigint(20) unsigned DEFAULT NULL,
  `rate_limit_notes` varchar(500) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_model_effective` (`provider_model_id`,`effective_from`,`effective_to`),
  KEY `idx_current` (`provider_model_id`,`effective_to`),
  CONSTRAINT `provider_model_pricing_ibfk_1` FOREIGN KEY (`provider_model_id`) REFERENCES `provider_models` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=48 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `provider_model_pricing`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `provider_model_pricing` WRITE;
/*!40000 ALTER TABLE `provider_model_pricing` DISABLE KEYS */;
/*!40000 ALTER TABLE `provider_model_pricing` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `provider_models`
--

DROP TABLE IF EXISTS `provider_models`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `provider_models` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `provider_id` int(10) unsigned NOT NULL,
  `model_key` varchar(100) NOT NULL,
  `model_name` varchar(200) NOT NULL,
  `model_family` varchar(100) DEFAULT NULL,
  `category` enum('chat','embedding','reranker','image','tts','stt','vision') NOT NULL,
  `supports_streaming` tinyint(1) DEFAULT 0,
  `supports_function_calling` tinyint(1) DEFAULT 0,
  `supports_vision` tinyint(1) DEFAULT 0,
  `max_context_window` int(10) unsigned DEFAULT NULL,
  `max_output_tokens` int(10) unsigned DEFAULT NULL,
  `thinking_mode` enum('auto','on','off') DEFAULT 'auto',
  `is_active` tinyint(1) DEFAULT 1,
  `is_deprecated` tinyint(1) DEFAULT 0,
  `deprecation_date` date DEFAULT NULL,
  `release_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_provider_model` (`provider_id`,`model_key`),
  KEY `idx_category` (`category`),
  KEY `idx_model_key` (`model_key`),
  KEY `idx_active` (`is_active`,`is_deprecated`),
  CONSTRAINT `provider_models_ibfk_1` FOREIGN KEY (`provider_id`) REFERENCES `providers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=211 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `provider_models`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `provider_models` WRITE;
/*!40000 ALTER TABLE `provider_models` DISABLE KEYS */;
INSERT INTO `provider_models` VALUES
(50,52,'meta/llama-3.2-1b-instruct','meta/llama-3.2-1b-instruct','Meta','chat',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-13 11:00:17','2026-08-13 11:00:17'),
(51,52,'z-ai/glm-5.2','z-ai/glm-5.2','Z-AI','chat',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-13 11:01:03','2026-08-13 11:01:03'),
(52,72,'deepseek-chat','DeepSeek V3','deepseek','chat',1,1,0,64000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(53,73,'grok-4','Grok 4','grok','chat',1,1,1,256000,32768,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(55,74,'sonar-pro','Sonar Pro','sonar','chat',1,1,0,200000,4096,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(56,75,'meta-llama/Llama-3.3-70B-Instruct-Turbo','Llama 3.3 70B','llama','chat',1,1,0,131072,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(57,76,'accounts/fireworks/models/llama-v3p3-70b-instruct','Llama 3.3 70B','llama','chat',1,1,0,131072,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(58,77,'llama-3.3-70b','Llama 3.3 70B','llama','chat',1,1,0,131072,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(59,78,'command-r-plus','Command R+','command','chat',1,1,1,128000,4096,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(60,78,'embed-english-v3','Embed English v3','embed','embedding',0,0,0,512,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(61,79,'anthropic/claude-3.5-sonnet','Claude 3.5 Sonnet','claude','chat',1,1,1,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(62,80,'minimax-m2','MiniMax M2','minimax','chat',1,1,0,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(63,81,'glm-4.7','GLM-4.7','glm','chat',1,1,0,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(64,82,'kimi-latest','Kimi','kimi','chat',1,1,0,131072,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(65,83,'meta-llama/Llama-3.3-70B-Instruct','Llama 3.3 70B','llama','chat',1,1,0,131072,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(66,84,'deepseek-ai/DeepSeek-V3','DeepSeek V3','deepseek','chat',1,1,0,64000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(67,85,'meta-llama/Llama-3.3-70B-Instruct','Llama 3.3 70B','llama','chat',1,1,0,131072,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(83,87,'gpt-4o','GPT-4o','gpt','chat',1,1,1,128000,16384,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(84,88,'MiniMax-M2.7','MiniMax M2.7','minimax','chat',1,1,0,196608,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(85,89,'hunyuan-turbos-latest','Hunyuan TurboS Latest','hunyuan','chat',1,1,0,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(86,89,'hunyuan-t1-latest','Hunyuan T1 Latest','hunyuan','chat',1,1,0,256000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(87,90,'deepseek-v4-pro','DeepSeek V4 Pro','deepseek','chat',1,1,0,1048576,32768,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(88,91,'venice-uncensored-1-2','Venice Uncensored 1.2','venice','chat',1,1,1,128000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(89,91,'zai-org-glm-5','GLM-5 (Venice)','glm','chat',1,1,0,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(90,91,'text-embedding-3-large','Text Embedding 3 Large','openai-embed','embedding',0,0,0,8192,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(91,92,'black-forest-labs/FLUX.1-schnell','FLUX.1 Schnell','flux','image',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(92,92,'openai/whisper-large-v3','Whisper Large v3','whisper','stt',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(93,93,'poolside/laguna-s-2.1','Laguna S 2.1','laguna','chat',1,1,0,128000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(94,95,'deepseek-ai/DeepSeek-V4-Pro','DeepSeek V4 Pro','deepseek','chat',1,1,0,128000,32768,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(95,96,'claude-sonnet-4.6','Claude Sonnet 4.6','claude','chat',1,1,1,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(96,97,'glm-5.2','GLM 5.2','glm','chat',1,1,0,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(97,98,'MiniMax-M2.7','MiniMax M2.7','minimax','chat',1,1,0,200704,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(98,98,'MiniMax-M3','MiniMax M3','minimax','chat',1,1,0,1048576,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(99,99,'qwen3.5-plus','Qwen3.5 Plus','qwen','chat',1,1,1,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(100,100,'qwen3.5-plus','Qwen3.5 Plus','qwen','chat',1,1,1,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(101,101,'qwen3.5-plus','Qwen3.5 Plus','qwen','chat',1,1,1,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(102,102,'seed-2-0-pro-260328','Seed 2.0 Pro','seed','chat',1,1,0,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(103,103,'Doubao-Seed-2.0-Code','Doubao-Seed 2.0 Code','doubao','chat',1,1,0,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(104,104,'anthropic/claude-opus-5','Claude Opus 5','claude','chat',1,1,1,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(105,105,'anthropic/claude-3.7-sonnet','Claude 3.7 Sonnet (Free)','claude','chat',1,1,1,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(106,106,'claude-opus-4.7','Claude Opus 4.7','claude','chat',1,1,1,1000000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(107,107,'gpt-4.1','GPT-4.1','gpt','chat',1,1,1,1048576,32768,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(108,108,'kilo-auto/free','Kilo Auto Free','kilo','chat',1,1,0,256000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(109,109,'gpt-5.5','GPT-5.5','gpt','chat',1,1,1,1050000,32768,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(110,110,'morph-v3-large','Morph v3 Large','morph','chat',1,1,0,128000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(111,111,'nanobanana-flash','NanoBanana Flash','nano-banana','image',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(112,112,'mimo-v2.5-pro','MiMo V2.5 Pro','mimo','chat',1,1,0,1050000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(113,113,'mimo-v2.5-pro','MiMo V2.5 Pro','mimo','chat',1,1,0,1050000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(114,114,'mimo-auto','MiMo Auto','mimo','chat',1,0,0,128000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(115,115,'qwen3-coder-plus','Qwen3 Coder Plus','qwen','chat',1,1,0,131072,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(116,116,'ultimate','Ultimate','qwen','chat',1,1,0,128000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(117,118,'deepseek/deepseek-v4-pro','DeepSeek V4 Pro','deepseek','chat',1,1,0,128000,32768,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(118,119,'cline-pass/glm-5.2','GLM-5.2 (ClinePass)','glm','chat',1,1,0,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(119,120,'perplexity/sonar','Perplexity Sonar','sonar','chat',1,1,0,127000,4096,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(120,122,'glm-5.2','GLM 5.2','glm','chat',1,1,0,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(121,123,'anthropic/claude-sonnet-4.6','Claude Sonnet 4.6','claude','chat',1,1,1,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(122,124,'gemini-3.1-pro-preview','Gemini 3.1 Pro Preview','gemini','chat',1,1,1,1048576,65536,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(123,125,'deepseek-ai/deepseek-v3.2-maas','DeepSeek V3.2 (Vertex)','deepseek','chat',1,1,0,128000,32768,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(124,126,'claude-opus-5','Claude Opus 5','claude','chat',1,1,1,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(125,127,'grok-4','Grok 4','grok','chat',1,1,0,131072,32768,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(126,128,'grok-4.5','Grok 4.5','grok','chat',1,1,0,500000,64000,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(127,129,'gpt-oss:120b','GPT OSS 120B','gpt-oss','chat',1,1,0,128000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(128,132,'jina-embeddings-v3','Jina Embeddings v3','jina','embedding',0,0,0,8192,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(129,132,'jina-embeddings-v2-base-en','Jina Embeddings v2 Base EN','jina','embedding',0,0,0,8192,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(130,132,'jina-embeddings-v2-base-code','Jina Embeddings v2 Base Code','jina','embedding',0,0,0,8192,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(131,133,'pplx-auto','Perplexity Auto','sonar','chat',1,1,0,127000,4096,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(132,134,'claude-opus-5','Claude Opus 5','claude','chat',1,1,1,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-17 06:34:16'),
(133,135,'gpt-5.5','GPT-5.5','gpt','chat',1,1,1,400000,32768,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(134,136,'claude-4.5-sonnet','Claude 4.5 Sonnet','claude','chat',1,1,1,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(135,137,'gemini-3.6-flash-high','Gemini 3.6 Flash (High)','gemini','chat',1,1,1,1048576,65536,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(136,138,'gpt-5.4','GPT-5.4','gpt','chat',1,1,1,400000,32768,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(137,139,'minimax-m3','MiniMax-M3','minimax','chat',1,1,0,1048576,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(138,140,'gemini-3.1-pro-preview','Gemini 3.1 Pro Preview','gemini','chat',1,1,1,1048576,65536,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(139,141,'anthropic/claude-opus-4.7','Claude Opus 4.7','claude','chat',1,1,1,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(140,142,'anthropic/claude-sonnet-4-20250514','Claude Sonnet 4','claude','chat',1,1,1,200000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(141,143,'voyage-3-large','Voyage 3 Large','voyage','embedding',0,0,0,32000,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(142,143,'voyage-3.5','Voyage 3.5','voyage','embedding',0,0,0,32000,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(143,143,'voyage-3.5-lite','Voyage 3.5 Lite','voyage','embedding',0,0,0,32000,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(144,156,'eleven_multilingual_v2','Eleven Multilingual v2','eleven','tts',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(145,157,'PlayHT2.0-Turbo','PlayHT 2.0 Turbo','playht','tts',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(146,161,'sonic-2','Sonic 2','sonic','tts',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(147,164,'inworld-tts-1.5-mini','Inworld TTS 1.5 Mini','inworld','tts',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(148,164,'inworld-tts-1.5-max','Inworld TTS 1.5 Max','inworld','tts',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(149,167,'nova-3','Nova 3','nova','stt',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(150,169,'flux-1.1-pro','FLUX 1.1 Pro','flux','image',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(151,170,'stable-image-ultra','Stable Image Ultra','stable-image','image',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(152,171,'recraft-v3','Recraft V3','recraft','image',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(153,172,'gen3a_turbo','Gen-3 Alpha Turbo','gen3','image',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(154,173,'fal-ai/flux/dev','FLUX Dev','flux','image',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(155,175,'flux-dev','FLUX Dev','flux','image',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(156,175,'sdxl','SDXL','sdxl','image',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(157,176,'stable-diffusion-v1-5','Stable Diffusion v1.5','sd','image',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(158,176,'sdxl-base-1.0','SDXL Base 1.0','sdxl','image',0,0,0,NULL,NULL,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(159,177,'mimo-auto','MiMo Auto','mimo','chat',1,0,0,128000,8192,'auto',1,0,NULL,NULL,'2026-08-14 07:38:39','2026-08-14 07:38:39');
/*!40000 ALTER TABLE `provider_models` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `provider_resource_types`
--

DROP TABLE IF EXISTS `provider_resource_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `provider_resource_types` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `provider_id` int(10) unsigned NOT NULL,
  `resource_type` varchar(50) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `description` varchar(500) DEFAULT NULL,
  `icon_name` varchar(50) DEFAULT NULL,
  `display_color` varchar(20) DEFAULT NULL,
  `config_schema` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`config_schema`)),
  `is_required` tinyint(1) DEFAULT 0,
  `is_default_enabled` tinyint(1) DEFAULT 1,
  `max_per_credential` int(10) unsigned DEFAULT NULL,
  `provision_endpoint_key` varchar(50) DEFAULT NULL,
  `provision_method` enum('POST','PUT','GET') DEFAULT 'POST',
  `provision_payload_schema` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`provision_payload_schema`)),
  `health_check_endpoint_key` varchar(50) DEFAULT NULL,
  `health_check_interval_seconds` int(10) unsigned DEFAULT 300,
  `display_order` smallint(5) unsigned DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_provider_resource_type` (`provider_id`,`resource_type`),
  KEY `idx_provider` (`provider_id`,`display_order`),
  CONSTRAINT `provider_resource_types_ibfk_1` FOREIGN KEY (`provider_id`) REFERENCES `providers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `provider_resource_types`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `provider_resource_types` WRITE;
/*!40000 ALTER TABLE `provider_resource_types` DISABLE KEYS */;
INSERT INTO `provider_resource_types` VALUES
(24,62,'vector_index','Vector Index','Serverless vector database for similarity search','cube','#FF6B35','{\"index_name\": {\"type\": \"text\", \"required\": true, \"placeholder\": \"my-embeddings\"}, \"dimensions\": {\"type\": \"numeric\", \"required\": true, \"default\": 1536, \"min\": 1, \"max\": 4096}, \"metric\": {\"type\": \"select\", \"required\": true, \"default\": \"cosine\", \"options\": [\"cosine\", \"euclidean\", \"dot-product\"]}}',0,1,NULL,'vectorize','POST',NULL,NULL,300,10,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(25,62,'object_bucket','R2 Bucket','S3-compatible object storage with free egress','archive-box','#F6821F','{\"bucket_name\": {\"type\": \"text\", \"required\": true, \"pattern\": \"^[a-z0-9][a-z0-9-]{2,62}$\"}, \"location_hint\": {\"type\": \"select\", \"required\": false, \"default\": \"auto\", \"options\": [\"auto\", \"enam\", \"weur\", \"apac\"]}, \"lifecycle_days\": {\"type\": \"numeric\", \"required\": false, \"default\": 90}}',0,1,NULL,'r2','POST',NULL,NULL,300,20,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(26,62,'sql_database','D1 Database','Serverless SQLite-compatible SQL database','database','#F38020','{\"database_name\": {\"type\": \"text\", \"required\": true}, \"region\": {\"type\": \"select\", \"required\": false, \"default\": \"auto\", \"options\": [\"auto\", \"enam\", \"weur\", \"apac\"]}}',0,1,NULL,'d1','POST',NULL,NULL,300,30,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(27,62,'kv_namespace','KV Namespace','Globally distributed low-latency key-value store','key','#FAAD3F','{\"namespace_title\": {\"type\": \"text\", \"required\": true}}',0,1,NULL,'kv','POST',NULL,NULL,300,40,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(28,66,'vector_index','Pinecone Index','Managed vector index',NULL,NULL,'{\"index_name\": {\"type\": \"text\", \"required\": true}, \"dimension\": {\"type\": \"numeric\", \"required\": true, \"default\": 1536}, \"metric\": {\"type\": \"select\", \"required\": true, \"default\": \"cosine\", \"options\": [\"cosine\", \"euclidean\", \"dotproduct\"]}, \"cloud\": {\"type\": \"select\", \"required\": true, \"default\": \"aws\", \"options\": [\"aws\", \"gcp\", \"azure\"]}, \"region\": {\"type\": \"select\", \"required\": true, \"default\": \"us-east-1\", \"options\": [\"us-east-1\", \"us-west-2\", \"eu-west-1\"]}}',0,1,NULL,NULL,'POST',NULL,NULL,300,10,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(29,70,'graph_database','Neo4j Graph Database','Cypher-queryable property graph database',NULL,NULL,'{\"database_name\": {\"type\": \"text\", \"required\": true, \"placeholder\": \"neo4j\"}, \"memory_config\": {\"type\": \"json\", \"required\": false, \"placeholder\": \"{\\\"page_cache_size_mb\\\": 512}\"}}',1,1,NULL,NULL,'POST',NULL,NULL,300,10,1,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(30,57,'none','No Resources',NULL,NULL,NULL,NULL,0,1,NULL,NULL,'POST',NULL,NULL,300,99,1,'2026-08-13 12:10:07','2026-08-13 12:10:07');
/*!40000 ALTER TABLE `provider_resource_types` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `provider_resources`
--

DROP TABLE IF EXISTS `provider_resources`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `provider_resources` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `credential_id` bigint(20) unsigned NOT NULL,
  `company_id` int(10) unsigned NOT NULL,
  `provider_id` int(10) unsigned NOT NULL,
  `environment_id` int(10) unsigned DEFAULT NULL,
  `resource_type` enum('vector_index','object_bucket','sql_database','kv_namespace','graph_database','embedding_index','search_index','cache_namespace') NOT NULL,
  `resource_key` varchar(100) NOT NULL,
  `resource_name` varchar(200) NOT NULL,
  `external_resource_id` varchar(255) DEFAULT NULL,
  `external_resource_url` varchar(500) DEFAULT NULL,
  `external_region` varchar(50) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`config`)),
  `status` enum('provisioning','active','syncing','error','archived') DEFAULT 'provisioning',
  `is_default` tinyint(1) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `last_health_check_at` datetime DEFAULT NULL,
  `last_health_status` enum('healthy','degraded','unhealthy','unknown') DEFAULT 'unknown',
  `health_check_error` text DEFAULT NULL,
  `provisioned_at` datetime DEFAULT NULL,
  `last_synced_at` datetime DEFAULT NULL,
  `created_by` varchar(100) DEFAULT NULL,
  `updated_by` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_resource_key` (`company_id`,`resource_key`),
  UNIQUE KEY `uk_external` (`provider_id`,`external_resource_id`),
  KEY `idx_credential` (`credential_id`),
  KEY `idx_company_type` (`company_id`,`resource_type`,`is_active`),
  KEY `idx_provider` (`provider_id`),
  KEY `idx_status` (`status`,`is_active`),
  KEY `idx_external` (`external_resource_id`),
  KEY `idx_alive` (`deleted_at`),
  KEY `environment_id` (`environment_id`),
  CONSTRAINT `provider_resources_ibfk_1` FOREIGN KEY (`credential_id`) REFERENCES `credentials` (`id`) ON DELETE CASCADE,
  CONSTRAINT `provider_resources_ibfk_2` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `provider_resources_ibfk_3` FOREIGN KEY (`provider_id`) REFERENCES `providers` (`id`),
  CONSTRAINT `provider_resources_ibfk_4` FOREIGN KEY (`environment_id`) REFERENCES `company_environments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `provider_resources`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `provider_resources` WRITE;
/*!40000 ALTER TABLE `provider_resources` DISABLE KEYS */;
INSERT INTO `provider_resources` VALUES
(1,8,2,48,NULL,'vector_index','smoke-mspxf1en','Smoke Vector Index','smoke-index',NULL,NULL,NULL,NULL,'active',0,1,NULL,'unknown',NULL,NULL,NULL,NULL,NULL,'2026-08-12 10:08:18','2026-08-12 10:08:19','2026-08-12 10:08:19');
/*!40000 ALTER TABLE `provider_resources` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `providers`
--

DROP TABLE IF EXISTS `providers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `providers` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `provider_key` varchar(50) NOT NULL,
  `provider_name` varchar(100) NOT NULL,
  `primary_service_category` enum('ai','embedding','vector','storage','graph','image','speech','search','database','email','analytics') NOT NULL,
  `website_url` varchar(500) DEFAULT NULL,
  `documentation_url` varchar(500) DEFAULT NULL,
  `logo_url` varchar(500) DEFAULT NULL,
  `default_api_base_url` varchar(500) DEFAULT NULL,
  `auth_type` enum('api_key','bearer_token','oauth2','basic_auth','custom') DEFAULT 'bearer_token',
  `auth_header_name` varchar(100) DEFAULT 'Authorization',
  `api_key_format_regex` varchar(255) DEFAULT NULL,
  `default_config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`default_config`)),
  `is_active` tinyint(1) DEFAULT 1,
  `round_robin_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `provider_key` (`provider_key`),
  KEY `idx_provider_key` (`provider_key`),
  KEY `idx_primary_service` (`primary_service_category`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB AUTO_INCREMENT=214 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `providers`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `providers` WRITE;
/*!40000 ALTER TABLE `providers` DISABLE KEYS */;
INSERT INTO `providers` VALUES
(48,'cloudflare_worker_ai','Cloudflare Worker AI','ai',NULL,NULL,NULL,'https://api.cloudflare.com/client/v4/accounts','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-12 08:25:21','2026-08-12 08:25:21'),
(52,'nvidia','Nvidia','ai','https://www.nvidia.com/en-in/','https://docs.api.nvidia.com/','https://build.nvidia.com/_next/image?url=%2Fnvidia-logo.png&w=300&q=75','https://integrate.api.nvidia.com/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-13 10:33:18','2026-08-13 10:43:14'),
(57,'openai','OpenAI','ai',NULL,'https://platform.openai.com/signup',NULL,'https://api.openai.com/v1','bearer_token','Authorization','^sk-[A-Za-z0-9]{20,}$',NULL,1,0,'2026-08-13 12:10:07','2026-08-17 06:31:59'),
(58,'anthropic','Anthropic','ai',NULL,'https://console.anthropic.com/signup',NULL,'https://api.anthropic.com','api_key','x-api-key','^sk-ant-[A-Za-z0-9-]{40,}$',NULL,1,0,'2026-08-13 12:10:07','2026-08-17 06:31:59'),
(59,'gemini','Google Gemini','ai',NULL,NULL,NULL,'https://generativelanguage.googleapis.com/v1beta','api_key','key','^AIza[A-Za-z0-9_-]{35}$',NULL,1,0,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(60,'groq','Groq','ai',NULL,NULL,NULL,'https://api.groq.com/openai/v1','bearer_token','Authorization','^gsk_[A-Za-z0-9]{20,}$',NULL,1,0,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(61,'mistral','Mistral AI','ai',NULL,'https://console.mistral.ai',NULL,'https://api.mistral.ai','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-13 12:10:07','2026-08-17 06:31:59'),
(62,'cloudflare','Cloudflare','ai',NULL,NULL,NULL,'https://api.cloudflare.com/client/v4','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(64,'cloudflare_r2','Cloudflare R2','storage',NULL,NULL,NULL,'https://{account}.r2.cloudflarestorage.com','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(65,'cloudflare_d1','Cloudflare D1','database',NULL,NULL,NULL,'https://api.cloudflare.com/client/v4','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(66,'pinecone','Pinecone','vector',NULL,NULL,NULL,'https://api.pinecone.io','api_key','Api-Key',NULL,NULL,1,0,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(67,'weaviate','Weaviate','vector',NULL,NULL,NULL,NULL,'bearer_token','Authorization',NULL,NULL,1,0,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(68,'qdrant','Qdrant','vector',NULL,NULL,NULL,NULL,'api_key','api-key',NULL,NULL,1,0,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(69,'aws_s3','AWS S3','storage',NULL,NULL,NULL,'https://s3.amazonaws.com','custom','Authorization',NULL,NULL,1,0,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(70,'neo4j','Neo4j','graph',NULL,NULL,NULL,'bolt://localhost:7687','basic_auth','Authorization',NULL,NULL,1,0,'2026-08-13 12:10:07','2026-08-13 12:10:07'),
(72,'deepseek','DeepSeek','ai',NULL,'https://platform.deepseek.com',NULL,'https://api.deepseek.com','bearer_token','Authorization','^sk-[A-Za-z0-9]{20,}$',NULL,1,0,'2026-08-14 07:38:39','2026-08-17 06:31:59'),
(73,'xai','xAI','ai',NULL,'https://console.x.ai',NULL,'https://api.x.ai/v1','bearer_token','Authorization','^xai-[A-Za-z0-9]{20,}$',NULL,1,0,'2026-08-14 07:38:39','2026-08-17 06:31:59'),
(74,'perplexity','Perplexity','ai',NULL,NULL,NULL,'https://api.perplexity.ai','bearer_token','Authorization','^pplx-[A-Za-z0-9]{20,}$',NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(75,'together','Together AI','ai',NULL,NULL,NULL,'https://api.together.xyz/v1','bearer_token','Authorization','^[A-Za-z0-9]{32,}$',NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(76,'fireworks','Fireworks AI','ai',NULL,NULL,NULL,'https://api.fireworks.ai/inference/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(77,'cerebras','Cerebras','ai',NULL,NULL,NULL,'https://api.cerebras.ai/v1','bearer_token','Authorization','^cerebras_[A-Za-z0-9]{20,}$',NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(78,'cohere','Cohere','ai',NULL,'https://dashboard.cohere.com',NULL,'https://api.cohere.ai','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-17 06:31:59'),
(79,'openrouter','OpenRouter','ai',NULL,NULL,NULL,'https://openrouter.ai/api/v1','bearer_token','Authorization','^sk-or-v1-[A-Za-z0-9-]{20,}$',NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(80,'minimax','MiniMax','ai',NULL,NULL,NULL,'https://api.minimax.io','api_key','x-api-key',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(81,'glm','Z.ai GLM','ai',NULL,NULL,NULL,'https://api.z.ai/api','api_key','x-api-key',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(82,'kimi','Kimi (Moonshot)','ai',NULL,NULL,NULL,'https://api.kimi.com/coding','api_key','x-api-key','^sk-[A-Za-z0-9]{20,}$',NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(83,'nebius','Nebius AI','ai',NULL,NULL,NULL,'https://api.studio.nebius.ai/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(84,'siliconflow','SiliconFlow','ai',NULL,NULL,NULL,'https://api.siliconflow.com/v1','bearer_token','Authorization','^sk-[A-Za-z0-9]{20,}$',NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(85,'hyperbolic','Hyperbolic','ai',NULL,NULL,NULL,'https://api.hyperbolic.xyz/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(87,'azure','Azure OpenAI','ai',NULL,NULL,NULL,'https://{resource}.openai.azure.com/openai','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(88,'sambanova','SambaNova','ai',NULL,NULL,NULL,'https://api.sambanova.ai/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(89,'tencent','Tencent Hunyuan','ai',NULL,NULL,NULL,'https://api.hunyuan.cloud.tencent.com/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(90,'baidu','Baidu Qianfan','ai',NULL,NULL,NULL,'https://qianfan.baidubce.com/v2','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(91,'venice','Venice AI','ai',NULL,NULL,NULL,'https://api.venice.ai/api/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(92,'huggingface','Hugging Face','ai',NULL,NULL,NULL,'https://api-inference.huggingface.co','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(93,'poolside','Poolside','ai',NULL,NULL,NULL,'https://inference.poolside.ai/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(94,'chutes','Chutes AI','ai',NULL,NULL,NULL,'https://llm.chutes.ai/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(95,'featherless','Featherless','ai',NULL,NULL,NULL,'https://api.featherless.ai/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(96,'blackbox','Blackbox AI','ai',NULL,NULL,NULL,'https://api.blackbox.ai/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(97,'glm-cn','GLM (China)','ai',NULL,NULL,NULL,'https://open.bigmodel.cn/api/coding/paas/v4','api_key','x-api-key',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(98,'minimax-cn','MiniMax (China)','ai',NULL,NULL,NULL,'https://api.minimaxi.com/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(99,'alims-intl','Alibaba Studio','ai',NULL,NULL,NULL,'https://dashscope-intl.aliyuncs.com/compatible-mode/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(100,'alicode','Alibaba Coding','ai',NULL,NULL,NULL,'https://coding.dashscope.aliyuncs.com/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(101,'alicode-intl','Alibaba Coding Intl','ai',NULL,NULL,NULL,'https://coding-intl.dashscope.aliyuncs.com/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(102,'byteplus','BytePlus ModelArk','ai',NULL,NULL,NULL,'https://ark.ap-southeast.bytepluses.com/api/coding/v3','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(103,'volcengine-ark','Volcengine Ark','ai',NULL,NULL,NULL,'https://ark.cn-beijing.volces.com/api/coding/v3','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(104,'tokenrouter','TokenRouter','ai',NULL,NULL,NULL,'https://api.tokenrouter.com/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(105,'api-airforce','API.airforce','ai',NULL,NULL,NULL,'https://api.airforce/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(106,'bazaarlink','Bazaarlink','ai',NULL,NULL,NULL,'https://bazaarlink.ai/api/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(107,'bluesminds','BluesMinds','ai',NULL,NULL,NULL,'https://api.bluesminds.com/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(108,'kilo-gateway','Kilo Gateway','ai',NULL,NULL,NULL,'https://api.kilo.ai/api/gateway','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(109,'llm7','LLM7','ai',NULL,NULL,NULL,'https://api.llm7.io/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(110,'morph','Morph','ai',NULL,NULL,NULL,'https://api.morphllm.com/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(111,'nanobanana','NanoBanana','ai',NULL,NULL,NULL,'https://api.nanobananaapi.ai/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(112,'xiaomi-mimo','Xiaomi MiMo','ai',NULL,NULL,NULL,'https://api.xiaomimimo.com/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(113,'xiaomi-tokenplan','Xiaomi MiMo Token Plan','ai',NULL,NULL,NULL,'https://token-plan-sgp.xiaomimimo.com/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(114,'mimo-free','MiMo Code Free','ai',NULL,NULL,NULL,'https://api.xiaomimimo.com/api/free-ai/openai','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(115,'iflow','iFlow AI','ai',NULL,NULL,NULL,'https://apis.iflow.cn/v1','oauth2','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(116,'qoder','Qoder','ai',NULL,NULL,NULL,'https://api3.qoder.sh/algo/api/v2/service/pro/sse','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(117,'zed','Zed','ai',NULL,'https://zed.dev',NULL,'https://cloud.zed.dev','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-17 06:31:59'),
(118,'commandcode','Command Code','ai',NULL,NULL,NULL,'https://api.commandcode.ai/alpha','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(119,'clinepass','ClinePass','ai',NULL,NULL,NULL,'https://api.cline.bot/api/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(120,'perplexity-agent','Perplexity Agent','ai',NULL,NULL,NULL,'https://api.perplexity.ai/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(121,'opencode','OpenCode Free','ai',NULL,NULL,NULL,'https://opencode.ai','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(122,'opencode-go','OpenCode Go','ai',NULL,NULL,NULL,'https://opencode.ai/zen/go/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(123,'vercel-ai-gateway','Vercel AI Gateway','ai',NULL,NULL,NULL,'https://ai-gateway.vercel.sh/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(124,'vertex','Vertex AI','ai',NULL,NULL,NULL,'https://aiplatform.googleapis.com','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(125,'vertex-partner','Vertex Partner','ai',NULL,NULL,NULL,'https://aiplatform.googleapis.com','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(126,'kiro','Kiro AI','ai',NULL,'https://kiro.dev',NULL,'https://runtime.us-east-1.kiro.dev','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-17 06:31:59'),
(127,'grok-web','Grok Web','ai',NULL,'https://grok.com',NULL,'https://grok.com','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-17 06:31:59'),
(128,'grok-cli','Grok CLI','ai',NULL,'https://grok.com',NULL,'https://cli-chat-proxy.grok.com','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-17 06:31:59'),
(129,'ollama','Ollama Cloud','ai',NULL,NULL,NULL,'https://ollama.com','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(130,'ollama-local','Ollama Local','ai',NULL,NULL,NULL,'http://localhost:11434','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(131,'local-device','Local Device','ai',NULL,NULL,NULL,NULL,'custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(132,'jina-ai','Jina AI','ai',NULL,NULL,NULL,'https://api.jina.ai/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(133,'perplexity-web','Perplexity Web','ai',NULL,NULL,NULL,'https://www.perplexity.ai','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(134,'claude','Claude Code','ai',NULL,'https://claude.com/download',NULL,'https://api.anthropic.com','oauth2','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-17 06:33:58'),
(135,'codex','OpenAI Codex','ai',NULL,'https://chatgpt.com/codex',NULL,'https://chatgpt.com/backend-api/codex','oauth2','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-17 06:31:59'),
(136,'cursor','Cursor IDE','ai',NULL,'https://cursor.com',NULL,'https://api2.cursor.sh','oauth2','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-17 06:31:59'),
(137,'antigravity','Antigravity','ai',NULL,'https://cloud.google.com/products/antigravity',NULL,'https://cloudcode-pa.googleapis.com','oauth2','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-17 06:31:59'),
(138,'github','GitHub Copilot','ai',NULL,'https://github.com/features/copilot',NULL,'https://api.githubcopilot.com','oauth2','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-17 06:31:59'),
(139,'kimchi','Kimchi','ai',NULL,NULL,NULL,'https://llm.kimchi.dev/openai/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(140,'gemini-cli','Gemini CLI','ai',NULL,'https://cloud.google.com/ai/gemini-cli',NULL,'https://cloudcode-pa.googleapis.com/v1internal','oauth2','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-17 06:31:59'),
(141,'cline','Cline','ai',NULL,NULL,NULL,'https://api.cline.bot/api/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(142,'kilocode','Kilo Code','ai',NULL,NULL,NULL,'https://api.kilo.ai/api/openrouter','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(143,'voyage-ai','Voyage AI','ai',NULL,NULL,NULL,'https://api.voyageai.com/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(144,'brave-search','Brave Search','ai',NULL,NULL,NULL,'https://api.search.brave.com','custom','X-Subscription-Token',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(145,'tavily','Tavily','ai',NULL,NULL,NULL,'https://api.tavily.com','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(146,'serper','Serper','ai',NULL,NULL,NULL,'https://google.serper.dev','custom','X-API-KEY',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(147,'searxng','SearXNG','ai',NULL,NULL,NULL,'http://localhost:8080','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(148,'exa','Exa','ai',NULL,NULL,NULL,'https://api.exa.ai','custom','x-api-key',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(149,'linkup','Linkup','ai',NULL,NULL,NULL,'https://api.linkup.so','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(150,'searchapi','SearchAPI','ai',NULL,NULL,NULL,'https://www.searchapi.io','custom','api_key',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(151,'youcom','You.com Search','ai',NULL,NULL,NULL,'https://ydc-index.io','custom','X-API-Key',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(152,'google-pse','Google PSE','ai',NULL,NULL,NULL,'https://www.googleapis.com/customsearch/v1','custom','key',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(153,'firecrawl','Firecrawl','ai',NULL,NULL,NULL,'https://api.firecrawl.dev','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(154,'jina-reader','Jina Reader','ai',NULL,NULL,NULL,'https://r.jina.ai','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(155,'gitlab','GitLab','ai',NULL,NULL,NULL,'https://gitlab.com','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(156,'elevenlabs','ElevenLabs','ai',NULL,NULL,NULL,'https://api.elevenlabs.io','custom','xi-api-key',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(157,'playht','PlayHT','ai',NULL,NULL,NULL,'https://api.play.ai','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(158,'edge-tts','Edge TTS','ai',NULL,NULL,NULL,NULL,'custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(159,'google-tts','Google TTS','ai',NULL,NULL,NULL,NULL,'custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(160,'aws-polly','AWS Polly','ai',NULL,NULL,NULL,'https://polly.us-east-1.amazonaws.com','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(161,'cartesia','Cartesia','ai',NULL,NULL,NULL,'https://api.cartesia.ai','custom','X-API-Key',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(162,'coqui','Coqui TTS','ai',NULL,NULL,NULL,'http://localhost:5002','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(163,'tortoise','Tortoise TTS','ai',NULL,NULL,NULL,'http://localhost:8080','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(164,'inworld','Inworld TTS','ai',NULL,NULL,NULL,'https://api.inworld.ai/tts/v1','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(165,'selfhosted-tts','Self-hosted TTS','ai',NULL,NULL,NULL,'http://localhost:8080','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(166,'assemblyai','AssemblyAI','ai',NULL,NULL,NULL,'https://api.assemblyai.com','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(167,'deepgram','Deepgram','ai',NULL,NULL,NULL,'https://api.deepgram.com','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(168,'selfhosted-stt','Self-hosted STT','ai',NULL,NULL,NULL,'http://localhost:8080','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(169,'black-forest-labs','Black Forest Labs','ai',NULL,NULL,NULL,'https://api.bfl.ml','custom','X-Key',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(170,'stability-ai','Stability AI','ai',NULL,NULL,NULL,'https://api.stability.ai','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(171,'recraft','Recraft','ai',NULL,NULL,NULL,'https://external.api.recraft.ai','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(172,'runwayml','Runway','ai',NULL,NULL,NULL,'https://api.dev.runwayml.com/v1','bearer_token','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(173,'fal-ai','fal.ai','ai',NULL,NULL,NULL,'https://queue.fal.run','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(174,'topaz','Topaz','ai',NULL,NULL,NULL,'https://api.topazlabs.com','custom','X-Api-Key',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(175,'comfyui','ComfyUI','ai',NULL,NULL,NULL,'http://localhost:8188','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(176,'sdwebui','SD WebUI','ai',NULL,NULL,NULL,'http://localhost:7860','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(177,'mmf','MMF','ai',NULL,NULL,NULL,'https://api.xiaomimimo.com/api/free-ai/openai','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39'),
(178,'selfhosted-embedding','Self-hosted Embedding','ai',NULL,NULL,NULL,'http://localhost:8080/v1','custom','Authorization',NULL,NULL,1,0,'2026-08-14 07:38:39','2026-08-14 07:38:39');
/*!40000 ALTER TABLE `providers` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `schema_migrations`
--

DROP TABLE IF EXISTS `schema_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `schema_migrations` (
  `version` varchar(255) NOT NULL,
  `applied_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `checksum` varchar(64) NOT NULL,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `schema_migrations`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `schema_migrations` WRITE;
/*!40000 ALTER TABLE `schema_migrations` DISABLE KEYS */;
INSERT INTO `schema_migrations` VALUES
('001_init.sql','2026-08-06 06:33:04','a1cc423d30c3314f98050a1834247d7b1c9433ca409914a925b3dbc59b1f2005'),
('002_company_config.sql','2026-08-06 07:36:15','655c0e7f211b3e8dd2950a4cec3d061d8ff0ff8af3008cad248905f887395bb5'),
('003_platform_seed.sql','2026-08-06 12:28:14','40116f73a988c6e8c5adf5fd2e3644e8811d637e811e64f32ab6042458398acd'),
('004_seed_catalog.sql','2026-08-07 04:52:29','13794a5cc20ca6b77042604a3c4c1a0679d5fea9636875f9c79cd6e5d472c767'),
('005_credentials_view_left_join.sql','2026-08-11 05:45:00','48b7542cab72ad9b27c121f1101855a82a27873fda3d261ea42d6d7405ea1997'),
('006_seed_catalog_children.sql','2026-08-12 06:42:10','8b60d83768d6fbebe7eb370621869d85a73d4b899f09f9c738e22ea49dc1af40'),
('007_seed_existing_provider_auth.sql','2026-08-13 11:15:42','1c49809b2eecce09050dd208ceee1d4e1357465de8bdd33a81e1bff88b715642'),
('008_reseed_catalog.sql','2026-08-13 12:10:07','ca8505220f1363b96f59a700c400b5cf9e1f87e91878bc2940431bef1fb3d756'),
('009_seed_ai_provider_catalog.sql','2026-08-14 07:38:39','0403d49621583c026836fa67cce972fe70b53da01c8968a6161fe02d13b4e6f8'),
('010_seed_9router_catalog.sql','2026-08-14 07:38:39','952befaae077925912410d78a08adfbd79ba59b6d9f9b60b8f1f9603540e1306'),
('011_provider_round_robin_thinking.sql','2026-08-17 06:30:22','8c35c382ecc169881d98c0b569bebcdf60c6c84a6245b3c0aac3af4a3b70ff0e'),
('012_seed_provider_docs_urls.sql','2026-08-17 06:31:59','c5075f572c48f6ea9bc037214c06fd7cdcef926dbf860df4e5b599e4739cfab4');
/*!40000 ALTER TABLE `schema_migrations` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Temporary table structure for view `v_company_resources`
--

DROP TABLE IF EXISTS `v_company_resources`;
/*!50001 DROP VIEW IF EXISTS `v_company_resources`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_company_resources` AS SELECT
 NULL AS `resource_id`,
 NULL AS `resource_type`,
 NULL AS `resource_key`,
 NULL AS `resource_name`,
 NULL AS `external_resource_id`,
 NULL AS `external_resource_url`,
 NULL AS `external_region`,
 NULL AS `status`,
 NULL AS `is_default`,
 NULL AS `is_active`,
 NULL AS `last_health_status`,
 NULL AS `config`,
 NULL AS `company_id`,
 NULL AS `company_key`,
 NULL AS `provider_id`,
 NULL AS `provider_key`,
 NULL AS `provider_name`,
 NULL AS `primary_service_category`,
 NULL AS `credential_id`,
 NULL AS `credential_key`,
 NULL AS `env_key`,
 NULL AS `env_name` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_company_usage_summary`
--

DROP TABLE IF EXISTS `v_company_usage_summary`;
/*!50001 DROP VIEW IF EXISTS `v_company_usage_summary`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_company_usage_summary` AS SELECT
 NULL AS `company_id`,
 NULL AS `company_key`,
 NULL AS `company_name`,
 NULL AS `usage_date`,
 NULL AS `model_used`,
 NULL AS `provider_key`,
 NULL AS `request_count`,
 NULL AS `total_input_units`,
 NULL AS `total_output_units`,
 NULL AS `total_cost_usd`,
 NULL AS `avg_duration_ms` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_credential_models`
--

DROP TABLE IF EXISTS `v_credential_models`;
/*!50001 DROP VIEW IF EXISTS `v_credential_models`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_credential_models` AS SELECT
 NULL AS `credential_id`,
 NULL AS `provider_model_id`,
 NULL AS `model_key`,
 NULL AS `model_name`,
 NULL AS `category`,
 NULL AS `provider_key`,
 NULL AS `company_id`,
 NULL AS `is_enabled`,
 NULL AS `is_default_for_category`,
 NULL AS `rate_limit_per_min`,
 NULL AS `monthly_quota_tokens`,
 NULL AS `monthly_quota_used_tokens`,
 NULL AS `input_price_per_million`,
 NULL AS `output_price_per_million` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_credentials_full`
--

DROP TABLE IF EXISTS `v_credentials_full`;
/*!50001 DROP VIEW IF EXISTS `v_credentials_full`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_credentials_full` AS SELECT
 NULL AS `credential_id`,
 NULL AS `credential_key`,
 NULL AS `credential_name`,
 NULL AS `credential_type`,
 NULL AS `priority`,
 NULL AS `is_active`,
 NULL AS `is_default`,
 NULL AS `last_verified_at`,
 NULL AS `last_verification_status`,
 NULL AS `expires_at`,
 NULL AS `company_id`,
 NULL AS `company_key`,
 NULL AS `company_name`,
 NULL AS `provider_id`,
 NULL AS `provider_key`,
 NULL AS `provider_name`,
 NULL AS `primary_service_category`,
 NULL AS `env_key`,
 NULL AS `env_name`,
 NULL AS `is_production`,
 NULL AS `effective_endpoint_url` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_model_pricing_current`
--

DROP TABLE IF EXISTS `v_model_pricing_current`;
/*!50001 DROP VIEW IF EXISTS `v_model_pricing_current`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_model_pricing_current` AS SELECT
 NULL AS `provider_id`,
 NULL AS `provider_key`,
 NULL AS `model_key`,
 NULL AS `model_name`,
 NULL AS `category`,
 NULL AS `input_price_per_million`,
 NULL AS `output_price_per_million`,
 NULL AS `cached_input_price_per_million`,
 NULL AS `image_price`,
 NULL AS `billing_unit`,
 NULL AS `price_currency`,
 NULL AS `tier_name`,
 NULL AS `effective_from`,
 NULL AS `effective_to` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_provider_auth_form`
--

DROP TABLE IF EXISTS `v_provider_auth_form`;
/*!50001 DROP VIEW IF EXISTS `v_provider_auth_form`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_provider_auth_form` AS SELECT
 NULL AS `provider_id`,
 NULL AS `provider_key`,
 NULL AS `field_name`,
 NULL AS `field_label`,
 NULL AS `field_type`,
 NULL AS `field_placeholder`,
 NULL AS `field_help_text`,
 NULL AS `field_default_value`,
 NULL AS `is_required`,
 NULL AS `validation_regex`,
 NULL AS `validation_min_length`,
 NULL AS `validation_max_length`,
 NULL AS `is_encrypted`,
 NULL AS `encryption_storage_path`,
 NULL AS `display_order`,
 NULL AS `field_group`,
 NULL AS `field_width`,
 NULL AS `select_options`,
 NULL AS `show_when` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_provider_capabilities`
--

DROP TABLE IF EXISTS `v_provider_capabilities`;
/*!50001 DROP VIEW IF EXISTS `v_provider_capabilities`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_provider_capabilities` AS SELECT
 NULL AS `provider_id`,
 NULL AS `provider_key`,
 NULL AS `capability_key`,
 NULL AS `is_supported`,
 NULL AS `config` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_provider_resource_templates`
--

DROP TABLE IF EXISTS `v_provider_resource_templates`;
/*!50001 DROP VIEW IF EXISTS `v_provider_resource_templates`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_provider_resource_templates` AS SELECT
 NULL AS `provider_id`,
 NULL AS `provider_key`,
 NULL AS `resource_type`,
 NULL AS `display_name`,
 NULL AS `description`,
 NULL AS `icon_name`,
 NULL AS `display_color`,
 NULL AS `config_schema`,
 NULL AS `is_required`,
 NULL AS `is_default_enabled`,
 NULL AS `max_per_credential`,
 NULL AS `provision_endpoint_key`,
 NULL AS `provision_method`,
 NULL AS `provision_payload_schema`,
 NULL AS `health_check_endpoint_key`,
 NULL AS `health_check_interval_seconds`,
 NULL AS `display_order` */;
SET character_set_client = @saved_cs_client;

--
-- Dumping routines for database 'u555265406_nodejs'
--
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 DROP PROCEDURE IF EXISTS `GetCompanyCredential` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
DELIMITER ;;
CREATE DEFINER=`u555265406_admin`@`%` PROCEDURE `GetCompanyCredential`(
    IN p_company_key VARCHAR(100),
    IN p_provider_key VARCHAR(50),
    IN p_env_key VARCHAR(50),
    OUT p_credential_id BIGINT UNSIGNED,
    OUT p_encrypted_credentials TEXT,
    OUT p_config JSON,
    OUT p_endpoint_url VARCHAR(500)
)
BEGIN
    SELECT 
        c.id, c.encrypted_credentials, c.config,
        COALESCE(c.endpoint_override_url, p.default_api_base_url)
    INTO p_credential_id, p_encrypted_credentials, p_config, p_endpoint_url
    FROM credentials c
    JOIN companies co ON c.company_id = co.id AND co.deleted_at IS NULL
    JOIN providers p ON c.provider_id = p.id AND p.is_active = TRUE
    LEFT JOIN company_environments ce ON c.environment_id = ce.id AND ce.deleted_at IS NULL
    WHERE co.company_key = p_company_key
      AND p.provider_key = p_provider_key
      AND (p_env_key IS NULL OR ce.env_key = p_env_key)
      AND c.is_active = TRUE AND c.deleted_at IS NULL
    ORDER BY c.is_default DESC, c.priority ASC, c.last_verified_at DESC, c.created_at DESC
    LIMIT 1;
END
;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 DROP PROCEDURE IF EXISTS `IsModelAllowedForCredential` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
DELIMITER ;;
CREATE DEFINER=`u555265406_admin`@`%` PROCEDURE `IsModelAllowedForCredential`(
    IN p_credential_id BIGINT UNSIGNED,
    IN p_model_key VARCHAR(100),
    OUT p_is_allowed TINYINT,
    OUT p_provider_model_id INT UNSIGNED,
    OUT p_input_price DECIMAL(12,6),
    OUT p_output_price DECIMAL(12,6),
    OUT p_monthly_quota_remaining BIGINT UNSIGNED
)
BEGIN
    SELECT 1, pm.id, pmp.input_price_per_million, pmp.output_price_per_million,
           CASE WHEN cma.monthly_quota_tokens IS NULL THEN NULL
                ELSE cma.monthly_quota_tokens - cma.monthly_quota_used_tokens END
    INTO p_is_allowed, p_provider_model_id, p_input_price, p_output_price, p_monthly_quota_remaining
    FROM credential_model_access cma
    JOIN provider_models pm ON cma.provider_model_id = pm.id
    JOIN providers p ON pm.provider_id = p.id
    LEFT JOIN provider_model_pricing pmp ON pmp.provider_model_id = pm.id AND pmp.effective_to IS NULL
    WHERE cma.credential_id = p_credential_id
      AND pm.model_key = p_model_key
      AND cma.is_enabled = TRUE AND cma.deleted_at IS NULL
      AND pm.is_active = TRUE;
END
;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 DROP PROCEDURE IF EXISTS `ResolveDispatch` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
DELIMITER ;;
CREATE DEFINER=`u555265406_admin`@`%` PROCEDURE `ResolveDispatch`(
    IN p_company_key VARCHAR(100),
    IN p_provider_key VARCHAR(50),
    IN p_model_key VARCHAR(100),
    IN p_env_key VARCHAR(50),
    OUT p_credential_id BIGINT UNSIGNED,
    OUT p_endpoint_url VARCHAR(500),
    OUT p_input_price DECIMAL(12,6),
    OUT p_output_price DECIMAL(12,6),
    OUT p_remaining_tokens BIGINT UNSIGNED
)
BEGIN
    CALL GetCompanyCredential(p_company_key, p_provider_key, p_env_key,
        p_credential_id, @creds_dummy, @cfg_dummy, p_endpoint_url);
    CALL IsModelAllowedForCredential(p_credential_id, p_model_key,
        @allowed, @pmid_dummy, p_input_price, p_output_price, p_remaining_tokens);
END
;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Current Database: `u555265406_nodejs`
--

USE `u555265406_nodejs`;

--
-- Final view structure for view `v_company_resources`
--

/*!50001 DROP VIEW IF EXISTS `v_company_resources`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`u555265406_admin`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_company_resources` AS select `pr`.`id` AS `resource_id`,`pr`.`resource_type` AS `resource_type`,`pr`.`resource_key` AS `resource_key`,`pr`.`resource_name` AS `resource_name`,`pr`.`external_resource_id` AS `external_resource_id`,`pr`.`external_resource_url` AS `external_resource_url`,`pr`.`external_region` AS `external_region`,`pr`.`status` AS `status`,`pr`.`is_default` AS `is_default`,`pr`.`is_active` AS `is_active`,`pr`.`last_health_status` AS `last_health_status`,`pr`.`config` AS `config`,`co`.`id` AS `company_id`,`co`.`company_key` AS `company_key`,`p`.`id` AS `provider_id`,`p`.`provider_key` AS `provider_key`,`p`.`provider_name` AS `provider_name`,`p`.`primary_service_category` AS `primary_service_category`,`c`.`id` AS `credential_id`,`c`.`credential_key` AS `credential_key`,`ce`.`env_key` AS `env_key`,`ce`.`env_name` AS `env_name` from ((((`provider_resources` `pr` join `companies` `co` on(`pr`.`company_id` = `co`.`id` and `co`.`deleted_at` is null)) join `providers` `p` on(`pr`.`provider_id` = `p`.`id` and `p`.`is_active` = 1)) join `credentials` `c` on(`pr`.`credential_id` = `c`.`id` and `c`.`is_active` = 1 and `c`.`deleted_at` is null)) left join `company_environments` `ce` on(`pr`.`environment_id` = `ce`.`id` and `ce`.`deleted_at` is null)) where `pr`.`is_active` = 1 and `pr`.`deleted_at` is null */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_company_usage_summary`
--

/*!50001 DROP VIEW IF EXISTS `v_company_usage_summary`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`u555265406_admin`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_company_usage_summary` AS select `co`.`id` AS `company_id`,`co`.`company_key` AS `company_key`,`co`.`company_name` AS `company_name`,cast(`l`.`created_at` as date) AS `usage_date`,`l`.`model_used` AS `model_used`,`p`.`provider_key` AS `provider_key`,count(0) AS `request_count`,sum(`l`.`input_units`) AS `total_input_units`,sum(`l`.`output_units`) AS `total_output_units`,sum(`l`.`cost_usd`) AS `total_cost_usd`,avg(`l`.`duration_ms`) AS `avg_duration_ms` from (((`credential_usage_logs` `l` join `companies` `co` on(`l`.`company_id` = `co`.`id` and `co`.`deleted_at` is null)) left join `credentials` `c` on(`l`.`credential_id` = `c`.`id`)) left join `providers` `p` on(`c`.`provider_id` = `p`.`id`)) where `l`.`response_status` between 200 and 299 group by `co`.`id`,`co`.`company_key`,`co`.`company_name`,cast(`l`.`created_at` as date),`l`.`model_used`,`p`.`provider_key` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_credential_models`
--

/*!50001 DROP VIEW IF EXISTS `v_credential_models`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`u555265406_admin`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_credential_models` AS select `cma`.`credential_id` AS `credential_id`,`cma`.`provider_model_id` AS `provider_model_id`,`pm`.`model_key` AS `model_key`,`pm`.`model_name` AS `model_name`,`pm`.`category` AS `category`,`p`.`provider_key` AS `provider_key`,`cma`.`company_id` AS `company_id`,`cma`.`is_enabled` AS `is_enabled`,`cma`.`is_default_for_category` AS `is_default_for_category`,`cma`.`rate_limit_per_min` AS `rate_limit_per_min`,`cma`.`monthly_quota_tokens` AS `monthly_quota_tokens`,`cma`.`monthly_quota_used_tokens` AS `monthly_quota_used_tokens`,`pmp`.`input_price_per_million` AS `input_price_per_million`,`pmp`.`output_price_per_million` AS `output_price_per_million` from (((`credential_model_access` `cma` join `provider_models` `pm` on(`cma`.`provider_model_id` = `pm`.`id`)) join `providers` `p` on(`pm`.`provider_id` = `p`.`id`)) left join `provider_model_pricing` `pmp` on(`pmp`.`provider_model_id` = `pm`.`id` and `pmp`.`effective_to` is null)) where `cma`.`is_enabled` = 1 and `cma`.`deleted_at` is null and `pm`.`is_active` = 1 */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_credentials_full`
--

/*!50001 DROP VIEW IF EXISTS `v_credentials_full`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`u555265406_admin`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_credentials_full` AS select `c`.`id` AS `credential_id`,`c`.`credential_key` AS `credential_key`,`c`.`credential_name` AS `credential_name`,`c`.`credential_type` AS `credential_type`,`c`.`priority` AS `priority`,`c`.`is_active` AS `is_active`,`c`.`is_default` AS `is_default`,`c`.`last_verified_at` AS `last_verified_at`,`c`.`last_verification_status` AS `last_verification_status`,`c`.`expires_at` AS `expires_at`,`co`.`id` AS `company_id`,`co`.`company_key` AS `company_key`,`co`.`company_name` AS `company_name`,`p`.`id` AS `provider_id`,`p`.`provider_key` AS `provider_key`,`p`.`provider_name` AS `provider_name`,`p`.`primary_service_category` AS `primary_service_category`,`ce`.`env_key` AS `env_key`,`ce`.`env_name` AS `env_name`,`ce`.`is_production` AS `is_production`,coalesce(`c`.`endpoint_override_url`,`p`.`default_api_base_url`) AS `effective_endpoint_url` from (((`credentials` `c` join `companies` `co` on(`c`.`company_id` = `co`.`id` and `co`.`deleted_at` is null)) join `providers` `p` on(`c`.`provider_id` = `p`.`id` and `p`.`is_active` = 1)) left join `company_environments` `ce` on(`c`.`environment_id` = `ce`.`id` and `ce`.`deleted_at` is null)) where `c`.`is_active` = 1 and `c`.`deleted_at` is null */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_model_pricing_current`
--

/*!50001 DROP VIEW IF EXISTS `v_model_pricing_current`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`u555265406_admin`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_model_pricing_current` AS select `pm`.`provider_id` AS `provider_id`,`p`.`provider_key` AS `provider_key`,`pm`.`model_key` AS `model_key`,`pm`.`model_name` AS `model_name`,`pm`.`category` AS `category`,`pmp`.`input_price_per_million` AS `input_price_per_million`,`pmp`.`output_price_per_million` AS `output_price_per_million`,`pmp`.`cached_input_price_per_million` AS `cached_input_price_per_million`,`pmp`.`image_price` AS `image_price`,`pmp`.`billing_unit` AS `billing_unit`,`pmp`.`price_currency` AS `price_currency`,`pmp`.`tier_name` AS `tier_name`,`pmp`.`effective_from` AS `effective_from`,`pmp`.`effective_to` AS `effective_to` from ((`provider_models` `pm` join `providers` `p` on(`pm`.`provider_id` = `p`.`id`)) left join `provider_model_pricing` `pmp` on(`pmp`.`provider_model_id` = `pm`.`id` and `pmp`.`effective_to` is null)) where `pm`.`is_active` = 1 and `pm`.`is_deprecated` = 0 */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_provider_auth_form`
--

/*!50001 DROP VIEW IF EXISTS `v_provider_auth_form`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`u555265406_admin`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_provider_auth_form` AS select `pas`.`provider_id` AS `provider_id`,`p`.`provider_key` AS `provider_key`,`pas`.`field_name` AS `field_name`,`pas`.`field_label` AS `field_label`,`pas`.`field_type` AS `field_type`,`pas`.`field_placeholder` AS `field_placeholder`,`pas`.`field_help_text` AS `field_help_text`,`pas`.`field_default_value` AS `field_default_value`,`pas`.`is_required` AS `is_required`,`pas`.`validation_regex` AS `validation_regex`,`pas`.`validation_min_length` AS `validation_min_length`,`pas`.`validation_max_length` AS `validation_max_length`,`pas`.`is_encrypted` AS `is_encrypted`,`pas`.`encryption_storage_path` AS `encryption_storage_path`,`pas`.`display_order` AS `display_order`,`pas`.`field_group` AS `field_group`,`pas`.`field_width` AS `field_width`,`pas`.`select_options` AS `select_options`,`pas`.`show_when` AS `show_when` from (`provider_auth_schemas` `pas` join `providers` `p` on(`pas`.`provider_id` = `p`.`id`)) where `pas`.`is_active` = 1 and `p`.`is_active` = 1 */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_provider_capabilities`
--

/*!50001 DROP VIEW IF EXISTS `v_provider_capabilities`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`u555265406_admin`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_provider_capabilities` AS select `pc`.`provider_id` AS `provider_id`,`p`.`provider_key` AS `provider_key`,`pc`.`capability_key` AS `capability_key`,`pc`.`is_supported` AS `is_supported`,`pc`.`config` AS `config` from (`provider_capabilities` `pc` join `providers` `p` on(`pc`.`provider_id` = `p`.`id`)) where `pc`.`is_active` = 1 and `p`.`is_active` = 1 */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_provider_resource_templates`
--

/*!50001 DROP VIEW IF EXISTS `v_provider_resource_templates`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`u555265406_admin`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_provider_resource_templates` AS select `prt`.`provider_id` AS `provider_id`,`p`.`provider_key` AS `provider_key`,`prt`.`resource_type` AS `resource_type`,`prt`.`display_name` AS `display_name`,`prt`.`description` AS `description`,`prt`.`icon_name` AS `icon_name`,`prt`.`display_color` AS `display_color`,`prt`.`config_schema` AS `config_schema`,`prt`.`is_required` AS `is_required`,`prt`.`is_default_enabled` AS `is_default_enabled`,`prt`.`max_per_credential` AS `max_per_credential`,`prt`.`provision_endpoint_key` AS `provision_endpoint_key`,`prt`.`provision_method` AS `provision_method`,`prt`.`provision_payload_schema` AS `provision_payload_schema`,`prt`.`health_check_endpoint_key` AS `health_check_endpoint_key`,`prt`.`health_check_interval_seconds` AS `health_check_interval_seconds`,`prt`.`display_order` AS `display_order` from (`provider_resource_types` `prt` join `providers` `p` on(`prt`.`provider_id` = `p`.`id`)) where `prt`.`is_active` = 1 and `p`.`is_active` = 1 order by `prt`.`provider_id`,`prt`.`display_order` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

-- Dump completed on 2026-08-17 15:30:10
