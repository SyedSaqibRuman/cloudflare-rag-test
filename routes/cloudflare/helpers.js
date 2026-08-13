// --------------------------
// CLOUDFLARE ROUTE HELPERS (Clean Architecture: one router per resource group)
// Shared validation + company resolution for every sub-router.
// --------------------------
import { companyFromRequest } from "../../utils/request-context.js";

// Index/bucket/config/prompt routes resolve the company from the header,
// ?company= query, or body.company (see utils/request-context.js). Without a
// company there is nothing to resolve against, so fail fast with a clear 400
// instead of letting the Cloudflare SDK throw an auth error.
export function companyFromHeader(req, res) {
  const { companyName, error } = companyFromRequest(req, { query: true, body: true });
  if (error) {
    res.status(400).json({ success: false, error });
    return null;
  }
  return companyName;
}

// Resource names (vector indexes, R2 buckets) share the same naming contract.
export function validateResourceName(name) {
  if (!name?.trim()) {
    return "Name is required.";
  }

  const normalized = name.trim();

  if (!/^[a-z0-9-]+$/.test(normalized)) {
    return "Name must contain only lowercase letters, numbers, and hyphens.";
  }

  if (normalized.length < 3 || normalized.length > 63) {
    return "Name must be between 3 and 63 characters.";
  }

  return null;
}
