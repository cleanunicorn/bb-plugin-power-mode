// Power Mode settings model: types, defaults and the sanitizer. Pure (no
// window access) so the backend can validate what it stores with the same rules
// the browser applies.

export type Intensity = "epic" | "legendary" | "godlike";
export type ThemeId = "neon" | "fire" | "matrix" | "sakura" | "cyberpunk" | "retro";
export const THEME_IDS: readonly ThemeId[] = ["neon", "fire", "matrix", "sakura", "cyberpunk", "retro"];

export interface PowerSettings {
  enabled: boolean;
  particles: boolean;
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
  /**
   * Reduce motion: no shake, no full-screen flashes, no lightning. `null`
   * follows the OS `prefers-reduced-motion` setting; `true`/`false` is an
   * explicit user override that wins over the OS from then on.
   */
  reduceMotion: boolean | null;
}

export const DEFAULT_SETTINGS: PowerSettings = {
  enabled: false,
  particles: true,
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
  reduceMotion: null,
};

export const DENSITY_RANGE = { min: 0.25, max: 3 } as const;

export const INTENSITIES: readonly Intensity[] = ["epic", "legendary", "godlike"];

/**
 * Persisted and remote values are untrusted: keep only well-typed fields,
 * clamp ranges, and fall back to the defaults for anything else.
 */
export function sanitizeSettings(value: unknown): PowerSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_SETTINGS;
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
    particles: bool("particles"),
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
    reduceMotion: typeof v.reduceMotion === "boolean" ? v.reduceMotion : null,
  };
}

/** True when two settings documents hold the same values. */
export function sameSettings(a: PowerSettings, b: PowerSettings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as (keyof PowerSettings)[]).every((key) => a[key] === b[key]);
}
