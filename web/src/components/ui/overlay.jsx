import { createContext, cloneElement, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "./helpers";
import ScrollToTop from "./ScrollToTop.jsx";

// ------------------------------------------------------------------
// Modal
// ------------------------------------------------------------------
export function Modal({ open, title, onClose, children, footer, wide, maxScreen = false, closeOnBackdrop = false, closeOnEscape = false }) {
  const dialogRef = useRef(null);
  const scrollRef = useRef(null);
  const previousFocusRef = useRef(null);
  // Callers pass inline onClose arrows, which get a NEW identity on every
  // parent render. If onClose were an effect dependency, the effect would
  // re-run on every keystroke inside the dialog and its requestAnimationFrame
  // below would steal focus from the input the user is typing in (cursor jumps
  // to the first focusable — e.g. the Close button). Hold the latest onClose
  // in a ref so the effect only runs when the modal actually opens/closes.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape" && closeOnEscape) onCloseRef.current();
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
  }, [open, closeOnEscape]);

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
          // Material dialog (Apple-style): light-catching top edge, layered
          // depth shadow, subtle enter animation. The scrim + blur reads as a
          // dimmed, pushed-back parent layer (§12).
          "w-full overscroll-contain rounded-xl border border-slate-700 border-t-slate-500/40 bg-slate-900 shadow-[0_24px_60px_-12px_rgb(0_0_0/0.55)] max-w-[calc(100vw-2rem)] @container modal-pop-in",
          wide ? "md:max-w-3xl" : "md:max-w-lg",
          // Viewport-clamped by default: a dialog taller than the screen must
          // scroll INTERNALLY (body area) — never overflow the viewport or push
          // its footer off-screen. `maxScreen` additionally lets short content
          // stretch to fill the clamped height.
          "flex max-h-[calc(100dvh-2rem)] flex-col"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-4">
          <h3 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="text-slate-400 hover:text-slate-100 transition-colors rounded-lg p-1 hover:bg-slate-800">
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto p-5">
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

export function Popover({ children, className }) {
  const [open, setOpen] = useState(false);
  // Outside-click guard lives here (wrapping BOTH trigger and content): the
  // content renders in a portal to <body>, so a trigger-scoped guard would
  // close the popover on mousedown before the item's click ever fires. We
  // therefore consider clicks inside the trigger wrapper OR the portaled menu
  // as "inside".
  const wrapperRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (wrapperRef.current && wrapperRef.current.contains(e.target)) return;
      // Use closest() for robust portal detection — menuRef.current may not
      // be set yet on first interaction, and portal DOM can confuse contains().
      if (e.target.closest?.("[role=menu]") || e.target.closest?.("[role=menuitem]")) return;
      setOpen(false);
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
    <PopoverCtx.Provider value={{ open, setOpen, wrapperRef, menuRef }}>
      <div ref={wrapperRef} className={cx("relative", className ?? "w-full")}>{children}</div>
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

export function PopoverContent({ children, align = "start", sideOffset = 8, side = "bottom", className, matchTrigger = false }) {
  const { open, wrapperRef, menuRef } = useContext(PopoverCtx);
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const [resolvedSide, setResolvedSide] = useState("bottom");

  // Expose the portaled menu so Popover's outside-click guard treats clicks on
  // it as "inside" (the menu renders in a portal to <body>, not inside the
  // wrapper — otherwise every selection would be dismissed on mousedown).
  useEffect(() => {
    menuRef.current = ref.current;
    return () => { menuRef.current = null; };
  }, [menuRef]);

  // Measure + place before paint (no flash at 0,0) and reposition on
  // resize/scroll. Uses `fixed` positioning, so it escapes any ancestor's
  // overflow clipping (e.g. the Card primitive's overflow-hidden) and clamps
  // to the viewport so it can never be positioned with a negative X.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const el = ref.current;
    const wrapper = wrapperRef.current;
    if (!el || !wrapper) return;
    // Anchor = the composed trigger (the first element child of the wrapper),
    // so a split-button group positions the menu against the whole control
    // rather than a tiny chevron.
    const trigger = wrapper.firstElementChild || wrapper;

    const compute = () => {
      if (!document.body.contains(el)) return;
      const t = trigger.getBoundingClientRect();
      if (matchTrigger) el.style.width = `${t.width}px`;
      const mh = el.offsetHeight;
      const menuW = matchTrigger ? t.width : el.offsetWidth;
      const margin = 8;

      // Vertical: prefer the requested side; when only one side fits, use it;
      // clamp into the viewport either way.
      const fitsBelow = t.bottom + sideOffset + mh <= window.innerHeight - margin;
      const fitsAbove = t.top - sideOffset - mh >= margin;
      let placeBelow;
      if (fitsBelow && fitsAbove) placeBelow = side !== "top";
      else placeBelow = fitsBelow;
      const rawTop = placeBelow ? t.bottom + sideOffset : t.top - sideOffset - mh;
      const top = Math.max(margin, Math.min(rawTop, window.innerHeight - mh - margin));
      setResolvedSide(placeBelow ? "bottom" : "top");

      // Horizontal: align start/center/end to the anchor, then clamp so the
      // menu is never clipped by the viewport's left or right edge.
      let left = align === "end" ? t.right - menuW : align === "center" ? t.left + (t.width - menuW) / 2 : t.left;
      left = Math.max(margin, Math.min(left, window.innerWidth - menuW - margin));

      setPos({ left, top });
    };

    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, align, side, sideOffset, matchTrigger, wrapperRef]);

  if (!open) return null;

  // Grow the menu outward from its anchor edge so the open animation feels
  // anchored to the button rather than always originating top-left.
  // Applied as an inline transform-origin (bulletproof — no Tailwind scanning
  // dependency) keyed to the resolved side + align.
  const origin =
    resolvedSide === "bottom"
      ? align === "end" ? "bottom right"
        : align === "center" ? "bottom center" : "bottom left"
      : align === "end" ? "top right"
        : align === "center" ? "top center" : "top left";

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className={cx(
        "z-50 min-w-[10rem] rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-xl",
        "popover-pop-in",
        className
      )}
      style={{ position: "fixed", left: pos?.left ?? 0, top: pos?.top ?? 0, transformOrigin: origin }}
    >
      {children}
    </div>,
    document.body
  );
}

export function PopoverItem({ children, onClick, className }) {
  const { setOpen } = useContext(PopoverCtx);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        onClick?.(e);
        setOpen(false);
      }}
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
