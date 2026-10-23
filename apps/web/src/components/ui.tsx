import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TouchEvent } from "react";
import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Inbox, Info, TriangleAlert, X } from "lucide-react";
import { NavLink } from "react-router-dom";
// `m` (not `motion`): features come from the root LazyMotion in main.tsx, so the
// full motion component stays out of the initial bundle. Same component, same
// animations — see the bundle note in main.tsx.
import { m, AnimatePresence } from "framer-motion";
import { motionTokens } from "../lib/motion";
import { t } from "../lib/i18n";
import type { Lang } from "../lib/i18n";

// ── Design System v2 — Enterprise Tokens (single source of truth: tokens.css) ──
// Colors: brand/stone ramps + surface system + action/link/accent semantics + status triplets.
// Spacing: 4/8pt grid · Radius: lg/xl/2xl/card/button/input/chip/iconBox · Elevation: sm→float.
// Motion: fast 0.15 normal 0.25 slow 0.4, press 0.98 — see src/lib/tokens.ts + src/lib/motion.ts.

// ── UI language for primitive-owned copy ──
// A few primitives own copy of their own (the error banner's copy button, a
// dialog's close label). Those defaults used to be English literals, so every
// screen that did not pass a label showed English chrome on a Bengali page.
// The language is published by App once and read here, rather than importing the
// session context — `lib/session.tsx` already imports `useToast` from this file,
// and a second import in the other direction would make the cycle load-order
// dependent.
const UiLangCtx = createContext<Lang>("bn");

export function UiLangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <UiLangCtx.Provider value={lang}>{children}</UiLangCtx.Provider>;
}

/** Current UI language, for primitives that own user-visible copy. */
export function useUiLang(): Lang {
  return useContext(UiLangCtx);
}

type ButtonVariant = "primary" | "cta" | "soft" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

/** Accessible spinner used for loading states (replaces bare "…" text).*/
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-90" />
    </svg>
  );
}

/** Focusable-query helper for modal focus trapping.*/
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
  // Read the callback through a ref: the effect must depend on `open` alone. Callers
  // pass inline closures, and re-running this setup resets focus to the dialog's first
  // focusable element — which stole focus on every keystroke in dialogs whose state
  // updates as the user types (the withdraw amount field, the booking form).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement;
    const prevOverflow = document.body.style.overflow;
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarW > 0) document.body.style.paddingRight = `${scrollbarW}px`;
    // Make the app chrome inert while the dialog is open. Inerting #main alone left the
    // header, sidebar, bottom nav and skip link reachable to assistive technology behind
    // an aria-modal dialog. The selectors are listed rather than blanket-inerting the
    // body's children because the confirm dialog renders inside the React tree (only the
    // Modal uses a portal), so blanketing would have inerted the dialog itself.
    // `!el.contains(container)` is the safeguard for the mirror case: a dialog rendered
    // inside one of these regions must never be inerted by its own open effect.
    const container = containerRef.current;
    const chrome = Array.from(
      document.querySelectorAll<HTMLElement>("#main, header, nav[aria-label], aside, a[href='#main']"),
    ).filter((el) => !container || !el.contains(container));
    const marked = chrome.filter((el) => !el.hasAttribute("inert"));
    for (const el of marked) el.setAttribute("inert", "");

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
      if (e.key === "Escape" && onCloseRef.current) onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = "";
      for (const el of marked) el.removeAttribute("inert");
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

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
  // Disabled buttons keep WCAG AA contrast. The old treatment was
  // `disabled:opacity-50`, which blends BOTH the variant background and its
  // white label toward the page — measured 2.1–2.4:1, and axe caught it on the
  // out-of-stock "Add to cart" state of the market list (data-dependent, so it
  // only failed some runs; the state itself is always a violation). The
  // token-based muted surface keeps the intent — clearly unavailable — at a
  // measured 6.8:1 (stone-600 on surface-subdued; stone-500 sits at 4.3:1 and
  // would still miss the 4.5 floor for this label size), and the shadow drops
  // so a disabled control does not float above the card.
  const base = "inline-flex items-center justify-center gap-2 rounded-button font-semibold transition-[transform,background-color,box-shadow,filter] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)] disabled:cursor-not-allowed disabled:bg-surface-subdued disabled:text-stone-600 disabled:shadow-none disabled:hover:brightness-100 motion-reduce:transition-none motion-reduce:active:scale-100";
  const sizes: Record<ButtonSize, string> = {
    // `sm` keeps the compact text/padding but not a compact hit area: at 36px it
    // was the one control in the system that did not meet the 44px target the
    // rest of the app enforces with min-h-[44px] (and that IconButton guarantees).
    // It is the size used for farm actions, admin approve/reject, mark-all-read
    // and booking cancel — all reachable on a phone.
    sm: "min-h-[44px] px-3 py-1.5 text-xs",
    md: "min-h-[44px] px-4 py-2.5 text-sm",
    lg: "min-h-[48px] px-6 py-3 text-base",
  };
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-action text-white shadow-button hover:bg-action-hover active:bg-action-active",
    cta: "bg-cta text-white shadow-button hover:brightness-[1.04] active:brightness-95 motion-reduce:hover:brightness-100",
    soft: "bg-brand-50 text-accent hover:bg-brand-100 ring-1 ring-inset ring-brand-100",
    outline: "border border-brand-300 text-link hover:bg-brand-50 hover:border-brand-400",
    ghost: "text-stone-600 hover:bg-stone-100",
    // `critical-strong`, not `critical`: the accent token measured 3.77:1 behind
    // this variant's white label (2.5:1 in dark mode) — below the 4.5:1 WCAG 2.2 AA
    // minimum for the label sizes these destructive controls carry. axe never
    // caught it because a danger button is only on screen while a confirmation
    // dialog is open, which the route scans do not open.
    danger: "bg-enterprise-critical-strong text-white shadow-button hover:brightness-110 active:brightness-95 motion-reduce:hover:brightness-100",
  };
  return (
    <button ref={ref} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <Spinner className="h-4 w-4" /> : children}
    </button>
  );
});

