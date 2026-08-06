import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: [".monkeycode-ai.live"],
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
