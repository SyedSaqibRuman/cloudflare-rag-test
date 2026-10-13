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

No router library (hash routing is hand-rolled), no state library (contexts/hooks only), no form library (hand-styled inputs), and **no third-party UI kit** — menu/popover affordances come from in-house primitives in `web/src/components/ui` consumed by the theme toggle directly. Historical note: an earlier Radix wrapper (dropdown-menu.jsx) existed; both it and any `@radix-ui/*` dependency were removed during this project's active development window — verified absent while authoring (grep across `web/src`, root and web package.json returns nothing), so the previously flagged missing-declaration risk is resolved.

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