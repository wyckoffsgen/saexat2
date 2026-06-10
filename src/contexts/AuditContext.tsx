import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getHotelState, setHotelState } from "@/lib/hotel-state.functions";
import type { UserRole } from "./AuthContext";

export interface AuditEvent {
  id: string;
  at: string;
  actor: {
    username: string;
    role: UserRole;
    adminId?: string | null;
  };
  category: "auth" | "booking" | "admin" | "shift" | "form" | "system";
  action: string;
  summary: string;
  details?: Record<string, unknown>;
}

interface AuditContextValue {
  events: AuditEvent[];
  log: (e: Omit<AuditEvent, "id" | "at">) => void;
  clear: () => void;
}

const STORAGE_KEY = "hotel_audit_log";
const CHANGE_EVENT = "hotel-audit-changed";

function load(): AuditEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuditEvent[]) : [];
  } catch {
    return [];
  }
}

const AuditContext = createContext<AuditContextValue | undefined>(undefined);

export function AuditProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<AuditEvent[]>(() => load());
  const ref = useRef<AuditEvent[]>(events);
  ref.current = events;
  const cloudWriteRef = useRef<number | null>(null);
  const lastCloudVersionRef = useRef(0);
  const getSharedState = useServerFn(getHotelState);
  const setSharedState = useServerFn(setHotelState);

  // ─── Load from Supabase on mount + REAL-TIME subscription ───────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const applyCloud = (stateData: unknown, version?: number) => {
      // Don't overwrite while we are mid-write (our own pending debounce)
      if (cloudWriteRef.current) return;
      if (version !== undefined && version <= lastCloudVersionRef.current) return;
      if (!Array.isArray(stateData) || stateData.length === 0) return;
      if (version !== undefined) lastCloudVersionRef.current = version;
      const cloudEvents = stateData as AuditEvent[];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudEvents));
      ref.current = cloudEvents;
      setEvents(cloudEvents);
    };

    // Initial load from Supabase
    const loadCloud = async () => {
      try {
        const row = await getSharedState({ data: { key: "audit" } });
        if (cancelled) return;
        if (row?.stateData && Array.isArray(row.stateData) && row.stateData.length > 0) {
          applyCloud(row.stateData, row.version);
        } else {
          const local = load();
          if (local.length > 0) {
            await setSharedState({ data: { key: "audit", stateData: local } });
          }
        }
      } catch { /* keep local */ }
    };
    loadCloud();

    // ── Real-time subscription: audit log updates pushed from other users ───
    import("@/integrations/supabase/client").then(({ supabase }) => {
      if (cancelled) return;
      const channel = supabase
        .channel("hotel-audit-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "hotel_app_state", filter: "state_key=eq.audit" },
          (payload) => {
            const row = payload.new as { state_data: unknown; version: number } | undefined;
            if (row) applyCloud(row.state_data, row.version);
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
    const reload = () => setEvents(load());
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) reload(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, reload as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, reload as EventListener);
    };
  }, []);

  const log = useCallback<AuditContextValue["log"]>((e) => {
    if (typeof window === "undefined") return;
    const ev: AuditEvent = {
      ...e,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
    };
    const next = [ev, ...ref.current].slice(0, 2000);
    ref.current = next;
    setEvents(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    // Debounced write to Supabase — batches rapid actions together
    if (cloudWriteRef.current) window.clearTimeout(cloudWriteRef.current);
    cloudWriteRef.current = window.setTimeout(() => {
      void setSharedState({ data: { key: "audit", stateData: ref.current } })
        .then((row) => { lastCloudVersionRef.current = row.version; })
        .catch(() => undefined);
      cloudWriteRef.current = null;
    }, 500);
  }, [setSharedState]);

  const clear = useCallback(() => {
    if (typeof window === "undefined") return;
    ref.current = [];
    setEvents([]);
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    void setSharedState({ data: { key: "audit", stateData: [] } }).catch(() => undefined);
  }, [setSharedState]);

  const value = useMemo(() => ({ events, log, clear }), [events, log, clear]);
  return <AuditContext.Provider value={value}>{children}</AuditContext.Provider>;
}

export function useAudit() {
  const ctx = useContext(AuditContext);
  if (!ctx) throw new Error("useAudit must be used within AuditProvider");
  return ctx;
}