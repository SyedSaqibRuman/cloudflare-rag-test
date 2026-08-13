// --------------------------
// CATALOG WIZARD — InlineEditor: reusable add/edit row used inside the
// Fields (step 3) and Endpoints & Resource Types (step 4) editors.
// --------------------------
import { useEffect, useRef } from "react";
import { Button } from "../../../components/ui";

// Reusable inline editor row — a labelled grid of inputs plus a Save/Cancel
// pair. `fields` is an array of rendered inputs ({ key, label, render }).
export function InlineEditor({ title, fields, onSave, onCancel }) {
  // Focus the editor's first control on mount so the add/edit flow continues
  // without another click (same polish as the step transition focus).
  const editorRef = useRef(null);
  useEffect(() => {
    editorRef.current?.querySelector('input:not([type="hidden"]), select, textarea')?.focus();
  }, []);
  return (
    <div ref={editorRef} className="rounded-lg border border-indigo-500/40 bg-slate-950/60 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-indigo-300">{title}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{fields}</div>
      <div className="mt-4 flex items-center gap-2">
        <Button className="px-2.5 py-1 text-xs" onClick={onSave}>Save</Button>
        <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
