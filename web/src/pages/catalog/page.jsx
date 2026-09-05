// --------------------------
// CATALOG — Providers page (default export).
// Thin orchestrator: delegates to CatalogList (list view) or CatalogDetail
// (detail view) based on URL segment, wired through the useCatalog hook.
// --------------------------
import { lazy, Suspense } from "react";
import { Button, Spinner } from "../../components/ui";
import { useHeaderActions } from "../../components/Layout";
import { useCatalog } from "./useCatalog";
import { CatalogList } from "./list";
// Detail view lazy-loaded: it pulls in the modals + credentials modules and
// only renders on the #catalog/:key sub-route.
const CatalogDetail = lazy(() =>
  import("./detail").then((m) => ({ default: m.CatalogDetail }))
);

export default function Catalog({ navigate, path }) {
  const key = (path || "").split("/")[1];
  const cat = useCatalog(key, navigate);

  // Header actions (Test All + Refresh) for list view.
  useHeaderActions(
    !key ? (
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          onClick={cat.runBatchTest}
          disabled={!!cat.testing || !cat.companyKey}
          className="whitespace-nowrap"
          title={cat.companyKey ? "Test every active connection of the selected company" : "Select a company to test its connections"}
        >
          {cat.testing ? (
            <>
              <Spinner className="h-3.5 w-3.5" /> Testing…
            </>
          ) : (
            "Test All"
          )}
        </Button>
        <Button variant="secondary" onClick={() => cat.loadCreds(cat.companyKey)} disabled={cat.loading}>
          {cat.loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
        </Button>
      </div>
    ) : null
  );

  // Loading skeleton on initial bootstrap.
  if (cat.loading && cat.providers.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  // Detail view when a provider key is in the URL.
  if (key) {
    return (
      <Suspense fallback={<div className="flex items-center justify-center py-20"><Spinner className="h-6 w-6" /></div>}>
        <CatalogDetail
        providerKey={key}
        navigate={navigate}
        providers={cat.providers}
        setProviders={cat.setProviders}
        detail={cat.detail}
        companyKey={cat.companyKey}
        creds={cat.creds}
        companyEnvs={cat.companyEnvs}
        loading={cat.loading}
        error={cat.error}
        notify={cat.notify}
        toast={cat.toast}
        loadDetail={cat.loadDetail}
        testOpen={cat.testOpen}
        setTestOpen={cat.setTestOpen}
        deleteTarget={cat.deleteTarget}
        setDeleteTarget={cat.setDeleteTarget}
        deleting={cat.deleting}
        forceDelete={cat.forceDelete}
        setForceDelete={cat.setForceDelete}
        removeProvider={cat.removeProvider}
        />
      </Suspense>
    );
  }

  // List view (default).
  return (
    <CatalogList
      search={cat.search}
      setSearch={cat.setSearch}
      categoryFilter={cat.categoryFilter}
      setCategoryFilter={cat.setCategoryFilter}
      providers={cat.providers}
      loading={cat.loading}
      error={cat.error}
      statsOf={cat.statsOf}
      toggleProvider={cat.toggleProvider}
      navigate={navigate}
      expandedSections={cat.expandedSections}
      setExpandedSections={cat.setExpandedSections}
      collapsedSections={cat.collapsedSections}
      setCollapsedSections={cat.setCollapsedSections}
      addOpenAI={cat.addOpenAI}
      setAddOpenAI={cat.setAddOpenAI}
      addAnthropic={cat.addAnthropic}
      setAddAnthropic={cat.setAddAnthropic}
      compatibleCreated={cat.compatibleCreated}
      testResults={cat.testResults}
      setTestResults={cat.setTestResults}
      toast={cat.toast}
      matchSearch={cat.matchSearch}
      sortCards={cat.sortCards}
    />
  );
}
