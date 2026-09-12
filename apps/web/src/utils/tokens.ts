// AgroBridge Enterprise Design Tokens — Single Source of Truth
// Semantic naming, no scattered hex values. For Tailwind, see tailwind.config.js and tokens.css

export const tokens = {
  color: {
    // Brand
    brand: {
      50: "var(--color-brand-50)",
      100: "var(--color-brand-100)",
      200: "var(--color-brand-200)",
      300: "var(--color-brand-300)",
      400: "var(--color-brand-400)",
      500: "var(--color-brand-500)",
      600: "var(--color-brand-600)",
      700: "var(--color-brand-700)",
      800: "var(--color-brand-800)",
      900: "var(--color-brand-900)",
      950: "var(--color-brand-950)",
    },
    // Semantic surface
    surface: {
      bg: "var(--color-surface-bg)",
      card: "var(--color-surface-card)",
      border: "var(--color-surface-border)",
      muted: "var(--color-surface-muted)",
    },
    // Text hierarchy
    text: {
      primary: "var(--text-primary)",
      strong: "var(--text-strong)",
      secondary: "var(--text-secondary)",
      tertiary: "var(--text-tertiary)",
      muted: "var(--text-muted)",
      disabled: "var(--text-disabled)",
      inverse: "var(--text-on-light)",
    },
    // Semantic status
    success: { bg: "var(--color-success-bg)", border: "var(--color-success-border)", text: "var(--color-success-text)" },
    warning: { bg: "var(--color-warning-bg)", border: "var(--color-warning-border)", text: "var(--color-warning-text)" },
    danger: { bg: "var(--color-danger-bg)", border: "var(--color-danger-border)", text: "var(--color-danger-text)" },
    info: { bg: "var(--color-info-bg)" },
  },
  spacing: {
    1: "var(--space-1)",
    2: "var(--space-2)",
    3: "var(--space-3)",
    4: "var(--space-4)",
    6: "var(--space-6)",
    8: "var(--space-8)",
    12: "3rem",
    16: "4rem",
  },
  radius: {
    lg: "var(--radius-lg)",
    xl: "var(--radius-xl)",
    "2xl": "var(--radius-2xl)",
    card: "var(--radius-card)",
    button: "var(--radius-button)",
    chip: "var(--radius-chip)",
    iconBox: "var(--radius-iconBox)",
  },
  shadow: {
    sm: "var(--shadow-sm)",
    md: "var(--shadow-md)",
    lg: "var(--shadow-lg)",
    card: "var(--shadow-card)",
    cardHover: "var(--shadow-cardHover)",
    button: "var(--shadow-button)",
  },
  motion: {
    duration: { fast: 0.15, normal: 0.25, slow: 0.4 },
    ease: { enter: [0.16, 1, 0.3, 1] as const, exit: [0.4, 0, 1, 1] as const },
    spring: {
      snappy: { type: "spring" as const, stiffness: 400, damping: 30 },
      gentle: { type: "spring" as const, stiffness: 340, damping: 28 },
    },
  },
  breakpoint: {
    sm: "640px",
    md: "768px",
    lg: "1024px",
    xl: "1280px",
    "2xl": "1536px",
  },
  z: {
    header: 10,
    nav: 20,
    modal: 50,
    toast: 60,
  },
} as const;
