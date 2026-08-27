// --------------------------
// ASK API KEY CARD (/config page, Security tab)
// Generate/reveal/copy/revoke the per-company ask API key. The key value is
// shown exactly once and never returned by GET endpoints — the parent only
// feeds the initial enabled state (from the fetched config's AUTH section).
// --------------------------
import { useEffect, useState } from "react";
import { api } from "../../api";
import { Card, Button, Input, Spinner, Badge } from "../../components/ui";

export default function AskApiKeyCard({ company, initialEnabled, onError, notify }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [generatedKey, setGeneratedKey] = useState(null);
  const [busy, setBusy] = useState(false);

  // Sync from the parent's config load; a company switch also discards any
  // still-uncopied generated key (matches the previous load() behavior).
  useEffect(() => {
    setEnabled(initialEnabled);
    setGeneratedKey(null);
  }, [company, initialEnabled]);

  const generate = async () => {
    if (!company) return;
    setBusy(true);
    onError(null);
    try {
      const data = await api(`/cloudflare/companies/${encodeURIComponent(company)}/apikey`, { method: "POST" });
      setGeneratedKey(data.apiKey);
      setEnabled(true);
      notify("API key generated — copy it now.");
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm(`Revoke '${company}'s API key? /ask and /ask-stream will become open for this company again.`)) return;
    setBusy(true);
    onError(null);
    try {
      await api(`/cloudflare/companies/${encodeURIComponent(company)}/apikey`, { method: "DELETE" });
      setGeneratedKey(null);
      setEnabled(false);
      notify("API key revoked.");
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(generatedKey);
      notify("API key copied to clipboard.");
    } catch {
      notify("Could not copy — select the key manually.");
    }
  };

  return (
    <Card
      title="Ask API Key"
      subtitle="When enabled, POST /ask and /ask-stream require x-api-key and must originate from <company>.com or a subdomain"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={enabled ? "green" : "amber"}>{enabled ? "Enabled" : "Disabled"}</Badge>
        {generatedKey ? (
          <Input
            readOnly
            label="Generated API key"
            value={generatedKey}
            onFocus={(e) => e.target.select()}
            className="w-96 font-mono text-xs"
          />
        ) : null}
        {enabled ? (
          <Button variant="danger" onClick={revoke} disabled={busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : "Revoke"}
          </Button>
        ) : (
          <Button onClick={generate} disabled={busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : "Generate API Key"}
          </Button>
        )}
        {generatedKey && (
          <Button variant="secondary" onClick={copy}>
            Copy
          </Button>
        )}
      </div>
      {generatedKey && (
        <p className="mt-2 text-xs text-amber-300">Shown once — copy it now. Regenerating invalidates the previous key.</p>
      )}
    </Card>
  );
}