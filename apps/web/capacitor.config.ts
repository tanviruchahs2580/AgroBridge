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
 * the mark in res/drawable/splash_icon.xml, colours in res/values/colors.xml)
 * and then handed over to the in-app React splash (src/components/Splash.tsx).
 * No SplashScreen plugin is installed, so no plugin block is declared here —
 * configuration for an uninstalled plugin has no effect and misleads the next
 * reader. The WebView background that carries part of that hand-over is below.
 */
const config: CapacitorConfig = {
  appId: "com.agrobridge.app",
  appName: "AgroBridge",
  webDir: "dist",
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    /**
     * Painted by the WebView itself: the frame it draws before the bundled
     * document paints anything. Left unset that frame is white, and it is the
     * first of the two blank screens that used to appear between the platform
     * launch screen and the in-app splash (the second was the page's own light
     * surface colour — see the `#root:empty` rule in src/index.css).
     * Mirrors --color-splash-from in src/tokens.css.
     */
    backgroundColor: "#0a2f1f",
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
