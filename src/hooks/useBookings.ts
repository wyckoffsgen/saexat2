import { useState, useCallback, useEffect, useRef } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Booking, generateSampleBookings } from '@/types/hotel';
import { differenceInCalendarDays, isBefore, parseISO, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import { getHotelState, setHotelState } from '@/lib/hotel-state.functions';
import { useI18n } from './useI18n';

const STORAGE_KEY = 'sayohat-bookings-v2';
const CHANGE_EVENT = 'sayohat-bookings-changed';

function bookingSignature(b: Booking): string {
  return [b.roomNumber, b.bedIndex ?? 'room', b.checkIn, b.checkOut, b.status, (b.guestName || '').trim().toLowerCase()].join('|');
}

function isLegacySampleBooking(b: Booking): boolean {
  return /^b\d+$/.test(String(b.id));
}

function normalizeBookings(input: unknown): Booking[] {
  if (!Array.isArray(input)) return [];
  const byId = new Map<string, Booking>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const b = item as Booking;
    if (!b.id || !b.roomNumber || !b.checkIn || !b.checkOut || !b.status) continue;
    if (isLegacySampleBooking(b)) continue;
    byId.set(String(b.id), b);
  }
  const bySignature = new Map<string, Booking>();
  for (const b of byId.values()) bySignature.set(bookingSignature(b), b);
  return applyAutoCheckout(Array.from(bySignature.values()));
}

function bookingHalfSpan(b: Booking): [number, number] {
  const base = startOfDay(parseISO('2000-01-01'));
  const inDay = differenceInCalendarDays(parseISO(b.checkIn), base);
  const outDay = differenceInCalendarDays(parseISO(b.checkOut), base);
  return [
    2 * inDay + 1 - (b.checkInHalfDay ? 1 : 0),
    2 * outDay + 1 + (b.checkOutHalfDay ? 1 : 0),
  ];
}

/** Room-wide bookings/maintenance block every bed; otherwise conflicts are per-bed, with 08:00/14:00/12:00/24:00 half-day precision. */
function bookingsConflict(a: Booking, b: Booking): boolean {
  if (a.id === b.id) return false;
  if (a.roomNumber !== b.roomNumber) return false;
  const eitherIsRoomWide = a.status === 'maintenance' || b.status === 'maintenance'
    || a.bedIndex === undefined || b.bedIndex === undefined;
  if (!eitherIsRoomWide) {
    // Expand each booking to its full occupancy (primary bed + any blocker beds).
    const aBeds = new Set<number>([a.bedIndex as number, ...(a.additionalBeds ?? [])]);
    const bBeds = new Set<number>([b.bedIndex as number, ...(b.additionalBeds ?? [])]);
    let overlap = false;
    for (const bed of aBeds) { if (bBeds.has(bed)) { overlap = true; break; } }
    if (!overlap) return false;
  }
  const [aStart, aEnd] = bookingHalfSpan(a);
  const [bStart, bEnd] = bookingHalfSpan(b);
  return aStart < bEnd && bStart < aEnd;
}

function findConflict(list: Booking[], candidate: Booking): Booking | undefined {
  return list.find(b => bookingsConflict(b, candidate));
}

/**
 * Auto-flip any booking whose checkOut date is strictly before today to
 * 'checked-out'. Bookings that are still running (checkOut >= today) keep
 * their existing status. Maintenance is left alone since it is not a guest
 * stay. Returns the same array reference if nothing changed (cheap to call).
 */
function applyAutoCheckout(list: Booking[]): Booking[] {
  const today = startOfDay(new Date());
  let changed = false;
  const next = list.map(b => {
    if (b.status === 'maintenance' || b.status === 'checked-out') return b;
    const out = parseISO(b.checkOut);
    if (isBefore(out, today)) {
      changed = true;
      return { ...b, status: 'checked-out' as const };
    }
    return b;
  });
  return changed ? next : list;
}

