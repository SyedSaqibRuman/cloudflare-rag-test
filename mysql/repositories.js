// --------------------------
// REPOSITORY LAYER (MySQL) — barrel entry point.
// Clean Architecture: one repository per aggregate lives in ./repositories/.
// This file re-exports them so callers keep importing from the same path
// (services, routes, tests). No SQL lives here anymore.
// --------------------------
export * from "./repositories/index.js";
