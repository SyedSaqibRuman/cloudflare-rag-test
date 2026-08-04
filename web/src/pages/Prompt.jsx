import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, Button, TextArea, Select, Spinner, Badge } from "../components/ui";
import { useCompanies } from "../context";

export default function Prompt() {
  const { company, companies, select } = useCompanies();
  const [data, setData] = useState(null);
  const [template, setTemplate] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = async (name) => {
    if (!name) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api(`/cloudflare/prompt?company=${encodeURIComponent(name)}`);
      setData(res.prompt);
      setTemplate(res.prompt.template);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(company);
  }, [company]);

  const save = async () => {
    if (!company || !template.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api("/cloudflare/prompt", {
        method: "PUT",
        company,
        body: { template },
      });
      setData(res.prompt);
      notify("System prompt saved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm(`Reset the system prompt for '${company}' to the default template?`)) return;
    setError(null);
    try {
      const res = await api("/cloudflare/prompt/reset", {
        method: "POST",
        company,
        body: {},
      });
      setData(res.prompt);
      setTemplate(res.prompt.template);
      notify("System prompt reset to default.");
    } catch (e) {
      setError(e.message);
    }
  };

  const dirty = data && template !== data.template;
  const variables = data?.variables || {};

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">System Prompt</h1>
          <p className="text-sm text-slate-400 mt-1">The assistant's behavior template with runtime variable interpolation</p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={company}
            onChange={(e) => select(e.target.value)}
            options={[
              { value: "", label: "Select a company…" },
              ...companies.map((c) => ({ value: c.name, label: c.COMPANY_NAME || c.name })),
            ]}
            className="w-64"
          />
          {company && (
            <>
              <Button variant="secondary" onClick={reset}>
                Reset
              </Button>
              <Button onClick={save} disabled={!dirty || saving}>
                {saving ? <Spinner className="h-3.5 w-3.5" /> : "Save"}
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {!company ? (
        <Card>
          <div className="py-10 text-center text-sm text-slate-500">Select a company to edit its system prompt.</div>
        </Card>
      ) : loading || !data ? (
        <Card>
          <div className="flex items-center justify-center py-10">
            <Spinner className="h-6 w-6" />
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card
            title="Template"
            subtitle="Variables like {{CONSULTANT_NAME}} are resolved at runtime"
            actions={
              Object.keys(variables).length > 0 && (
                <div className="flex flex-wrap justify-end gap-1">
                  {Object.keys(variables).map((v) => (
                    <button
                      key={v}
                      className="rounded-md border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[11px] font-mono text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
                      onClick={() => {
                        const el = document.getElementById("prompt-template");
                        el.focus();
                        const start = el.selectionStart ?? template.length;
                        const end = el.selectionEnd ?? template.length;
                        const next = template.slice(0, start) + `{{${v}}}` + template.slice(end);
                        setTemplate(next);
                        requestAnimationFrame(() => {
                          el.selectionStart = el.selectionEnd = start + v.length + 4;
                        });
                      }}
                    >
                      {`{{${v}}}`}
                    </button>
                  ))}
                </div>
              )
            }
          >
            <TextArea
              id="prompt-template"
              rows={24}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="h-[480px]"
            />
            {dirty && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200">
                <span>Unsaved changes.</span>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setTemplate(data.template)}>
                    Discard
                  </Button>
                  <Button onClick={save} disabled={saving}>
                    {saving ? <Spinner className="h-3 w-3" /> : "Save"}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <div className="space-y-6">
            <Card title="Resolved Prompt" subtitle="Preview with current company values injected">
              <pre className="max-h-[480px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-950 border border-slate-800 p-4 text-xs leading-relaxed text-slate-300">
                {data.resolved || "—"}
              </pre>
            </Card>
            <Card title="Variable Values" subtitle="Current values for template interpolation">
              <div className="space-y-2">
                {Object.entries(variables).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-4 text-sm">
                    <Badge tone="indigo">{`{{${key}}}`}</Badge>
                    <span className="truncate text-xs text-slate-400">{value || "—"}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-200 shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
