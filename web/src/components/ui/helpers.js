import { cx } from "../../util";

/** Derive a stable field id/name from a label string. */
export const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Badge/StatCard tone → Tailwind class map. */
export const tones = {
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  red: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  indigo: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  slate: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  cyan: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
};

export { cx };