/** Square icon-only button with a guaranteed 44px touch target.*/
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "ghost" | "outline" | "soft"; label: string }>(function IconButton(
  { variant = "ghost", label, className = "", children, ...props },
  ref
) {
  const variants = {
    ghost: "text-stone-600 hover:bg-stone-100",
    outline: "border border-surface-border-strong text-stone-700 hover:bg-stone-100 bg-surface-card",
    soft: "bg-brand-50 text-link hover:bg-brand-100",
  } as const;
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)] motion-reduce:transition-none ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});

/**
 * Surface card. Variants:
 *  - default: elevated + hover lift (tap/clickable surfaces)
 *  - static:  no hover motion (dense lists, read-only panels)
 *  - subdued: quiet secondary panel inside a card/page
 * padded={false} removes the panel padding for edge-to-edge list rows
 * (the rows then supply their own spacing) instead of `!p-0` overrides.
 */
export function Card({
  className = "",
  variant = "default",
  padded = true,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: "default" | "static" | "subdued"; padded?: boolean }) {
  const variants = {
    default:
      "rounded-card border border-surface-border bg-surface-card shadow-card transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-cardHover motion-reduce:transition-none motion-reduce:hover:translate-y-0",
    static: "rounded-card border border-surface-border bg-surface-card shadow-card",
    subdued: "rounded-card border border-surface-border bg-surface-subdued",
  } as const;
  return <div className={`${variants[variant]} ${padded ? "p-4" : ""} ${className}`} {...props} />;
}

