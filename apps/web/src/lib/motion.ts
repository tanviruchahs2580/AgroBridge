// Motion tokens — single source of truth for duration, easing, spring
export const motionTokens = {
  duration: {
    fast: 0.15,
    normal: 0.25,
    slow: 0.4,
  },
  ease: {
    enter: [0.16, 1, 0.3, 1] as const,
    exit: [0.4, 0, 1, 1] as const,
    emphasis: [0.2, 0, 0, 1] as const,
  },
  spring: {
    snappy: { type: "spring" as const, stiffness: 400, damping: 30 },
    gentle: { type: "spring" as const, stiffness: 340, damping: 28 },
    soft: { type: "spring" as const, stiffness: 260, damping: 26 },
  },
  press: {
    scale: 0.98,
    duration: 0.12,
  },
} as const;
