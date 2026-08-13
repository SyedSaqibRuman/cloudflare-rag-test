// --------------------------
// GATEWAY ROUTER — barrel entry point.
// Clean Architecture: the gateway's Express routes are split into one router
// per resource group under ./routes/ (providers, companies, resources,
// credentials, endpoints, pricing, kbs, assistants) and composed in
// ./routes/index.js. This file re-exports the composed router so app.js and
// the route tests keep importing from the same path.
// --------------------------
export { default } from "./routes/index.js";
