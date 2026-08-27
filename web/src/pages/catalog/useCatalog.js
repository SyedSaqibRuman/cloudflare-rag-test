// --------------------------
// useCatalog — data hook for the Catalog page.
// Owns all API calls, state, and action handlers.
// --------------------------
import { useEffect, useState } from "react";
import {
  deleteProvider,
  getGatewayCompany,
  getProvider,
  listCredentials,
  listGatewayCompanies,
  listProviders,
  testCredentialsBatch,
  updateCredential,
} from "../../api";
import { useCompanies } from "../../context";
import { useToast } from "../../hooks";
import { errorTag, timeAgo } from "./utils";

export function useCatalog(key, navigate) {
  const { company } = useCompanies();
  const [companies, setCompanies] = useState([]);
  const [companyKey, setCompanyKey] = useState("");
  const [providers, setProviders] = useState([]);
  const [creds, setCreds] = useState([]);
  const [companyEnvs, setCompanyEnvs] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { toast, notify } = useToast();
  const [search, setSearch] = useState("");
  const [expandedSections, setExpandedSections] = useState(() => new Set());
  const [collapsedSections, setCollapsedSections] = useState(() => new Set());
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [addOpenAI, setAddOpenAI] = useState(false);
  const [addAnthropic, setAddAnthropic] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);

  // -------- data loaders ------------------------------------------------

  const loadCreds = async (companyKeyParam) => {
    if (!companyKeyParam) {
      setCreds([]);
      return;
    }
    setError(null);
    try {
      setCreds(await listCredentials(companyKeyParam, true));
    } catch (e) {
      setError(e.message);
    }
  };

  // Bootstrap: gateway companies + provider catalog.
  useEffect(() => {
    (async () => {
      setError(null);
      try {
        const [csResult, psResult] = await Promise.all([listGatewayCompanies(), listProviders()]);
        const cs = csResult.items ?? csResult;
        const ps = psResult.items ?? psResult;
        setCompanies(cs);
        setProviders(ps);
        const preferred =
          company && cs.some((c) => c.company_key === company)
            ? company
            : cs[0]?.company_key;
        setCompanyKey(preferred || "");
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep gateway tenant in sync with sidebar company picker.
  useEffect(() => {
    if (!company || !companies.length) return;
    if (companies.some((c) => c.company_key === company) && company !== companyKey)
      setCompanyKey(company);
  }, [company, companies, companyKey]);

  useEffect(() => {
    loadCreds(companyKey);
  }, [companyKey]);

  // Environments for the Environments-card gate.
  useEffect(() => {
    if (!companyKey) {
      setCompanyEnvs([]);
      return;
    }
    getGatewayCompany(companyKey)
      .then((d) => setCompanyEnvs(d.environments || []))
      .catch(() => setCompanyEnvs([]));
  }, [companyKey]);

  // Full provider metadata for the detail view.
  const loadDetail = async () => {
    if (!key) {
      setDetail(null);
      return;
    }
    setError(null);
    try {
      setDetail(await getProvider(key));
    } catch (e) {
      setError(e.message);
      setDetail(null);
    }
  };

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // -------- actions ------------------------------------------------------

  const statsOf = (providerKeyParam) => {
    const conns = creds.filter((c) => c.provider_key === providerKeyParam);
    const connected = conns.filter(
      (c) => c.is_active && c.last_verification_status === "success"
    ).length;
    const errors = conns.filter(
      (c) => c.is_active && c.last_verification_status === "failed"
    );
    const error = errors.length;
    const total = conns.length;
    const allDisabled = total > 0 && conns.every((c) => !c.is_active);
    const latest = [...errors].sort(
      (a, b) => new Date(b.last_verified_at || 0) - new Date(a.last_verified_at || 0)
    )[0];
    const errorCode = latest ? errorTag(latest.verification_error, providerKeyParam) : null;
    const errorTime = latest?.last_verified_at ? timeAgo(latest.last_verified_at) : null;
    return { connected, error, total, errorCode, errorTime, allDisabled };
  };

  const toggleProvider = async (providerKeyParam, newActive) => {
    const targets = creds.filter((c) => c.provider_key === providerKeyParam);
    setCreds((prev) =>
      prev.map((c) =>
        c.provider_key === providerKeyParam ? { ...c, is_active: newActive } : c
      )
    );
    await Promise.allSettled(
      targets.map((c) => updateCredential(c.id, { isActive: newActive }))
    );
    notify(newActive ? "Provider enabled." : "Provider disabled.");
  };

  const runBatchTest = async () => {
    if (testing || !companyKey) return;
    setTesting(true);
    setTestResults(null);
    try {
      const data = await testCredentialsBatch(companyKey, {});
      setTestResults(data);
      const { passed, failed, total } = data.summary || {};
      if (total > 0) {
        if (failed === 0) notify(`All ${total} tests passed`);
        else notify(`${passed}/${total} passed, ${failed} failed`, "red");
      } else {
        notify("No active connections to test.");
      }
    } catch (e) {
      setTestResults({ error: e.message });
      notify("Batch test failed", "red");
    } finally {
      setTesting(false);
    }
  };

  const removeProvider = async (force = false) => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteProvider(deleteTarget.providerKey, force);
      setForceDelete(false);
      setProviders((await listProviders()).items ?? []);
      if (key === deleteTarget.providerKey) navigate("catalog");
      notify(`Provider '${deleteTarget.providerKey}' deleted.`);
      setDeleteTarget(null);
    } catch (e) {
      setError(e.message);
      if (/referenced|cannot be deleted/i.test(e.message)) setForceDelete(true);
    } finally {
      setDeleting(false);
    }
  };

  const compatibleCreated = async (providerKeyParam) => {
    setAddOpenAI(false);
    setAddAnthropic(false);
    setProviders((await listProviders()).items ?? []);
    navigate(`catalog/${providerKeyParam}`);
    notify(`Provider '${providerKeyParam}' created.`);
  };

  const matchSearch = (p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      p.providerName.toLowerCase().includes(q) || p.providerKey.toLowerCase().includes(q)
    );
  };

  const sortCards = (list) =>
    [...list].sort((a, b) => {
      const ca = statsOf(a.providerKey).total > 0 ? 0 : 1;
      const cb = statsOf(b.providerKey).total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return a.providerName.localeCompare(b.providerName);
    });

  return {
    // state
    companies,
    companyKey,
    setCompanyKey,
    providers,
    setProviders,
    creds,
    companyEnvs,
    detail,
    loading,
    error,
    setError,
    toast,
    notify,
    search,
    setSearch,
    expandedSections,
    setExpandedSections,
    collapsedSections,
    setCollapsedSections,
    testing,
    testResults,
    setTestResults,
    addOpenAI,
    setAddOpenAI,
    addAnthropic,
    setAddAnthropic,
    testOpen,
    setTestOpen,
    deleteTarget,
    setDeleteTarget,
    deleting,
    forceDelete,
    setForceDelete,
    // actions
    loadCreds,
    loadDetail,
    statsOf,
    toggleProvider,
    runBatchTest,
    removeProvider,
    compatibleCreated,
    matchSearch,
    sortCards,
  };
}
