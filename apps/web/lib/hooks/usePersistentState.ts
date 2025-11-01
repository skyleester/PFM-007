"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useSyncExternalStore } from "react";

type StorageKind = "local" | "session" | "memory";

export type UsePersistentStateOptions<T> = {
  storage?: Exclude<StorageKind, "memory">;
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
};

type Listener = () => void;

type StoreEntry<T> = {
  key: string;
  value: T;
  hydrated: boolean;
  storageKind: StorageKind;
  serialize: (value: T) => string;
  deserialize: (value: string) => T;
  getInitial: () => T;
  listeners: Set<Listener>;
  hydrationListeners: Set<Listener>;
  subscribe: (listener: Listener) => () => void;
  subscribeHydration: (listener: Listener) => () => void;
  notify: () => void;
  notifyHydration: () => void;
  hydrationRequested: boolean;
  storage?: Storage | null;
};

const storeRegistry = new Map<string, StoreEntry<any>>();

function resolveInitialValue<T>(initialState: T | (() => T)): T {
  return typeof initialState === "function" ? (initialState as () => T)() : initialState;
}

const defaultSerialize = (value: unknown): string => JSON.stringify(value);
const defaultDeserialize = <T,>(value: string): T => JSON.parse(value) as T;

function resolveStorage(kind: StorageKind): Storage | null {
  if (typeof window === "undefined") return null;
  if (kind === "local") return window.localStorage;
  if (kind === "session") return window.sessionStorage;
  return null;
}

function getEntry<T>(
  key: string,
  initialState: T | (() => T),
  options: UsePersistentStateOptions<T> | undefined
): StoreEntry<T> {
  const existing = storeRegistry.get(key) as StoreEntry<T> | undefined;
  if (existing) {
    return existing;
  }

  const storageKind: StorageKind = options?.storage ?? "session";
  const serialize: (value: T) => string = options?.serialize ?? ((value) => defaultSerialize(value));
  const deserialize: (value: string) => T = options?.deserialize ?? ((value) => defaultDeserialize<T>(value));
  const entry: StoreEntry<T> = {
    key,
    value: resolveInitialValue(initialState),
    hydrated: false,
    storageKind,
    serialize,
    deserialize,
    getInitial: () => resolveInitialValue(initialState),
    listeners: new Set(),
    hydrationListeners: new Set(),
    hydrationRequested: false,
    subscribe(listener: Listener) {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    },
    subscribeHydration(listener: Listener) {
      this.hydrationListeners.add(listener);
      return () => {
        this.hydrationListeners.delete(listener);
      };
    },
    notify() {
      this.listeners.forEach((listener) => listener());
    },
    notifyHydration() {
      this.hydrationListeners.forEach((listener) => listener());
    },
  };

  storeRegistry.set(key, entry);
  return entry;
}

function ensureHydrated<T>(entry: StoreEntry<T>) {
  if (entry.hydrationRequested) {
    return;
  }
  entry.hydrationRequested = true;

  if (typeof window === "undefined") {
    entry.hydrated = true;
    entry.notifyHydration();
    return;
  }

  const storage = resolveStorage(entry.storageKind);
  entry.storage = storage;

  if (!storage) {
    entry.hydrated = true;
    entry.notifyHydration();
    return;
  }

  try {
    const raw = storage.getItem(entry.key);
    if (raw !== null) {
      const value = entry.deserialize(raw);
      entry.value = value;
      entry.notify();
    }
  } catch (error) {
    console.warn(`Failed to read persistent state for ${entry.key}`, error);
  } finally {
    entry.hydrated = true;
    entry.notifyHydration();
  }
}

function persistEntry<T>(entry: StoreEntry<T>) {
  if (typeof window === "undefined") return;
  if (entry.storageKind === "memory") return;

  const storage = entry.storage ?? resolveStorage(entry.storageKind);
  if (!storage) return;
  entry.storage = storage;

  try {
    storage.setItem(entry.key, entry.serialize(entry.value));
  } catch (error) {
    console.warn(`Failed to write persistent state for ${entry.key}`, error);
  }
}

function clearEntry<T>(entry: StoreEntry<T>) {
  if (typeof window !== "undefined" && entry.storageKind !== "memory") {
    const storage = entry.storage ?? resolveStorage(entry.storageKind);
    if (storage) {
      try {
        storage.removeItem(entry.key);
      } catch (error) {
        console.warn(`Failed to clear persistent state for ${entry.key}`, error);
      }
    }
  }
  entry.value = entry.getInitial();
  entry.notify();
}

export function usePersistentState<T>(
  key: string,
  initialState: T | (() => T),
  options?: UsePersistentStateOptions<T>
): [T, (value: T | ((prev: T) => T)) => void, () => void, boolean] {
  const entry = useMemo(() => getEntry<T>(key, initialState, options), [key, initialState, options]);

  useEffect(() => {
    ensureHydrated(entry);
  }, [entry]);

  const subscribe = useCallback((listener: Listener) => entry.subscribe(listener), [entry]);
  const getSnapshot = useCallback(() => entry.value, [entry]);
  const subscribeHydration = useCallback((listener: Listener) => entry.subscribeHydration(listener), [entry]);
  const getHydrationSnapshot = useCallback(() => entry.hydrated, [entry]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const hydrated = useSyncExternalStore(subscribeHydration, getHydrationSnapshot, getHydrationSnapshot);

  const setState = useCallback(
    (update: T | ((prev: T) => T)) => {
      const nextValue = typeof update === "function" ? (update as (prev: T) => T)(entry.value) : update;
      if (Object.is(entry.value, nextValue)) {
        return;
      }
      entry.value = nextValue;
      entry.notify();
      persistEntry(entry);
    },
    [entry]
  );

  const clear = useCallback(() => {
    clearEntry(entry);
    persistEntry(entry);
  }, [entry]);

  return [state, setState, clear, hydrated];
}
