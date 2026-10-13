// --------------------------
// SETUP STATUS ROUTE (GET /cloudflare/setup-status)
// Maps the selected company's real state onto the shared checkpoint model
// (shared/setup-checkpoints.js) so the portal can render the horizontal
// stepper — always in the fixed sequential order, with `next` = the first
// incomplete step. Rendered by the portal only while setup is incomplete.
// --------------------------
import express from "express";

import { getConfig, listCompanies } from "../../config/index.js";
import { computeSetupCheckpoints } from "../../shared/setup-checkpoints.js";
import { hasCompanyChatted } from "../../utils/setup-progress.js";
import { companyFromHeader } from "./helpers.js";
import { isMysqlConfigured } from "../../mysql/pool.js";

const router = express.Router();

// GET /cloudflare/setup-status?company=… (or x-company-name header)
// Returns { complete, doneCount, total, next, steps } — steps are ALWAYS in
// sequential config order (workspace → credentials → vector index → storage →
// content → assistant → chat).
router.get("/", async (req, res) => {
  const companyName = companyFromHeader(req, res);
  if (!companyName) return;

  // Unknown company → treat as a fresh setup (the list check keeps this cheap
  // and avoids throwing for a company that was just deleted in another tab).
  const exists = listCompanies().some((c) => c.name === companyName);
  if (!exists) {
    return res.json({ success: true, company: companyName, complete: false, next: null, steps: [] });
  }

  let cfg;
  try {
    cfg = getConfig(companyName);
  } catch {
    return res.json({ success: true, company: companyName, complete: false, next: null, steps: [] });
  }

  const state = {
    // 1. Workspace exists (we got here, so it does)
    workspace: true,
    // 2. Provider credentials for the RAG pipeline (Cloudflare account+token)
    credentials: !!(cfg.CLOUDFLARE_ACCOUNT_ID && cfg.CLOUDFLARE_API_TOKEN),
    // 3. Vector index selected
    "vector-index": !!cfg.VECTOR_INDEX,
    // 4. Document storage selected
    storage: !!cfg.R2_BUCKET_NAME,
    // 5. Content ingested (≥1 knowledge base created for this company)
    content: false,
    // 6. AI assistant created — the legacy config ASSISTANT_KEY (still honored
    // by the ask path) counts as a base; the gateway probe below adds rows
    assistant: !!cfg.ASSISTANT_KEY,
    // 7. Chat exercised (first successful /ask or /ask-stream answer)
    chat: hasCompanyChatted(companyName),
  };
  const details = {
    "vector-index": cfg.VECTOR_INDEX || "",
    storage: cfg.R2_BUCKET_NAME || "",
    ...(cfg.ASSISTANT_KEY ? { assistant: cfg.ASSISTANT_KEY } : {}),
  };

  // Gateway KBs count toward the content checkpoint (best-effort — MySQL
  // unavailable simply leaves the step open).
  if (!isMysqlConfigured()) {
    const result = computeSetupCheckpoints(state, details);
    return res.json({
      success: true,
      company: companyName,
      complete: result.complete,
      doneCount: result.doneCount,
      total: result.steps.length,
      next: result.next,
      steps: result.steps, // sequential order preserved
    });
  }
  try {
    const { KbRepository } = await import("../../mysql/repositories/kb.js");
    const { AssistantRepository } = await import("../../mysql/repositories/assistant.js");
    const { CompanyRepository } = await import("../../mysql/repositories/company.js");
    const row = await CompanyRepository.findByKey(companyName);
    if (row) {
      const kbs = await KbRepository.listByCompany(row.id);
      if (kbs.length > 0) {
        state.content = true;
        details.content = `${kbs.length} knowledge base${kbs.length === 1 ? "" : "s"}`;
      }
      // 6. AI assistant — any gateway assistant row counts (active or not:
      // the persona exists; ask-time activation is a separate concern)
      const assistants = await AssistantRepository.listByCompany(row.id);
      if (assistants.length > 0) {
        state.assistant = true;
        if (!details.assistant) details.assistant = assistants[0].assistant_name;
      }
    }
  } catch {
    // No MySQL / lazy pool unavailable — content/assistant steps just stay open
  }

  const result = computeSetupCheckpoints(state, details);
  return res.json({
    success: true,
    company: companyName,
    complete: result.complete,
    doneCount: result.doneCount,
    total: result.steps.length,
    next: result.next,
    steps: result.steps, // sequential order preserved
  });
});

export default router;
