import type { CapacitorConfig } from "@capacitor/cli";

/**
 * AgroBridge Android wrapper.
 * - Bundled SPA mode (default): webDir = dist, API base injected at build time
 *   via VITE_API_BASE_URL (see apps/web/src/lib/api.ts).
 * - The deployed WEB_ORIGIN must include "https://localhost" (Capacitor origin)
 *   or the absolute site URL when using server.url mode.
 *
 * Launch screen: themed natively by the Android splash resources
 * (res/values/styles.xml for API < 31, res/values-v31/styles.xml for 31+,
 * colours in res/values/colors.xml) and then handed over to the in-app React
 * splash (src/components/Splash.tsx). No SplashScreen plugin is installed, so
 * no plugin block is declared here — configuration for an uninstalled plugin
 * has no effect and misleads the next reader.
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
};

export default config;
