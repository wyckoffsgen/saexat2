import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UserRole } from "./AuthContext";

/**
 * AuditContext — captures every meaningful user action (creation, deletion,
 * edit, login/logout, shift change, etc.). NOT scrolling, hovering, or
 * passive viewing.
 *
 * Persisted in localStorage with cross-tab sync so superuser sees admin
 * actions instantly.
 */
export interface AuditEvent {
  id: string;
  at: string; // ISO
  actor: {
    username: string;
    role: UserRole;
    /** AdminRecord.id when actor is an admin signed in via the registry. */
    adminId?: string | null;
  };
  category:
    | "auth"
    | "booking"
    | "admin"
    | "shift"
    | "form"
    | "system";
  /** Short verb-noun action label, e.g. "booking.created", "admin.deleted". */
  action: string;
  /** One-line human summary. */
  summary: string;
  /** Optional structured details (room, fields changed, etc.). */
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reload = () => setEvents(load());
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
  }, []);

  const clear = useCallback(() => {
    if (typeof window === "undefined") return;
    ref.current = [];
    setEvents([]);
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const value = useMemo(() => ({ events, log, clear }), [events, log, clear]);
  return <AuditContext.Provider value={value}>{children}</AuditContext.Provider>;
}

export function useAudit() {
  const ctx = useContext(AuditContext);
  if (!ctx) throw new Error("useAudit must be used within AuditProvider");
  return ctx;
}
