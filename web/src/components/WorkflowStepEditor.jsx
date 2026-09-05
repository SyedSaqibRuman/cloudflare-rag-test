// --------------------------
// WORKFLOW STEP EDITOR — visual drag-and-drop step builder
// Each step is a card with type selector, config fields, and reorder handles.
// --------------------------
import { useState, useRef } from "react";
import { Button } from "./ui";

const STEP_TYPES = [
  { id: "assistant", label: "🤖 Assistant", color: "bg-blue-100 text-blue-700" },
  { id: "http", label: "🌐 HTTP Request", color: "bg-purple-100 text-purple-700" },
  { id: "ingest", label: "📥 Ingest KB", color: "bg-green-100 text-green-700" },
  { id: "notify", label: "🔔 Notify", color: "bg-amber-100 text-amber-700" },
  { id: "delay", label: "⏱ Delay", color: "bg-gray-100 text-gray-700" },
  { id: "condition", label: "🔀 Condition", color: "bg-cyan-100 text-cyan-700" },
  { id: "loop", label: "🔁 Loop", color: "bg-rose-100 text-rose-700" },
];

const STEP_CONFIG_FIELDS = {
  assistant: [
    { key: "assistantKey", label: "Assistant Key", placeholder: "support-bot" },
    { key: "input", label: "Input Template", placeholder: "{{step1.output}}" },
  ],
  http: [
    { key: "url", label: "URL", placeholder: "https://api.example.com/webhook" },
    { key: "method", label: "Method", type: "select", options: ["GET", "POST", "PUT", "DELETE"] },
    { key: "headers", label: "Headers (JSON)", placeholder: '{"Authorization":"Bearer ..."}' },
    { key: "body", label: "Body (JSON)", placeholder: '{"key":"value"}' },
  ],
  ingest: [
    { key: "kbKey", label: "KB Key", placeholder: "iso-docs" },
    { key: "scope", label: "Scope", type: "select", options: ["all", "limit"] },
  ],
  notify: [
    { key: "channel", label: "Channel", placeholder: "#alerts" },
    { key: "message", label: "Message", placeholder: "Workflow completed!" },
  ],
  delay: [
    { key: "ms", label: "Delay (ms)", type: "number", placeholder: "5000" },
  ],
  condition: [
    { key: "expression", label: "Expression", placeholder: "{{step1.output}} == 'success'" },
    { key: "ifTrue", label: "If True (step index)", type: "number", placeholder: "2" },
    { key: "ifFalse", label: "If False (step index)", type: "number", placeholder: "4" },
  ],
  loop: [
    { key: "items", label: "Items Expression", placeholder: "{{step1.output.items}}" },
    { key: "stepIndex", label: "Step to repeat", type: "number", placeholder: "1" },
  ],
};

const RETRY_FIELDS = [
  { key: "maxAttempts", label: "Max Attempts", type: "number", placeholder: "3" },
  { key: "delayMs", label: "Delay (ms)", type: "number", placeholder: "1000" },
];

/**
 * Visual workflow step editor.
 * @param {Object} props
 * @param {Array} props.steps - Current steps array
 * @param {function} props.onChange - Called with updated steps
 */
