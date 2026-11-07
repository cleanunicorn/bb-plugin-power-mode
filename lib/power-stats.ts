// Lifetime stats and achievements. The engine records events in memory on
// every keystroke; they are persisted at most every 2 seconds so typing never
// pays for a localStorage write. Unlocks notify through `onUnlock`.

import { THEME_IDS, powerStorageKey, type ThemeId } from "./power-store";

export interface PowerStats {
  chars: number;
  deletes: number;
  pastes: number;
  milestones: number;
  bestCombo: number;
  bestWpm: number;
  agentChars: number;
  bestAgentWords: number;
  agentTurns: number;
  themesTried: ThemeId[];
  /** achievement id → unlock time (ms since epoch) */
  unlocked: Record<string, number>;
}

export const EMPTY_STATS: PowerStats = {
  chars: 0,
  deletes: 0,
  pastes: 0,
  milestones: 0,
  bestCombo: 0,
  bestWpm: 0,
  agentChars: 0,
  bestAgentWords: 0,
  agentTurns: 0,
  themesTried: [],
  unlocked: {},
};

export interface Achievement {
  id: string;
  icon: string;
  title: string;
  description: string;
  check(stats: PowerStats, ctx: { hour: number }): boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-spark", icon: "✨", title: "First Spark", description: "Type with Power Mode on.", check: (s) => s.chars >= 1 },
  { id: "combo-10", icon: "🔥", title: "Warming Up", description: "Reach a 10 combo.", check: (s) => s.bestCombo >= 10 },
  { id: "combo-50", icon: "⚡", title: "Unstoppable", description: "Reach a 50 combo.", check: (s) => s.bestCombo >= 50 },
  { id: "combo-100", icon: "💯", title: "Centurion", description: "Reach a 100 combo.", check: (s) => s.bestCombo >= 100 },
  { id: "combo-250", icon: "⚔️", title: "Keyboard Warrior", description: "Reach a 250 combo.", check: (s) => s.bestCombo >= 250 },
  { id: "combo-500", icon: "👑", title: "Ascended", description: "Reach a 500 combo.", check: (s) => s.bestCombo >= 500 },
  { id: "chars-1k", icon: "✍️", title: "Wordsmith", description: "Type 1,000 characters.", check: (s) => s.chars >= 1_000 },
  { id: "chars-10k", icon: "📜", title: "Novelist", description: "Type 10,000 characters.", check: (s) => s.chars >= 10_000 },
  { id: "chars-100k", icon: "🏛️", title: "Legend of the Keys", description: "Type 100,000 characters.", check: (s) => s.chars >= 100_000 },
  { id: "wpm-60", icon: "🏃", title: "Fast Fingers", description: "Hit 60 WPM.", check: (s) => s.bestWpm >= 60 },
  { id: "wpm-100", icon: "😈", title: "Speed Demon", description: "Hit 100 WPM.", check: (s) => s.bestWpm >= 100 },
  { id: "wpm-140", icon: "🚀", title: "Lightspeed", description: "Hit 140 WPM.", check: (s) => s.bestWpm >= 140 },
  { id: "deletes-500", icon: "🧽", title: "Second Thoughts", description: "Delete 500 characters.", check: (s) => s.deletes >= 500 },
  { id: "pastes-25", icon: "📋", title: "Ctrl+V Warrior", description: "Paste 25 times.", check: (s) => s.pastes >= 25 },
  { id: "night-owl", icon: "🦉", title: "Night Owl", description: "Type between midnight and 4 AM.", check: (s, c) => s.chars > 0 && c.hour < 4 },
  { id: "agent-hype", icon: "📣", title: "Hype Man", description: "Cheer on an agent through 1,000 characters.", check: (s) => s.agentChars >= 1_000 },
  { id: "agent-500", icon: "🤝", title: "Pair Programmer", description: "Watch an agent write 500 words in one reply.", check: (s) => s.bestAgentWords >= 500 },
  { id: "agent-turns-25", icon: "🎬", title: "Director", description: "See 25 agent turns finish.", check: (s) => s.agentTurns >= 25 },
  { id: "theme-tourist", icon: "🎨", title: "Theme Tourist", description: "Try every theme.", check: (s) => THEME_IDS.every((t) => s.themesTried.includes(t)) },
];

let stats: PowerStats = EMPTY_STATS;
let loaded = false;
let dirty = false;
let saveTimer = 0;
const listeners = new Set<() => void>();
let unlockHandler: ((a: Achievement) => void) | null = null;

function key() {
  return powerStorageKey("stats");
}

function parse(raw: string | null): PowerStats {
  if (!raw) return EMPTY_STATS;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== "object") return EMPTY_STATS;
    const n = (k: keyof PowerStats) =>
      typeof v[k] === "number" && Number.isFinite(v[k]) ? Math.max(0, Math.floor(v[k] as number)) : 0;
    const unlocked: Record<string, number> = {};
    if (v.unlocked && typeof v.unlocked === "object") {
      for (const [id, at] of Object.entries(v.unlocked as Record<string, unknown>)) {
        if (typeof at === "number" && ACHIEVEMENTS.some((a) => a.id === id)) unlocked[id] = at;
      }
    }
    return {
      chars: n("chars"),
      deletes: n("deletes"),
      pastes: n("pastes"),
      milestones: n("milestones"),
      bestCombo: n("bestCombo"),
      bestWpm: n("bestWpm"),
      agentChars: n("agentChars"),
      bestAgentWords: n("bestAgentWords"),
      agentTurns: n("agentTurns"),
      themesTried: Array.isArray(v.themesTried)
        ? THEME_IDS.filter((t) => (v.themesTried as unknown[]).includes(t))
        : [],
      unlocked,
    };
  } catch {
    return EMPTY_STATS;
  }
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    stats = parse(window.localStorage.getItem(key()));
  } catch {
    stats = EMPTY_STATS;
  }
}

function flush() {
  saveTimer = 0;
  if (!dirty) return;
  dirty = false;
  try {
    window.localStorage.setItem(key(), JSON.stringify(stats));
  } catch {
    // ignore: stats are best-effort
  }
  for (const l of listeners) l();
}

function scheduleSave() {
  dirty = true;
  if (!saveTimer) saveTimer = window.setTimeout(flush, 2000);
}

function checkAchievements() {
  const ctx = { hour: new Date().getHours() };
  let unlockedAny = false;
  for (const a of ACHIEVEMENTS) {
    if (stats.unlocked[a.id] || !a.check(stats, ctx)) continue;
    stats = { ...stats, unlocked: { ...stats.unlocked, [a.id]: Date.now() } };
    unlockedAny = true;
    unlockHandler?.(a);
  }
  if (unlockedAny) {
    dirty = true;
    flush(); // unlocks persist and show in settings immediately
  }
}

/** Apply a change to the stats, then check for newly unlocked achievements. */
export function recordStats(mutate: (s: PowerStats) => PowerStats) {
  ensureLoaded();
  stats = mutate(stats);
  scheduleSave();
  checkAchievements();
}

export function getPowerStats(): PowerStats {
  ensureLoaded();
  return stats;
}

export function subscribePowerStats(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setUnlockHandler(handler: ((a: Achievement) => void) | null) {
  unlockHandler = handler;
}

export function flushPowerStats() {
  if (saveTimer) window.clearTimeout(saveTimer);
  flush();
}

export function resetPowerStats() {
  stats = EMPTY_STATS;
  dirty = true;
  flushPowerStats();
}
