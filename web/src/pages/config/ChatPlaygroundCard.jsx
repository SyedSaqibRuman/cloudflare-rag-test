// --------------------------
// CHAT PLAYGROUND CARD (/config page, Playground tab)
// Live model test via the company's saved gateway connection
// (POST /gateway/companies/:key/execute/chat). Read-only: the request runs
// against the provider with the stored credential — nothing here is saved.
// Fully self-contained state; follows the draft's LLM_MODEL selection.
// --------------------------
import { useEffect, useState } from "react";
import { executeChat } from "../../api";
import { Card, Button, Select, Spinner, Badge, TextArea } from "../../components/ui";
import { diagnoseError } from "#shared/error-tag.js";

export default function ChatPlaygroundCard({ company, aiProvider, llmModel, options }) {
  const [model, setModel] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // Follows the draft's selected model so you can test the current selection
  // before saving; the in-card select lets you try any chat model.
  useEffect(() => {
    setModel(llmModel ?? "");
  }, [llmModel]);

  // Fresh playground per company — clear the previous company's conversation.
  useEffect(() => {
    setMessage("");
    setResult(null);
    setError(null);
  }, [company]);

  const run = async () => {
    if (!company || !aiProvider || !model || !message.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await executeChat(company, {
        providerKey: aiProvider,
        model,
        messages: [{ role: "user", content: message.trim() }],
      });
      setResult({
        model: data.model,
        content: data.content,
        latencyMs: data.latencyMs,
        providerKey: data.providerKey,
      });
    } catch (e) {
      const tag = diagnoseError(e.message, aiProvider);
      setError(tag ? `${e.message} (${tag})` : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Chat Playground"
      subtitle="Send a message to any chat model through this company's saved connection — nothing here is saved"
    >
      <div className="space-y-4">
        <div className="max-w-sm">
          <Select
            label="Model"
            options={options}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            Defaults to your AI Model selection — pick any other chat model to try it first.
          </p>
        </div>
        <TextArea
          label="Message"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Try the model, e.g. 'Explain ISO 9001 in one sentence.'"
        />
        <div className="flex items-center gap-3">
          <Button onClick={run} disabled={busy || !aiProvider || !model || !message.trim()}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : "Send"}
          </Button>
          {busy && (
            <span className="text-xs text-slate-500">
              Calling {model} via {aiProvider}…
            </span>
          )}
        </div>
        {!aiProvider && (
          <p className="text-xs text-amber-300">Select a provider in the Models & Provider card to enable the playground.</p>
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
            {/no active credential/i.test(error) && (
              <span className="mt-1 block">
                Add a connection for '{aiProvider}' on the Providers page first.
              </span>
            )}
          </div>
        )}
        {result && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <Badge tone="green">OK</Badge>
              <span>
                {result.model}
                {result.latencyMs != null ? ` · ${result.latencyMs}ms` : ""}
                {result.providerKey ? ` · via ${result.providerKey}` : ""}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-100">
              {result.content ?? "(empty response)"}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}