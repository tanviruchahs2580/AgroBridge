import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import App from "./App";
import { SessionProvider } from "./lib/session";
import { ConfirmProvider, ToastProvider } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import "./dark.css"; // designed dark token layer — after index.css so it cascades last

// No service worker is registered — deliberately. The only SW file that ships is
// public/sw.js, a kill switch that unregisters old registrations and deletes
// their caches; no build emits service-worker.js. The previous probe-and-
// register path plus its update announcer could therefore never fire and has
// been removed. Offline behaviour is the durable write queue
// (lib/offlineQueue.ts): writes queue and sync when connectivity returns.
// There is no offline page shell, and no copy claims one.

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user" transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
      <ToastProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <SessionProvider>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </SessionProvider>
          </BrowserRouter>
        </ConfirmProvider>
      </ToastProvider>
    </MotionConfig>
  </React.StrictMode>
);