export function Label({ className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`mb-1 block text-sm font-medium text-stone-700 ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const isInvalid = props["aria-invalid"] === true || props["aria-invalid"] === "true";
  return (
    <input
      // Placeholder text is real text to WCAG: stone-400 on white sits at 2.4:1,
      // so the shared input uses stone-500 (4.7:1) even though axe cannot see
      //:placeholder and would never flag it.
      className={`w-full rounded-input border border-surface-border-strong bg-surface-card px-3 py-2.5 text-base text-stone-800 shadow-sm transition-[border-color,box-shadow,transform] placeholder:text-stone-500 focus:border-brand-500 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)] disabled:bg-stone-100 motion-reduce:transition-none ${isInvalid ? "animate-shake border-danger-border" : ""} ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const isInvalid = props["aria-invalid"] === true || props["aria-invalid"] === "true";
  return (
    <select
      className={`w-full rounded-input border border-surface-border-strong bg-surface-card px-3 py-2.5 text-base text-stone-800 shadow-sm transition-[border-color,box-shadow] focus:border-brand-500 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)] motion-reduce:transition-none ${isInvalid ? "animate-shake border-danger-border" : ""} ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

/** Label + control + hint/error composite — the house form pattern.*/
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className = "",
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-enterprise-critical" aria-hidden> *</span>}
      </Label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
      {/* The error is a real element with the id call sites already point at
          (`aria-describedby="<field-id>-err"`, used by Login/Register/Reset/
          SellCrop). Without the id those thirteen attributes referenced
          nothing, so the field → error association WCAG expects was missing
          even though role="alert" still announced the message. */}
      {error && (
        <p id={htmlFor ? `${htmlFor}-err` : undefined} role="alert" className="mt-1 text-xs font-medium text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

export type BadgeTone = "default" | "brand" | "success" | "warning" | "danger" | "info" | "ai" | "outline";

export function Badge({ className = "", tone = "default", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  const tones: Record<BadgeTone, string> = {
    default: "bg-stone-100 text-stone-700",
    brand: "bg-brand-50 text-accent ring-1 ring-inset ring-brand-100",
    success: "bg-success-bg text-success-text ring-1 ring-inset ring-success-border",
    warning: "bg-warning-bg text-warning-text ring-1 ring-inset ring-warning-border",
    danger: "bg-danger-bg text-danger-text ring-1 ring-inset ring-danger-border",
    info: "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200",
    ai: "bg-enterprise-ai-light text-enterprise-ai ring-1 ring-inset ring-indigo-200",
    outline: "border border-surface-border-strong text-stone-600",
  };
  return <span className={`inline-flex items-center gap-1 rounded-chip px-2.5 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`} {...props} />;
}

export function Skeleton({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={`skeleton-shimmer rounded-xl ${className}`} {...props} />;
}

/**
 * Page-level or section-level "nothing here yet".
 *
 * `headingLevel` defaults to 2 because every page-level empty state sits directly
 * under the page's `h1`, and a hardcoded `h3` made those screens skip a level
 * (axe `heading-order`). The four call sites that render inside a section which
 * already has its own `h2` — the wallet ledger and withdrawals, the checkout
 * cart step, and the bookings block — pass 3 and keep the old outline.
 */
export function EmptyState({
  icon = <Inbox className="h-7 w-7 text-brand-600" aria-hidden />,
  title,
  description,
  action,
  headingLevel = 2,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-surface-border bg-surface-card p-4 py-10 text-center shadow-card">
      <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 ring-1 ring-inset ring-brand-100">
        {icon}
      </span>
      <Heading className="text-base font-bold text-stone-800">{title}</Heading>
      {description && <p className="max-w-sm text-sm leading-relaxed text-stone-600">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorBanner({
  code,
  message,
  copyLabel,
  copiedLabel,
}: {
  code?: string;
  message: string;
  copyLabel?: string;
  copiedLabel?: string;
}) {
  const lang = useUiLang();
  // Defaulted from the dictionary instead of English literals: fourteen call
  // sites omit these props, and they were the only English text on those screens.
  const resolvedCopy = copyLabel ?? t("errCopy", lang);
  const resolvedCopied = copiedLabel ?? t("errCopied", lang);
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
    <div role="alert" className="flex items-center justify-between gap-2 rounded-input border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-text">
      <span className="flex min-w-0 items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0">
          {message}
          {code && <span className="ml-2 font-mono text-xs opacity-80">[{code}]</span>}
        </span>
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        className="shrink-0 min-h-[44px] rounded-lg border border-danger-border bg-surface-card px-2.5 py-2 text-xs font-semibold text-danger-text hover:bg-danger-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
      >
        {copied ? resolvedCopied : resolvedCopy}
      </button>
    </div>
  );
}

/**
 * A failed read plus its retry — the house pattern for a screen whose data did
 * not arrive. Nine screens had their own byte-identical copy of this; it lives
 * here so the retry affordance has one definition to change.
 * Renders nothing when there is no error, so call sites can drop it inline.
 */
export function BlockError({ error, retryLabel, onRetry }: { error: string | null | undefined; retryLabel: string; onRetry: () => void }) {
  if (!error) return null;
  return (
    <div className="space-y-2">
      <ErrorBanner message={error} />
      <Button variant="outline" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

// ── Navigation shells — Enterprise Refinement ──
/** `ariaLabel` is passed in rather than hardcoded: the shell must not announce
 * an English landmark name on a Bengali screen (App.tsx supplies the copy).
 * `badgeLabel` names what the dot means, and is rendered *outside* the
 * `aria-hidden` icon span — inside it, the text was invisible to assistive
 * technology and the badge became colour-only, and it also said "new
 * notifications" on a tab whose badge is the offline write queue. */
export function BottomNav({
  items,
  ariaLabel,
}: {
  items: { to: string; label: string; icon: ReactNode; badge?: boolean; badgeLabel?: string }[];
  ariaLabel: string;
}) {
  if (import.meta.env.VITE_FEATURE_NEW_SHELL === "false") return null;
  return (
    <nav
      aria-label={ariaLabel}
      data-testid="bottom-nav"
      className="fixed inset-x-2 bottom-3 z-20 flex rounded-2xl border border-surface-border bg-[var(--glass-nav)] p-1 shadow-float backdrop-blur-md md:hidden"
      style={{ paddingBottom: "calc(0.25rem + env(safe-area-inset-bottom))" }}
    >
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] ${
              isActive ? "bg-brand-50 text-accent shadow-sm ring-1 ring-inset ring-brand-100" : "text-stone-600 hover:bg-stone-100 hover:text-link"
            }`
          }
          style={{ minHeight: 44 }}
        >
          <span aria-hidden className="relative text-lg">
            {it.icon}
            {it.badge && (
              <span className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-enterprise-critical ring-2 ring-[var(--color-surface-card)]" />
            )}
          </span>
          <span className="leading-none tracking-[-0.01em]">{it.label}</span>
          {it.badge && it.badgeLabel && <span className="sr-only">{it.badgeLabel}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

/** `ariaLabel` mirrors BottomNav: the two `nav` landmarks must be distinguishable. */
export function Sidebar({ items, ariaLabel }: { items: { to: string; label: string; icon: ReactNode }[]; ariaLabel: string }) {
  if (import.meta.env.VITE_FEATURE_NEW_SHELL === "false") return null;
  return (
    <aside className="hidden w-60 shrink-0 border-r border-surface-border bg-[var(--glass-nav)] backdrop-blur-sm md:block">
      <nav aria-label={ariaLabel} data-testid="sidebar-nav" className="sticky top-[var(--shell-header-offset)] space-y-1 p-3">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium tracking-[-0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] ${
                isActive ? "bg-action text-white shadow-button" : "text-stone-700 hover:bg-brand-50 hover:text-accent"
              }`
            }
          >
            <span aria-hidden className="text-lg">{it.icon}</span>
            <span>{it.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

// ── Page furniture ──
/** Consistent page header: title + optional subtitle + trailing action slot.*/
export function PageHeader({
  title,
  subtitle,
  icon,
  action,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-4 flex items-start justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && (
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-iconBox bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-extrabold tracking-[-0.01em] text-stone-800">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-xs text-stone-500">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Small section heading with optional trailing action (e.g. "See all ›").*/
export function SectionHeader({ title, action, className = "" }: { title: string; action?: ReactNode; className?: string }) {
  return (
    <div className={`mb-2.5 flex items-center justify-between gap-2 ${className}`}>
      <h2 className="text-sm font-bold uppercase tracking-[0.04em] text-stone-500">{title}</h2>
      {action}
    </div>
  );
}

/** Compact metric tile: icon + value + label, tinted by tone.*/
export function StatTile({
  icon,
  value,
  label,
  tone = "brand",
  className = "",
}: {
  icon: ReactNode;
  value: string;
  label: string;
  tone?: "brand" | "sky" | "ai" | "warning" | "success" | "danger";
  className?: string;
}) {
  const tones = {
    brand: "bg-brand-50 text-brand-700 ring-brand-100",
    sky: "bg-sky-50 text-sky-600 ring-sky-100",
    ai: "bg-enterprise-ai-light text-enterprise-ai ring-indigo-100",
    warning: "bg-warning-bg text-warning-text ring-warning-border",
    success: "bg-success-bg text-success-text ring-success-border",
    danger: "bg-danger-bg text-danger-text ring-danger-border",
  } as const;
  return (
    <div className={`flex items-center gap-3 rounded-card border border-surface-border bg-surface-card p-3.5 shadow-card ${className}`}>
      <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-iconBox ring-1 ring-inset ${tones[tone]}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="truncate text-lg font-extrabold leading-6 tracking-[-0.01em] text-stone-800">{value}</div>
        <div className="truncate text-xs text-stone-500">{label}</div>
      </div>
    </div>
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
  success: "border border-success-border bg-success-bg text-success-text",
  error: "border border-danger-border bg-danger-bg text-danger-text",
  info: "border border-info-border bg-info-bg text-info-text",
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
      {/* Fixed viewport, bottom-center above bottom-nav (safe-area aware).
          The container is NOT a live region: it used to be `aria-live="polite"`
          while each error toast also carried `role="alert"` + `aria-live=
          "assertive"`, so errors sat inside two nested live regions and could be
          announced twice. Each toast now owns exactly one role, which is what
          decides politeness (`alert` = assertive, `status` = polite). */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        <AnimatePresence>
          {items.map((tst) => (
            <m.div
              key={tst.id}
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: motionTokens.duration.normal, ease: motionTokens.ease.enter }}
              role={tst.kind === "error" ? "alert" : "status"}
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
              className={`pointer-events-auto flex min-h-[44px] w-full max-w-sm items-center gap-2.5 rounded-input px-4 py-3 text-sm font-medium shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)] backdrop-blur-sm ${TOAST_KIND_CLASS[tst.kind]} motion-reduce:transition-none`}
            >
              <span aria-hidden>{tst.kind === "success" ? <Check className="h-5 w-5" aria-hidden /> : tst.kind === "error" ? <TriangleAlert className="h-5 w-5" aria-hidden /> : <Info className="h-5 w-5" aria-hidden />}</span>
              <span className="flex-1">{tst.msg}</span>
            </m.div>
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
/** Accessible overlay: focus-trapped, scroll-locked, Escape-closable, focus-restoring.
 *  Rendered through a portal to document.body: pages are free to use transform-bearing
 *  entrance animations (which create stacking contexts) and `useDialogA11y` marks `#main`
 *  inert while open — an inline modal inside `#main` would trap itself (unclickable)
 * and paint below the fixed nav layers.*/
export function Modal({
  title,
  onClose,
  closeLabel,
  children,
  footer,
}: {
  title: string;
  onClose?: () => void;
  closeLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const lang = useUiLang();
  // `true`, not `Boolean(onClose)`: the dialog a11y behaviour must follow whether
  // the dialog is *open*, not whether it happens to be closable. The checkout
  // wizard passes no onClose for its intermediate steps, and gating on
  // closability left those steps rendered as `aria-modal="true"` with no focus
  // trap, no initial focus and no focus restore — the header, nav and page
  // behind stayed reachable. Every call site mounts this conditionally, so a
  // mounted Modal is an open Modal.
  const dialogRef = useDialogA11y(true, onClose);
  return createPortal(
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: motionTokens.duration.fast, ease: motionTokens.ease.enter }}
      className="fixed inset-0 z-[65] flex items-end justify-center bg-surface-overlay p-4 backdrop-blur-[2px] sm:items-center motion-reduce:transition-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <m.div
        ref={dialogRef as unknown as React.RefObject<HTMLDivElement>}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        transition={{ duration: motionTokens.duration.normal, ease: motionTokens.ease.enter }}
        className="flex max-h-[95vh] w-full max-w-md flex-col rounded-t-card bg-surface-card shadow-float sm:rounded-card motion-reduce:transform-none motion-reduce:transition-none"
      >
        <div className="flex items-center justify-between gap-2 border-b border-surface-border px-4 py-3">
          <h2 className="text-base font-bold text-stone-800">{title}</h2>
          {onClose && (
            <IconButton label={closeLabel ?? t("close", lang)} onClick={onClose} className="-mr-2" variant="ghost">
              <X className="h-5 w-5" aria-hidden />
            </IconButton>
          )}
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && <div className="border-t border-surface-border px-4 py-3">{footer}</div>}
      </m.div>
    </m.div>,
    document.body
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
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motionTokens.duration.fast, ease: motionTokens.ease.enter }}
          className="fixed inset-0 z-[70] flex items-end justify-center bg-surface-overlay p-4 backdrop-blur-[2px] sm:items-center motion-reduce:transition-none"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) settle(false);
          }}
        >
          <m.div
            ref={dialogRef as unknown as React.RefObject<HTMLDivElement>}
            role="dialog"
            aria-modal="true"
            aria-label={pending.opts.title}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: motionTokens.duration.normal, ease: motionTokens.ease.enter }}
            className="w-full max-w-md rounded-card bg-surface-card p-5 shadow-float motion-reduce:transform-none motion-reduce:transition-none"
          >
            {pending.opts.danger && (
              <span aria-hidden className="mb-3 flex h-11 w-11 items-center justify-center rounded-iconBox bg-danger-bg text-danger-text ring-1 ring-inset ring-danger-border">
                <TriangleAlert className="h-5 w-5" />
              </span>
            )}
            <h2 className={`text-base font-bold ${pending.opts.danger ? "text-danger-text" : "text-stone-800"}`}>{pending.opts.title}</h2>
            {pending.opts.body && <p className="mt-2 text-sm leading-relaxed text-stone-600">{pending.opts.body}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => settle(false)}>
                {pending.opts.cancelLabel ?? "Cancel"}
              </Button>
              <Button variant={pending.opts.danger ? "danger" : "primary"} onClick={() => settle(true)}>
                {pending.opts.confirmLabel ?? "OK"}
              </Button>
            </div>
          </m.div>
        </m.div>
      )}
    </>
  );
}

