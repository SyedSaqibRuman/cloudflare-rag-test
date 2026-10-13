// --------------------------
// BULK ACTIONS BAR — reusable batch operations UI
// Shows a floating bar at the bottom when items are selected,
// with Delete, Export, and deselect actions.
// --------------------------

import { useState } from "react";
import { Button } from "./index.jsx";
import { useToast } from "../../hooks.js";

/**
 * BulkActionsBar — renders a sticky bottom bar when items are selected.
 * @param {Object} props
 * @param {string} props.entity - Entity type: "kbs" | "assistants"
 * @param {string[]} props.selectedKeys - Currently selected keys
 * @param {function} props.onDeselectAll - Clear selection
 * @param {function} props.onRefresh - Reload list after operation
 * @param {string} props.company - Current company name
 * @param {function} props.bulkDeleteApi - (entity, keys, company) => Promise
 * @param {function} props.bulkExportApi - (entity, keys, company) => Promise
 */
export default function BulkActionsBar({
  entity,
  selectedKeys,
  onDeselectAll,
  onRefresh,
  company,
  bulkDeleteApi,
  bulkExportApi,
}) {
  const { notify } = useToast();
  const [working, setWorking] = useState(false);

  if (!selectedKeys || selectedKeys.length === 0) return null;

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedKeys.length} ${entity}? This cannot be undone.`)) return;
    setWorking(true);
    try {
      const result = await bulkDeleteApi(entity, selectedKeys, company);
      notify(result.message || `Deleted ${selectedKeys.length} ${entity}.`);
      onDeselectAll();
      onRefresh?.();
    } catch (e) {
      notify(e.message, "red");
    } finally {
      setWorking(false);
    }
  };

  const handleBulkExport = async () => {
    setWorking(true);
    try {
      const result = await bulkExportApi(entity, selectedKeys, company);
      // Trigger download
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entity}-export-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify(`Exported ${selectedKeys.length} ${entity}.`);
    } catch (e) {
      notify(e.message, "red");
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-lg px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {selectedKeys.length} {entity} selected
          </span>
          <button
            type="button"
            onClick={onDeselectAll}
            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline"
          >
            Clear selection
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleBulkExport}
            disabled={working}
          >
            📥 Export
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleBulkDelete}
            disabled={working}
            className="text-red-600 border-red-300 hover:bg-red-50"
          >
            {working ? "⏳ Deleting..." : `🗑 Delete (${selectedKeys.length})`}
          </Button>
        </div>
      </div>
    </>
  );
}
