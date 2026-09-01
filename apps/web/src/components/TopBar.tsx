import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { motionTokens } from "../lib/motion.js";

export function TopBar() {
  const location = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 400);
    return () => clearTimeout(t);
  }, [location.pathname]);

  return (
    <div className="pointer-events-none fixed top-0 inset-x-0 z-[100] h-[2px]">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ scaleX: 0, opacity: 1 }}
            animate={{ scaleX: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.duration.slow, ease: motionTokens.ease.enter }}
            className="h-full w-full origin-left bg-[#15803D] motion-reduce:transition-none"
            style={{ transformOrigin: "left" }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
