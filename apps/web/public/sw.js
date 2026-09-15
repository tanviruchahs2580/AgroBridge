/* Legacy service-worker kill-switch (vite-plugin-pwa era shipped a workbox
 * sw.js that precached the whole app; once the file stopped shipping, browsers
 * kept the old SW forever (update fetch returned HTML → MIME error → no
 * replace), serving stale versions. This file deliberately exists so the old
 * SW's update check finds valid JS with new bytes: it then installs, clears
 * every cache, unregisters all registrations and reloads open clients.
 * After this one-time migration, no SW is registered again (the app's own
 * /service-worker.js probe 404s → main.tsx no-ops). */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch { /* best effort */ }
      try {
        const regs = await self.registration.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
      } catch { /* best effort */ }
      try {
        await self.registration.unregister();
      } catch { /* best effort */ }
      try {
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        for (const c of clients) {
          try { c.navigate(c.url); } catch { /* non-navigable client */ }
        }
      } catch { /* best effort */ }
    })()
  );
});
