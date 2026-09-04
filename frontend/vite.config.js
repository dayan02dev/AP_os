/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev-only API proxy, so a local dev server can talk to a remote backend
    // without that backend's CORS allow-list needing this origin. Requests go
    // out server-side from Vite, where CORS does not apply.
    //
    // The prefix is deliberately NOT a bare path: `/founder/store` is both an
    // SPA route and an API route, so proxying those directly would shadow the
    // pages. Set VITE_API_BASE_URL=/api-proxy to route API calls through here.
    proxy: {
      "/api-proxy": {
        target: "https://cdw51c7gid.execute-api.ap-south-1.amazonaws.com",
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api-proxy/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    include: ["src/**/*.test.{js,jsx}", "src/**/*.test.{ts,tsx}"],
  },
});
