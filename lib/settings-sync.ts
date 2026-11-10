// Keeps the local settings store in step with the copy saved on the bb server.
//
// - On start the server copy wins: it is applied over the local copy. If the
//   server has nothing yet (first run after this feature shipped), the local
//   copy is uploaded, so existing preferences carry over.
// - Fields changed in this window before the server answered win over the
//   server copy; the merged result is uploaded. Other fields still come from
//   the server, so a stale local copy (say, a new device's defaults plus a
//   combo record) never overwrites the saved settings wholesale.
// - Local changes are uploaded after a short debounce (sliders fire often).
// - `refresh()` (called when another client saved) reloads the server copy,
//   unless this window has an upload pending, which would overwrite it anyway.
// - Failed loads and uploads retry with backoff; the local copy keeps working
//   offline in the meantime.

import {
  applyRemotePowerSettings,
  getPowerSettings,
  powerStoreReady,
  subscribeLocalSettingsChanges,
  type PowerSettings,
} from "./power-store";

export interface SettingsRemote {
  /** The saved settings, or `null` when nothing was saved yet. */
  load(): Promise<unknown | null>;
  save(settings: PowerSettings): Promise<void>;
}

export interface SettingsSyncOptions {
  signal: AbortSignal;
  /** Delay before uploading local changes. */
  debounceMs?: number;
  /** First retry delay after a failed request; doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
  onError?: (error: unknown) => void;
}

export interface SettingsSync {
  /** Another client saved: reload the server copy. */
  refresh(): void;
  /** Resolves once the first load (and any upload it triggered) settled. */
  readonly hydrated: Promise<void>;
}

export function startSettingsSync(remote: SettingsRemote, options: SettingsSyncOptions): SettingsSync {
  const { signal, debounceMs = 400, retryMs = 2_000, maxRetryMs = 60_000, onError } = options;
  let hydrated = false;
  /** A local change not yet uploaded. */
  let dirty = false;
  /** Fields changed in this window before the first load succeeded. */
  const changedBeforeHydration = new Set<keyof PowerSettings>();
  let saving = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let refreshQueued = false;

  const backoff = () => Math.min(maxRetryMs, retryMs * 2 ** Math.max(0, failures - 1));
  const busy = () => dirty || saving || timer !== null;

  function schedule(delay: number) {
    if (signal.aborted) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void (hydrated ? upload() : hydrate());
    }, delay);
  }

  async function upload() {
    if (saving || !dirty || signal.aborted) return;
    dirty = false;
    saving = true;
    try {
      await remote.save(getPowerSettings());
      failures = 0;
    } catch (error) {
      dirty = true;
      failures++;
      onError?.(error);
    } finally {
      saving = false;
    }
    if (dirty) schedule(failures > 0 ? backoff() : debounceMs);
    else if (refreshQueued) void reload();
  }

  async function reload() {
    refreshQueued = false;
    if (signal.aborted) return;
    try {
      const saved = await remote.load();
      // A local edit made while loading is newer: keep it and let it upload.
      if (signal.aborted || busy()) return;
      if (saved !== null) applyRemotePowerSettings(saved);
    } catch (error) {
      onError?.(error);
    }
  }

  let settleHydration: () => void = () => {};
  const hydratedPromise = new Promise<void>((resolve) => {
    settleHydration = resolve;
  });

  async function hydrate() {
    if (signal.aborted) return settleHydration();
    let saved: unknown | null;
    try {
      saved = await remote.load();
    } catch (error) {
      failures++;
      onError?.(error);
      schedule(backoff());
      return;
    }
    if (signal.aborted) return settleHydration();
    failures = 0;
    hydrated = true;
    if (saved === null) {
      dirty = true;
      await upload();
    } else if (dirty) {
      const local = getPowerSettings();
      const merged: Record<string, unknown> = { ...(saved as Record<string, unknown>) };
      for (const key of changedBeforeHydration) merged[key] = local[key];
      applyRemotePowerSettings(merged);
      await upload();
    } else {
      applyRemotePowerSettings(saved);
    }
    changedBeforeHydration.clear();
    settleHydration();
  }

  const unsubscribe = subscribeLocalSettingsChanges((keys) => {
    dirty = true;
    if (!hydrated) for (const key of keys) changedBeforeHydration.add(key);
    if (hydrated && !saving) schedule(debounceMs);
  });

  signal.addEventListener(
    "abort",
    () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
      timer = null;
      // Best effort: don't lose a change made just before the window closed.
      if (hydrated && dirty && !saving) {
        dirty = false;
        void remote.save(getPowerSettings()).catch(() => {});
      }
      settleHydration();
    },
    { once: true },
  );

  void powerStoreReady.then(() => hydrate());

  return {
    refresh() {
      if (!hydrated || signal.aborted) return;
      if (saving) refreshQueued = true;
      else if (!busy()) void reload();
    },
    hydrated: hydratedPromise,
  };
}
