// Visual themes. A theme picks the color for a given combo, the particle shape
// sparks turn into, how they fall, and whether the bloom layer applies.

import type { ThemeId } from "./power-store";

export type SparkShape = "glow" | "pixel" | "petal" | "code";

export interface Theme {
  id: ThemeId;
  name: string;
  emoji: string;
  description: string;
  /** CSS colors for the settings swatch. */
  swatch: string[];
  shape: SparkShape;
  /** Gravity multiplier for sparks (negative rises). */
  gravity: number;
  bloom: boolean;
  /** Font stack for flying letters, the HUD and milestone titles. */
  font: string;
  /** Override milestone colors with this theme's palette. */
  ownMilestoneHue: boolean;
  hue(combo: number, now: number): number;
}

const SANS = 'ui-sans-serif, system-ui, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

const RETRO_HUES = [0, 30, 55, 120, 195, 280, 320];
const CYBER_HUES = [305, 185, 55];

export const THEMES: Record<ThemeId, Theme> = {
  neon: {
    id: "neon",
    name: "Neon",
    emoji: "🌈",
    description: "Ice → toxic → fire → plasma → rainbow as the combo climbs.",
    swatch: ["#22d3ee", "#4ade80", "#fb923c", "#e879f9"],
    shape: "glow",
    gravity: 1,
    bloom: true,
    font: SANS,
    ownMilestoneHue: false,
    hue(combo, now) {
      if (combo < 10) return 190 + Math.sin(now / 300) * 15;
      if (combo < 25) return 140 + Math.sin(now / 250) * 20;
      if (combo < 50) return 20 + Math.sin(now / 200) * 18;
      if (combo < 100) return 300 + Math.sin(now / 180) * 30;
      return (now / 6 + combo * 7) % 360;
    },
  },
  fire: {
    id: "fire",
    name: "Inferno",
    emoji: "🔥",
    description: "Embers rise, sparks burn from red to white-hot gold.",
    swatch: ["#7f1d1d", "#dc2626", "#f97316", "#fde047"],
    shape: "glow",
    gravity: -0.35,
    bloom: true,
    font: SANS,
    ownMilestoneHue: true,
    hue(combo, now) {
      return 8 + Math.min(combo / 120, 1) * 32 + Math.sin(now / 90) * 8;
    },
  },
  matrix: {
    id: "matrix",
    name: "Matrix",
    emoji: "🟩",
    description: "Every keystroke rains green code.",
    swatch: ["#022c22", "#15803d", "#22c55e", "#bbf7d0"],
    shape: "code",
    gravity: 0.35,
    bloom: true,
    font: MONO,
    ownMilestoneHue: true,
    hue(_combo, now) {
      return 128 + Math.sin(now / 400) * 8;
    },
  },
  sakura: {
    id: "sakura",
    name: "Sakura",
    emoji: "🌸",
    description: "Cherry-blossom petals drift and sway.",
    swatch: ["#fdf2f8", "#fbcfe8", "#f472b6", "#db2777"],
    shape: "petal",
    gravity: 0.12,
    bloom: true,
    font: SANS,
    ownMilestoneHue: true,
    hue(_combo, now) {
      return 332 + Math.sin(now / 500) * 10;
    },
  },
  cyberpunk: {
    id: "cyberpunk",
    name: "Cyberpunk",
    emoji: "🌃",
    description: "Hot magenta, electric cyan, warning yellow.",
    swatch: ["#ff2bd6", "#00e5ff", "#ffe600", "#1e1b4b"],
    shape: "glow",
    gravity: 0.6,
    bloom: true,
    font: SANS,
    ownMilestoneHue: true,
    hue(combo) {
      return CYBER_HUES[combo % CYBER_HUES.length];
    },
  },
  retro: {
    id: "retro",
    name: "Retro 8-bit",
    emoji: "👾",
    description: "Chunky pixels, a console palette, no bloom.",
    swatch: ["#e40058", "#f8b800", "#00a800", "#0058f8"],
    shape: "pixel",
    gravity: 1.2,
    bloom: false,
    font: MONO,
    ownMilestoneHue: true,
    hue(combo) {
      return RETRO_HUES[combo % RETRO_HUES.length];
    },
  },
};

