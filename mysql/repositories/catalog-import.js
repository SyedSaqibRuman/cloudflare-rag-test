// --------------------------
// catalog-import — one aggregate per file (Clean Architecture: repository layer).
// Extracted verbatim from the former mysql/repositories.js monolith.
// --------------------------
import { getPool } from "../pool.js";

// (mysql/services/catalog-importer.js). Every write accepts an optional
// `conn` so the whole definition can be applied in one transaction.
// ON DUPLICATE KEY UPDATE refreshes metadata for providers that are
// re-imported (e.g. after a catalog fix) without touching tenant rows.
// ------------------------------------------------------------------
export const CatalogImportRepository = {
  /** Upsert the provider base row, returning { id, created }. */
  async upsertProvider(input, conn) {
    const pool = conn ?? (await getPool());
    const [result] = await pool.query(
      `INSERT INTO providers
         (provider_key, provider_name, primary_service_category, website_url,
          documentation_url, logo_url, default_api_base_url, auth_type,
          auth_header_name, api_key_format_regex, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
         provider_name = VALUES(provider_name),
         primary_service_category = VALUES(primary_service_category),
         website_url = VALUES(website_url),
         documentation_url = VALUES(documentation_url),
         logo_url = VALUES(logo_url),
         default_api_base_url = VALUES(default_api_base_url),
         auth_type = VALUES(auth_type),
         auth_header_name = VALUES(auth_header_name),
         api_key_format_regex = VALUES(api_key_format_regex),
         is_active = TRUE`,
      [
        input.providerKey,
        input.providerName,
        input.category,
        input.websiteUrl ?? input.website ?? null,
        input.documentationUrl ?? input.documentation ?? null,
        input.logoUrl ?? null,
        input.defaultApiBaseUrl ?? null,
        input.authType ?? "bearer_token",
        input.authHeaderName ?? "Authorization",
        input.apiKeyFormatRegex ?? input.apiKeyFormat ?? null,
      ]
    );
    const [rows] = await pool.query(`SELECT id FROM providers WHERE provider_key = ?`, [
      input.providerKey,
    ]);
    return { id: rows[0].id, created: result.affectedRows === 1 };
  },

  /** Edit-wizard replace: delete auth fields whose field_name is not in the
   *  provided list (called AFTER upserts so kept rows are already present). */
  async deleteAuthFieldsNotIn(providerId, keepFieldNames, conn) {
    const pool = conn ?? (await getPool());
    if (keepFieldNames.length === 0) {
      await pool.query(`DELETE FROM provider_auth_schemas WHERE provider_id = ?`, [providerId]);
      return;
    }
    const ph = keepFieldNames.map(() => "?").join(", ");
    await pool.query(
      `DELETE FROM provider_auth_schemas
        WHERE provider_id = ? AND field_name NOT IN (${ph})`,
      [providerId, ...keepFieldNames]
    );
  },

  /** Upsert one auth-schema field (v_provider_auth_form source row). */
  async upsertAuthField(providerId, f, conn) {
    const pool = conn ?? (await getPool());
    await pool.query(
      `INSERT INTO provider_auth_schemas
         (provider_id, field_name, field_label, field_type, field_placeholder,
          field_help_text, field_default_value, is_required, validation_regex,
          validation_min_length, validation_max_length, is_encrypted,
          encryption_storage_path, display_order, field_group, field_width,
          select_options, show_when, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
         field_label = VALUES(field_label),
         field_type = VALUES(field_type),
         field_placeholder = VALUES(field_placeholder),
         field_help_text = VALUES(field_help_text),
         field_default_value = VALUES(field_default_value),
         is_required = VALUES(is_required),
         validation_regex = VALUES(validation_regex),
         validation_min_length = VALUES(validation_min_length),
         validation_max_length = VALUES(validation_max_length),
         is_encrypted = VALUES(is_encrypted),
         encryption_storage_path = VALUES(encryption_storage_path),
         display_order = VALUES(display_order),
         field_group = VALUES(field_group),
         field_width = VALUES(field_width),
         select_options = VALUES(select_options),
         show_when = VALUES(show_when),
         is_active = TRUE`,
      [
        providerId,
        f.fieldName,
        f.fieldLabel,
        f.fieldType ?? "text",
        f.fieldPlaceholder ?? null,
        f.fieldHelpText ?? null,
        f.fieldDefaultValue ?? null,
        f.isRequired ?? true,
        f.validationRegex ?? null,
        f.validationMinLength ?? null,
        f.validationMaxLength ?? null,
        f.isEncrypted ?? true,
        f.encryptionStoragePath ?? f.fieldName,
        f.displayOrder ?? 0,
        f.fieldGroup ?? "main",
        f.fieldWidth ?? "full",
        f.selectOptions ? JSON.stringify(f.selectOptions) : null,
        f.showWhen ? JSON.stringify(f.showWhen) : null,
      ]
    );
  },

  /** Edit-wizard replace: delete endpoints whose endpoint_key is not in the
   *  provided list (called AFTER upserts so kept rows are already present). */
  async deleteEndpointsNotIn(providerId, keepKeys, conn) {
    const pool = conn ?? (await getPool());
    if (keepKeys.length === 0) {
      await pool.query(`DELETE FROM provider_endpoints WHERE provider_id = ?`, [providerId]);
      return;
    }
    const ph = keepKeys.map(() => "?").join(", ");
    await pool.query(
      `DELETE FROM provider_endpoints
        WHERE provider_id = ? AND endpoint_key NOT IN (${ph})`,
      [providerId, ...keepKeys]
    );
  },

  /** Upsert one endpoint definition. */
  async upsertEndpoint(providerId, e, conn) {
    const pool = conn ?? (await getPool());
    await pool.query(
      `INSERT INTO provider_endpoints
         (provider_id, endpoint_key, endpoint_name, endpoint_url, http_method,
          default_timeout_seconds, is_default, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
         endpoint_name = VALUES(endpoint_name),
         endpoint_url = VALUES(endpoint_url),
         http_method = VALUES(http_method),
         default_timeout_seconds = VALUES(default_timeout_seconds),
         is_default = VALUES(is_default),
         is_active = TRUE`,
      [
        providerId,
        e.endpointKey,
        e.endpointName,
        e.endpointUrl,
        e.httpMethod ?? "POST",
        e.defaultTimeoutSeconds ?? 30,
        e.isDefault ?? false,
      ]
    );
  },

  /** Upsert a capability. Accepts a bare key string or { capabilityKey, isSupported, config }. */
  async upsertCapability(providerId, input, conn) {
    const pool = conn ?? (await getPool());
    const { capabilityKey, isSupported = true, config } =
      typeof input === "string" ? { capabilityKey: input } : input;
    await pool.query(
      `INSERT INTO provider_capabilities (provider_id, capability_key, is_supported, config, is_active)
       VALUES (?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
         is_supported = VALUES(is_supported),
         config = VALUES(config),
         is_active = TRUE`,
      [providerId, capabilityKey, isSupported, config ? JSON.stringify(config) : null]
    );
  },

  /** Edit-wizard replace: delete resource types whose resource_type is not in
   *  the provided list (called AFTER upserts so kept rows are already present). */
  async deleteResourceTypesNotIn(providerId, keepTypes, conn) {
    const pool = conn ?? (await getPool());
    if (keepTypes.length === 0) {
      await pool.query(`DELETE FROM provider_resource_types WHERE provider_id = ?`, [providerId]);
      return;
    }
    const ph = keepTypes.map(() => "?").join(", ");
    await pool.query(
      `DELETE FROM provider_resource_types
        WHERE provider_id = ? AND resource_type NOT IN (${ph})`,
      [providerId, ...keepTypes]
    );
  },

  /** Upsert one resource-type template (drives the "Provision Resource" wizard). */
  async upsertResourceType(providerId, r, conn) {
    const pool = conn ?? (await getPool());
    await pool.query(
      `INSERT INTO provider_resource_types
         (provider_id, resource_type, display_name, description, icon_name,
          display_color, config_schema, is_required, is_default_enabled,
          max_per_credential, provision_endpoint_key, provision_method,
          provision_payload_schema, health_check_endpoint_key,
          health_check_interval_seconds, display_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         description = VALUES(description),
         icon_name = VALUES(icon_name),
         display_color = VALUES(display_color),
         config_schema = VALUES(config_schema),
         is_required = VALUES(is_required),
         is_default_enabled = VALUES(is_default_enabled),
         max_per_credential = VALUES(max_per_credential),
         provision_endpoint_key = VALUES(provision_endpoint_key),
         provision_method = VALUES(provision_method),
         provision_payload_schema = VALUES(provision_payload_schema),
         health_check_endpoint_key = VALUES(health_check_endpoint_key),
         health_check_interval_seconds = VALUES(health_check_interval_seconds),
         display_order = VALUES(display_order),
         is_active = TRUE`,
      [
        providerId,
        r.resourceType,
        r.displayName ?? r.resourceType,
        r.description ?? null,
        r.iconName ?? null,
        r.displayColor ?? null,
        r.configSchema ? JSON.stringify(r.configSchema) : null,
        r.isRequired ?? false,
        r.isDefaultEnabled ?? false,
        r.maxPerCredential ?? null,
        r.provisionEndpointKey ?? null,
        r.provisionMethod ?? null,
        r.provisionPayloadSchema ? JSON.stringify(r.provisionPayloadSchema) : null,
        r.healthCheckEndpointKey ?? null,
        r.healthCheckIntervalSeconds ?? null,
        r.displayOrder ?? 0,
      ]
    );
  },

  /** Upsert one model definition. */
  async upsertModel(providerId, m, conn) {
    const pool = conn ?? (await getPool());
    await pool.query(
      `INSERT INTO provider_models
         (provider_id, model_key, model_name, model_family, category,
          supports_streaming, supports_function_calling, supports_vision,
          max_context_window, max_output_tokens, is_active, is_deprecated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, FALSE)
       ON DUPLICATE KEY UPDATE
         model_name = VALUES(model_name),
         model_family = VALUES(model_family),
         category = VALUES(category),
         supports_streaming = VALUES(supports_streaming),
         supports_function_calling = VALUES(supports_function_calling),
         supports_vision = VALUES(supports_vision),
         max_context_window = VALUES(max_context_window),
         max_output_tokens = VALUES(max_output_tokens),
         is_active = TRUE`,
      [
        providerId,
        m.modelKey,
        m.modelName,
        m.modelFamily ?? null,
        m.category,
        m.supportsStreaming ?? false,
        m.supportsFunctionCalling ?? false,
        m.supportsVision ?? false,
        m.maxContextWindow ?? null,
        m.maxOutputTokens ?? null,
      ]
    );
  },

  async modelIdByKey(providerId, modelKey, conn) {
    const pool = conn ?? (await getPool());
    const [rows] = await pool.query(
      `SELECT id FROM provider_models WHERE provider_id = ? AND model_key = ?`,
      [providerId, modelKey]
    );
    return rows[0]?.id ?? null;
  },

  /** Close the currently-open pricing row before a new open-ended row lands
   * (same D3 current-price invariant as savePricing). */
  async closeOpenPricing(modelId, effectiveFromExclusive, conn) {
    const pool = conn ?? (await getPool());
    await pool.query(
      `UPDATE provider_model_pricing
          SET effective_to = ?
        WHERE provider_model_id = ? AND effective_to IS NULL AND effective_from < ?`,
      [effectiveFromExclusive, modelId, effectiveFromExclusive]
    );
  },

  /** Insert one pricing bucket for a model. */
  async insertPricing(modelId, p, conn) {
    const pool = conn ?? (await getPool());
    await pool.query(
      `INSERT INTO provider_model_pricing
         (provider_model_id, effective_from, effective_to,
          input_price_per_million, output_price_per_million,
          cached_input_price_per_million, image_price,
          audio_input_price_per_million, audio_output_price_per_million,
          request_price, price_currency, billing_unit, tier_name,
          min_units, rate_limit_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        modelId,
        p.effectiveFrom,
        p.effectiveTo ?? null,
        p.inputPricePerMillion ?? null,
        p.outputPricePerMillion ?? null,
        p.cachedInputPricePerMillion ?? null,
        p.imagePrice ?? null,
        p.audioInputPricePerMillion ?? null,
        p.audioOutputPricePerMillion ?? null,
        p.requestPrice ?? null,
        p.priceCurrency ?? "USD",
        p.billingUnit ?? "tokens",
        p.tierName ?? "standard",
        p.minUnits ?? null,
        p.rateLimitNotes ?? null,
      ]
    );
  },
};
