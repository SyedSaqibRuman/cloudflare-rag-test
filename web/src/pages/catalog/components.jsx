// --------------------------
// CATALOG — shared presentational components (StatTile, OverviewItem,
// PriceHistory). Used by the list/detail views (page.jsx) and the wizard's
// review step. Extracted so no single page file owns reusable UI.
// --------------------------
import { Badge, Button, IconButton, Spinner } from "../../components/ui";
import { cx } from "../../util";
import { price, ymd } from "./utils";

export function StatTile({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-100">{value}</p>
    </div>
  );
}

export function OverviewItem({ term, desc, link, mono }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{term}</dt>
      <dd className={cx("mt-0.5 truncate", mono ? "font-mono text-xs text-slate-300" : "text-sm text-slate-200")}>
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" className="text-indigo-300 underline-offset-2 hover:underline">{desc}</a>
        ) : (
          desc
        )}
      </dd>
    </div>
  );
}

export function PriceHistory({ model, rows, loading, onAdd, onEdit, onDelete }) {
  if (loading) {
    return <Spinner className="h-4 w-4" />;
  }
  if (!rows || rows.length === 0) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          No prices for <span className="font-mono text-slate-400">{model?.model_key || "this model"}</span> yet.
        </span>
        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={onAdd}>
          Add price
        </Button>
      </div>
    );
  }
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="pb-2 font-medium">From</th>
              <th className="pb-2 font-medium">To</th>
              <th className="pb-2 font-medium">Input /M</th>
              <th className="pb-2 font-medium">Output /M</th>
              <th className="pb-2 font-medium">Currency</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((p) => (
              <tr key={p.id} className="text-slate-300">
                <td className="py-2 font-mono text-xs">{ymd(p.effective_from)}</td>
                <td className="py-2 font-mono text-xs">{p.effective_to ? ymd(p.effective_to) : "—"}</td>
                <td className="py-2 font-mono text-xs">{price(p.input_price_per_million)}</td>
                <td className="py-2 font-mono text-xs">{price(p.output_price_per_million)}</td>
                <td className="py-2 text-xs">{p.price_currency}</td>
                <td className="py-2">{p.effective_to === null ? <Badge tone="green">current</Badge> : <Badge tone="slate">past</Badge>}</td>
                <td className="py-2">
                  <div className="flex items-center justify-end gap-1">
                    <IconButton title="Edit price" onClick={() => onEdit(p)}>
                      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                    </IconButton>
                    <IconButton title="Delete price" className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" onClick={() => onDelete(p)}>
                      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      </svg>
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex justify-end">
        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={onAdd}>
          Add price
        </Button>
      </div>
    </div>
  );
}
