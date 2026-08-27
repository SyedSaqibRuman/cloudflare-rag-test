---
type: frontend
status: active
area: frontend
tags: [dependencies]
related:
  - "[[Backend Dependencies]]"
---

# Frontend Dependencies

From `web/package.json` (verified):

```jsonc
dependencies:    { react ^18.3.1, react-dom ^18.3.1 }
devDependencies: { @tailwindcss/vite ^4.1.7, @vitejs/plugin-react ^4.4.1,
                   rollup-plugin-visualizer ^7.1.1, tailwindcss ^4.1.7, vite ^6.3.5 }
scripts: dev | build | analyze(ANALYZE=true) | preview
```

No router library (hash routing is hand-rolled), no state library (contexts/hooks only), no form library (hand-styled inputs), **one** UI-library surface: Radix dropdown behavior achieved without listing radix deps here — imported from the parent app's single dependency elsewhere? Correction on inspection: `dropdown-menu.jsx` imports `@radix-ui/react-dropdown-menu`, which must therefore be present transitively via hoisting of another package rather than declared locally. Its direct absence in web/package.json is flagged as a latent risk ([[Technical Debt]] suggestion to declare explicitly).

## Shared-code coupling to backend

| Portal file | Backend module |
|---|---|
| web/src/models.js | config/schema.js re-export (ALLOWED_MODELS etc.) — explicit anti-drift design |
| #shared alias resolution | shared/error-tag.js, patterns.js, catalog-enums.js, status.js |

Both couplings are intentional and load-bearing: changing backend schema keys surfaces instantly in portal forms/tests.

## Build notes

- JSX handled by @vitejs/plugin-react (no TS).
- fs.allow [".."] needed because #shared resolves outside Vite root.
- visualizer artifact written to dist/bundle-stats.html when analyze script used.
- Bundle budget commentary recorded in App.jsx comments (~428KB initial after lazy split).

## Test execution

Portal tests run under root npm test glob `web/src/**/__tests__/*.test.js` using node:test directly against ESM sources (no build step required for these pure modules).