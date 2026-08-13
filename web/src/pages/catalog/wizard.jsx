// --------------------------
// CATALOG — Add/Edit Provider wizard (5-step modal).
// Clean Architecture: this file is the stateful container only. The pure
// data-shaping helpers live in ./wizard/helpers.js, the reusable inline
// editor in ./wizard/inline-editor.jsx, and the five step bodies in
// ./wizard/steps.jsx.
// --------------------------
import { Fragment, useEffect, useRef, useState } from "react";
import { importProviderDefinition } from "../../api";
import { Button, Modal, Spinner } from "../../components/ui";
import { cx } from "../../util";
import { DRAFT_KEY, STEP_LABELS, STEP_TIPS, STEP_TITLES } from "./constants";
import { providerSlug } from "./utils";
import {
  EMPTY_WIZARD,
  providerToWizard,
  safeParseJson,
} from "./wizard/helpers";
import { Step1Basics, Step2Auth, Step3Fields, Step4Endpoints, Step5Review } from "./wizard/steps";

// Shared create/edit wizard. `provider` null → create; otherwise edit, prefilled
// from the full registry row (snake_case: provider_key, authForm, endpoints,
// resourceTemplates) with the provider key locked. Saving always goes through
// /gateway/providers/import — create upserts, edit passes replaceChildren so
// removed fields/endpoints/resource types are actually deleted.

