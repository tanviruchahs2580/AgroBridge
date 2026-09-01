import type { CapacitorConfig } from "@capacitor/cli";

/**
 * AgroBridge Android wrapper.
 * - Bundled SPA mode (default): webDir = dist, API base injected at build time
 *   via VITE_API_BASE_URL (see apps/web/src/lib/api.ts).
 * - The deployed WEB_ORIGIN must include "https://localhost" (Capacitor origin)
 *   or the absolute site URL when using server.url mode.
 */
const config: CapacitorConfig = {
  appId: "com.agrobridge.app",
  appName: "AgroBridge",
  webDir: "dist",
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: true,
      splashImmersive: true,
      backgroundColor: "#0A2F1F",
    },
  },
};

export default config;
