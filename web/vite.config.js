import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Repo-root shared/ modules (error-tag, patterns, catalog-enums, status)
      // imported from the portal as "#shared/<file>.js". Browser-only: files
      // that must ALSO resolve under bare `node --test` (web/src/pages/
      // catalog/utils.js, web/src/models.js) keep relative paths — Node
      // rejects "../" escapes in package.json "imports" targets.
      "#shared": path.resolve(__dirname, "..", "shared"),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    // Run with ANALYZE=true npm run build to open the treemap
    process.env.ANALYZE && visualizer({
      open: true,
      filename: "dist/bundle-stats.html",
      gzipSize: true,
      brotliSize: true,
    }),
  ].filter(Boolean),
  server: {
    port: 5173,
    host: true,
    allowedHosts: [".monkeycode-ai.live"],
    // Serve shared/ (repo root) too — the portal imports repo-root modules,
    // which live outside the Vite project root.
    fs: { allow: [".."] },
    proxy: {
      "/_health": {
        target: "http://localhost:3000",
        rewrite: () => "/",
      },
      "/cloudflare": "http://localhost:3000",
      "/ask": "http://localhost:3000",
      "/auth": "http://localhost:3000",
    },
  },
});
