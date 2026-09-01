import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TouchEvent } from "react";
import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Check, Inbox, Info, TriangleAlert } from "lucide-react";
import { NavLink } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { motionTokens } from "../lib/motion.js";

// ── Design System — Enterprise Tokens (single source of truth) ──
// Colors: brand-50..950, stone-50..900, text-primary/strong/secondary/tertiary/muted, surface, semantic (success/warning/danger/info)
// Spacing: 4/8/12/16/24/32/48/64, Radius: lg/xl/2xl/card/button/chip/iconBox, Elevation: sm/md/lg/card/cardHover/button
// Motion: fast 0.15 normal 0.25 slow 0.4, spring snappy/gentle, press 0.98 — see src/lib/tokens.ts + src/lib/motion.ts

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

/** Accessible spinner used for loading states (replaces bare "…" text). */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-90" />
    </svg>
  );
}

/** Focusable-query helper for modal focus trapping. */
function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Accessible dialog behavior (WCAG 2.4.3 / 2.1.2):
 * - traps Tab focus inside the dialog
 * - locks body scroll (preserving scrollbar width)
 * - closes on Escape when closable
 * - restores focus to the trigger on unmount
 */
function useDialogA11y(open: boolean, onClose?: () => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement;
    const prevOverflow = document.body.style.overflow;
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarW > 0) document.body.style.paddingRight = `${scrollbarW}px`;
    // STEP 35: make background inert while dialog is open (a11y + scroll already locked)
    const mainEl = document.getElementById("main");
    const hadInert = mainEl?.hasAttribute("inert");
    if (mainEl && !hadInert) mainEl.setAttribute("inert", "");

    const container = containerRef.current;
    if (container) {
      const focusables = getFocusable(container);
      (focusables[0] ?? container).focus();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Tab" && container) {
        const f = getFocusable(container);
        if (f.length === 0) {
          e.preventDefault();
          return;
        }
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      if (e.key === "Escape" && onClose) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = "";
      if (mainEl && !hadInert) mainEl.removeAttribute("inert");
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  return containerRef;
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    className = "",
    children,
    disabled,
    ...props
  },
  ref
) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-[transform,background-color,box-shadow] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100";
  const sizes: Record<ButtonSize, string> = {
    sm: "min-h-[36px] px-3 py-1.5 text-xs",
    md: "min-h-[44px] px-4 py-2.5 text-sm",
    lg: "min-h-[48px] px-6 py-3 text-base",
  };
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-green-700 text-white hover:bg-green-800 active:bg-green-900",
    outline: "border border-green-700 text-green-800 hover:bg-green-50",
    ghost: "text-stone-600 hover:bg-stone-100",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return (
    <button ref={ref} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <Spinner className="h-4 w-4" /> : children}
    </button>
  );
});

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${className}`} {...props} />;
}

export function Label({ className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`mb-1 block text-sm font-medium text-stone-700 ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const isInvalid = props["aria-invalid"] === true || props["aria-invalid"] === "true";
  return (
    <input
      className={`w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base text-stone-800 transition-[border-color,box-shadow,transform] focus:border-green-600 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:bg-stone-50 motion-reduce:transition-none ${isInvalid ? "animate-shake border-red-300" : ""} ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const isInvalid = props["aria-invalid"] === true || props["aria-invalid"] === "true";
  return (
    <select
      className={`w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base text-stone-800 transition-[border-color,box-shadow,transform] focus:border-green-600 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 motion-reduce:transition-none ${isInvalid ? "animate-shake border-red-300" : ""} ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Badge({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`inline-block rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-semibold text-stone-700 ${className}`} {...props} />;
}

export function Skeleton({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-stone-200 ${className}`} {...props} />;
}

export function EmptyState({
  icon = <Inbox className="h-10 w-10 text-stone-300" aria-hidden />,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 py-8 text-center shadow-sm">
      <div aria-hidden>{icon}</div>
      <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
      {description && <p className="max-w-sm text-sm text-stone-600">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorBanner({ code, message }: { code?: string; message: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code ? `${message} [${code}]` : message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be unavailable in insecure context
    }
  }
  return (
    <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <span>{message}{code && <span className="ml-2 font-mono text-xs text-red-600">[{code}]</span>}</span>
      <button
        type="button"
        onClick={() => void copy()}
        className="shrink-0 min-h-[44px] rounded-md border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

// ── Navigation shells — Enterprise Refinement ──
export function BottomNav({ items }: { items: { to: string; label: string; icon: ReactNode; badge?: boolean }[] }) {
  if (import.meta.env.VITE_FEATURE_NEW_SHELL === "false") return null;
  return (
    <nav aria-label="Primary navigation" className="fixed inset-x-2 bottom-3 z-20 flex rounded-2xl border border-stone-200 bg-white/95 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.08)] backdrop-blur supports-[backdrop-filter]:bg-white/90 md:hidden" style={{ paddingBottom: "calc(0.25rem + env(safe-area-inset-bottom))" }}>
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          aria-current={undefined}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${
              isActive ? "bg-green-50 text-[#14532d] shadow-sm" : "text-stone-600 hover:bg-stone-50 hover:text-green-700"
            }`
          }
          style={{ minHeight: 44 }}
        >
          <span aria-hidden className="relative text-[18px]">
            {it.icon}
            {it.badge && <span className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white"><span className="sr-only"> new notifications</span></span>}
          </span>
          <span className="leading-none tracking-[-0.01em]">{it.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function Sidebar({ items }: { items: { to: string; label: string; icon: ReactNode }[] }) {
  if (import.meta.env.VITE_FEATURE_NEW_SHELL === "false") return null;
  return (
    <aside className="hidden w-56 shrink-0 border-r border-stone-200 bg-white md:block">
      <nav className="sticky top-[57px] space-y-1 p-3">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium tracking-[-0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${
                isActive ? "bg-green-700 text-white shadow-sm" : "text-stone-700 hover:bg-green-50 hover:text-green-800"
              }`
            }
          >
            <span aria-hidden className="text-[18px]">{it.icon}</span>
            <span>{it.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

// ── Toast system ──
export interface ToastApi {
  success(msg: string): void;
  error(msg: string): void;
  info(msg: string): void;
}

const ToastCtx = createContext<ToastApi>({ success() {}, error() {}, info() {} });

interface ToastItem {
  id: number;
  kind: "success" | "error" | "info";
  msg: string;
}

const TOAST_KIND_CLASS: Record<ToastItem["kind"], string> = {
  success: "border border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-[var(--color-success-text)]",
  error: "border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] text-[var(--color-danger-text)]",
  info: "border border-stone-200 bg-[var(--color-info-bg)] text-stone-700",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const swipeStart = useRef<{ id: number; x: number } | null>(null);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((tst) => tst.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastItem["kind"], msg: string) => {
      // Max 3 stacked: drop oldest beyond capacity.
      setItems((prev) => [...prev.slice(-2), { id: ++nextId.current, kind, msg }]);
      const id = nextId.current;
      window.setTimeout(() => dismiss(id), kind === "error" ? 6000 : 4000);
    },
    [dismiss]
  );

  const value = useMemo<ToastApi>(
    () => ({
      success: (msg) => push("success", msg),
      error: (msg) => push("error", msg),
      info: (msg) => push("info", msg),
    }),
    [push]
  );

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {/* Fixed viewport, bottom-center above bottom-nav (safe-area aware). */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        <AnimatePresence>
          {items.map((tst) => (
            <motion.div
              key={tst.id}
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: motionTokens.duration.normal, ease: motionTokens.ease.enter }}
              role={tst.kind === "error" ? "alert" : undefined}
              aria-live={tst.kind === "error" ? "assertive" : undefined}
              onTouchStart={(e: TouchEvent<HTMLDivElement>) => { swipeStart.current = { id: tst.id, x: e.touches[0].clientX }; }}
              onTouchMove={(e: TouchEvent<HTMLDivElement>) => {
                const s = swipeStart.current;
                if (s && s.id === tst.id) {
                  const dx = e.touches[0].clientX - s.x;
                  if (Math.abs(dx) > 10) (e.currentTarget as HTMLElement).style.transform = `translateX(${dx}px)`;
                  (e.currentTarget as HTMLElement).style.opacity = `${Math.max(0.2, 1 - Math.abs(dx) / 200)}`;
                }
              }}
              onTouchEnd={(e: TouchEvent<HTMLDivElement>) => {
                const s = swipeStart.current;
                (e.currentTarget as HTMLElement).style.transform = "";
                (e.currentTarget as HTMLElement).style.opacity = "";
                if (s && s.id === tst.id) {
                  const dx = e.changedTouches[0].clientX - s.x;
                  if (Math.abs(dx) > 60) dismiss(tst.id);
                }
                swipeStart.current = null;
              }}
              className={`pointer-events-auto flex min-h-[44px] w-full max-w-sm items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 ${TOAST_KIND_CLASS[tst.kind]} motion-reduce:transition-none`}
            >
              <span aria-hidden>{tst.kind === "success" ? <Check className="h-5 w-5" aria-hidden /> : tst.kind === "error" ? <TriangleAlert className="h-5 w-5" aria-hidden /> : <Info className="h-5 w-5" aria-hidden />}</span>
              <span className="flex-1">{tst.msg}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastCtx);
}

// ── Modal ──
/** Accessible overlay: focus-trapped, scroll-locked, Escape-closable, focus-restoring. */
export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialogRef = useDialogA11y(Boolean(onClose), onClose);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: motionTokens.duration.fast, ease: motionTokens.ease.enter }}
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/40 p-4 sm:items-center motion-reduce:transition-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <motion.div
        ref={dialogRef as unknown as React.RefObject<HTMLDivElement>}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        transition={{ duration: motionTokens.duration.normal, ease: motionTokens.ease.enter }}
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-xl bg-white shadow-xl sm:rounded-xl motion-reduce:transform-none motion-reduce:transition-none"
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 className="text-base font-bold text-stone-800">{title}</h2>
          {onClose && (
            <button type="button" aria-label="Close" onClick={onClose} className="touch-target -mr-2 text-lg text-stone-600 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
              ✕
            </button>
          )}
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && <div className="border-t border-stone-200 px-4 py-3">{footer}</div>}
      </motion.div>
    </motion.div>
  );
}

// ── Confirm dialog ──
export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn>(async () => false);

interface PendingConfirm {
  opts: ConfirmOptions;
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setPending({ opts, resolve });
      }),
    []
  );

  const settle = useCallback((value: boolean) => {
    setPending((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  const dialogRef = useDialogA11y(Boolean(pending), pending ? () => settle(false) : undefined);

  return (
    <>
      <ConfirmCtx.Provider value={confirm}>{children}</ConfirmCtx.Provider>
      {pending && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motionTokens.duration.fast, ease: motionTokens.ease.enter }}
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 sm:items-center motion-reduce:transition-none"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) settle(false);
          }}
        >
          <motion.div
            ref={dialogRef as unknown as React.RefObject<HTMLDivElement>}
            role="dialog"
            aria-modal="true"
            aria-label={pending.opts.title}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: motionTokens.duration.normal, ease: motionTokens.ease.enter }}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl motion-reduce:transform-none motion-reduce:transition-none"
          >
            <h2 className={`text-base font-bold ${pending.opts.danger ? "text-red-700" : "text-stone-800"}`}>{pending.opts.title}</h2>
            {pending.opts.body && <p className="mt-2 text-sm leading-relaxed text-stone-600">{pending.opts.body}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => settle(false)}>
                {pending.opts.cancelLabel ?? "Cancel"}
              </Button>
              <Button variant={pending.opts.danger ? "danger" : "primary"} onClick={() => settle(true)}>
                {pending.opts.confirmLabel ?? "OK"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}

/** useConfirm() → async confirm(opts) resolving true/false; renders an accessible dialog at the app root. */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmCtx);
}

// ── Stepper ──
export interface StepItem {
  label: string;
  state: "done" | "current" | "todo";
}

/** Horizontal stepper; wraps on mobile. done=check green, current=ringed, todo=muted. */
export function Stepper({ steps }: { steps: StepItem[] }) {
  return (
    <ol className="flex flex-wrap items-start gap-x-1 gap-y-3">
      {steps.map((step, i) => (
        <li key={`${step.label}-${i}`} className="flex min-w-[76px] flex-1 flex-col items-center gap-1" aria-current={step.state === "current" ? "step" : undefined}>
          <span
            aria-hidden
            className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold ${
              step.state === "done"
                ? "border-green-700 bg-green-700 text-white"
                : step.state === "current"
                  ? "border-green-600 bg-white text-green-800 ring-2 ring-green-600"
                  : "border-stone-300 bg-white text-stone-500"
            }`}
          >
            {step.state === "done" ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
          </span>
          <span className={`text-center text-[11px] font-medium leading-tight ${step.state === "todo" ? "text-stone-500" : step.state === "done" ? "text-green-800" : "text-stone-700"}`}>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
