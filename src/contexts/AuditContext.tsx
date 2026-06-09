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
  const getSharedState = useServerFn(getHotelState);
  const setSharedState = useServerFn(setHotelState);

  // Load from Supabase on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const loadCloud = async () => {
      try {
        const row = await getSharedState({ data: { key: "audit" } });
        if (cancelled) return;
        if (row?.stateData && Array.isArray(row.stateData) && row.stateData.length > 0) {
          const cloudEvents = row.stateData as AuditEvent[];
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudEvents));
          ref.current = cloudEvents;
          setEvents(cloudEvents);
        } else {
          const local = load();
          if (local.length > 0) {
            await setSharedState({ data: { key: "audit", stateData: local } });
          }
        }
      } catch { /* keep local */ }
    };
    loadCloud();
    return () => { cancelled = true; };
  }, []);

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
    // Debounced write to Supabase (500ms so rapid actions batch together)
    if (cloudWriteRef.current) window.clearTimeout(cloudWriteRef.current);
    cloudWriteRef.current = window.setTimeout(() => {
      void setSharedState({ data: { key: "audit", stateData: ref.current } }).catch(() => undefined);
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