// --------------------------
// CATALOG MODALS — barrel entry point.
// Clean Architecture: each modal lives in ./modals/ (model-modal,
// delete-provider-modal, provider-test-modal, add-compatible-modal).
// This file re-exports them so callers keep importing from "./modals".
// --------------------------
export * from "./modals/index.js";
