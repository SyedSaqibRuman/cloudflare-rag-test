// --------------------------
// ESLINT (flat config, ESLint 10)
// One config for the whole repo: Node ESM backend (root) + React/Vite portal
// (web/). Run with `npm run lint`. Core rules from @eslint/js plus the
// react-hooks plugin (the portal's disable comments reference it); JSX is
// parsed via espree's jsx ecmaFeature.
// --------------------------
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "node_modules/**",
      "web/node_modules/**",
      "web/dist/**",
      "db/**",
      "backup/**",
      "logs/**",
      "content/**",
      "processed-*.json",
      "scripts/*.sh",
      // Ad-hoc dev tools (test.js, test-bot.js, gen-key.js, …) — not part of
      // the app (see AGENTS.md), and several are CJS which the ESM parser
      // rejects. Keep them out of the lint pass.
      "scripts/**",
    ],
  },

  // Backend + shared (Node ESM).
  {
    files: ["**/*.js"],
    ignores: ["web/**"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // Underscore-prefixed names are the codebase's "intentionally dropped"
      // convention (e.g. `const { providerKey: _ignored, ...value } = …`,
      // unused trailing params like `(err, _req, res, _next)`).
      "no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
    },
  },

  // Portal (browser ESM + JSX).
  {
    files: ["web/src/**/*.{js,jsx}"],
    ...js.configs.recommended,
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: {
      // The codebase deliberately uses eslint-disable-next-line comments for
      // these (effect-driven loads keyed on one dep); honor them.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": ["error", { varsIgnorePattern: "^_" }],
    },
  },
];
