// --------------------------
// TOOLTIP — lightweight CSS tooltip with glossary support.
// Pure CSS, no dependencies. Shows on hover with a small info icon.
// --------------------------
import { useState, useRef, useEffect } from "react";
import { cx } from "../../util";

// ------------------------------------------------------------------
// Tooltip component — wraps children with a hover tooltip
// ------------------------------------------------------------------
export function Tooltip({ children, content, side = "top", className }) {
  const [show, setShow] = useState(false);
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!show || !ref.current) { setPos(null); return; }
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const gap = 6;

    let top, left;
    switch (side) {
      case "top":
        top = rect.top - gap;
        left = rect.left + rect.width / 2;
        break;
      case "bottom":
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2;
        break;
      case "left":
        top = rect.top + rect.height / 2;
        left = rect.left - gap;
        break;
      case "right":
        top = rect.top + rect.height / 2;
        left = rect.right + gap;
        break;
      default:
        top = rect.top - gap;
        left = rect.left + rect.width / 2;
    }
    setPos({ top, left, side });
  }, [show, side]);

  if (!content) return children;

  // Caller can pass positioning utilities (e.g. "absolute right-3 top-3").
  // When they do, skip our default `relative` so the caller's `absolute`
  // wins over our `relative` in Tailwind's CSS source order (`.absolute` is
  // declared before `.relative`, so adding `relative` later overrides it).
  const callerIsPositioned = /\b(?:absolute|fixed|sticky)\b/.test(className || "");
  const wrapClass = cx(
    callerIsPositioned ? "inline-flex" : "relative inline-flex",
    className
  );

  return (
    <span
      ref={ref}
      className={wrapClass}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && pos && (
        <span
          role="tooltip"
          className={cx(
            "pointer-events-none fixed z-[100] max-w-xs rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 shadow-xl",
            "animate-in fade-in-0 zoom-in-95",
            pos.side === "top" && "bottom-auto -translate-x-1/2 -translate-y-full",
            pos.side === "bottom" && "top-auto -translate-x-1/2 translate-y-0",
            pos.side === "left" && "right-auto -translate-x-full -translate-y-1/2",
            pos.side === "right" && "left-auto translate-x-0 -translate-y-1/2"
          )}
          style={{ top: pos.top, left: pos.left }}
        >
          {content}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------
// InfoTip — small (?) icon that shows a tooltip on hover
// ------------------------------------------------------------------
export function InfoTip({ content, side = "top", className }) {
  if (!content) return null;

  return (
    <Tooltip content={content} side={side} className={className}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="More info"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-700/60 text-[10px] text-slate-400 transition-colors hover:bg-slate-600 hover:text-slate-200"
      >
        ?
      </button>
    </Tooltip>
  );
}
