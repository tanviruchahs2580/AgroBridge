import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { motionTokens } from "../lib/motion.js";

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: motionTokens.duration.normal, ease: motionTokens.ease.enter }}
      className="motion-reduce:transform-none motion-reduce:transition-none"
    >
      {children}
    </motion.div>
  );
}
