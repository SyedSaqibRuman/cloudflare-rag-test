// --------------------------
// CREDENTIALS — dynamic form fields driven by provider auth schemas
// (AuthFields / PasswordField) and resource config schemas
// (ResourceConfigFields).
// --------------------------
import { useState } from "react";
import { Input, Select } from "../../components/ui";

// Config-schema driven inputs for the resource provisioning form
// (provider_resource_types.config_schema drives the fields).
export function ResourceConfigFields({ schema, values, onChange }) {
  if (!schema || typeof schema !== "object") return null;
  const entries = Object.entries(schema);
  if (!entries.length) return null;
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Resource config</p>
      {entries.map(([key, spec]) => {
        const field = spec || {};
        const label = `${field.label || key}${field.required ? " *" : ""}`;
        const value = values[key] ?? "";
        if (field.type === "select") {
          return (
            <Select
              key={key}
              label={label}
              options={Array.isArray(field.options) ? field.options : []}
              value={value}
              onChange={(e) => onChange(key, e.target.value)}
            />
          );
        }
        return (
          <Input
            key={key}
            label={label}
            type={field.type === "numeric" ? "number" : "text"}
            placeholder={field.placeholder || ""}
            min={field.min}
            max={field.max}
            value={value}
            onChange={(e) => onChange(key, e.target.value)}
          />
        );
      })}
    </div>
  );
}

function parseOptions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Dynamic field list rendered from a provider's auth schema (provider_auth_schemas).

export function AuthFields({ schema, values, onChange }) {
  if (!schema.length) {
    // No schema rows (blank-slate provider, or the registry cache predates a
    // catalog seed) — fall back to a single generic API key field so the
    // "pick a provider → paste key → save" flow always works. Values are still
    // encrypted at rest server-side.
    return (
      <div className="space-y-3">
        <PasswordField
          label="API Key *"
          value={values.api_key || ""}
          onChange={(e) => onChange("api_key", e.target.value)}
        />
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
          This provider has no auth schema rows yet (provider_auth_schemas table) — showing a generic
          API Key field as a fallback. Once the catalog is seeded, the form will ask for the
          provider-specific fields.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {schema.map((f) => {
        const label = `${f.field_label}${f.is_required ? " *" : ""}`;
        if (f.field_type === "select") {
          return (
            <Select
              key={f.field_name}
              label={label}
              options={parseOptions(f.select_options)}
              value={values[f.field_name] || ""}
              onChange={(e) => onChange(f.field_name, e.target.value)}
            />
          );
        }
        if (f.field_type === "password") {
          return (
            <PasswordField
              key={f.field_name}
              label={label}
              placeholder={f.placeholder || ""}
              value={values[f.field_name] || ""}
              onChange={(e) => onChange(f.field_name, e.target.value)}
            />
          );
        }
        return (
          <Input
            key={f.field_name}
            label={label}
            type={f.field_type === "url" ? "url" : "text"}
            placeholder={f.placeholder || ""}
            value={values[f.field_name] || ""}
            onChange={(e) => onChange(f.field_name, e.target.value)}
            autoComplete="off"
            spellCheck="false"
          />
        );
      })}
    </div>
  );
}

// Password input with an inline show/hide eye toggle — same pattern as the
// login page. One toggle per field (each password field has its own state).

function PasswordField({ label, placeholder, value, onChange }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-400">{label}</span>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          placeholder={placeholder || ""}
          onChange={onChange}
          autoComplete="off"
          spellCheck="false"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 pr-12 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="absolute right-1 top-0 flex h-full w-11 items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {show ? (
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </label>
  );
}
