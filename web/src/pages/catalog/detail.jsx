// --------------------------
// CatalogDetail — detail view for a single provider.
// Header with badges/links, connections, models, environments, resources,
// test/delete modals.
// --------------------------
import { lazy, Suspense } from "react";
import { listProviders } from "../../api";
import { Badge, Button, Card, SkeletonCard, Spinner, Toast } from "../../components/ui";
import { categoryTone, groupFor, isAnthropicCompatible, isOpenAICompatible } from "./constants";
import { ConnectionsCard } from "./connections-card";
import { EnvironmentsCard, ResourcesCard } from "../credentials/cards";
import { ChunkErrorBoundary } from "./chunk-error-boundary";
import { hasResourceTemplates, servesModels, usesEnvironments } from "./utils";

const ModelsCard = lazy(() => import("./models-card").then((m) => ({ default: m.ModelsCard })));
const CloudflareResourcesCard = lazy(() => import("./cloudflare-resources-card").then((m) => ({ default: m.CloudflareResourcesCard })));
const ProviderTestModal = lazy(() => import("./modals").then((m) => ({ default: m.ProviderTestModal })));
const DeleteProviderModal = lazy(() => import("./modals").then((m) => ({ default: m.DeleteProviderModal })));

/** Extract the first URL from provider auth-schema help text, if any. */
function helpTextUrl(fieldHelpText) {
  const m = String(fieldHelpText || "").match(/https?:\/\/[^\s"')]+/);
  return m ? m[0] : null;
}

export function CatalogDetail({
  providerKey,
  navigate,
  providers,
  setProviders,
  detail,
  companyKey,
  creds,
  companyEnvs,
  error,
  notify,
  toast,
  loadDetail,
  testOpen,
  setTestOpen,
  deleteTarget,
  setDeleteTarget,
  deleting,
  forceDelete,
  setForceDelete,
  removeProvider,
}) {
  const provider = providers.find((p) => p.providerKey === providerKey);
  const authSchema = detail?.authForm || [];
  const isOpenAI = isOpenAICompatible(providerKey);
  const isAnthropic = isAnthropicCompatible(providerKey);

  const isSessionProvider =
    provider?.authType === "oauth2" ||
    authSchema.some(
      (f) => f.field_name === "token" || /session|subscription|cookie/i.test(f.field_help_text || "")
    );

  const showModels = servesModels(providerKey, provider, detail);
  const showEnvironments = usesEnvironments(providerKey, companyKey, companyEnvs, creds);

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" onClick={() => navigate("catalog")}>
          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </Button>
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="truncate text-lg font-bold text-slate-50">{provider?.providerName || providerKey}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={categoryTone(provider?.category)}>{provider ? groupFor(provider.category).label : ""}</Badge>
            <Badge>{provider?.authType || ""}</Badge>
            {isOpenAI && <Badge tone="green">OpenAI Compatible</Badge>}
            {isAnthropic && <Badge tone="amber">Anthropic Compatible</Badge>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {(() => {
            const primary = provider?.websiteUrl || provider?.documentationUrl;
            if (primary) {
              return (
                <a
                  href={primary}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300"
                >
                  <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h6v6" />
                    <path d="M10 14 21 3" />
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  </svg>
                  Sign up / Learn more
                </a>
              );
            }
            const url = (detail?.authForm || []).map((f) => helpTextUrl(f.field_help_text)).find(Boolean);
            return url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300"
              >
                <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6" />
                  <path d="M10 14 21 3" />
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                </svg>
                Generate API key
              </a>
            ) : null;
          })()}
          <Button variant="secondary" onClick={() => setTestOpen(true)}>Test Provider</Button>
          <Button
            variant="danger"
            onClick={() => {
              setForceDelete(false);
              setDeleteTarget(provider || { providerKey, providerName: providerKey });
            }}
          >
            Delete Provider
          </Button>
        </div>
      </div>

      {/* Risk Notice */}
      {isSessionProvider && (
        <div role="note" className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <span aria-hidden="true" className="mt-0.5 text-amber-400">⚠️</span>
          <p className="text-sm text-amber-200">
            <span className="font-semibold">Risk Notice:</span> This provider uses a subscription/OAuth
            session not officially licensed for proxy/router use. Account may be restricted or banned.
            Use at your own risk.
          </p>
        </div>
      )}

      {/* Connections */}
      <ConnectionsCard
        providerKey={providerKey}
        companyKey={companyKey}
        providers={providers}
        notify={notify}
        provider={provider}
        onProviderChanged={async () => {
          await loadDetail();
          try {
            setProviders((await listProviders({ perPage: 500 })).items ?? []);
          } catch {
            /* best-effort */
          }
        }}
      />

      {/* Models */}
      {showModels && (
        <ChunkErrorBoundary>
          <Suspense fallback={<Card><SkeletonCard rows={3} /></Card>}>
            <ModelsCard providerKey={providerKey} companyKey={companyKey} notify={notify} />
          </Suspense>
        </ChunkErrorBoundary>
      )}

      {/* Environments */}
      {showEnvironments && <EnvironmentsCard companyKey={companyKey} notify={notify} />}

      {/* Resources */}
      {providerKey.startsWith("cloudflare") ? (
        <ChunkErrorBoundary>
          <Suspense fallback={<Card><SkeletonCard rows={2} /></Card>}>
            <CloudflareResourcesCard companyKey={companyKey} providerKey={providerKey} notify={notify} />
          </Suspense>
        </ChunkErrorBoundary>
      ) : hasResourceTemplates(detail) ? (
        <ResourcesCard companyKey={companyKey} providerKey={providerKey} providers={providers} notify={notify} />
      ) : null}

      {/* Modals */}
      {testOpen && (
        <ChunkErrorBoundary>
          <Suspense fallback={<Spinner className="h-5 w-5" />}>
            <ProviderTestModal
              open={testOpen}
              providerKey={providerKey}
              providerName={provider?.providerName}
              authForm={authSchema}
              onClose={() => setTestOpen(false)}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}
      {deleteTarget && (
        <ChunkErrorBoundary>
          <Suspense fallback={<Spinner className="h-5 w-5" />}>
            <DeleteProviderModal
              provider={deleteTarget}
              busy={deleting}
              force={forceDelete}
              onClose={() => setDeleteTarget(null)}
              onConfirm={() => removeProvider(forceDelete)}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}

      <Toast message={toast?.msg} tone={toast?.tone} />
    </div>
  );
}
