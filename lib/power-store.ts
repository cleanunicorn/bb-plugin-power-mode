// Power Mode preferences, shared by the effects engine (content script) and
// the settings UI. Stored per browser window in localStorage, keyed by the
// plugin id, and synced across tabs through the `storage` event.

export type Intensity = "epic" | "legendary" | "godlike";
export type ThemeId = "neon" | "fire" | "matrix" | "sakura" | "cyberpunk" | "retro";
export const THEME_IDS: readonly ThemeId[] = ["neon", "fire", "matrix", "sakura", "cyberpunk", "retro"];

export interface PowerSettings {
  enabled: boolean;
  intensity: Intensity;
  shake: boolean;
  screenShake: boolean;
  sound: boolean;
  ghostLetters: boolean;
  lightning: boolean;
  /** React to agents writing replies in the transcript. */
  agentMode: boolean;
  /** Keep effects off the text box being typed in (and the streaming agent reply). */
  protectText: boolean;
  theme: ThemeId;
  /** Particle count multiplier, 0.25–3. */
  density: number;
  /** Bloom strength, 0–1 (0 turns the bloom layer off). */
  glow: number;
  bestCombo: number;
}

export const DEFAULT_SETTINGS: PowerSettings = {
  enabled: false,
  intensity: "legendary",
  shake: true,
  screenShake: true,
  sound: false,
  ghostLetters: true,
  lightning: true,
  agentMode: true,
  protectText: true,
  theme: "neon",
  density: 1,
  glow: 0.7,
  bestCombo: 0,
};

export const DENSITY_RANGE = { min: 0.25, max: 3 } as const;

const INTENSITIES: readonly Intensity[] = ["epic", "legendary", "godlike"];

let storageKey = "bb-plugin-power-mode:settings";
let keyPrefix = "bb-plugin-power-mode";
let state: PowerSettings = DEFAULT_SETTINGS;
let initialized = false;
const listeners = new Set<() => void>();

/** Persisted values are untrusted: keep only well-typed fields. */
function parse(raw: string | null): PowerSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_SETTINGS;
    const v = value as Record<string, unknown>;
    const bool = (key: keyof PowerSettings) =>
      typeof v[key] === "boolean" ? (v[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean);
    const num = (key: "density" | "glow", min: number, max: number) =>
      typeof v[key] === "number" && Number.isFinite(v[key])
        ? Math.min(max, Math.max(min, v[key] as number))
        : DEFAULT_SETTINGS[key];
    const best = typeof v.bestCombo === "number" && Number.isFinite(v.bestCombo) ? Math.max(0, Math.floor(v.bestCombo)) : 0;
    return {
      enabled: bool("enabled"),
      intensity: INTENSITIES.includes(v.intensity as Intensity) ? (v.intensity as Intensity) : DEFAULT_SETTINGS.intensity,
      shake: bool("shake"),
      screenShake: bool("screenShake"),
      sound: bool("sound"),
      ghostLetters: bool("ghostLetters"),
      lightning: bool("lightning"),
      agentMode: bool("agentMode"),
      protectText: bool("protectText"),
      theme: THEME_IDS.includes(v.theme as ThemeId) ? (v.theme as ThemeId) : DEFAULT_SETTINGS.theme,
      density: num("density", DENSITY_RANGE.min, DENSITY_RANGE.max),
      glow: num("glow", 0, 1),
      bestCombo: best,
    };
  } catch {
    return DEFAULT_SETTINGS;
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

export function getPowerSettings(): PowerSettings {
  return state;
}

export function updatePowerSettings(patch: Partial<PowerSettings>) {
  state = { ...state, ...patch };
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Storage full or blocked: keep the in-memory value.
  }
  emit();
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
