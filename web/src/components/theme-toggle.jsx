// Theme switcher: icon-button trigger opening a dropdown with Light mode /
// Dark mode / Follow system. Uses the lightweight CSS Popover (zero deps).
import { Popover, PopoverTrigger, PopoverContent, PopoverItem } from "./ui";
import { cx } from "../util";

export default function ThemeToggle({ onChange }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Toggle theme"
          title="Toggle theme"
          className={cx(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-400 shadow-sm transition-colors",
            "hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          )}
        >
          <IconSunMoon className="h-[1.2rem] w-[1.2rem]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8}>
        <PopoverItem onClick={() => onChange("light")}>
          <IconSun />
          Light mode
        </PopoverItem>
        <PopoverItem onClick={() => onChange("dark")}>
          <IconMoon />
          Dark mode
        </PopoverItem>
        <PopoverItem onClick={() => onChange("system")}>
          <IconSunMoon />
          Follow system
        </PopoverItem>
      </PopoverContent>
    </Popover>
  );
}

function IconSun() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
    </svg>
  );
}

function IconSunMoon({ className = "h-4 w-4" }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v2" />
      <path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715" />
      <path d="M16 12a4 4 0 0 0-4-4" />
      <path d="m19 5-1.256 1.256" />
      <path d="M20 12h2" />
    </svg>
  );
}
