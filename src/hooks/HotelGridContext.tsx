import React, { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { ROOM_CATEGORIES, ROOMS_PER_CATEGORY, type Room, type RoomCategory } from '@/types/hotel';
import { getHotelState, setHotelState } from '@/lib/hotel-state.functions';

export interface CategoryDef {
  id: string;
  label: Record<string, string>;
  short: string;
  maxGuests: number;
  custom?: boolean;
}

interface Ctx {
  categories: CategoryDef[];
  rooms: Room[];
  categoryRates: Record<string, number>;
  addCategory: (input: { name: string; short: string; maxGuests: number }) => void;
  removeCategory: (id: string) => void;
  addRoom: (categoryId: string, roomNumber: number) => { ok: boolean; reason?: 'exists' | 'invalid' };
  removeRoom: (roomNumber: number) => void;
  setCategoryRate: (categoryId: string, rate: number) => void;
}

const HotelGridContext = createContext<Ctx | null>(null);

const STORAGE_KEY = 'sayohat-hotel-grid-v1';
const CHANGE_EVENT = 'sayohat-hotel-grid-changed';

interface PersistedState {
  extraCategories: CategoryDef[];
  removedCategoryIds: string[];
  removedRoomNumbers: number[];
  extraRooms: Room[];
  categoryRates?: Record<string, number>;
}

function loadPersisted(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      extraCategories: Array.isArray(parsed.extraCategories) ? parsed.extraCategories : [],
      removedCategoryIds: Array.isArray(parsed.removedCategoryIds) ? parsed.removedCategoryIds : [],
      removedRoomNumbers: Array.isArray(parsed.removedRoomNumbers) ? parsed.removedRoomNumbers : [],
      extraRooms: Array.isArray(parsed.extraRooms) ? parsed.extraRooms : [],
      categoryRates: parsed.categoryRates && typeof parsed.categoryRates === 'object' ? parsed.categoryRates : {},
    };
  } catch {
    return null;
  }
}

const EMPTY_STATE: PersistedState = {
  extraCategories: [],
  removedCategoryIds: [],
  removedRoomNumbers: [],
  extraRooms: [],
  categoryRates: {},
};

