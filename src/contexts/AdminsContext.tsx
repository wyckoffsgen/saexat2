import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";

export interface AdminRecord {
  id: string;
  name: string;
  surname: string;
  /** National / personal ID number entered by superuser. */
  idNumber: string;
  /** Login username unique per admin. */
  username: string;
  /** Per-admin password — used to sign into the shared admin panel. */
  password: string;
  /** Visual-only fingerprint identifier (e.g. "FP-7A21-4C09"). */
  fingerprintId: string;
  createdAt: string;
}

export type AdminInput = Omit<AdminRecord, "id" | "createdAt">;

interface AdminsContextValue {
  admins: AdminRecord[];
  addAdmin: (input: AdminInput) => AdminRecord;
  updateAdmin: (id: string, patch: Partial<AdminInput>) => void;
  removeAdmin: (id: string) => void;
  /** Look up an admin by login username (case-insensitive). */
  findByUsername: (username: string) => AdminRecord | undefined;
}

const STORAGE_KEY = "hotel_admins_registry";
const CHANGE_EVENT = "hotel-admins-changed";

function load(): AdminRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Partial<AdminRecord>[];
    // Backfill new fields for older records so we don't crash old registries.
    return list.map((a) => ({
      id: a.id ?? `adm_${Math.random().toString(36).slice(2, 9)}`,
      name: a.name ?? "",
      surname: a.surname ?? "",
      idNumber: a.idNumber ?? "",
      username: a.username ?? "",
      password: a.password ?? "",
      fingerprintId: a.fingerprintId ?? "",
      createdAt: a.createdAt ?? new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

function save(list: AdminRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const AdminsContext = createContext<AdminsContextValue | undefined>(undefined);

export function AdminsProvider({ children }: { children: ReactNode }) {
  const [admins, setAdmins] = useState<AdminRecord[]>(() => load());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reload = () => setAdmins(load());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) reload();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, reload as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, reload as EventListener);
    };
  }, []);

  const addAdmin: AdminsContextValue["addAdmin"] = useCallback((input) => {
    const rec: AdminRecord = {
      id: `adm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: input.name.trim(),
      surname: input.surname.trim(),
      idNumber: input.idNumber.trim(),
      username: input.username.trim().toLowerCase(),
      password: input.password,
      fingerprintId: input.fingerprintId.trim(),
      createdAt: new Date().toISOString(),
    };
    const next = [rec, ...load()];
    save(next);
    setAdmins(next);
    return rec;
  }, []);

  const updateAdmin: AdminsContextValue["updateAdmin"] = useCallback((id, patch) => {
    const next = load().map((a) =>
      a.id === id
        ? {
            ...a,
            ...patch,
            username: patch.username ? patch.username.trim().toLowerCase() : a.username,
          }
        : a,
    );
    save(next);
    setAdmins(next);
  }, []);

  const removeAdmin: AdminsContextValue["removeAdmin"] = useCallback((id) => {
    const next = load().filter((a) => a.id !== id);
    save(next);
    setAdmins(next);
  }, []);

  const findByUsername = useCallback(
    (username: string) => {
      const u = username.trim().toLowerCase();
      return admins.find((a) => a.username.toLowerCase() === u);
    },
    [admins],
  );

  const value = useMemo(
    () => ({ admins, addAdmin, updateAdmin, removeAdmin, findByUsername }),
    [admins, addAdmin, updateAdmin, removeAdmin, findByUsername],
  );

  return <AdminsContext.Provider value={value}>{children}</AdminsContext.Provider>;
}

export function useAdmins() {
  const ctx = useContext(AdminsContext);
  if (!ctx) throw new Error("useAdmins must be used within AdminsProvider");
  return ctx;
}
