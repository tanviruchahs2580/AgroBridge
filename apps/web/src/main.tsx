import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { domAnimation, LazyMotion, MotionConfig } from "framer-motion";
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

// framer-motion bundle posture (load-bearing): every module on the entry path
// (App shell, ui.tsx overlays, Splash, TopBar, PageTransition) renders the `m`
// component, and the animation feature bundle is provided once, here, through
// LazyMotion. With features={domAnimation} passed as the imported feature set the
// features ship in the eager graph — no animation loads late — while the full
// `motion` component (gestures, drag, layout projection — used only inside lazy
// route chunks such as services/ServiceCard) no longer sits on the initial path.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user" transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
      <LazyMotion features={domAnimation}>
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
      </LazyMotion>
    </MotionConfig>
  </React.StrictMode>
);