/** useConfirm → async confirm(opts) resolving true/false; renders an accessible dialog at the app root.*/
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmCtx);
}

// ── Stepper ──
export interface StepItem {
  label: string;
  state: "done" | "current" | "todo";
}

/** Horizontal stepper; wraps on mobile. done=check filled, current=ringed, todo=muted.*/
export function Stepper({ steps }: { steps: StepItem[] }) {
  return (
    <ol className="flex flex-wrap items-start gap-x-1 gap-y-3">
      {steps.map((step, i) => (
        <li key={`${step.label}-${i}`} className="flex min-w-[76px] flex-1 flex-col items-center gap-1.5" aria-current={step.state === "current" ? "step" : undefined}>
          <span
            aria-hidden
            className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold transition-colors ${
              step.state === "done"
                ? "border-action bg-action text-white"
                : step.state === "current"
                  ? "border-brand-500 bg-surface-card text-accent ring-[3px] ring-brand-100"
                  : "border-surface-border-strong bg-surface-card text-stone-500"
            }`}
          >
            {step.state === "done" ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
          </span>
          {/* Todo labels are step names, not decoration — stone-500 keeps them
 legible on white (stone-400 was 2.4:1 and failed AA).*/}
          <span className={`text-center text-xs font-medium leading-tight ${step.state === "todo" ? "text-stone-500" : step.state === "done" ? "text-success-text" : "text-stone-700"}`}>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
