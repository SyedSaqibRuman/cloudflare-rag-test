// --------------------------
// DEFAULT SYSTEM PROMPT CARD (/config page, Prompt tab)
// Edit the company's default system prompt (SYSTEM_PROMPT in the config
// store) through GET/PUT /cloudflare/prompt + POST /cloudflare/prompt/reset.
// Shows a live "resolved" preview ({{VARIABLE}} → the custom variable values)
// so the admin sees exactly what the LLM will receive. There are NO built-in
// variables: a placeholder with no matching custom variable is left literal and
// flagged below the editor. Per-assistant prompts + variables (Assistants page)
// override this at ask time — hence the "Default" in the title.
// --------------------------
import { useEffect, useState } from "react";
import { api } from "../../api";
import { Card, Button, TextArea, Input, Spinner, Badge } from "../../components/ui";
import { collectPlaceholders, resolvePromptTemplate } from "#shared/prompt-variables.js";

/** Merge the company PROMPT_VARIABLES tier with the selected assistant's
 *  variables (assistant wins) into a { KEY: value } map — the same merge the
 *  server applies in shared/prompt-variables.js. */
export function mergeVariableMaps(companyVariables, assistantVariables) {
  const merged = new Map();
  for (const v of [...(companyVariables || []), ...(assistantVariables || [])]) {
    const key = String(v?.key || "").trim().toUpperCase();
    if (key) merged.set(key, v?.value ?? "");
  }
  return Object.fromEntries(merged);
}

