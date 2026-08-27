import { createContext, cloneElement, useCallback, useContext, useEffect, useRef, useState } from "react";
import { cx } from "./helpers";
import ScrollToTop from "./ScrollToTop.jsx";

// ------------------------------------------------------------------
// Modal
// ------------------------------------------------------------------
export function Modal({ open, title, onClose, children, footer, wide, maxScreen = false, closeOnBackdrop = false, closeOnEscape = false }) {
  const dialogRef = useRef(null);
  const scrollRef = useRef(null);
  const previousFocusRef = useRef(null);
  const [progress, setProgress] = useState(0);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.min(100, Math.round((el.scrollTop / max) * 100)) : 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape" && closeOnEscape) onClose();
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    previousFocusRef.current = document.activeElement;
    setProgress(0);
    requestAnimationFrame(() => {
      const focusable = dialogRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable?.length) focusable[0].focus();
    });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocusRef.current?.focus();
    };
  }, [open, onClose, closeOnEscape]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex h-full min-h-dvh w-full items-center justify-center bg-black/60 p-4"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          "w-full overscroll-contain rounded-xl border border-slate-700 bg-slate-900 shadow-2xl max-w-[calc(100vw-2rem)] @container",
          wide ? "md:max-w-3xl" : "md:max-w-lg",
          maxScreen && "flex max-h-[calc(100dvh-2rem)] flex-col"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="text-slate-400 hover:text-slate-100 transition-colors rounded-lg p-1 hover:bg-slate-800">
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div ref={scrollRef} onScroll={handleScroll} className={cx("relative min-h-0 p-5", wide && "max-h-[70vh] overflow-y-auto", maxScreen && "flex-1 overflow-y-auto")}>
          {maxScreen && progress > 0 && (
            <div className="sticky top-0 left-0 z-10 -mx-5 -mt-5 mb-3 h-0.5 bg-slate-800">
              <div
                className="h-full bg-indigo-500 transition-[width] duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          {children}
          {maxScreen && (
            <ScrollToTop container={scrollRef} className="sticky bottom-3 ml-auto" />
          )}
        </div>
        {footer && <div className="flex shrink-0 justify-end gap-2 @max-[360px]:flex-col @max-[360px]:items-stretch border-t border-slate-800 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Tabs
// ------------------------------------------------------------------
export function Tabs({ tabs, active, onChange, children }) {
  return (
    <div>
      <div className="flex gap-1 border-b border-slate-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-selected={active === tab.id}
            role="tab"
            className={cx(
              "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors -mb-px",
              active === tab.id
                ? "border-indigo-500 text-indigo-300"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600"
            )}
          >
            {tab.icon && <span className="shrink-0">{tab.icon}</span>}
            {tab.label}
          </button>
        ))}
      </div>
      <div className="pt-5">{children}</div>
    </div>
  );
}

export function TabPanel({ id, active, children }) {
  if (id !== active) return null;
  return <div role="tabpanel">{children}</div>;
}

// ------------------------------------------------------------------
// Popover — lightweight CSS dropdown (zero dependencies)
// ------------------------------------------------------------------
const PopoverCtx = createContext(null);

export function Popover({ children }) {
  const [open, setOpen] = useState(false);
  // Outside-click guard lives here (wrapping BOTH trigger and content): the
  // content renders outside the trigger element, so a trigger-scoped guard
  // would close the popover on mousedown before the item's click ever fires.
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <PopoverCtx.Provider value={{ open, setOpen }}>
      <div ref={ref} className="relative w-full">{children}</div>
    </PopoverCtx.Provider>
  );
}

export function PopoverTrigger({ children, asChild }) {
  const { open, setOpen } = useContext(PopoverCtx);

  if (asChild && children) {
    return (
      <span>
        {cloneElement(children, {
          onClick: (e) => {
            setOpen(!open);
            children.props?.onClick?.(e);
          },
          "aria-expanded": open,
        })}
      </span>
    );
  }

  return (
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
      {children}
    </button>
  );
}

export function PopoverContent({ children, align = "start", sideOffset = 8, side = "bottom", className }) {
  const { open, setOpen } = useContext(PopoverCtx);
  const ref = useRef(null);

  useEffect(() => {
    if (!open || !ref.current) return;
    const first = ref.current.querySelector("[role=menuitem], button, a");
    if (first) requestAnimationFrame(() => first.focus());
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="menu"
      className={cx(
        "absolute z-50 min-w-[10rem] rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-xl",
        "animate-in fade-in zoom-in-95 duration-100",
        align === "end" ? "right-0" : "left-0",
        className
      )}
      style={{ [side === "top" ? "marginBottom" : "marginTop"]: `${sideOffset}px`, [side === "top" ? "bottom" : "top"]: "100%" }}
      onClick={(e) => {
        if (e.target.closest("[role=menuitem]")) setOpen(false);
      }}
    >
      {children}
    </div>
  );
}

export function PopoverItem({ children, onClick, className }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => onClick?.(e)}
      className={cx(
        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300",
        "transition-colors hover:bg-slate-800 hover:text-slate-100",
        "focus:bg-slate-800 focus:text-slate-100 focus:outline-none",
        "group",
        className
      )}
    >
      {children}
    </button>
  );
}

export function PopoverSeparator() {
  return <div className="my-1 h-px bg-slate-800" />;
}
