// --------------------------
// CATALOG WIZARD — pure helpers: draft shape factories + provider-row → form
// mapping. No React here — keeps the step components free of data plumbing.
// --------------------------

export function safeParseJson(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export const emptyField = (i) => ({
  name: "",
  label: "",
  type: "text",
  placeholder: "",
  helpText: "",
  required: true,
  validationRegex: "",
  encrypted: true,
  storagePath: "",
  displayOrder: String(i * 10),
  group: "main",
  width: "full",
  selectOptions: "",
});

export const emptyEndpoint = (i) => ({
  key: "",
  name: "",
  method: "POST",
  url: "",
  timeoutSeconds: "30",
  isDefault: false,
});

export const emptyResource = (i) => ({
  type: "vector_index",
  displayName: "",
  description: "",
  required: false,
  maxPerCredential: "",
  displayOrder: String(i * 10),
});

// Convert a registry provider row (snake_case) into the wizard's step shapes.
export function providerToWizard(provider) {
  const p = provider || {};
  return {
    form: {
      providerKey: p.provider_key || p.providerKey || "",
      providerName: p.provider_name || p.providerName || "",
      category: p.primary_service_category || p.category || "ai",
      websiteUrl: p.website_url || p.websiteUrl || "",
      documentationUrl: p.documentation_url || p.documentationUrl || "",
      logoUrl: p.logo_url || p.logoUrl || "",
    },
    auth: {
      authType: p.auth_type || p.authType || "bearer_token",
      authHeaderName: p.auth_header_name || p.authHeaderName || "Authorization",
      defaultApiBaseUrl: p.default_api_base_url || p.defaultApiBaseUrl || "",
      apiKeyFormatRegex: p.api_key_format_regex || p.apiKeyFormatRegex || "",
    },
    fields: (p.authForm || []).map((f) => ({
      name: f.field_name || "",
      label: f.field_label || "",
      type: f.field_type || "text",
      placeholder: f.field_placeholder || "",
      helpText: f.field_help_text || "",
      required: !!f.is_required,
      validationRegex: f.validation_regex || "",
      encrypted: !!f.is_encrypted,
      storagePath: f.encryption_storage_path || f.field_name || "",
      displayOrder: String(f.display_order ?? 0),
      group: f.field_group || "main",
      width: f.field_width || "full",
      selectOptions: f.select_options
        ? typeof f.select_options === "string"
          ? f.select_options
          : JSON.stringify(f.select_options)
        : "",
    })),
    endpoints: (p.endpoints || []).map((e) => ({
      key: e.endpoint_key || "",
      name: e.endpoint_name || "",
      method: e.http_method || "POST",
      url: e.endpoint_url || "",
      timeoutSeconds: String(e.default_timeout_seconds ?? 30),
      isDefault: !!e.is_default,
    })),
    resources: (p.resourceTemplates || []).map((r) => ({
      type: r.resource_type || "",
      displayName: r.display_name || "",
      description: r.description || "",
      required: !!r.is_required,
      maxPerCredential: r.max_per_credential == null ? "" : String(r.max_per_credential),
      displayOrder: String(r.display_order ?? 0),
    })),
  };
}

export const EMPTY_WIZARD = {
  form: { providerKey: "", providerName: "", category: "ai", websiteUrl: "", documentationUrl: "", logoUrl: "" },
  auth: { authType: "bearer_token", authHeaderName: "Authorization", defaultApiBaseUrl: "", apiKeyFormatRegex: "" },
  fields: [],
  endpoints: [],
  resources: [],
};
