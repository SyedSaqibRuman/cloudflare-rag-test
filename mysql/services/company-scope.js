// --------------------------
// COMPANY SCOPE — gateway tenant resolution
// Resolves x-company-name against the MySQL companies table
// (CompanyRepository.findByKey), NOT the RAG company_config store
// (utils/request-context.js companyFromRequest). Used by every /gateway/kbs*
// route so tenant tables carry the gateway company id.
// --------------------------
import { CompanyRepository } from "../repositories.js";

/**
 * Pure resolution: map a company key to its gateway row.
 * @param {string} companyKey
 * @returns {Promise<{ company: Object } | { error: string, status: number }>}
 */
export async function resolveGatewayCompany(companyKey) {
  if (!companyKey?.trim()) {
    return { error: "Company is required (x-company-name header, ?company=, or body.company).", status: 400 };
  }
  const company = await CompanyRepository.findByKey(companyKey.trim());
  if (!company) {
    return { error: `Company '${companyKey.trim()}' not found.`, status: 404 };
  }
  return { company };
}

/**
 * Express middleware: attaches req.company = <companies row> for KB routes.
 * Header wins over ?company=, which wins over body.company.
 */
export async function requireGatewayCompany(req, res, next) {
  const companyKey =
    req.headers?.["x-company-name"]?.trim() ||
    req.query?.company?.trim() ||
    req.body?.company?.trim();

  const result = await resolveGatewayCompany(companyKey);
  if (result.error) {
    return res.status(result.status).json({ success: false, error: result.error });
  }
  req.company = result.company;
  next();
}