export function ProviderWizardModal({ open, provider, onClose, onSaved }) {
  const isEdit = !!provider;
  const [step, setStep] = useState(1);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draftBanner, setDraftBanner] = useState(false);
  const [helpOpen, setHelpOpen] = useState(true);
  // Step 1 — Basics
  const [form, setForm] = useState(EMPTY_WIZARD.form);
  const [keyTouched, setKeyTouched] = useState(false);
  // Step 2 — Auth defaults
  const [auth, setAuth] = useState(EMPTY_WIZARD.auth);
  // Step 3 — Credential form fields
  const [fields, setFields] = useState([]);
  const [fieldEditor, setFieldEditor] = useState(null); // null | { index, draft }
  // Step 4 — Endpoints & resource types
  const [endpoints, setEndpoints] = useState([]);
  const [endpointEditor, setEndpointEditor] = useState(null);
  const [resources, setResources] = useState([]);
  const [resourceEditor, setResourceEditor] = useState(null);
  const wasOpen = useRef(open);
  const lastKey = useRef(null);
  const contentRef = useRef(null); // step container — for focus management

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setAuthField = (k, v) => setAuth((a) => ({ ...a, [k]: v }));

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      lastKey.current = null;
      return;
    }
    // A different provider was selected while the modal is open → re-prefill.
    const providerKey = provider?.provider_key || provider?.providerKey || null;
    if (providerKey !== lastKey.current) wasOpen.current = false;
    if (wasOpen.current) return; // already prefilled for this provider
    wasOpen.current = true;
    lastKey.current = providerKey;
    setStep(1);
    setError(null);
    setHelpOpen(true);
    setFieldEditor(null);
    setEndpointEditor(null);
    setResourceEditor(null);
    if (provider) {
      const w = providerToWizard(provider);
      setForm(w.form);
      setAuth(w.auth);
      setFields(w.fields);
      setEndpoints(w.endpoints);
      setResources(w.resources);
      setKeyTouched(false);
      setDraftBanner(false);
    } else {
      // Reset to a fresh slate each open (create mode).
      setForm(EMPTY_WIZARD.form);
      setKeyTouched(false);
      setAuth(EMPTY_WIZARD.auth);
      setFields([]);
      setEndpoints([]);
      setResources([]);
      setDraftBanner(!!localStorage.getItem(DRAFT_KEY));
    }
  }, [open, provider]);

  // Focus management: when the wizard opens or the step changes, move focus to
  // the first focusable control of the newly rendered step so keyboard users
  // land in the content instead of staying on the button they just clicked.
  useEffect(() => {
    if (!open) return;
    contentRef.current
      ?.querySelector('input:not([type="hidden"]), select, textarea, [role="button"], button')
      ?.focus();
  }, [open, step]);

  // Typing the name auto-generates the provider key until manually edited
  // (create mode only — the key is locked in edit mode).
  const onName = (v) => {
    setForm((f) => ({
      ...f,
      providerName: v,
      providerKey: isEdit || keyTouched ? f.providerKey : providerSlug(v),
    }));
  };

  // Validation runs when Next is clicked (never a silently-disabled button):
  // the current step's state is checked and the first problem is surfaced as
  // a banner error so the user knows exactly why they can't advance.
  const validateStep = (s) => {
    if (s === 1) {
      if (!form.providerName.trim()) return "Provider name is required.";
      if (!isEdit && !/^[a-z0-9_]{3,50}$/.test(form.providerKey.trim())) {
        return "Provider key must be 3–50 characters: lowercase letters, numbers, and underscores only.";
      }
      return null;
    }
    if (s === 2) {
      if (auth.apiKeyFormatRegex.trim()) {
        try {
          new RegExp(auth.apiKeyFormatRegex);
        } catch {
          return "API key format regex is not a valid regular expression.";
        }
      }
      return null;
    }
    if (s === 3) {
      const seen = new Set();
      for (const f of fields) {
        if (!/^[a-z0-9_]+$/.test(f.name.trim())) {
          return `Field '${f.label || f.name || "?"}' needs a valid name — lowercase letters, numbers, and underscores only.`;
        }
        if (!f.label.trim()) return "Every auth field needs a label.";
        if (seen.has(f.name)) return `Duplicate field name '${f.name}'.`;
        seen.add(f.name);
        if (f.type === "select" && f.selectOptions.trim() && !safeParseJson(f.selectOptions)) {
          return `Select options for '${f.name}' must be valid JSON.`;
        }
      }
      return null;
    }
    if (s === 4) {
      for (const e of endpoints) {
        if (!/^[a-z0-9-]+$/.test(e.key.trim())) {
          return `Endpoint '${e.name || e.key || "?"}' needs a valid key — lowercase letters, numbers, and hyphens only.`;
        }
        if (!e.name.trim()) return "Every endpoint needs a name.";
        let url;
        try {
          url = new URL(e.url.trim());
        } catch {
          return `Endpoint '${e.name || e.key}' has an invalid URL.`;
        }
        if (!/^https?:$/.test(url.protocol)) return `Endpoint '${e.name || e.key}' must use http or https.`;
      }
      for (const r of resources) {
        if (!r.displayName.trim()) return "Every resource type needs a display name.";
      }
      return null;
    }
    return null;
  };

  const goTo = (n) => {
    setError(null);
    setStep(n);
  };

  const handleNext = () => {
    // An unsaved draft sitting in an open inline editor (steps 3/4) is part of
    // the step's state too — apply the same rules so it can't be silently
    // hidden by advancing.
    let err = null;
    if (fieldEditor) {
      const d = fieldEditor.draft;
      if (!/^[a-z0-9_]+$/.test(d.name.trim())) err = "Field name must match lowercase letters, numbers, and underscores.";
      else if (!d.label.trim()) err = "Field label is required.";
      else if (d.type === "select" && d.selectOptions.trim() && !safeParseJson(d.selectOptions)) {
        err = "Select options must be valid JSON.";
      }
    }
    if (!err && endpointEditor) {
      const d = endpointEditor.draft;
      if (!/^[a-z0-9-]+$/.test(d.key.trim())) err = "Endpoint key must match lowercase letters, numbers, and hyphens.";
      else if (!d.name.trim()) err = "Endpoint name is required.";
      else {
        let url;
        try {
          url = new URL(d.url.trim());
        } catch {
          err = "Endpoint URL must be a valid URL.";
        }
        if (!err && !/^https?:$/.test(url.protocol)) err = "Endpoint URL must use http or https.";
      }
    }
    if (!err && resourceEditor && !resourceEditor.draft.displayName.trim()) {
      err = "Resource display name is required.";
    }
    if (err) {
      setError(err);
      return;
    }
    err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    goTo(step + 1);
  };

  const saveDraft = () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step, form, auth, fields, endpoints, resources })
    );
    onClose();
  };

  const restoreDraft = () => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (d.form) setForm(d.form);
      if (d.auth) setAuth(d.auth);
      if (d.fields) setFields(d.fields);
      if (d.endpoints) setEndpoints(d.endpoints);
      if (d.resources) setResources(d.resources);
      // If the restored key isn't the auto-slug of the restored name, the user
      // edited it manually — keep that behavior after restore too.
      setKeyTouched(!!(d.form?.providerKey && d.form?.providerKey !== providerSlug(d.form?.providerName || "")));
      setDraftBanner(false);
      // Resume where the user left off (defaults to step 1 for old drafts).
      const savedStep = Number(d.step);
      goTo(Number.isInteger(savedStep) && savedStep >= 1 ? Math.min(savedStep, 5) : 1);
    } catch {
      /* corrupted draft — ignore */
    }
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setDraftBanner(false);
  };

  // Step 3 — field editor actions
  const saveField = () => {
    const d = fieldEditor.draft;
    if (!/^[a-z0-9_]+$/.test(d.name.trim())) {
      setError("Field name must match lowercase letters, numbers, and underscores.");
      return;
    }
    if (!d.label.trim()) {
      setError("Field label is required.");
      return;
    }
    if (d.type === "select" && d.selectOptions.trim()) {
      const parsed = safeParseJson(d.selectOptions);
      if (!parsed) {
        setError("Select options must be valid JSON — e.g. [{\"value\":\"a\",\"label\":\"A\"}].");
        return;
      }
      d.selectOptions = JSON.stringify(parsed);
    }
    setError(null);
    setFields((list) => {
      const next = [...list];
      if (fieldEditor.index === -1) next.push(d);
      else next[fieldEditor.index] = d;
      return next;
    });
    setFieldEditor(null);
  };

  const removeField = (index) => {
    setFields((list) => list.filter((_, i) => i !== index));
    setFieldEditor(null);
  };

  // Step 4 — endpoint editor actions
  const saveEndpoint = () => {
    const d = endpointEditor.draft;
    if (!/^[a-z0-9-]+$/.test(d.key.trim())) {
      setError("Endpoint key must match lowercase letters, numbers, and hyphens.");
      return;
    }
    if (!d.name.trim()) {
      setError("Endpoint name is required.");
      return;
    }
    let url;
    try {
      url = new URL(d.url.trim());
    } catch {
      setError("Endpoint URL must be a valid URL.");
      return;
    }
    if (!/^https?:$/.test(url.protocol)) {
      setError("Endpoint URL must use http or https.");
      return;
    }
    setError(null);
    setEndpoints((list) => {
      const next = [...list];
      if (endpointEditor.index === -1) next.push(d);
      else next[endpointEditor.index] = d;
      return next;
    });
    setEndpointEditor(null);
  };

  const removeEndpoint = (index) => {
    setEndpoints((list) => list.filter((_, i) => i !== index));
    setEndpointEditor(null);
  };

  // Step 4 — resource type editor actions
  const saveResource = () => {
    const d = resourceEditor.draft;
    if (!d.displayName.trim()) {
      setError("Display name is required.");
      return;
    }
    setError(null);
    setResources((list) => {
      const next = [...list];
      if (resourceEditor.index === -1) next.push(d);
      else next[resourceEditor.index] = d;
      return next;
    });
    setResourceEditor(null);
  };

  const removeResource = (index) => {
    setResources((list) => list.filter((_, i) => i !== index));
    setResourceEditor(null);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      // selectOptions was validated + stringified in saveField; re-parse safely
      // in case a hand-edited draft slipped through.
      const definition = {
        providerKey: form.providerKey.trim(),
        providerName: form.providerName.trim(),
        category: form.category,
        websiteUrl: form.websiteUrl.trim() || null,
        documentationUrl: form.documentationUrl.trim() || null,
        logoUrl: form.logoUrl.trim() || null,
        defaultApiBaseUrl: auth.defaultApiBaseUrl.trim() || null,
        authType: auth.authType,
        authHeaderName: auth.authHeaderName.trim() || null,
        apiKeyFormatRegex: auth.apiKeyFormatRegex.trim() || null,
        authFields: fields.map((f) => ({
          name: f.name.trim(),
          label: f.label.trim(),
          type: f.type,
          placeholder: f.placeholder.trim() || null,
          helpText: f.helpText.trim() || null,
          required: f.required,
          validationRegex: f.validationRegex.trim() || null,
          encrypted: f.encrypted,
          storagePath: f.storagePath.trim() || f.name.trim(),
          displayOrder: Number(f.displayOrder) || 0,
          group: f.group,
          width: f.width,
          selectOptions: f.type === "select" && f.selectOptions.trim() ? safeParseJson(f.selectOptions) : null,
        })),
        endpoints: endpoints.map((e) => ({
          key: e.key.trim(),
          name: e.name.trim(),
          method: e.method,
          url: e.url.trim(),
          timeoutSeconds: Number(e.timeoutSeconds) || 30,
          isDefault: e.isDefault,
        })),
        resources: resources.map((r) => ({
          type: r.type,
          displayName: r.displayName.trim(),
          description: r.description.trim() || null,
          required: r.required,
          maxPerCredential: r.maxPerCredential === "" ? null : Number(r.maxPerCredential),
          displayOrder: Number(r.displayOrder) || 0,
        })),
      };
      const data = await importProviderDefinition(definition, {
        replaceChildren: isEdit,
      });
      localStorage.removeItem(DRAFT_KEY);
      onSaved(definition.providerKey, data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      title={isEdit ? "EDIT PROVIDER" : "ADD PROVIDER"}
      onClose={onClose}
      // Dismissal is opt-in portal-wide (backdrop/Escape never close by
      // default — see Modal in components/ui.jsx). The wizard keeps that.
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          {!isEdit && (
            <Button variant="secondary" onClick={saveDraft} disabled={busy}>Save Draft</Button>
          )}
          {step > 1 && (
            <Button variant="secondary" onClick={() => goTo(step - 1)} disabled={busy}>
              ← Back
            </Button>
          )}
          {step < 5 ? (
            <Button onClick={handleNext} disabled={busy}>
              Next: {STEP_TITLES[step]} →
            </Button>
          ) : (
            <Button onClick={create} disabled={busy}>
              {busy ? <Spinner className="h-3.5 w-3.5" /> : isEdit ? "Save Changes" : "Create Provider"}
            </Button>
          )}
        </>
      }
    >
      {/* Step indicator — completed steps are clickable, current step is
          highlighted with the primary color, upcoming steps stay muted. */}
      <ol className="mb-6 flex items-start">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const current = n === step;
          return (
            <Fragment key={label}>
              {i > 0 && (
                <li
                  aria-hidden
                  role="presentation"
                  className={`mt-[15px] h-0.5 min-w-4 flex-1 rounded-full transition-colors ${
                    n <= step ? "bg-indigo-500" : "bg-slate-700"
                  }`}
                />
              )}
              <li className="flex min-w-0 flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    if (done) goTo(n);
                  }}
                  disabled={busy}
                  aria-current={current ? "step" : undefined}
                  title={done ? `Go back to: ${STEP_TITLES[i]}` : `${STEP_TITLES[i]} — complete the previous steps first`}
                  className={cx(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-all",
                    current &&
                      "border-indigo-500 bg-indigo-500 text-white shadow-lg shadow-indigo-500/40 ring-4 ring-indigo-500/20",
                    done &&
                      "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:border-indigo-400 hover:bg-indigo-500/20",
                    !current &&
                      !done &&
                      "border-slate-700 bg-slate-950 text-slate-500 cursor-not-allowed",
                    done && !busy && "cursor-pointer"
                  )}
                >
                  {done ? (
                    <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    n
                  )}
                </button>
                <span
                  className={cx(
                    "max-w-16 truncate text-center text-[10px] font-medium leading-tight",
                    current ? "text-indigo-300" : done ? "text-slate-400" : "text-slate-600"
                  )}
                >
                  {label}
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>

      {/* "How to add a provider" help panel — collapsible, highlights the
          current step, and adapts its tips for edit mode. */}
      <div className="mb-4 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
        <button
          type="button"
          onClick={() => setHelpOpen((v) => !v)}
          aria-expanded={helpOpen}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-300 transition-colors hover:bg-slate-900/60 hover:text-slate-100"
        >
          <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
          How to {isEdit ? "edit" : "add"} a provider
          <svg
            aria-hidden="true"
            className={cx("ml-auto h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform", helpOpen && "rotate-180")}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {helpOpen && (
          <div className="border-t border-slate-800 px-3 py-3">
            <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
              {isEdit
                ? "Everything is prefilled from the existing provider. The provider key stays locked — it is the stable route ID and can never change. Removing a field, endpoint, or resource type here is applied when you save."
                : "A provider is the top-level entry in your AI gateway catalog. What you fill in on this step drives the provider's identity and behavior."}
            </p>
            {/* Only the current step's tip is shown — the rest appear as you advance. */}
            <div className="flex items-start gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5 text-xs leading-relaxed text-slate-200">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[11px] font-bold text-white">
                {step}
              </span>
              <span>
                <span className="font-semibold text-indigo-300">{STEP_TITLES[step - 1]} — </span>
                {STEP_TIPS[step - 1]}
              </span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
      )}

      {draftBanner && step === 1 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2.5 text-xs text-sky-200">
          <span>A saved draft from a previous session was found.</span>
          <span className="flex shrink-0 gap-2">
            <button type="button" onClick={restoreDraft} className="font-semibold text-sky-300 underline-offset-2 hover:underline">Restore</button>
            <button type="button" onClick={discardDraft} className="text-sky-400/80 hover:text-sky-200">Discard</button>
          </span>
        </div>
      )}

      {/* Step container — ref'd for focus management on step change. */}
      <div ref={contentRef}>
        {step === 1 && <Step1Basics form={form} isEdit={isEdit} keyTouched={keyTouched} onName={onName} set={set} setKeyTouched={setKeyTouched} />}
        {step === 2 && <Step2Auth auth={auth} setAuthField={setAuthField} />}
        {step === 3 && (
          <Step3Fields
            fields={fields}
            fieldEditor={fieldEditor}
            setFieldEditor={setFieldEditor}
            saveField={saveField}
            removeField={removeField}
          />
        )}
        {step === 4 && (
          <Step4Endpoints
            endpoints={endpoints}
            resources={resources}
            endpointEditor={endpointEditor}
            resourceEditor={resourceEditor}
            setEndpointEditor={setEndpointEditor}
            setResourceEditor={setResourceEditor}
            saveEndpoint={saveEndpoint}
            removeEndpoint={removeEndpoint}
            saveResource={saveResource}
            removeResource={removeResource}
          />
        )}
        {step === 5 && <Step5Review form={form} auth={auth} fields={fields} endpoints={endpoints} resources={resources} isEdit={isEdit} />}
      </div>
    </Modal>
  );
}
