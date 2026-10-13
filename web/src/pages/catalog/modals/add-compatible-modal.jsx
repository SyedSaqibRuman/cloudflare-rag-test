// --------------------------
// CATALOG — AddCompatibleModal (9Router AddCompatibleModal equivalent).
// Quick-add an OpenAI-compatible or Anthropic-compatible provider to the
// catalog: name + base URL, with an optional API key "Check" that probes
// {baseUrl}/models before creating. The provider key is auto-generated from
// the name under the compatible prefix (oc_ / ac_), which the Providers page
// uses to group these cards into the "Custom Providers" section.
// --------------------------
import { useEffect, useRef, useState } from "react";
import { createProvider } from "../../../api";
import { Button, Input, Modal, Spinner } from "../../../components/ui";
import { ANTHROPIC_COMPATIBLE_PREFIX, OPENAI_COMPATIBLE_PREFIX } from "../constants";
import { providerSlug } from "../utils";

const VARIANT_CONFIG = {
  openai: {
    title: "Add OpenAI Compatible",
    prefix: OPENAI_COMPATIBLE_PREFIX,
    defaultBaseUrl: "https://api.openai.com/v1",
    namePlaceholder: "OpenAI Compatible (Prod)",
    baseUrlHint: "Use the base URL (ending in /v1) for your OpenAI-compatible API.",
  },
  anthropic: {
    title: "Add Anthropic Compatible",
    prefix: ANTHROPIC_COMPATIBLE_PREFIX,
    defaultBaseUrl: "https://api.anthropic.com/v1",
    namePlaceholder: "Anthropic Compatible (Prod)",
    baseUrlHint: "Use the base URL (ending in /v1) for your Anthropic-compatible API.",
  },
};

export function AddCompatibleModal({ variant, open, onClose, onCreated }) {
  const config = VARIANT_CONFIG[variant];
  const [form, setForm] = useState({ name: "", baseUrl: config.defaultBaseUrl });
  const [checkKey, setCheckKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null); // { valid, error?, status? }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const wasOpen = useRef(open);

  // Reset transient state each time the modal opens (like ProviderTestModal).
  useEffect(() => {
    if (open && !wasOpen.current) {
      setForm({ name: "", baseUrl: config.defaultBaseUrl });
      setCheckKey("");
      setValidation(null);
      setError(null);
    }
    wasOpen.current = open;
  }, [open, config.defaultBaseUrl]);

  const generatedKey = () => {
    const slug = providerSlug(form.name);
    return `${config.prefix}${slug}`;
  };

  const handleCheck = async () => {
    setValidating(true);
    setValidation(null);
    try {
      const res = await fetch(`${String(form.baseUrl).trim().replace(/\/+$/, "")}/models`, {
        method: "GET",
        headers: checkKey.trim() ? { Authorization: `Bearer ${checkKey.trim()}` } : {},
        signal: AbortSignal.timeout(10000),
        redirect: "manual",
      });
      // Any HTTP response proves the host is reachable; 401/403 additionally
      // prove the key reached an auth gate (still a valid endpoint).
      setValidation({ valid: true, status: res.status });
    } catch (e) {
      setValidation({ valid: false, error: `Base URL unreachable: ${e.message}` });
    } finally {
      setValidating(false);
    }
  };

  const handleCreate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const name = form.name.trim();
      if (!name) throw new Error("Name is required.");
      const key = generatedKey();
      if (key.length < 3) throw new Error("Name is too short to generate a provider key (min 3 chars).");
      const baseUrl = form.baseUrl.trim();
      if (!baseUrl) throw new Error("Base URL is required.");
      await createProvider({
        providerKey: key,
        providerName: name,
        category: "ai",
        authType: "bearer_token",
        defaultApiBaseUrl: baseUrl,
      });
      onCreated(key);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={config.title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={submitting || !form.name.trim() || !form.baseUrl.trim()}>
            {submitting ? <Spinner className="h-3.5 w-3.5" /> : "Create"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
        )}
        <div>
          <Input
            label="Name *"
            value={form.name}
            onChange={(e) => {
              setForm((f) => ({ ...f, name: e.target.value }));
              setValidation(null);
            }}
            placeholder={config.namePlaceholder}
            autoFocus
          />
          <p className="mt-1.5 text-[11px] text-slate-500">
            A friendly label. Provider key auto-generates as{" "}
            <span className="font-mono text-slate-400">{generatedKey() || `${config.prefix}…`}</span>
          </p>
        </div>
        <div>
          <Input
            label="Base URL *"
            value={form.baseUrl}
            onChange={(e) => {
              setForm((f) => ({ ...f, baseUrl: e.target.value }));
              setValidation(null);
            }}
            placeholder={config.defaultBaseUrl}
          />
          <p className="mt-1.5 text-[11px] text-slate-500">{config.baseUrlHint}</p>
        </div>
        <div>
          <Input
            label="API Key (for Check)"
            type="password"
            value={checkKey}
            onChange={(e) => setCheckKey(e.target.value)}
          />
          <p className="mt-1.5 text-[11px] text-slate-500">Optional — verifies the endpoint answers at <span className="font-mono">{`${form.baseUrl.replace(/\/+$/, "")}/models`}</span> before you create it.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={handleCheck} disabled={validating || !form.baseUrl.trim()}>
            {validating ? <Spinner className="h-3.5 w-3.5" /> : "Check"}
          </Button>
          {validation && (
            validation.valid ? (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
                ✓ Endpoint reachable{validation.status ? ` (HTTP ${validation.status})` : ""}
              </span>
            ) : (
              <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-300">
                ✕ {validation.error}
              </span>
            )
          )}
        </div>
      </div>
    </Modal>
  );
}
