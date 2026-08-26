import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes } from "react";
import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

// ── Design tokens (Tailwind-based) ──
// Primary green scale: brand-50..800 (see tailwind.config.js)
// Neutrals: stone-*, Focus: ring-green-200, Radius: lg/xl, Elevation: shadow-sm/md

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

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
  const base = "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
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
    <button ref={ref} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={disabled || loading} {...props}>
      {loading ? "..." : children}
    </button>
  );
});

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl border border-stone-200 bg-white p-4 shadow-sm ${className}`} {...props} />;
}

export function Label({ className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`mb-1 block text-sm font-medium text-stone-700 ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-200 disabled:bg-stone-50 ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-200 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Badge({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`inline-block rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-semibold text-stone-600 ${className}`} {...props} />;
}

export function Skeleton({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`animate-pulse rounded-lg bg-stone-200 ${className}`} {...props} />;
}

export function EmptyState({
  icon = "📭",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 py-8 text-center shadow-sm">
      <div className="text-3xl" aria-hidden>{icon}</div>
      <h3 className="text-sm font-semibold text-stone-700">{title}</h3>
      {description && <p className="max-w-sm text-sm text-stone-500">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorBanner({ code, message }: { code?: string; message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <span>{message}</span>
      {code && <span className="ml-2 font-mono text-xs text-red-600">[{code}]</span>}
    </div>
  );
}

// ── Navigation shells (Sprint A2) ──
export function BottomNav({ items }: { items: { to: string; label: string; icon: string; badge?: boolean }[] }) {
  if (import.meta.env.VITE_FEATURE_NEW_SHELL === "false") return null;
  return (
    <nav aria-label="Primary navigation" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-stone-200 bg-white/95 backdrop-blur md:hidden">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${isActive ? "text-green-700" : "text-stone-600 hover:text-green-700"}`
          }
          style={{ minHeight: 44 }}
        >
          <span aria-hidden className="relative text-base">
            {it.icon}
            {it.badge && <span className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />}
          </span>
          <span>{it.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function Sidebar({ items }: { items: { to: string; label: string; icon: string }[] }) {
  if (import.meta.env.VITE_FEATURE_NEW_SHELL === "false") return null;
  return (
    <aside className="hidden w-56 shrink-0 border-r border-stone-200 bg-white md:block">
      <nav className="sticky top-[57px] space-y-1 p-3">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${isActive ? "bg-green-700 text-white" : "text-stone-700 hover:bg-green-50"}`
            }
          >
            <span aria-hidden>{it.icon}</span>
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
  success: "bg-green-800",
  error: "bg-red-600",
  info: "bg-stone-800",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

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
      {/* Fixed viewport, bottom-center above bottom-nav (bottom-20 mobile / bottom-6 desktop). */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((tst) => (
          <div
            key={tst.id}
            role={tst.kind === "error" ? "alert" : undefined}
            aria-live={tst.kind === "error" ? "assertive" : undefined}
            className={`pointer-events-auto flex min-h-[44px] w-full max-w-sm items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-200 ${TOAST_KIND_CLASS[tst.kind]}`}
          >
            <span aria-hidden>{tst.kind === "success" ? "✓" : tst.kind === "error" ? "⚠" : "ℹ"}</span>
            <span className="flex-1">{tst.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastCtx);
}

// ── Modal ──
/** Simple overlay container used by ConfirmDialog and available for wizards. */
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
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-xl bg-white shadow-xl sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 className="text-base font-bold text-stone-800">{title}</h2>
          {onClose && (
            <button type="button" aria-label="Close" onClick={onClose} className="touch-target -mr-2 text-lg text-stone-500 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
              ✕
            </button>
          )}
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && <div className="border-t border-stone-200 px-4 py-3">{footer}</div>}
      </div>
    </div>
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
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

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

  useEffect(() => {
    if (pending) confirmBtnRef.current?.focus();
  }, [pending]);

  return (
    <>
      <ConfirmCtx.Provider value={confirm}>{children}</ConfirmCtx.Provider>
      {pending && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) settle(false);
          }}
        >
          <div role="dialog" aria-modal="true" aria-label={pending.opts.title} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className={`text-base font-bold ${pending.opts.danger ? "text-red-700" : "text-stone-800"}`}>{pending.opts.title}</h2>
            {pending.opts.body && <p className="mt-2 text-sm leading-relaxed text-stone-600">{pending.opts.body}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => settle(false)}>
                {pending.opts.cancelLabel ?? "Cancel"}
              </Button>
              <Button ref={confirmBtnRef} variant={pending.opts.danger ? "danger" : "primary"} onClick={() => settle(true)}>
                {pending.opts.confirmLabel ?? "OK"}
              </Button>
            </div>
          </div>
        </div>
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

/** Horizontal stepper; wraps on mobile. done=✓ green, current=ringed, todo=muted. */
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
                  ? "border-green-600 bg-white text-green-800 ring-2 ring-green-200"
                  : "border-stone-300 bg-white text-stone-400"
            }`}
          >
            {step.state === "done" ? "✓" : i + 1}
          </span>
          <span className={`text-center text-[11px] font-medium leading-tight ${step.state === "todo" ? "text-stone-400" : step.state === "done" ? "text-green-800" : "text-stone-700"}`}>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
