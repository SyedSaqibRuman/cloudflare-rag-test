// --------------------------
// KEYBOARD SHORTCUTS — global keyboard shortcuts for common actions.
// Ctrl+K: Focus search / command palette
// Ctrl+N: Create new item (context-dependent)
// Esc: Close modals / overlays
// --------------------------
import { useEffect, useCallback, useState } from "react";
import { useCompanies } from "../context";

// ------------------------------------------------------------------
// Command Palette (Ctrl+K)
// ------------------------------------------------------------------
function CommandPalette({ navigate, onClose }) {
  const [query, setQuery] = useState("");
  const { companies, company } = useCompanies();

  const commands = [
    { id: "dashboard", label: "Go to Dashboard", shortcut: "Home", route: "dashboard" },
    { id: "ingestion", label: "Go to Knowledge Bases", shortcut: "K", route: "ingestion" },
    { id: "assistants", label: "Go to Assistants", shortcut: "A", route: "assistants" },
    { id: "ask", label: "Test AI (Ask Console)", shortcut: "T", route: "ask" },
    { id: "config", label: "Go to Settings", shortcut: "S", route: "config" },
    { id: "catalog", label: "Go to AI Providers", shortcut: "P", route: "catalog" },
    { id: "workflows", label: "Go to Workflows", shortcut: "W", route: "workflows" },
    { id: "scheduler", label: "Go to Scheduler", shortcut: "J", route: "scheduler" },
    { id: "usage", label: "Go to Usage", shortcut: "U", route: "usage" },
    { id: "companies", label: "Go to Companies", shortcut: "O", route: "companies" },
    { id: "webhooks", label: "Go to Notifications", shortcut: "N", route: "webhooks" },
    { id: "logs", label: "Go to Logs", shortcut: "L", route: "logs" },
  ];

  const filtered = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (cmd) => {
    navigate(cmd.route);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, actions..."
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
            autoFocus
          />
          <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No results found
            </div>
          ) : (
            filtered.map((cmd) => (
              <button
                key={cmd.id}
                type="button"
                onClick={() => handleSelect(cmd)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
              >
                <span className="flex-1">{cmd.label}</span>
                {cmd.shortcut && (
                  <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {cmd.shortcut}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 px-4 py-2 text-[11px] text-slate-600">
          <span className="mr-3">↑↓ Navigate</span>
          <span className="mr-3">↵ Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Keyboard Shortcuts Provider
// ------------------------------------------------------------------
export default function KeyboardShortcuts({ navigate }) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  const handleKeyDown = useCallback((e) => {
    // Ctrl+K or Cmd+K → Open command palette
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      setPaletteOpen((prev) => !prev);
    }

    // ? → Open page help (skip if inside an input)
    if (e.key === "?" && !paletteOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = e.target?.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && !e.target?.isContentEditable) {
        window.dispatchEvent(new CustomEvent("open-page-help"));
      }
    }

    // Escape → Close command palette
    if (e.key === "Escape" && paletteOpen) {
      e.preventDefault();
      setPaletteOpen(false);
    }
  }, [paletteOpen]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      {paletteOpen && (
        <CommandPalette navigate={navigate} onClose={() => setPaletteOpen(false)} />
      )}
    </>
  );
}
