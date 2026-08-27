import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient.js";
import { SessionProvider } from "./lib/session.jsx";
import { ConfirmProvider, ToastProvider, useToast } from "./components/ui.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { t } from "./lib/i18n.js";
import "./index.css";

// PWA service worker: auto-update; announce readiness as a toast, then reload.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    swUpdateReady = true;
  },
});

let swUpdateReady = false;
let applySwUpdate = () => void updateSW(true);

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
  </React.StrictMode>
);