export function HotelGridProvider({ children }: { children: React.ReactNode }) {
  const baseCategories = useMemo<CategoryDef[]>(
    () =>
      ROOM_CATEGORIES.map((c) => ({
        id: c.id,
        label: c.label,
        short: c.short,
        maxGuests: c.maxGuests,
      })),
    [],
  );

  const initial = useRef<PersistedState | null>(loadPersisted());
  const [extraCategories, setExtraCategories] = useState<CategoryDef[]>(initial.current?.extraCategories ?? []);
  const [removedCategoryIds, setRemovedCategoryIds] = useState<Set<string>>(
    new Set(initial.current?.removedCategoryIds ?? []),
  );
  const [removedRoomNumbers, setRemovedRoomNumbers] = useState<Set<number>>(
    new Set(initial.current?.removedRoomNumbers ?? []),
  );
  const [extraRooms, setExtraRooms] = useState<Room[]>(initial.current?.extraRooms ?? []);
  const [categoryRates, setCategoryRates] = useState<Record<string, number>>(initial.current?.categoryRates ?? {});

  const getSharedState = useServerFn(getHotelState);
  const setSharedState = useServerFn(setHotelState);
  const cloudWriteRef = useRef<number | null>(null);
  const lastCloudVersionRef = useRef(0);
  const skipNextPersist = useRef(false);

  // Load from Supabase on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const loadCloud = async () => {
      try {
        const row = await getSharedState({ data: { key: 'grid' } });
        if (cancelled) return;
        if (row?.stateData && typeof row.stateData === 'object' && !Array.isArray(row.stateData)) {
          if (row.version <= lastCloudVersionRef.current) return;
          lastCloudVersionRef.current = row.version;
          const data = row.stateData as PersistedState;
          const safe: PersistedState = {
            extraCategories: Array.isArray(data.extraCategories) ? data.extraCategories : [],
            removedCategoryIds: Array.isArray(data.removedCategoryIds) ? data.removedCategoryIds : [],
            removedRoomNumbers: Array.isArray(data.removedRoomNumbers) ? data.removedRoomNumbers : [],
            extraRooms: Array.isArray(data.extraRooms) ? data.extraRooms : [],
            categoryRates: data.categoryRates ?? {},
          };
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
          skipNextPersist.current = true;
          setExtraCategories(safe.extraCategories);
          setRemovedCategoryIds(new Set(safe.removedCategoryIds));
          setRemovedRoomNumbers(new Set(safe.removedRoomNumbers));
          setExtraRooms(safe.extraRooms);
          setCategoryRates(safe.categoryRates ?? {});
        } else {
          // Push local to cloud if cloud is empty
          const local = loadPersisted();
          if (local) {
            await setSharedState({ data: { key: 'grid', stateData: local } });
          } else {
            await setSharedState({ data: { key: 'grid', stateData: EMPTY_STATE } });
          }
        }
      } catch { /* keep local */ }
    };
    loadCloud();
    return () => { cancelled = true; };
  }, []);

  const baseRooms = useMemo<Room[]>(() => {
    const rooms: Room[] = [];
    let floor = 1;
    ROOM_CATEGORIES.forEach((cat) => {
      for (let i = 1; i <= ROOMS_PER_CATEGORY; i++) {
        rooms.push({ number: floor * 100 + i, category: cat.id });
      }
      floor++;
    });
    return rooms;
  }, []);

  // Persist to localStorage + Supabase on every change
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    const payload: PersistedState = {
      extraCategories,
      removedCategoryIds: Array.from(removedCategoryIds),
      removedRoomNumbers: Array.from(removedRoomNumbers),
      extraRooms,
      categoryRates,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    // Debounced Supabase write
    if (cloudWriteRef.current) window.clearTimeout(cloudWriteRef.current);
    cloudWriteRef.current = window.setTimeout(() => {
      void setSharedState({ data: { key: 'grid', stateData: payload } }).then((row) => {
        lastCloudVersionRef.current = row.version;
        cloudWriteRef.current = null;
      }).catch(() => undefined);
    }, 300);
  }, [extraCategories, removedCategoryIds, removedRoomNumbers, extraRooms, categoryRates]);

  // Cross-tab sync
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reload = () => {
      const data = loadPersisted();
      if (!data) return;
      skipNextPersist.current = true;
      setExtraCategories(data.extraCategories);
      setRemovedCategoryIds(new Set(data.removedCategoryIds));
      setRemovedRoomNumbers(new Set(data.removedRoomNumbers));
      setExtraRooms(data.extraRooms);
      setCategoryRates(data.categoryRates ?? {});
    };
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) reload(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, reload as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGE_EVENT, reload as EventListener);
    };
  }, []);

  const categories = useMemo(
    () => [...baseCategories, ...extraCategories].filter((category) => !removedCategoryIds.has(category.id)),
    [baseCategories, extraCategories, removedCategoryIds],
  );

  const rooms = useMemo<Room[]>(() => {
    const visibleBase = baseRooms.filter((r) => !removedRoomNumbers.has(r.number) && !removedCategoryIds.has(r.category));
    const merged = [...visibleBase, ...extraRooms.filter((r) => !removedCategoryIds.has(r.category))];
    return merged.sort((a, b) => a.number - b.number);
  }, [baseRooms, removedRoomNumbers, extraRooms, removedCategoryIds]);

  const addCategory = useCallback(({ name, short, maxGuests }: { name: string; short: string; maxGuests: number }) => {
    const id = `custom-${Date.now()}`;
    setExtraCategories((prev) => [
      ...prev,
      {
        id,
        custom: true,
        short: short.trim() || name.slice(0, 6).toUpperCase(),
        maxGuests: Math.max(1, Math.floor(maxGuests || 1)),
        label: { ru: name, uz: name, en: name },
      },
    ]);
  }, []);

  const removeCategory = useCallback((id: string) => {
    setRemovedCategoryIds((prev) => new Set(prev).add(id));
    setExtraCategories((prev) => prev.filter((c) => c.id !== id));
    setExtraRooms((prev) => prev.filter((r) => r.category !== id));
  }, []);

  const addRoom = useCallback(
    (categoryId: string, roomNumber: number) => {
      if (!Number.isFinite(roomNumber) || roomNumber <= 0) return { ok: false, reason: 'invalid' as const };
      const allNumbers = new Set([...baseRooms.map((r) => r.number), ...extraRooms.map((r) => r.number)]);
      if (allNumbers.has(roomNumber) && !removedRoomNumbers.has(roomNumber))
        return { ok: false, reason: 'exists' as const };
      setExtraRooms((prev) => [...prev, { number: roomNumber, category: categoryId as RoomCategory }]);
      setRemovedRoomNumbers((prev) => {
        if (!prev.has(roomNumber)) return prev;
        const n = new Set(prev);
        n.delete(roomNumber);
        return n;
      });
      return { ok: true };
    },
    [baseRooms, extraRooms, removedRoomNumbers],
  );

  const removeRoom = useCallback((roomNumber: number) => {
    setExtraRooms((prev) => prev.filter((r) => r.number !== roomNumber));
    setRemovedRoomNumbers((prev) => new Set(prev).add(roomNumber));
  }, []);

  const setCategoryRate = useCallback((categoryId: string, rate: number) => {
    setCategoryRates((prev) => ({ ...prev, [categoryId]: Math.max(0, Number.isFinite(rate) ? rate : 0) }));
  }, []);

  const value: Ctx = { categories, rooms, categoryRates, addCategory, removeCategory, addRoom, removeRoom, setCategoryRate };
  return <HotelGridContext.Provider value={value}>{children}</HotelGridContext.Provider>;
}

export function useHotelGrid() {
  const ctx = useContext(HotelGridContext);
  if (!ctx) throw new Error('useHotelGrid must be used inside HotelGridProvider');
  return ctx;
}