import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./index.css";

// PWA service worker: auto-update, prompt user when a new version is ready.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Minimal, non-blocking prompt; a toast component can replace this later.
    if (window.confirm("নতুন সংস্করণ পাওয়া গেছে — রিলোড করবেন?\nA new version is available — reload?")) {
      void updateSW(true);
    }
  },
  onOfflineReady() {
    console.info("AgroBridge ready to work offline");
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
