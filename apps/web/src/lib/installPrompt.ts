import { useCallback, useEffect, useState } from "react";

/**
 * In-app install affordance.
 *
 * Chrome was not offering its own install prompt on the live site even though
 * the manifest meets every current installability criterion it documents (name,
 * 192/512 icons that resolve 200, start_url, display: standalone, HTTPS). The
 * prompt itself is still the only way a page can install the app — but the page
 * can hold on to the browser's `beforeinstallprompt` event and give the user a
 * control of its own, which is what this hook does. When the browser has not
 * fired the event the control renders nothing: there is no fake install button,
 * because a button that cannot install would be a lie.
 *
 * What this deliberately does NOT do:
 *   - no service worker. Chrome's current install criteria do not require one,
 *     and `public/sw.js` is a documented one-time kill switch (root AGENTS.md
 *     §8 / the pwa-capacitor-release skill): `main.tsx` registers nothing and
 *     `vite.config.ts` keeps `VitePWA` out of `plugins`.
 *   - no storage. The browser is the single source of truth for both the event
 *     and the installed state (display-mode / `navigator.standalone`), so there
 *     is nothing to persist and nothing to go stale.
 */

/**
 * Chrome's install-prompt event — absent from lib.dom, declared minimally here.
 * Not exported: only this module produces or consumes it (nothing imports the
 * type), and knip's web entry list does not include unit tests, so a
 * test-only importer would not count as usage either — the strengthened gate
 * flags such exports, correctly. Callers that need it cast a dispatched
 * `Event` at the boundary instead.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/**
 * Narrow a dispatched `Event` to the install-prompt event.
 *
 * The type is not in lib.dom, so an unchecked `as` would be a claim the runtime
 * never made. These guards are that claim's verification: the two members read
 * by this module are checked before the value is handed on.
 */
function asInstallPromptEvent(event: Event): BeforeInstallPromptEvent | null {
  const candidate = event as Event & Partial<BeforeInstallPromptEvent>;
  if (typeof candidate.prompt !== "function") return null;
  if (typeof candidate.userChoice !== "object" || candidate.userChoice === null) return null;
  return candidate as BeforeInstallPromptEvent;
}

/**
 * True while the page runs as the installed app: the Android/desktop PWA via
 * `display-mode: standalone`, or iOS Safari via `navigator.standalone`. An
 * installed app has nothing to install, so this suppresses the control.
 */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // jsdom has no matchMedia — same guard as AuthShell's useIsDesktop.
  if (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) {
    return true;
  }
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * The hook's return shape. Deliberately NOT exported: nothing outside this
 * module imports the interface, and the strengthened knip gate (F-67) flags an
 * export with no importer — the same class of finding it raised for the Quick
 * Services default export. Callers that want the type use
 * `ReturnType<typeof useInstallPrompt>`.
 */
interface InstallPrompt {
  /** True only while the browser's own install prompt is available and unused. */
  canInstall: boolean;
  /** Show the browser's install prompt. No-op when nothing was captured. */
  promptInstall: () => Promise<void>;
  /** True once the page runs installed (display-mode / appinstalled). */
  installed: boolean;
}

export function useInstallPrompt(): InstallPrompt {
  const supported = typeof window !== "undefined";
  // The event is one-shot: Chrome rejects a second prompt() on the same event,
  // so it is dropped the moment it has been used or superseded.
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(isStandalone);

  useEffect(() => {
    if (!supported) return;
    const onBeforeInstallPrompt = (event: Event) => {
      const promptEvent = asInstallPromptEvent(event);
      if (!promptEvent) return;
      // Keep the event (and stop Chrome's own mini-infobar): the app shows the
      // affordance where the user actually is.
      event.preventDefault();
      setDeferred(promptEvent);
    };
    const onInstalled = () => {
      // Nothing left to install: clear the captured event and record the state
      // so the control disappears even before the page is reloaded.
      setDeferred(null);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [supported]);

  const promptInstall = useCallback(async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      // Resolves "accepted" or "dismissed". Either way this event is spent; a
      // dismissal can produce a fresh `beforeinstallprompt` later, which the
      // listener above will capture.
      await deferred.userChoice;
    } catch {
      // A browser that rejects prompt()/userChoice has consumed the event just
      // the same — fall through to the finally so the control cannot offer a
      // prompt that will never open again.
    } finally {
      setDeferred(null);
    }
  }, [deferred]);

  return {
    canInstall: supported && !installed && deferred !== null,
    promptInstall,
    installed,
  };
}
