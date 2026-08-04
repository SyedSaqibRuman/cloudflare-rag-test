import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

const STORAGE_KEY = "pc_selected_company";

const CompanyCtx = createContext(null);

export function CompanyProvider({ children }) {
  const [company, setCompany] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [companies, setCompanies] = useState([]);

  const select = (name) => {
    setCompany(name || "");
    if (name) localStorage.setItem(STORAGE_KEY, name);
    else localStorage.removeItem(STORAGE_KEY);
  };

  const refresh = async () => {
    try {
      const data = await api("/cloudflare/companies");
      setCompanies(data.companies || []);
    } catch {
      setCompanies([]);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <CompanyCtx.Provider value={{ company, companies, select, refresh }}>
      {children}
    </CompanyCtx.Provider>
  );
}

export function useCompanies() {
  return useContext(CompanyCtx);
}
