import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getHotelState, setHotelState } from "@/lib/hotel-state.functions";

export interface AdminRecord {
  id: string;
  name: string;
  surname: string;
  idNumber: string;
  username: string;
  password: string;
  fingerprintId: string;
  createdAt: string;
}

export type AdminInput = Omit<AdminRecord, "id" | "createdAt">;

interface AdminsContextValue {
  admins: AdminRecord[];
  addAdmin: (input: AdminInput) => AdminRecord;
  updateAdmin: (id: string, patch: Partial<AdminInput>) => void;
  removeAdmin: (id: string) => void;
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

function saveLocal(list: AdminRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const AdminsContext = createContext<AdminsContextValue | undefined>(undefined);

export function AdminsProvider({ children }: { children: ReactNode }) {
  const [admins, setAdmins] = useState<AdminRecord[]>(() => load());
  const getSharedState = useServerFn(getHotelState);
  const setSharedState = useServerFn(setHotelState);

  // ─── Load from Supabase on mount + REAL-TIME subscription ───────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const applyCloud = (stateData: unknown) => {
      if (!Array.isArray(stateData) || stateData.length === 0) return;
      const cloudList = stateData as AdminRecord[];
      saveLocal(cloudList);
      setAdmins(cloudList);
    };

    // Initial load from Supabase
    const loadCloud = async () => {
      try {
        const row = await getSharedState({ data: { key: "admins" } });
        if (cancelled) return;
        if (row?.stateData && Array.isArray(row.stateData) && row.stateData.length > 0) {
          applyCloud(row.stateData);
        } else {
          const local = load();
          if (local.length > 0) {
            await setSharedState({ data: { key: "admins", stateData: local } });
          }
        }
      } catch { /* keep local state */ }
    };
    loadCloud();

    // ── Real-time subscription: fires instantly when any other user writes ──
    import("@/integrations/supabase/client").then(({ supabase }) => {
      if (cancelled) return;
      const channel = supabase
        .channel("hotel-admins-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "hotel_app_state", filter: "state_key=eq.admins" },
          (payload) => {
            const row = payload.new as { state_data: unknown } | undefined;
            if (row) applyCloud(row.state_data);
          },
        )
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    });

    return () => { cancelled = true; };
  }, [getSharedState, setSharedState]);

  // ─── Cross-tab sync (same browser, different tabs) ───────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reload = () => setAdmins(load());
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) reload(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, reload as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, reload as EventListener);
    };
  }, []);

  const persistAll = useCallback(async (list: AdminRecord[]) => {
    saveLocal(list);
    setAdmins(list);
    try {
      await setSharedState({ data: { key: "admins", stateData: list } });
    } catch { /* supabase write failed, local is still saved */ }
  }, [setSharedState]);

  const hashPassword = (pw: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < pw.length; i++) {
      h ^= pw.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0") + pw.length.toString(16);
  };

  const addAdmin: AdminsContextValue["addAdmin"] = useCallback((input) => {
    const rec: AdminRecord = {
      id: `adm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: input.name.trim(),
      surname: input.surname.trim(),
      idNumber: input.idNumber.trim(),
      username: input.username.trim().toLowerCase(),
      password: hashPassword(input.password),
      fingerprintId: input.fingerprintId.trim(),
      createdAt: new Date().toISOString(),
    };
    const next = [rec, ...load()];
    void persistAll(next);
    return rec;
  }, [persistAll]);

  const updateAdmin: AdminsContextValue["updateAdmin"] = useCallback((id, patch) => {
    const next = load().map((a) =>
      a.id === id
        ? { ...a, ...patch, username: patch.username ? patch.username.trim().toLowerCase() : a.username }
        : a,
    );
    void persistAll(next);
  }, [persistAll]);

  const removeAdmin: AdminsContextValue["removeAdmin"] = useCallback((id) => {
    const next = load().filter((a) => a.id !== id);
    void persistAll(next);
  }, [persistAll]);

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