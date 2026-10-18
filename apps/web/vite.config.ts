import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Build identity. Version comes from the repo-root version.json (the single
 * source of truth shared with the Android versionName/versionCode); the commit
 * comes from git so any deployed bundle — web or APK — can be traced back to
 * the commit that produced it. Both are optional: a missing git checkout or
 * file degrades to a placeholder instead of failing the build.
 */
function buildIdentity() {
  let version = "0.0.0";
  try {
    version = JSON.parse(readFileSync(path.resolve(__dirname, "../../version.json"), "utf8")).version ?? version;
  } catch {
    // keep placeholder
  }
  let commit = process.env.GIT_COMMIT?.slice(0, 7) ?? "unknown";
  if (commit === "unknown") {
    try {
      commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      // not a git checkout (e.g. source archive) — leave unknown
    }
  }
  return { version, commit, builtAt: new Date().toISOString() };
}

export default defineConfig(async () => {
  const extraPlugins: any[] = [];
  const identity = buildIdentity();
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
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(identity.version),
    "import.meta.env.VITE_GIT_COMMIT": JSON.stringify(identity.commit),
    "import.meta.env.VITE_BUILD_TIME": JSON.stringify(identity.builtAt),
  },
  plugins: [
    react(),
    ...extraPlugins,
    // Emits version.json next to the bundle so a deployment (or an APK's
    // bundled assets) can be identified without reading the JS.
    {
      name: "agrobridge-build-stamp",
      generateBundle(this: { emitFile: (f: { type: "asset"; fileName: string; source: string }) => void }) {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify(identity, null, 2) + "\n",
        });
      },
    },
    // NOTE: VitePWA is intentionally disabled. The plugin's build-time Rollup
    // resolver cannot follow bare .ts relative imports (Vite 6 limitation),
    // and no service worker is built: public/sw.js is the one-time kill switch
    // only. main.tsx registers nothing — offline writes queue in
    // lib/offlineQueue.ts and sync when connectivity returns.
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
    // No hard-coded LAN IP: set AGRO_HMR_HOST to the machine's LAN address
    // (and optionally AGRO_HMR_PORT) when testing from physical devices.
    hmr: process.env.AGRO_HMR_HOST
      ? { host: process.env.AGRO_HMR_HOST, clientPort: Number(process.env.AGRO_HMR_PORT ?? 5173) }
      : undefined,
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
