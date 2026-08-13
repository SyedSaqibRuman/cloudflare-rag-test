// --------------------------
// CREDENTIALS — slug helpers (keys auto-generate from names).
// --------------------------

export const slugify = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const resourceSlug = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Config-schema driven inputs for the resource provisioning form
// (provider_resource_types.config_schema drives the fields).
