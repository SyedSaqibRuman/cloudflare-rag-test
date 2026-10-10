import { useEffect, useState } from "react";
import { api } from "../../api";
import { Button, Card, Spinner, TextArea } from "../../components/ui";

const PLACEHOLDER = "crypto\n/write.*haiku/i\n\\binvestment\\b";

/**
 * Company-level blocked patterns (BLOCKED_PATTERNS config key) — the middle
 * tier of the configurable intent fast-path pattern set:
 * assistant.blocked_patterns > company BLOCKED_PATTERNS > built-ins.
 * One pattern per line: a literal phrase (case-insensitive, regex-escaped) or
 * a /delimited/ regex. An empty value restores the built-in defaults.
 * Saved through the company PUT endpoint like every other config key.
 */
export default function BlockedPatternsCard({ company, onError, notify }) {
  const [value, setValue] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Load on mount / company switch.
  useEffect(() => {
    if (!company) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api(`/cloudflare/config?company=${encodeURIComponent(company)}`)
      .then((data) => {
        if (!alive) return;
        const current = data.config?.GUARDRAIL?.BLOCKED_PATTERNS || "";
        setValue(current);
        setOriginal(current);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        onError?.(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  const dirty = value !== original;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api(`/cloudflare/companies/${encodeURIComponent(company)}`, {
        method: "PUT",
        body: { BLOCKED_PATTERNS: value.trim() || "" },
        toast: false,
      });
      setOriginal(value.trim());
      setValue(value.trim());
      notify(`Blocked patterns saved.`);
    } catch (e) {
      setError(e.message);
      onError?.(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Blocked Patterns"
      subtitle="Off-topic patterns refused before any AI call — overrides the built-in defaults for every assistant of this company"
    >
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <Spinner className="h-3.5 w-3.5" /> Loading…
        </div>
      ) : !company ? (
        <p className="py-6 text-sm text-slate-500">Select a company first.</p>
      ) : (
        <div className="space-y-3">
          <TextArea
            label="Patterns (one per line)"
            rows={5}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={PLACEHOLDER}
          />
          <p className="text-[11px] leading-relaxed text-slate-500">
            Each line is a literal phrase (case-insensitive — <code>crypto</code> also blocks{" "}
            <code>cryptocurrency</code>) or a slash-delimited regex (<code>/write.*poem/i</code>). This set
            <strong> replaces</strong> the built-in defaults (poems, jokes, movies, songs, code, recipes) for this company —
            e.g. a recipes company can remove the <code>recipe</code> veto here. Per-assistant patterns (Assistants page →
            Prompt tab) take precedence over this list; company Blocked Topics (substring vetoes) always apply on top.
            Leave empty to restore the built-in defaults.
          </p>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={saving || !dirty}>
              {saving ? <Spinner className="h-3.5 w-3.5" /> : "Save Patterns"}
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setValue(original)} disabled={saving}>
                Discard
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