// ---------------------------------------------------------------- paste ordnance skins
//
// Pasting drops "ordnance" whose weapon tier (1–9) grows with the paste size.
// The choreography is shared; each theme re-skins how the weapons are drawn,
// what their explosions scatter, their slam titles, and their sound.

/** Draw treatment for ordnance bodies. */
export type OrdnanceStyle = "tube" | "solid" | "glyph" | "paper" | "hardedge" | "pixel";
/** Particle kind ordnance explosions scatter. */
export type OrdnanceDebris = "spark" | "ember" | "code" | "petal" | "pixel";
/** Synth flavor: changes oscillator shapes and the noise mix. */
export type OrdnanceSound = "standard" | "heavy" | "bit" | "soft" | "glitch" | "chip";

export interface OrdnanceSkin {
  style: OrdnanceStyle;
  debris: OrdnanceDebris;
  sound: OrdnanceSound;
  /** Slam title per tier, 1 → 9. */
  titles: readonly [string, string, string, string, string, string, string, string, string];
  /** Warning slam shown while the orbital strike locks on. */
  lockTitle: string;
  /** Warning slam shown while the nuke falls. */
  incomingTitle: string;
}

export const ORDNANCE_SKINS: Record<ThemeId, OrdnanceSkin> = {
  neon: {
    style: "tube",
    debris: "spark",
    sound: "standard",
    titles: ["POP", "OVERLOAD", "SPLIT SHOT", "NEON STRIKE", "LIGHT SHOW", "LASER LOCK", "STARFALL", "☢ MELTDOWN ☢", "EVENT HORIZON"],
    lockTitle: "TARGET LOCKED",
    incomingTitle: "⚠ INCOMING ⚠",
  },
  fire: {
    style: "solid",
    debris: "ember",
    sound: "heavy",
    titles: ["CRACKLE", "KA-BOOM", "SHRAPNEL", "HELLFIRE", "FIRESTORM", "SUN LANCE", "ARMAGEDDON", "☢ TACTICAL NUKE ☢", "SUPERNOVA"],
    lockTitle: "TARGET LOCKED",
    incomingTitle: "⚠ INCOMING ⚠",
  },
  matrix: {
    style: "glyph",
    debris: "code",
    sound: "bit",
    titles: ["ping", "EXEC TNT", "fork()", "PAYLOAD DELIVERED", "rm -rf /", "sudo strike", "STACK OVERFLOW", "☢ SYSTEM FAILURE ☢", "SEGFAULT"],
    lockTitle: "> TARGET ACQUIRED",
    incomingTitle: "⚠ INCOMING ⚠",
  },
  sakura: {
    style: "paper",
    debris: "petal",
    sound: "soft",
    titles: ["PON!", "PACHI!", "KUSUDAMA", "HANABI", "PETAL STORM", "MOONBEAM", "SHOOTING STARS", "🌸 FULL BLOOM 🌸", "ETERNAL SPRING"],
    lockTitle: "TARGET LOCKED",
    incomingTitle: "⚠ INCOMING ⚠",
  },
  cyberpunk: {
    style: "hardedge",
    debris: "spark",
    sound: "glitch",
    titles: ["BLIP", "EMP", "MINEFIELD", "MISSILE LOCK", "DRONE STRIKE", "RAILGUN", "DEORBIT", "☢ BLACKOUT ☢", "DATA COLLAPSE"],
    lockTitle: "UPLINK LOCKED",
    incomingTitle: "⚠ INCOMING ⚠",
  },
  retro: {
    style: "pixel",
    debris: "pixel",
    sound: "chip",
    titles: ["POP!", "BOMB!", "COMBO BREAKER", "1UP BARRAGE", "BOMBER RUN", "ZAP!", "ASTEROIDS", "☢ GAME OVER ☢", "CONTINUE? 9…"],
    lockTitle: "TARGET LOCKED",
    incomingTitle: "⚠ INCOMING ⚠",
  },
};