export default function SystemPromptCard({ company, onError, notify }) {
  const [template, setTemplate] = useState("");
  const [savedTemplate, setSavedTemplate] = useState("");
  const [variables, setVariables] = useState([]);
  const [savedVariables, setSavedVariables] = useState([]);
  const [assistantVariables, setAssistantVariables] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!company) return;
    let cancelled = false;
    setLoading(true);
    onError(null);
    api("/cloudflare/prompt", { company })
      .then((data) => {
        if (cancelled) return;
        setTemplate(data.prompt.template);
        setSavedTemplate(data.prompt.template);
        setVariables(data.prompt.companyVariables || []);
        setSavedVariables(data.prompt.companyVariables || []);
        setAssistantVariables(data.prompt.assistantVariables || []);
      })
      .catch((e) => !cancelled && onError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [company, onError]);

  const variableMap = mergeVariableMaps(variables, assistantVariables);
  const used = collectPlaceholders(template);
  const missing = used.filter((k) => !Object.prototype.hasOwnProperty.call(variableMap, k));
  const unused = Object.keys(variableMap).filter((k) => !used.includes(k));

  const dirty =
    template !== savedTemplate ||
    JSON.stringify(variables) !== JSON.stringify(savedVariables);

  const setVar = (index, patch) =>
    setVariables((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  const addVar = () => setVariables((prev) => [...prev, { key: "", value: "" }]);
  const removeVar = (index) => setVariables((prev) => prev.filter((_, i) => i !== index));

  /**
   * Copy a variable's `{{PLACEHOLDER}}` token so it can be pasted into the
   * template. Uses the uppercased key, matching how the resolver matches
   * case-insensitively. A blank row has no placeholder to copy, so the button
   * is disabled upstream. Reports failure instead of silently doing nothing —
   * `navigator.clipboard` rejects on insecure origins and when permission is
   * denied, which would otherwise look like a broken button.
   */
  const copyVar = async (key) => {
    const token = `{{${String(key).trim().toUpperCase()}}}`;
    try {
      await navigator.clipboard.writeText(token);
      notify(`Copied ${token}`, "green");
    } catch {
      notify("Could not copy — your browser blocked clipboard access.", "red");
    }
  };

  const save = async () => {
    setBusy(true);
    onError(null);
    try {
      const data = await api("/cloudflare/prompt", {
        method: "PUT",
        body: {
          template,
          variables: variables
            .filter((v) => String(v.key).trim())
            .map((v) => ({
              key: String(v.key).trim().toUpperCase(),
              value: String(v.value ?? ""),
            })),
        },
        company,
      });
      setTemplate(data.prompt.template);
      setSavedTemplate(data.prompt.template);
      setVariables(data.prompt.companyVariables || []);
      setSavedVariables(data.prompt.companyVariables || []);
      notify("System prompt saved.");
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Reset the system prompt and its variables to the shipped default? Your customization will be lost."))
      return;
    setBusy(true);
    onError(null);
    try {
      const data = await api("/cloudflare/prompt/reset", { method: "POST", company });
      setTemplate(data.prompt?.template ?? "");
      setSavedTemplate(data.prompt?.template ?? "");
      setVariables(data.prompt?.variables || []);
      setSavedVariables(data.prompt?.variables || []);
      notify("System prompt reset to default.");
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Default System Prompt"
      subtitle="Fallback persona for this company's answers. Assistants with their own system prompt override it at ask time."
    >
      {loading ? (
        <div className="flex items-center mt-4 gap-2 py-6 text-sm text-slate-400">
          <Spinner className="h-3 w-3" /> Loading prompt…
        </div>
      ) : (
        <>
          {/* -------- custom variables -------- */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-slate-400">Custom variables</span>
              <Button variant="secondary" className="text-xs" onClick={addVar} disabled={variables.length >= 50}>
                + Add variable
              </Button>
            </div>
            {variables.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                No custom variables yet — placeholders in the template stay literal.
              </p>
            ) : (
              <div className="space-y-2">
                {variables.map((v, i) => {
                  const key = String(v.key || "").trim().toUpperCase();
                  const overridden = assistantVariables.some(
                    (a) => String(a.key || "").trim().toUpperCase() === key
                  );
                  return (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex-1">
                        <Input
                          value={v.key}
                          onChange={(e) => setVar(i, { key: e.target.value })}
                          placeholder="BRAND_NAME"
                          aria-label={`Variable ${i + 1} name`}
                          className="font-mono text-xs"
                        />
                        {overridden && (
                          <div className="text-[11px] text-amber-400 mt-0.5">
                            Overridden by the selected assistant
                          </div>
                        )}
                      </div>
                      <div className="flex-[2]">
                        <Input
                          value={v.value}
                          onChange={(e) => setVar(i, { value: e.target.value })}
                          placeholder="Value used in the prompt"
                          aria-label={`Variable ${i + 1} value`}
                          className="text-xs"
                        />
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          className="text-xs"
                          onClick={() => copyVar(v.key)}
                          disabled={!key}
                          title={
                            key
                              ? `Copy {{${key}}} to paste into the prompt template`
                              : "Name this variable first"
                          }
                        >
                          Copy {"{{...}}"}
                        </Button>
                        <Button variant="ghost" className="text-xs" onClick={() => removeVar(i)}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-slate-500 mt-1.5">
              Names use letters, digits and underscores and start with a letter (e.g.{" "}
              <code className="font-mono">BRAND_NAME</code>). Matching is case-insensitive. Use{" "}
              <strong className="text-slate-400">Copy {"{{...}}"}</strong> to put a placeholder on
              the clipboard, then paste it into the template below.
            </p>
          </div>

          <TextArea
            label="Prompt template"
            rows={12}
            className="pt-3"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder="You are {{CONSULTANT_NAME}}, an AI assistant for {{COMPANY_NAME}}."
          />

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="text-xs font-medium text-slate-400">Placeholders used:</span>
            {used.length === 0 ? (
              <span className="text-xs text-slate-500">none</span>
            ) : (
              used.map((k) => (
                <Badge
                  key={k}
                  tone={Object.prototype.hasOwnProperty.call(variableMap, k) ? "green" : "red"}
                  className="font-mono"
                >{`{{${k}}}`}</Badge>
              ))
            )}
          </div>
          {missing.length > 0 && (
            <div className="mt-2 text-xs text-rose-300">
              No value defined for {missing.map((k) => `{{${k}}}`).join(", ")} — these are sent to the
              model as-is. Add a variable above or remove the placeholder.
            </div>
          )}
          {unused.length > 0 && (
            <div className="mt-1 text-xs text-slate-500">
              Defined but not used in the template: {unused.map((k) => `{{${k}}}`).join(", ")}
            </div>
          )}

          <div className="mt-3">
            <span className="block text-xs font-medium text-slate-400 mb-1.5">
              Resolved preview — what the LLM actually receives
            </span>
            <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-300 whitespace-pre-wrap font-mono">
              {resolvePromptTemplate(template, variableMap) || "—"}
            </pre>
          </div>
          <div className="flex items-center justify-between mt-4">
            <Button variant="secondary" onClick={reset} disabled={busy}>
              Reset to default
            </Button>
            <div className="flex items-center gap-3">
              {dirty && <span className="text-xs text-amber-400">Unsaved changes</span>}
              <Button onClick={save} disabled={busy || !dirty || !template.trim()}>
                {busy ? <Spinner className="h-3 w-3" /> : "Save prompt"}
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
