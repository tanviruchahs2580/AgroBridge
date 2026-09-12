import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import App from "./App";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { SessionProvider } from "./lib/session";
import { ConfirmProvider, ToastProvider, useToast } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { t } from "./lib/i18n";
import "./index.css";
import "./dark.css"; // designed dark token layer — after index.css so it cascades last

// PWA service worker registration: use a manual approach that does not
// depend on vite-plugin-pwa's virtual module (which is unavailable in
// production builds).  The generated service-worker.js is served at build.
//
// This is a best-effort registration; it works whether or not a SW file
// exists (it silently no-ops when the file is absent).
declare global {
  interface Window {
    __PWA_SW_VERSION__: string | undefined;
  }
}
let swUpdateReady = false;
let applySwUpdate = () => void 0;

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
      if (reg.installing) {
        swUpdateReady = true;
        reg.installing.addEventListener("statechange", () => {
          if ((reg.installing as ServiceWorker).state === "activated") {
            swUpdateReady = true;
          }
        });
      }
      applySwUpdate = () => {
        // Skip waiting to reload immediately
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      };
    } catch {
      // SW not available — silent fallback
    }
  });
}

function SwUpdateAnnouncer() {
  const toast = useToast();
  const fired = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      if (swUpdateReady && !fired.current) {
        fired.current = true;
        clearInterval(interval);
        toast.info(t("updateReady", "bn"));
        setTimeout(applySwUpdate, 1500); // action-less auto-reload
      }
    }, 400);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user" transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ConfirmProvider>
            <BrowserRouter>
              <SessionProvider>
                <ErrorBoundary>
                  <App />
                </ErrorBoundary>
              </SessionProvider>
            </BrowserRouter>
            <SwUpdateAnnouncer />
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MotionConfig>
  </React.StrictMode>
);
