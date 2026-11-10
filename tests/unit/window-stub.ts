import { vi } from "vitest";

type StorageListener = (event: { key: string | null; newValue: string | null }) => void;

/** Installs a minimal `window` (localStorage, timers, storage events) for the lib modules. */
export function installWindow(options: { failWrites?: boolean; failReads?: boolean } = {}) {
  const data = new Map<string, string>();
  const listeners = new Set<StorageListener>();
  const localStorage = {
    getItem(key: string) {
      if (options.failReads) throw new Error("storage blocked");
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (options.failWrites) throw new Error("quota exceeded");
      data.set(key, value);
    },
  };
  const win = {
    localStorage,
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (id: Parameters<typeof clearTimeout>[0]) => clearTimeout(id),
    addEventListener(type: string, listener: StorageListener, opts?: { signal?: AbortSignal }) {
      if (type !== "storage") return;
      listeners.add(listener);
      opts?.signal?.addEventListener("abort", () => listeners.delete(listener));
    },
  };
  vi.stubGlobal("window", win);
  return {
    data,
    /** Simulates another tab writing to storage. */
    dispatchStorage(key: string | null, newValue: string | null) {
      for (const listener of [...listeners]) listener({ key, newValue });
    },
  };
}
