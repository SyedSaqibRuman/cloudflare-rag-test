// --------------------------
// CATALOG — shared presentational components for the 9Router-style Providers
// page: ProviderIcon (logo tile with fallback text), the ProviderCard grid
// card (status badges + disable toggle), and the batch Test Results view.
// Extracted so page.jsx stays a thin stateful shell. The Toggle switch lives
// in the shared UI kit (components/ui.jsx) — used by cards, connections,
// modals, and the rest of the portal.
// --------------------------
import { useState } from "react";
import { Badge, Card, Toggle } from "../../components/ui";
import { cx } from "../../util";
import { colorFor } from "./constants";
import { errorTag } from "./utils";

// ------------------------------------------------------------------
// ProviderIcon — logo image on a category-colored tile, falling back to a
// two-letter text glyph (9Router paints the tile with the provider color at
// ~15% alpha and falls back to the id's first two letters).
// ------------------------------------------------------------------
export function ProviderIcon({ provider }) {
  const [broken, setBroken] = useState(false);
  const color = colorFor(provider?.category);
  const text = String(provider?.providerKey || "?").slice(0, 2).toUpperCase();
  return (
    <div
      className="flex size-8 shrink-0 items-center justify-center rounded-lg"
      style={{ backgroundColor: `${color}26` }}
      aria-hidden="true"
    >
      {provider?.logoUrl && !broken ? (
        <img
          src={provider.logoUrl}
          alt=""
          onError={() => setBroken(true)}
          className="max-h-[30px] max-w-[30px] rounded-lg object-contain"
        />
      ) : (
        <span className="text-xs font-bold" style={{ color }}>
          {text}
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// ProviderCard — 9Router getStatusDisplay: "N Connected" (green dot) + "N
// Error (CODE)" (red dot), or "No connections". Disabled providers show a
// pause icon instead. The hover toggle (right) flips all of the company's
// credentials for this provider; the switch markup is the shared UI-kit Toggle.
// ------------------------------------------------------------------
function StatusDisplay({ connected, error, errorCode, errorTime, allDisabled }) {
  if (allDisabled) {
    return (
      <Badge tone="slate">
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="text-[11px]">⏸</span>
          Disabled
        </span>
      </Badge>
    );
  }
  const parts = [];
  if (connected > 0) {
    parts.push(
      <Badge key="connected" tone="green">
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          {connected} Connected
        </span>
      </Badge>
    );
  }
  if (error > 0) {
    parts.push(
      <Badge key="error" tone="red">
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-rose-400" />
          {error} Error{errorCode ? ` (${errorCode})` : ""}
        </span>
      </Badge>
    );
  }
  if (parts.length === 0) {
    return <span className="text-xs text-slate-500">No connections</span>;
  }
  return (
    <>
      {parts}
      {errorTime && <span className="text-slate-500">{errorTime}</span>}
    </>
  );
}

// ------------------------------------------------------------------
// ProviderCard — the 9Router grid card. Click opens the detail page; a toggle
// (visible on hover) disables/enables every connection of the provider.
// ------------------------------------------------------------------
export function ProviderCard({ provider, stats, onToggle, onOpen }) {
  const { connected, error, errorCode, errorTime, total, allDisabled } = stats;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${provider.providerName} details`}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Keydown bubbles from the inner disable toggle — only navigate when
        // the card itself is focused, or Enter on the toggle would open the
        // detail page instead of flipping the switch.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group min-w-0 cursor-pointer text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-xl"
    >
      <Card className={cx("h-full transition-colors hover:border-slate-600", allDisabled && "opacity-50")}>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ProviderIcon provider={provider} />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-slate-100">{provider.providerName}</h3>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
                <StatusDisplay
                  connected={connected}
                  error={error}
                  errorCode={errorCode}
                  errorTime={errorTime}
                  allDisabled={allDisabled}
                />
              </div>
            </div>
          </div>
          {total > 0 && (
            <div
              className="shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggle(!allDisabled ? false : true);
              }}
            >
              <Toggle
                checked={!allDisabled}
                onChange={() => {}}
                title={allDisabled ? "Enable provider" : "Disable provider"}
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------
// TestResultsView — batch "Test All" results (9Router ProviderTestResultsView):
// summary chips + one row per tested credential with latency + diagnosis.
// ------------------------------------------------------------------
export function TestResultsView({ results }) {
  if (results.error && !results.results) {
    return (
      <div className="py-6 text-center text-sm text-rose-400">{results.error}</div>
    );
  }
  const { summary, mode } = results;
  const items = results.results || [];
  const modeLabel = { oauth: "OAuth", apikey: "API Key", custom: "Custom", provider: "Provider", all: "All" }[mode] || mode || "All";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {summary && (
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs sm:gap-3">
          <span className="text-slate-400">{modeLabel} Test</span>
          <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-400">{summary.passed} passed</span>
          {summary.failed > 0 && (
            <span className="rounded bg-rose-500/15 px-2 py-0.5 font-medium text-rose-400">{summary.failed} failed</span>
          )}
          <span className="text-slate-500 sm:ml-auto">{summary.total} tested</span>
        </div>
      )}
      {items.map((r, i) => (
        <div
          key={r.credentialId || i}
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-slate-950/60 px-3 py-2 text-xs sm:flex-nowrap"
        >
          <span aria-hidden="true" className={r.valid ? "text-emerald-400" : "text-rose-400"}>
            {r.valid ? "✓" : "✕"}
          </span>
          <div className="min-w-0 flex-[1_1_160px]">
            <span className="block truncate font-medium text-slate-100 sm:inline">{r.credentialName}</span>
            <span className="block truncate text-slate-500 sm:ml-1.5 sm:inline">({r.providerKey})</span>
          </div>
          {r.latencyMs !== undefined && r.latencyMs !== null && (
            <span className="shrink-0 font-mono tabular-nums text-slate-400">{r.latencyMs}ms</span>
          )}
          <span
            className={cx(
              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
              r.valid ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
            )}
          >
            {r.valid ? "OK" : r.diagnosis || errorTag(r.error, r.providerKey) || "ERROR"}
          </span>
        </div>
      ))}
      {items.length === 0 && (
        <div className="py-4 text-center text-sm text-slate-500">No active connections found for this group.</div>
      )}
    </div>
  );
}
