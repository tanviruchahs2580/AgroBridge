import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";

// ── Design tokens (Tailwind-based) ──
// Primary green scale: brand-50..800 (see tailwind.config.js)
// Neutrals: stone-*, Focus: ring-green-200, Radius: lg/xl, Elevation: shadow-sm/md

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
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
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={disabled || loading} {...props}>
      {loading ? "..." : children}
    </button>
  );
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl border border-stone-200 bg-white p-4 shadow-sm ${className}`} {...props} />;
}

export function Label({ className = "", ...props }: HTMLAttributes<HTMLLabelElement>) {
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
    <div className="card flex flex-col items-center gap-3 py-8 text-center">
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
