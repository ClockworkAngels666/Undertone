/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the FastAPI backend runs on :8020 and Vite forwards /api to it,
// so the browser sees one origin, exactly like on Vercel.
const apiTarget = process.env.API_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? "8020"}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  preview: {
    port: 4173,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  build: {
    sourcemap: true,
    assetsInlineLimit: (file) => (file.includes("flag-icons") ? false : undefined),
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) return "charts";
          if (id.includes("node_modules/react")) return "react";
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
