import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

interface SplashProps {
  onDone?: () => void;
  /** force static without timers, for reduced-motion preview or tests */
  staticOnly?: boolean;
}

const STATUS = [
  { upTo: 30, text: "ফার্ম ডেটা সংযুক্ত হচ্ছে..." },
  { upTo: 70, text: "AI বিশ্লেষণ চলছে..." },
  { upTo: 100, text: "আপনার ফার্ম প্রস্তুত" },
] as const;

function statusFor(p: number) {
  return STATUS.find((s) => p <= s.upTo)?.text ?? STATUS[2].text;
}

export function Splash({ onDone, staticOnly = false }: SplashProps) {
  const shouldReduce = useReducedMotion();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>(STATUS[0].text);
  const [phase, setPhase] = useState<"seed" | "brand" | "loading" | "exit">("seed");
  const [exiting, setExiting] = useState(false);

  // Respect reduced-motion: show static branded version but still auto-dismiss
  useEffect(() => {
    if (!(shouldReduce || staticOnly)) return;
    const t = setTimeout(() => onDone?.(), 1200);
    return () => clearTimeout(t);
  }, [shouldReduce, staticOnly, onDone]);

  useEffect(() => {
    if (shouldReduce || staticOnly) return;
    let cancelled = false;
    // Phase timing: seed 0-1.1s, brand 0.9-1.6s (overlap), loading 1.1-2.6s, exit 2.6-2.8s
    const tBrand = setTimeout(() => !cancelled && setPhase("brand"), 900);
    const tLoading = setTimeout(() => !cancelled && setPhase("loading"), 1100);
    const tExit = setTimeout(() => !cancelled && setPhase("exit"), 2600);

    // Progress animation 0→100 across 1.1-2.6s (1.5s) with meaningful status
    let raf = 0;
    const start = performance.now();
    const duration = 1500;
    const startDelay = 1100;
    function tick(now: number) {
      if (cancelled) return;
      const elapsed = now - start - startDelay;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min(100, (elapsed / duration) * 100);
      setProgress(p);
      setStatus(statusFor(p));
      if (p < 100) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    const tDone = setTimeout(() => {
      if (cancelled) return;
      setExiting(true);
      setTimeout(() => onDone?.(), 280);
    }, 2680);

    return () => {
      cancelled = true;
      clearTimeout(tBrand);
      clearTimeout(tLoading);
      clearTimeout(tExit);
      clearTimeout(tDone);
      cancelAnimationFrame(raf);
    };
  }, [shouldReduce, staticOnly, onDone]);

  if (shouldReduce || staticOnly) {
    return (
      <div data-testid="splash" className="fixed inset-0 z-[100] flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-b from-[#0A2F1F] via-[#1A4A32] to-[#2E7D4F] px-6 text-center" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex h-[96px] w-[96px] items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15 backdrop-blur">
          <span aria-hidden className="text-[40px] leading-none">🌱</span>
        </div>
        <h1 className="mt-4 text-[22px] font-bold tracking-[-0.02em] text-white">এগ্রোব্রিজ</h1>
        <p className="mt-1 text-[11px] font-medium tracking-[0.12em] text-white/70">AI-powered Farm Intelligence</p>
        <p className="mt-6 text-[13px] font-medium text-white/80">{statusFor(100)}</p>
      </div>
    );
  }

  const ringCircumference = 2 * Math.PI * 54;
  const ringOffset = ringCircumference * (1 - progress / 100);

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.4, 0, 1, 1] }}
          data-testid="splash"
          className="fixed inset-0 z-[100] flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#0A2F1F] via-[#1A4A32] to-[#2E7D4F] px-6"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
          aria-label="AgroBridge loading"
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
          <motion.div
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
                  <stop offset="0%" stopColor="#4ADE80" />
                  <stop offset="100%" stopColor="#22C55E" />
                </linearGradient>
                <linearGradient id="agro-shimmer" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="transparent" />
                  <stop offset="45%" stopColor="rgba(255,255,255,0.9)" />
                  <stop offset="55%" stopColor="rgba(255,255,255,0.9)" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
              <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3.5" />
              <motion.circle
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
              <motion.circle
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
              {/* Stem */}
              <motion.div
                initial={{ scaleY: 0 }}
                animate={{ scaleY: phase === "seed" ? 0 : 1 }}
                transition={{ duration: 0.5, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="absolute bottom-[18px] left-1/2 h-[28px] w-[3px] origin-bottom -translate-x-1/2 rounded-full bg-[#15803D]"
                aria-hidden
              />
              {/* Seed base */}
              <motion.div
                initial={{ scale: 0.15 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 180, damping: 14 }}
                className="absolute bottom-[14px] left-1/2 h-[10px] w-[10px] -translate-x-1/2 rounded-full bg-[#14532D] shadow-sm"
                aria-hidden
              />
              {/* Left leaf */}
              <motion.div
                initial={{ scale: 0, rotate: -35, x: -6, y: 6 }}
                animate={{ scale: phase === "seed" ? 0 : 1, rotate: phase === "seed" ? -35 : 0, x: phase === "seed" ? -6 : 0, y: phase === "seed" ? 6 : 0 }}
                transition={{ type: "spring", stiffness: 180, damping: 14, delay: 0.55 }}
                className="absolute bottom-[26px] right-[30px] h-[18px] w-[14px] origin-bottom-right rounded-[10px] bg-[#22C55E] shadow-[inset_0_1px_2px_rgba(255,255,255,0.6)]"
                style={{ borderRadius: "10px 10px 10px 2px" }}
                aria-hidden
              />
              {/* Right leaf */}
              <motion.div
                initial={{ scale: 0, rotate: 35, x: 6, y: 6 }}
                animate={{ scale: phase === "seed" ? 0 : 1, rotate: phase === "seed" ? 35 : 0, x: phase === "seed" ? 6 : 0, y: phase === "seed" ? 6 : 0 }}
                transition={{ type: "spring", stiffness: 180, damping: 14, delay: 0.6 }}
                className="absolute bottom-[26px] left-[30px] h-[18px] w-[14px] origin-bottom-left rounded-[10px] bg-[#4ADE80] shadow-[inset_0_1px_2px_rgba(255,255,255,0.6)]"
                style={{ borderRadius: "10px 10px 2px 10px" }}
                aria-hidden
              />
              {/* Fallback sprout emoji for screen-reader label, hidden visually when motion runs */}
              <span className="sr-only">AgroBridge sprout</span>
            </div>

            {/* Particles */}
            {Array.from({ length: 6 }).map((_, i) => (
              <motion.span
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
          </motion.div>

          {/* Brand Typography */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: phase === "seed" ? 0 : 1, y: phase === "seed" ? 12 : 0 }}
            transition={{ duration: 0.5, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="mt-5 text-center"
          >
            <h1 className="text-[26px] font-bold tracking-[-0.02em] text-white" style={{ fontFamily: "Hind Siliguri, Noto Sans Bengali, sans-serif" }}>
              এগ্রোব্রিজ
            </h1>
            <p className="mt-1 text-[11px] font-medium tracking-[0.14em] text-white/70">AI-powered Farm Intelligence</p>
          </motion.div>

          {/* Status text */}
          <div className="absolute bottom-[max(28px,env(safe-area-inset-bottom))] left-0 right-0 flex justify-center px-6">
            <AnimatePresence mode="wait">
              <motion.p
                key={status}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="text-center text-[13px] font-medium tracking-[0.01em] text-white/85"
              >
                {status}
              </motion.p>
            </AnimatePresence>
          </div>

          {/* Accessible progress */}
          <span className="sr-only" role="status" aria-live="polite">
            Loading {Math.round(progress)} percent — {status}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
