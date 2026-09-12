import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig(async () => {
  const extraPlugins: any[] = [];
  if (process.env.ANALYZE) {
    try {
      const mod: any = await import("rollup-plugin-visualizer");
      const viz = mod.visualizer ?? mod.default;
      if (viz) extraPlugins.push(viz({ filename: "dist/stats.html", gzipSize: true, brotliSize: true, open: false }));
    } catch (e) {
      console.warn("[vite] rollup-plugin-visualizer not installed, skipping analyze", e);
    }
  }
  return {
  plugins: [
    react(),
    ...extraPlugins,
    // NOTE: VitePWA is intentionally disabled. The plugin's build-time Rollup
    // resolver cannot follow bare .ts relative imports (Vite 6 limitation).
    // PWA is managed via manual SW registration in main.tsx and manual
    // service-worker.js generation.
  ],
  resolve: {
    extensions: [".mjs", ".js", ".ts", ".tsx", ".json"],
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    cors: true,
    hmr: { host: process.env.AGRO_HMR_HOST ?? "10.23.41.26", clientPort: 5173 },
    proxy: {
      "/api": { target: process.env.VITE_API_PROXY ?? "http://localhost:4000", changeOrigin: true },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    cors: true,
  },
  };
});
