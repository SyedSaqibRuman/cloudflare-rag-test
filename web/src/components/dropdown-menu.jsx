// Radix-based dropdown menu (shadcn-style wrapper, adapted to the portal's
// slate/indigo palette). Exports only the pieces the portal needs: Root,
// Trigger, Content, Item. Positioning, keyboard nav, focus, and dismissal
// come from @radix-ui/react-dropdown-menu.
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cx } from "../util";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({ className, align = "end", sideOffset = 6, children, ...props }) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cx(
          "z-50 w-max min-w-40 overflow-hidden rounded-lg border border-slate-700 bg-slate-900/95 p-1 text-slate-100 shadow-xl backdrop-blur",
          "data-[state=open]:menu-enter data-[state=closed]:menu-exit",
          className
        )}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, children, ...props }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cx(
        "group relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
        "text-slate-300 focus:bg-slate-800 focus:text-slate-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  );
}
