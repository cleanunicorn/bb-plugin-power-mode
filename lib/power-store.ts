// Power Mode preferences, shared by the effects engine (content script) and
// the settings UI. A copy lives in the bb origin's localStorage (shared by
// every window in a browser profile, keyed by the plugin id, synced across open
// windows through the `storage` event) so effects start instantly; the saved
// copy lives on the bb server and is kept in step by lib/settings-sync.ts.
//
// The storage keys depend on the plugin id, which `initPowerStore` sets. Every
// entry point calls it: the content script with its mount context, and each UI
// slot during render (see `withPowerStore` in app.tsx), so the host's mount
// order does not matter. Until then the store is memory-only: reads return
// defaults, `updatePowerSettings` changes memory and queues the patch, and
// nothing is written. Init loads the stored copy, applies queued patches over
// it, writes the result, runs `onPowerStoreInit` callbacks synchronously and
// notifies subscribers in a microtask (init can run during a React render).

import { DEFAULT_SETTINGS, sameSettings, sanitizeSettings, type PowerSettings } from "./power-settings";

export {
  DEFAULT_SETTINGS,
  DENSITY_RANGE,
  THEME_IDS,
  sanitizeSettings,
  type Intensity,
  type PowerSettings,
  type ThemeId,
} from "./power-settings";

let storageKey = "bb-plugin-power-mode:settings";
let keyPrefix = "bb-plugin-power-mode";
let state: PowerSettings = DEFAULT_SETTINGS;
let initialized = false;
/** Changes made before init, applied over the stored copy once it is known. */
let pendingPatch: Partial<PowerSettings> | null = null;
/**
 * Fields changed in this window while no server sync was listening (before
 * init, or before the sync started). The sync seeds its pre-hydration changes
 * from these and clears them once the server copy is reconciled.
 */
const unsyncedKeys = new Set<keyof PowerSettings>();
const listeners = new Set<() => void>();
const localChangeListeners = new Set<(keys: (keyof PowerSettings)[]) => void>();
const initCallbacks = new Set<() => void>();
let resolveReady: () => void = () => {};
/** Resolves once `initPowerStore` has loaded the local copy. */
export const powerStoreReady: Promise<void> = new Promise((resolve) => {
  resolveReady = resolve;
});

function parse(raw: string | null): PowerSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeLocal() {
  if (!initialized) return; // the key is not known yet
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Storage full or blocked: keep the in-memory value.
  }
}

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Idempotent; the first caller decides the storage keys. Safe to call during a
 * React render: storage is loaded synchronously, subscribers hear about it in
 * a microtask.
 */
export function initPowerStore(pluginId: string) {
  if (initialized) return;
  initialized = true;
  keyPrefix = pluginId;
  storageKey = `${pluginId}:power-mode:settings`;
  const seen = state;
  let loaded: PowerSettings;
  try {
    loaded = parse(window.localStorage.getItem(storageKey));
  } catch {
    loaded = DEFAULT_SETTINGS;
  }
  if (pendingPatch) {
    state = { ...loaded, ...pendingPatch };
    pendingPatch = null;
    writeLocal();
  } else {
    state = loaded;
  }
  for (const callback of [...initCallbacks]) callback();
  if (!sameSettings(seen, state)) queueMicrotask(emit);
  resolveReady();
}

export function isPowerStoreInitialized(): boolean {
  return initialized;
}

/**
 * Runs `callback` synchronously inside `initPowerStore`, once the storage keys
 * are known. Does nothing if the store is already initialised.
 */
export function onPowerStoreInit(callback: () => void) {
  if (initialized) return () => {};
  initCallbacks.add(callback);
  return () => {
    initCallbacks.delete(callback);
  };
}

/** Keeps every tab/window in sync. Returns a disposer. */
export function watchExternalChanges(signal: AbortSignal) {
  window.addEventListener(
    "storage",
    (event) => {
      if (event.key !== storageKey) return;
      state = parse(event.newValue);
      emit();
    },
    { signal },
  );
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function systemMedia(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
  } catch {
    return null;
  }
}

/** The OS-level `prefers-reduced-motion: reduce` value, read live (never persisted). */
export function getSystemReducedMotion(): boolean {
  return systemMedia()?.matches === true;
}

/** Effective value: the explicit override if the user chose one, else the OS preference. */
export function getReducedMotion(): boolean {
  return state.reduceMotion ?? getSystemReducedMotion();
}

/** Notifies subscribers when the OS motion preference changes. */
export function watchSystemMotion(signal: AbortSignal) {
  const media = systemMedia();
  if (!media) return;
  media.addEventListener("change", () => emit(), { signal });
}

/**
 * `useSyncExternalStore`-style subscription to the OS motion preference, for UI
 * that shows the effective value (the settings snapshot does not change on an OS flip).
 */
export function subscribeSystemMotion(listener: () => void) {
  const media = systemMedia();
  if (!media) return () => {};
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function getPowerSettings(): PowerSettings {
  return state;
}

/**
 * A change made in this window: persisted locally and announced for the server
 * sync. Before init it only changes memory and is applied again over the
 * stored copy when init loads it.
 */
export function updatePowerSettings(patch: Partial<PowerSettings>) {
  state = { ...state, ...patch };
  if (!initialized) pendingPatch = { ...pendingPatch, ...patch };
  writeLocal();
  emit();
  const keys = Object.keys(patch) as (keyof PowerSettings)[];
  if (localChangeListeners.size === 0) for (const key of keys) unsyncedKeys.add(key);
  for (const listener of localChangeListeners) listener(keys);
}

/** Fields changed in this window while no server sync was listening. */
export function getUnsyncedLocalChanges(): (keyof PowerSettings)[] {
  return [...unsyncedKeys];
}

/** The server sync reconciled the fields from `getUnsyncedLocalChanges`. */
export function clearUnsyncedLocalChanges(keys: Iterable<keyof PowerSettings>) {
  for (const key of keys) unsyncedKeys.delete(key);
}

/**
 * Applies settings loaded from the server (untrusted). Updates the local copy
 * but is not reported as a local change, so it is never echoed back.
 * Returns whether anything changed.
 */
export function applyRemotePowerSettings(value: unknown): boolean {
  const next = sanitizeSettings(value);
  if (sameSettings(next, state)) return false;
  state = next;
  writeLocal();
  emit();
  return true;
}

/**
 * Fires only for changes made in this window (not other tabs or the server),
 * with the names of the fields that were set.
 */
export function subscribeLocalSettingsChanges(listener: (keys: (keyof PowerSettings)[]) => void) {
  localChangeListeners.add(listener);
  return () => {
    localChangeListeners.delete(listener);
  };
}

export function subscribePowerSettings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** localStorage key for another Power Mode document (stats), namespaced by plugin id. */
export function powerStorageKey(name: string): string {
  return `${keyPrefix}:power-mode:${name}`;
}
