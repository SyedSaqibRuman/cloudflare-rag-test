import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

const STORAGE_KEY = "pc_selected_company";

const CompanyCtx = createContext(null);

export function CompanyProvider({ children }) {
  const [company, setCompany] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [companies, setCompanies] = useState([]);

  const select = useCallback((name) => {
    setCompany(name || "");
    if (name) localStorage.setItem(STORAGE_KEY, name);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api("/cloudflare/companies");
      setCompanies(data.companies || []);
    } catch {
      setCompanies([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ company, companies, select, refresh }),
    [company, companies, select, refresh]
  );

  return <CompanyCtx.Provider value={value}>{children}</CompanyCtx.Provider>;
}

export function useCompanies() {
  return useContext(CompanyCtx);
}
