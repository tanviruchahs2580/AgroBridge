import { useEffect, useRef, useState } from "react";
import { m, AnimatePresence, useReducedMotion } from "framer-motion";
import { t } from "../lib/i18n";
import type { DictKey, Lang } from "../lib/i18n";

interface SplashProps {
  onDone?: () => void;
  /** force static without timers, for reduced-motion preview or tests */
  staticOnly?: boolean;
}

/** Pre-login language (same key as AuthShell) so the splash respects the user's choice. */
function splashLang(): Lang {
  try {
    const stored = localStorage.getItem("agrobridge.auth_lang");
    if (stored === "bn" || stored === "en") return stored;
  } catch {
    // ignore storage errors (private mode)
  }
  return "bn";
}

const STATUS: { upTo: number; key: DictKey }[] = [
  { upTo: 30, key: "splashStatusConnect" },
  { upTo: 70, key: "splashStatusAi" },
  { upTo: 100, key: "splashStatusReady" },
] as const;

function statusFor(p: number, lang: Lang) {
  const found = STATUS.find((s) => p <= s.upTo) ?? STATUS[2];
  return t(found.key, lang);
}

export function Splash({ onDone, staticOnly = false }: SplashProps) {
  const shouldReduce = useReducedMotion();
  /**
   * `onDone` through a ref, not a dependency. App passes an inline closure, and the
   * session is hydrating for exactly as long as this splash is on screen — so every
   * parent render (loading/session flips) re-ran the animation effect, restarting
   * the timers and the progress ring mid-flight.
   */
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [lang] = useState<Lang>(splashLang);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>(() => statusFor(0, splashLang()));
  const [phase, setPhase] = useState<"seed" | "brand" | "loading" | "exit">("seed");
  const [exiting, setExiting] = useState(false);

  // Respect reduced-motion: show static branded version but still auto-dismiss
  useEffect(() => {
    if (!(shouldReduce || staticOnly)) return;
    const t = window.setTimeout(() => onDoneRef.current?.(), 1200);
    return () => window.clearTimeout(t);
  }, [shouldReduce, staticOnly]);

  useEffect(() => {
    if (shouldReduce || staticOnly) return;
    let cancelled = false;
    // Phase timing, compressed to ~1.4s total. The splash used to hold the
    // screen for 2.7s on a fixed clock, which made it the largest-contentful
    // paint on every cold visit — a self-inflicted LCP above 4s for users and
    // for the Lighthouse budget. The sequence (seed -> brand -> loading ->
    // exit) and every visual are unchanged; only the clock is tighter:
    // seed 0-0.45s, brand 0.35-0.75s (overlap), loading 0.45-1.25s, exit
    // 1.25-1.45s.
    const tBrand = setTimeout(() => !cancelled && setPhase("brand"), 350);
    const tLoading = setTimeout(() => !cancelled && setPhase("loading"), 450);
    const tExit = setTimeout(() => !cancelled && setPhase("exit"), 1250);

    // Progress animation 0→100 across 0.45-1.25s (0.8s) with meaningful status
    let raf = 0;
    let tHandoff: ReturnType<typeof setTimeout> | undefined;
    const start = performance.now();
    const duration = 800;
    const startDelay = 450;
    function tick(now: number) {
      if (cancelled) return;
      const elapsed = now - start - startDelay;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min(100, (elapsed / duration) * 100);
      setProgress(p);
      setStatus(statusFor(p, lang));
      if (p < 100) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    const tDone = setTimeout(() => {
      if (cancelled) return;
      setExiting(true);
      tHandoff = setTimeout(() => onDoneRef.current?.(), 200);
    }, 1300);

    return () => {
      cancelled = true;
      // The 200 ms handoff is cleared with the rest: it was not, so it could call
      // onDone after the effect had been torn down.
      if (tHandoff) clearTimeout(tHandoff);
      clearTimeout(tBrand);
      clearTimeout(tLoading);
      clearTimeout(tExit);
      clearTimeout(tDone);
      cancelAnimationFrame(raf);
    };
  }, [shouldReduce, staticOnly, lang]);

  if (shouldReduce || staticOnly) {
    return (
      <div data-testid="splash" className="fixed inset-0 z-[100] flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-b from-[var(--color-splash-from)] via-[var(--color-splash-via)] to-[var(--color-splash-to)] px-6 text-center" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex h-[96px] w-[96px] items-center justify-center overflow-hidden rounded-full ring-1 ring-white/15 backdrop-blur">
          <img src="/brand/logo-mark.png" alt="" className="h-[76px] w-[76px] rounded-2xl object-cover shadow" />
        </div>
        <h1 className="mt-4 text-xl font-bold tracking-[-0.02em] text-white">{t("appName", lang)}</h1>
        <p className="mt-1 text-xs font-medium tracking-[0.12em] text-white/70">{t("splashTagline", lang)}</p>
        <p className="mt-6 text-sm font-medium text-white/80">{statusFor(100, lang)}</p>
      </div>
    );
  }

  const ringCircumference = 2 * Math.PI * 54;
  const ringOffset = ringCircumference * (1 - progress / 100);

  return (
    <AnimatePresence>
      {!exiting && (
        <m.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.4, 0, 1, 1] }}
          data-testid="splash"
          className="fixed inset-0 z-[100] flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[var(--color-splash-from)] via-[var(--color-splash-via)] to-[var(--color-splash-to)] px-6"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
          // No aria-label here: the element has no role, and aria-label is not
          // supported on the generic role a div maps to, so it was ignored. The
          // h1 inside the splash is what names it.
        >
          {/* Subtle field texture — low opacity, performance friendly */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage: `radial-gradient(ellipse at 30% 20%, white 1px, transparent 1.5px), radial-gradient(ellipse at 70% 80%, white 1px, transparent 1.5px)`,
              backgroundSize: "180px 180px, 220px 220px",
            }}
          />

          {/* Logo + ring container */}
          <m.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={phase === "exit" ? { scale: 0.28, x: -140, y: -280, opacity: 0 } : { opacity: 1, scale: 1 }}
            transition={phase === "exit" ? { duration: 0.28, ease: [0.4, 0, 1, 1] } : { duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex h-[120px] w-[120px] items-center justify-center will-change-transform"
            style={{ transformOrigin: "center" }}
          >
            {/* Progress ring */}
            <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 120 120" aria-hidden>
              <defs>
                <linearGradient id="agro-ring" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="var(--color-brand-400)" />
                  <stop offset="100%" stopColor="var(--color-brand-500)" />
                </linearGradient>
                <linearGradient id="agro-shimmer" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="transparent" />
                  <stop offset="45%" stopColor="rgba(255,255,255,0.9)" />
                  <stop offset="55%" stopColor="rgba(255,255,255,0.9)" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
              <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3.5" />
              <m.circle
                cx="60"
                cy="60"
                r="54"
                fill="none"
                stroke="url(#agro-ring)"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                initial={false}
                animate={{ strokeDashoffset: ringOffset }}
                transition={{ duration: 0.08, ease: "linear" }}
              />
              {/* Shimmer traveling along ring — 1.8s loop */}
              <m.circle
                cx="60"
                cy="60"
                r="54"
                fill="none"
                stroke="url(#agro-shimmer)"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={`${ringCircumference * 0.18} ${ringCircumference * 0.82}`}
                animate={{ rotate: 360 }}
                transition={{ duration: 1.8, ease: "linear", repeat: Infinity }}
                style={{ originX: "50%", originY: "50%" }}
              />
            </svg>

            {/* Seed → stem → leaves */}
            <div className="relative flex h-[64px] w-[64px] items-center justify-center rounded-full bg-white shadow-[0_8px_32px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.2)] ring-1 ring-black/5">
              <img
              src="/brand/logo-mark.png"
              alt=""
              className="h-[56px] w-[56px] rounded-2xl object-cover shadow-[0_8px_32px_rgba(0,0,0,0.18)]"
            />
            </div>

            {/* Particles */}
            {Array.from({ length: 6 }).map((_, i) => (
              <m.span
                key={i}
                initial={{ opacity: 0, x: 0, y: 0, scale: 0.6 }}
                animate={{
                  opacity: [0, 0.9, 0],
                  x: [0, (i % 2 === 0 ? 1 : -1) * (18 + i * 6)],
                  y: [0, -22 - i * 8],
                  scale: [0.6, 1, 0.5],
                }}
                transition={{ duration: 1.1, delay: 0.5 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                className="absolute left-1/2 top-1/2 h-[6px] w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 shadow-sm"
                aria-hidden
              />
            ))}
          </m.div>

          {/* Brand Typography */}
          <m.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: phase === "seed" ? 0 : 1, y: phase === "seed" ? 12 : 0 }}
            transition={{ duration: 0.5, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="mt-5 text-center"
          >
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-white" style={{ fontFamily: "Hind Siliguri, Noto Sans Bengali, sans-serif" }}>
              {t("appName", lang)}
            </h1>
            <p className="mt-1 text-xs font-medium tracking-[0.14em] text-white/70">{t("splashTagline", lang)}</p>
          </m.div>

          {/* Status text */}
          <div className="absolute bottom-[max(28px,env(safe-area-inset-bottom))] left-0 right-0 flex justify-center px-6">
            <AnimatePresence mode="wait">
              <m.p
                key={status}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="text-center text-sm font-medium tracking-[0.01em] text-white/85"
              >
                {status}
              </m.p>
            </AnimatePresence>
          </div>

          {/* Accessible progress. The sentence goes through the dictionary: it sits
              inside an aria-live region, so the hardcoded English literal was read
              aloud to Bengali users even though `status` itself is localized. */}
          <span className="sr-only" role="status" aria-live="polite">
            {t("splashLoadingProgress", lang, { percent: Math.round(progress), status })}
          </span>
        </m.div>
      )}
    </AnimatePresence>
  );
}
