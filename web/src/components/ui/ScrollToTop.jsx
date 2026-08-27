import { useState, useEffect, useCallback, useRef } from "react";
import { cx } from "../../util.js";

/**
 * Floating scroll-to-top button with fade + scale animation.
 *
 * @param {Object} props
 * @param {React.RefObject} [props.container] — scrollable container ref (defaults to window)
 * @param {string} [props.className] — positioning classes override
 * @param {"sm"|"md"} [props.size="sm"] — button size
 * @param {number} [props.threshold=200] — px scrolled before button appears
 */
export default function ScrollToTop({
  container,
  className,
  size = "sm",
  threshold = 200,
}) {
  const [scrolled, setScrolled] = useState(false);
  const raf = useRef(null);

  const getScrollTop = useCallback(() => {
    if (container?.current) return container.current.scrollTop;
    return window.scrollY;
  }, [container]);

  const scrollToTop = useCallback(() => {
    if (container?.current) {
      container.current.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [container]);

  useEffect(() => {
    const onScroll = () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        setScrolled(getScrollTop() > threshold);
      });
    };

    const target = container?.current ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [container, threshold, getScrollTop]);

  const dim = size === "md" ? "h-9 w-9" : "h-8 w-8";

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Scroll to top"
      className={cx(
        "flex items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-slate-400 shadow-lg transition-all duration-200 hover:bg-slate-700 hover:text-slate-200",
        dim,
        scrolled
          ? "opacity-100 scale-100"
          : "pointer-events-none opacity-0 scale-90",
        className
      )}
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m18 15-6-6-6 6" />
      </svg>
    </button>
  );
}