export function useBookings() {
  const { t } = useI18n();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const getSharedState = useServerFn(getHotelState);
  const setSharedState = useServerFn(setHotelState);
  const cloudWriteRef = useRef<number | null>(null);
  const lastCloudVersionRef = useRef(0);

  // Load from localStorage on mount (client-side only, SSR-safe).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const data = window.localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const fixed = normalizeBookings(parsed);
          setBookings(fixed);
          if (fixed !== parsed) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fixed));
          return;
        }
      }
    } catch { /* fall through */ }
    const seed = normalizeBookings(generateSampleBookings());
    setBookings(seed);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const loadCloud = async () => {
      try {
        const row = await getSharedState({ data: { key: 'bookings' } });
        if (cancelled) return;
        if (row?.stateData) {
          if (row.version <= lastCloudVersionRef.current || cloudWriteRef.current) return;
          lastCloudVersionRef.current = row.version;
          const next = normalizeBookings(row.stateData);
          setBookings(next);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          window.dispatchEvent(new Event(CHANGE_EVENT));
          return;
        }
        const local = normalizeBookings(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null'));
        const seed = local.length ? local : [];
        await setSharedState({ data: { key: 'bookings', stateData: seed } });
      } catch { /* keep local state if backend is temporarily unreachable */ }
    };
    loadCloud();
    const id = window.setInterval(loadCloud, 2000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [getSharedState, setSharedState]);

  // Re-evaluate auto-checkout periodically so day-rollovers flip statuses live.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const tick = () => {
      setBookings(prev => {
        const next = applyAutoCheckout(prev);
        if (next !== prev) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    };
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Cross-tab / cross-role sync. When admin saves a change in one tab, the
  // `storage` event fires in every OTHER tab on the same origin (superuser /
  // director / admin tabs all share localStorage), so we re-hydrate state.
  // We also listen to a same-tab custom event for in-app rerenders that
  // bypass the native event (which never fires in the originating tab).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reload = () => {
      try {
        const data = window.localStorage.getItem(STORAGE_KEY);
        if (!data) return;
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) setBookings(normalizeBookings(parsed));
      } catch { /* ignore */ }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) reload();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, reload as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGE_EVENT, reload as EventListener);
    };
  }, []);

  const persist = (nextRaw: Booking[]) => {
    const next = normalizeBookings(nextRaw);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(CHANGE_EVENT));
      if (cloudWriteRef.current) window.clearTimeout(cloudWriteRef.current);
      cloudWriteRef.current = window.setTimeout(() => {
        void setSharedState({ data: { key: 'bookings', stateData: next } }).then((row) => {
          lastCloudVersionRef.current = row.version;
          cloudWriteRef.current = null;
        }).catch(() => undefined);
      }, 120);
    }
    return next;
  };

  const addBooking = useCallback((booking: Booking) => {
    let rejected = false;
    setBookings(prev => {
      const conflict = findConflict(prev, booking);
      if (conflict) {
        rejected = true;
        toast.error(t('overlapError'));
        return prev;
      }
      const next = persist([...prev, booking]);
      return next;
    });
    return !rejected;
  }, [setSharedState, t]);
  const removeBooking = useCallback((id: string) => {
    setBookings(prev => persist(prev.filter(b => b.id !== id)));
  }, [setSharedState]);
  const updateBooking = useCallback((id: string, updates: Partial<Booking>) => {
    let rejected = false;
    setBookings(prev => {
      const target = prev.find(b => b.id === id);
      if (!target) return prev;
      const candidate: Booking = { ...target, ...updates };
      const conflict = findConflict(prev, candidate);
      if (conflict) {
        rejected = true;
        toast.error(t('overlapError'));
        return prev;
      }
      const next = persist(prev.map(b => b.id === id ? candidate : b));
      return next;
    });
    return !rejected;
  }, [setSharedState, t]);

  return { bookings, addBooking, removeBooking, updateBooking };
}
