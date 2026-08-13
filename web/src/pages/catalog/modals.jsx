// --------------------------
// CATALOG MODALS — barrel entry point.
// Clean Architecture: each modal lives in ./modals/ (endpoint-modal,
// pricing-modal, model-modal, import-provider-modal, delete-provider-modal).
// This file re-exports them so callers keep importing from "./modals".
// --------------------------
export * from "./modals/index.js";