export default function WorkflowStepEditor({ steps = [], onChange }) {
  const [dragIdx, setDragIdx] = useState(null);
  const dragRef = useRef(null);

  const addStep = () => {
    onChange([...steps, { type: "assistant", config: {}, retry: {} }]);
  };

  const removeStep = (index) => {
    onChange(steps.filter((_, i) => i !== index));
  };

  const updateStep = (index, updates) => {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], ...updates };
    onChange(newSteps);
  };

  const updateConfig = (index, key, value) => {
    const step = steps[index];
    updateStep(index, { config: { ...step.config, [key]: value } });
  };

  const updateRetry = (index, key, value) => {
    const step = steps[index];
    updateStep(index, { retry: { ...step.retry, [key]: value } });
  };

  const moveStep = (from, to) => {
    if (to < 0 || to >= steps.length) return;
    const newSteps = [...steps];
    const [item] = newSteps.splice(from, 1);
    newSteps.splice(to, 0, item);
    onChange(newSteps);
  };

  // Drag handlers
  const handleDragStart = (e, index) => {
    setDragIdx(index);
    e.dataTransfer.effectAllowed = "move";
    dragRef.current = index;
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e, index) => {
    e.preventDefault();
    if (dragRef.current !== null && dragRef.current !== index) {
      moveStep(dragRef.current, index);
    }
    setDragIdx(null);
    dragRef.current = null;
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    dragRef.current = null;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <label className="block text-xs font-medium text-slate-400">
          Steps ({steps.length})
        </label>
        <Button size="sm" variant="outline" onClick={addStep}>+ Add Step</Button>
      </div>

      {steps.length === 0 ? (
        <p className="text-xs text-gray-500 italic py-4 text-center">
          No steps defined. Click "Add Step" to begin building your workflow.
        </p>
      ) : (
        <div className="space-y-2">
          {steps.map((step, i) => {
            const typeInfo = STEP_TYPES.find((t) => t.id === step.type) || STEP_TYPES[0];
            const fields = STEP_CONFIG_FIELDS[step.type] || [];
            const isDragging = dragIdx === i;

            return (
              <div
                key={i}
                draggable
                onDragStart={(e) => handleDragStart(e, i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={(e) => handleDrop(e, i)}
                onDragEnd={handleDragEnd}
                className={`border rounded-lg p-3 transition-all ${
                  isDragging
                    ? "opacity-50 border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20"
                    : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
                }`}
              >
                {/* Step header */}
                <div className="flex items-center gap-2 mb-2">
                  {/* Drag handle */}
                  <span className="cursor-grab text-gray-400 hover:text-gray-600" title="Drag to reorder">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="9" cy="6" r="1.5" />
                      <circle cx="15" cy="6" r="1.5" />
                      <circle cx="9" cy="12" r="1.5" />
                      <circle cx="15" cy="12" r="1.5" />
                      <circle cx="9" cy="18" r="1.5" />
                      <circle cx="15" cy="18" r="1.5" />
                    </svg>
                  </span>

                  <span className="text-xs text-gray-400 font-mono w-6">#{i + 1}</span>

                  {/* Type selector */}
                  <select
                    value={step.type}
                    onChange={(e) => updateStep(i, { type: e.target.value, config: {} })}
                    className="text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1"
                  >
                    {STEP_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>

                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeInfo.color}`}>
                    {typeInfo.label}
                  </span>

                  {/* Up/Down/Remove */}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => moveStep(i, i - 1)}
                      disabled={i === 0}
                      className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      title="Move up"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m18 15-6-6-6 6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => moveStep(i, i + 1)}
                      disabled={i === steps.length - 1}
                      className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      title="Move down"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => removeStep(i)}
                      className="text-red-500 hover:text-red-700"
                      title="Remove step"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Config fields */}
                <div className="grid grid-cols-2 gap-2 ml-8">
                  {fields.map((field) => (
                    <div key={field.key} className={field.key === "body" || field.key === "headers" || field.key === "expression" ? "col-span-2" : ""}>
                      <label className="block text-[10px] text-gray-500 mb-0.5">{field.label}</label>
                      {field.type === "select" ? (
                        <select
                          value={step.config?.[field.key] || ""}
                          onChange={(e) => updateConfig(i, field.key, e.target.value)}
                          className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1"
                        >
                          <option value="">Select...</option>
                          {field.options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : field.type === "number" ? (
                        <input
                          type="number"
                          value={step.config?.[field.key] || ""}
                          onChange={(e) => updateConfig(i, field.key, e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1"
                        />
                      ) : (
                        <input
                          type="text"
                          value={step.config?.[field.key] || ""}
                          onChange={(e) => updateConfig(i, field.key, e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1"
                        />
                      )}
                    </div>
                  ))}
                </div>

                {/* Retry config */}
                <div className="ml-8 mt-2 flex items-center gap-2">
                  <label className="text-[10px] text-gray-500">Retry:</label>
                  {RETRY_FIELDS.map((field) => (
                    <input
                      key={field.key}
                      type="number"
                      value={step.retry?.[field.key] || ""}
                      onChange={(e) => updateRetry(i, field.key, parseInt(e.target.value, 10) || 0)}
                      placeholder={field.placeholder}
                      className="w-16 text-[10px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-1.5 py-0.5"
                      title={field.label}
                    />
                  ))}
                </div>

                {/* Connector line */}
                {i < steps.length - 1 && (
                  <div className="flex justify-center mt-1">
                    <svg className="h-4 w-4 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
