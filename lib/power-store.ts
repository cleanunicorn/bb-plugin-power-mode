// Power Mode preferences, shared by the effects engine (content script) and
// the settings UI. A copy lives in the bb origin's localStorage (shared by
// every window in a browser profile, keyed by the plugin id, synced across open
// windows through the `storage` event) so effects start instantly; the saved
// copy lives on the bb server and is kept in step by lib/settings-sync.ts.

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
const listeners = new Set<() => void>();
const localChangeListeners = new Set<(keys: (keyof PowerSettings)[]) => void>();
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
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Storage full or blocked: keep the in-memory value.
  }
}

function emit() {
  for (const listener of listeners) listener();
}

/** Idempotent; the first caller decides the storage key. */
export function initPowerStore(pluginId: string) {
  if (initialized) return;
  initialized = true;
  keyPrefix = pluginId;
  storageKey = `${pluginId}:power-mode:settings`;
  try {
    state = parse(window.localStorage.getItem(storageKey));
  } catch {
    state = DEFAULT_SETTINGS;
  }
  resolveReady();
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

/** A change made in this window: persisted locally and announced for the server sync. */
export function updatePowerSettings(patch: Partial<PowerSettings>) {
  state = { ...state, ...patch };
  writeLocal();
  emit();
  const keys = Object.keys(patch) as (keyof PowerSettings)[];
  for (const listener of localChangeListeners) listener(keys);
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
