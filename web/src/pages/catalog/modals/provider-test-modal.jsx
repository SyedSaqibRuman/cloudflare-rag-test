// --------------------------
// CATALOG — ProviderTestModal (test a catalog provider right after adding it).
// POST /gateway/providers/:key/test — read-only: nothing is persisted. With
// credential fields filled in the provider's auth schema is validated and the
// live probe runs (mode "probe"); without fields the base URL is checked for
// reachability (mode "connectivity") or the check reports "none" for
// catalog-only providers. Mirrors the Connections card's "Check Connection" flow.
// --------------------------
import { useEffect, useRef, useState } from "react";
import { testProvider } from "../../../api";
import { Button, Modal, Spinner } from "../../../components/ui";
import { AuthFields } from "../../credentials/fields";

const MODE_LABEL = {
  probe: "live probe",
  connectivity: "host connectivity",
  format: "format validation",
  none: "no probe configured",
};

export function ProviderTestModal({ open, providerKey, providerName, authForm, onClose }) {
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Reset transient state each time the modal opens so a fresh test doesn't
  // show the previous provider's result (same ref-guard as ModelModal).
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setValues({});
      setResult(null);
      setError(null);
    }
    wasOpen.current = open;
  }, [open]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await testProvider(providerKey, values));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const warn = result?.status === "success" && result.warning;
  const tone = warn
    ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
    : result?.status === "success"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : result
        ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
        : "";

  return (
    <Modal
      open={open}
      title={`Test Provider — ${providerName || providerKey || ""}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={run} disabled={busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : "Run Test"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
        )}
        <p className="text-xs text-slate-500">
          Validates this provider without saving anything — paste a key to run a live probe
          (mode: <span className="font-mono text-slate-400">probe</span>), or leave the fields
          blank to check the base URL is reachable (mode:{" "}
          <span className="font-mono text-slate-400">connectivity</span>).
        </p>
        {authForm.length > 0 ? (
          <AuthFields schema={authForm} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
        ) : (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            This provider has no auth schema — the check is a host-connectivity probe of its base URL only.
          </p>
        )}
        {result && (
          <div role={warn ? "status" : result.status === "success" ? "status" : "alert"} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${tone}`}>
            <span aria-hidden="true">{result.status === "success" ? "✓" : "✕"}</span>
            <span>
              <span className="font-medium">
                {result.status === "success"
                  ? `Provider reachable${result.latencyMs != null ? ` in ${result.latencyMs}ms` : ""}.`
                  : `Test failed${result.error ? `: ${result.error}` : "."}`}
              </span>{" "}
              <span className="opacity-80">
                ({MODE_LABEL[result.mode] || result.mode}
                {result.checkedAt ? ` · ${new Date(result.checkedAt).toLocaleTimeString()}` : ""})
              </span>
              {warn && <span className="mt-1 block">⚠️ {result.warning}</span>}
              {result.status === "failed" && result.errors && (
                <span className="mt-1 block">Fix the highlighted field(s) and run the test again.</span>
              )}
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
