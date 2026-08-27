import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(async () => {
  // STEP 47: bundle analyzer — only active when ANALYZE=1 (see package.json script `analyze`)
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
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "AgroBridge — Green Soil. Smart Farm. Secure Future.",
        short_name: "AgroBridge",
        description:
          "কৃষকের ডিজিটাল সঙ্গী — ফসল পরামর্শ, AI সহকারী, বাজার, সেবা বুকিং ও ফসল বিক্রি। Farmer-first digital agriculture platform.",
        lang: "bn",
        dir: "ltr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#fafaf9",
        theme_color: "#166534",
        categories: ["productivity", "business", "utilities"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            // Catalog data: stale-while-revalidate so market loads instantly offline
            urlPattern: ({ url, request }) => url.pathname.startsWith("/api/v1/products") && request.method === "GET",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "api-products", expiration: { maxEntries: 50, maxAgeSeconds: 86400 } },
          },
          {
            // Reference data (services, membership plans): cache-first for a day
            urlPattern: ({ url }) => /\/api\/v1\/(services|membership)/.test(url.pathname),
            handler: "CacheFirst",
            options: { cacheName: "api-reference", expiration: { maxEntries: 30, maxAgeSeconds: 86400 } },
          },
        ],
        // Never cache auth/AI/payments — always live
        navigateFallbackDenylist: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.VITE_API_PROXY ?? "http://localhost:4000", changeOrigin: true },
    },
  },
  };
});
