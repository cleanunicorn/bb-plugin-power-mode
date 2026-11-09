// Lifetime stats and achievements. The engine records events in memory on
// every keystroke; they are persisted at most every 2 seconds so typing never
// pays for a localStorage write. Unlocks notify through `onUnlock`.

import {
  CATALOG,
  createCollection,
  reduceCollection,
  parseCollection,
  type SavedCollection,
  type AchievementEvent,
  type Category,
} from "./achievement-rules";
import { THEME_IDS, powerStorageKey, type ThemeId } from "./power-store";

export interface PowerStats {
  collection: SavedCollection;
  chars: number;
  deletes: number;
  pastes: number;
  milestones: number;
  bestCombo: number;
  bestWpm: number;
  agentChars: number;
  bestAgentWords: number;
  agentTurns: number;
  /** Highest paste ordnance tier dropped (1–9). */
  bestPasteTier: number;
  /** Pastes upgraded by a lucky drop. */
  luckyDrops: number;
  themesTried: ThemeId[];
  /** achievement id → unlock time (ms since epoch) */
  unlocked: Record<string, number>;
}

export const EMPTY_STATS: PowerStats = {
  collection: parseCollection(null),
  chars: 0,
  deletes: 0,
  pastes: 0,
  milestones: 0,
  bestCombo: 0,
  bestWpm: 0,
  agentChars: 0,
  bestAgentWords: 0,
  agentTurns: 0,
  bestPasteTier: 0,
  luckyDrops: 0,
  themesTried: [],
  unlocked: {},
};

export interface Achievement {
  id: string;
  icon: string;
  title: string;
  description: string;
  category: Category;
  hidden: boolean;
  flavor?: string;
  requires: readonly string[];
  check(stats: PowerStats, ctx: AchievementContext): boolean;
}

/** What triggered an achievement check, beyond the stats themselves. */
export interface AchievementContext {
  /** Local hour of day (0-23) when the check runs. */
  hour: number;
  /** True only when this check follows a keystroke that added typed characters. */
  typed: boolean;
}

/** Describes the event behind a `recordStats` call. */
export interface StatsEvent {
  typed?: boolean;
}

/** Night Owl window: 00:00 inclusive to 04:00 exclusive, local time. */
export const NIGHT_OWL_END_HOUR = 4;

/** Stats-driven badges. The first 19 are the original set; later ones read the paste ordnance counters. */
const LEGACY: (Omit<Achievement, "category" | "hidden" | "requires"> & {
  hidden?: boolean;
  requires?: ReadonlyArray<string>;
})[] = [
  {
    id: "first-spark",
    icon: "✨",
    title: "First Spark",
    description: "Type with Power Mode on.",
    check: (s) => s.chars >= 1,
  },
  {
    id: "combo-10",
    icon: "🔥",
    title: "Warming Up",
    description: "Reach a 10 combo.",
    check: (s) => s.bestCombo >= 10,
  },
  {
    id: "combo-50",
    icon: "⚡",
    title: "Unstoppable",
    description: "Reach a 50 combo.",
    check: (s) => s.bestCombo >= 50,
  },
  {
    id: "combo-100",
    icon: "💯",
    title: "Centurion",
    description: "Reach a 100 combo.",
    check: (s) => s.bestCombo >= 100,
  },
  {
    id: "combo-250",
    icon: "⚔️",
    title: "Keyboard Warrior",
    description: "Reach a 250 combo.",
    check: (s) => s.bestCombo >= 250,
  },
  {
    id: "combo-500",
    icon: "👑",
    title: "Ascended",
    description: "Reach a 500 combo.",
    check: (s) => s.bestCombo >= 500,
  },
  {
    id: "chars-1k",
    icon: "✍️",
    title: "Wordsmith",
    description: "Type 1,000 characters.",
    check: (s) => s.chars >= 1_000,
  },
  {
    id: "chars-10k",
    icon: "📜",
    title: "Novelist",
    description: "Type 10,000 characters.",
    check: (s) => s.chars >= 10_000,
  },
  {
    id: "chars-100k",
    icon: "🏛️",
    title: "Legend of the Keys",
    description: "Type 100,000 characters.",
    check: (s) => s.chars >= 100_000,
  },
  {
    id: "wpm-60",
    icon: "🏃",
    title: "Fast Fingers",
    description: "Hit 60 WPM.",
    check: (s) => s.bestWpm >= 60,
  },
  {
    id: "wpm-100",
    icon: "😈",
    title: "Speed Demon",
    description: "Hit 100 WPM.",
    check: (s) => s.bestWpm >= 100,
  },
  {
    id: "wpm-140",
    icon: "🚀",
    title: "Lightspeed",
    description: "Hit 140 WPM.",
    check: (s) => s.bestWpm >= 140,
  },
  {
    id: "deletes-500",
    icon: "🧽",
    title: "Second Thoughts",
    description: "Delete 500 characters.",
    check: (s) => s.deletes >= 500,
  },
  {
    id: "pastes-25",
    icon: "📋",
    title: "Ctrl+V Warrior",
    description: "Paste 25 times.",
    check: (s) => s.pastes >= 25,
  },
  {
    id: "night-owl",
    icon: "🦉",
    title: "Night Owl",
    description: "Type between midnight and 4 AM.",
    check: (_s, c) => c.typed && c.hour >= 0 && c.hour < NIGHT_OWL_END_HOUR,
  },
  {
    id: "agent-hype",
    icon: "📣",
    title: "Hype Man",
    description: "Cheer on an agent through 1,000 characters.",
    check: (s) => s.agentChars >= 1_000,
  },
  {
    id: "agent-500",
    icon: "🤝",
    title: "Pair Programmer",
    description: "Watch an agent write 500 words in one reply.",
    check: (s) => s.bestAgentWords >= 500,
  },
  {
    id: "agent-turns-25",
    icon: "🎬",
    title: "Director",
    description: "See 25 agent turns finish.",
    check: (s) => s.agentTurns >= 25,
  },
  {
    id: "theme-tourist",
    icon: "🎨",
    title: "Theme Tourist",
    description: "Try every theme.",
    check: (s) => THEME_IDS.every((t) => s.themesTried.includes(t)),
  },
  {
    id: "bombardier",
    icon: "💣",
    title: "Bombardier",
    description: "Drop tier 5 ordnance: paste 2,000 characters, or get a lucky drop from 600.",
    flavor: "The bomber run has been authorized.",
    requires: ["ordnance-stats"],
    check: (s) => s.bestPasteTier >= 5,
  },
  {
    id: "lucky-drop",
    icon: "🍀",
    title: "Lucky Drop",
    description: "Land a lucky drop. About one paste in twelve upgrades a tier.",
    flavor: "The clipboard smiled on you.",
    requires: ["ordnance-stats"],
    check: (s) => s.luckyDrops >= 1,
  },
  {
    id: "pyrotechnician",
    icon: "🎆",
    title: "Pyrotechnician",
    description: "Hit 100 combo milestones.",
    flavor: "Every slam is a small fireworks show.",
    requires: ["ordnance-stats"],
    check: (s) => s.milestones >= 100,
  },
  {
    id: "doomsday",
    icon: "☢️",
    title: "Doomsday Device",
    description: "Trigger a tactical nuke or a singularity with one paste.",
    flavor: "You pasted an entire repository, didn't you.",
    requires: ["ordnance-stats"],
    hidden: true,
    check: (s) => s.bestPasteTier >= 8,
  },
];

export const ACHIEVEMENTS: Achievement[] = [
  ...LEGACY.map((a) => ({
    ...a,
    category: (a.id.startsWith("agent-") ? "Agent" : "Human") as Category,
    hidden: a.hidden ?? false,
    requires: a.requires ?? ["legacy-stats"],
  })),
  ...CATALOG.map((a) => ({ ...a, check: () => false })),
];
let collection = createCollection();
export function getCollection() {
  ensureLoaded();
  return collection;
}
const resetListeners = new Set<() => void>();
export function onCollectionReset(fn: () => void) {
  resetListeners.add(fn);
  return () => {
    resetListeners.delete(fn);
  };
}
let eventSeq = 0;
export function recordAchievementEvent(event: Omit<AchievementEvent, "seq">) {
  ensureLoaded();
  const beforeWindows = collection.saved.windows;
  const beforeSession = collection.session;
  const earned = reduceCollection(collection, { ...event, seq: ++eventSeq });
  if (
    event.type === "tick" &&
    !earned.length &&
    beforeWindows === collection.saved.windows
  ) {
    if (beforeSession !== collection.session) {
      stats = { ...stats };
      for (const listener of listeners) listener();
    }
    return;
  }
  stats = {
    ...stats,
    collection: collection.saved,
    unlocked: { ...stats.unlocked, ...collection.saved.unlocked },
  };
  scheduleSave();
  for (const id of earned)
    unlockHandler?.(ACHIEVEMENTS.find((a) => a.id === id)!);
  if (earned.length) flushPowerStats();
}
export function setCollectionPreference(patch: {
  pin?: string | null;
  title?: string | null;
}) {
  ensureLoaded();
  const pin = patch.pin === undefined ? collection.saved.pin : patch.pin;
  collection.saved = {
    ...collection.saved,
    ...patch,
    pin: ACHIEVEMENTS.some((a) => a.id === pin && !a.hidden) ? pin : null,
  };
  stats = { ...stats, collection: collection.saved };
  scheduleSave();
  flushPowerStats();
}
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
      typeof v[k] === "number" && Number.isFinite(v[k])
        ? Math.max(0, Math.floor(v[k] as number))
        : 0;
    const unlocked: Record<string, number> = {};
    if (v.unlocked && typeof v.unlocked === "object") {
      for (const [id, at] of Object.entries(
        v.unlocked as Record<string, unknown>,
      )) {
        if (
          typeof at === "number" &&
          Number.isFinite(at) &&
          at > 0 &&
          ACHIEVEMENTS.some((a) => a.id === id)
        )
          unlocked[id] = at;
      }
    }
    const parsedCollection = parseCollection(v.collection);
    const storedPin = (v.collection as { pin?: unknown } | undefined)?.pin;
    if (
      typeof storedPin === "string" &&
      ACHIEVEMENTS.some((a) => a.id === storedPin && !a.hidden)
    )
      parsedCollection.pin = storedPin;
    return {
      collection: parsedCollection,
      chars: n("chars"),
      deletes: n("deletes"),
      pastes: n("pastes"),
      milestones: n("milestones"),
      bestCombo: n("bestCombo"),
      bestWpm: n("bestWpm"),
      agentChars: n("agentChars"),
      bestAgentWords: n("bestAgentWords"),
      agentTurns: n("agentTurns"),
      bestPasteTier: Math.min(9, n("bestPasteTier")),
      luckyDrops: n("luckyDrops"),
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
  const storedPin = stats.collection.pin;
  collection = createCollection(stats.collection);
  collection.saved.pin = storedPin;
  for (const a of CATALOG)
    if (stats.unlocked[a.id])
      collection.saved.unlocked[a.id] = stats.unlocked[a.id];
  stats = {
    ...stats,
    collection: collection.saved,
    unlocked: { ...stats.unlocked, ...collection.saved.unlocked },
  };
}

function flush() {
  if (saveTimer) window.clearTimeout(saveTimer);
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

function checkAchievements(event: StatsEvent) {
  const ctx: AchievementContext = { hour: new Date().getHours(), typed: event.typed === true };
  let unlockedAny = false;
  for (const a of ACHIEVEMENTS) {
    if (stats.unlocked[a.id] || !a.check(stats, ctx)) continue;
    stats = { ...stats, unlocked: { ...stats.unlocked, [a.id]: Date.now() } };
    unlockedAny = true;
    collection.session.discoveries.push(a.id);
    unlockHandler?.(a);
  }
  if (unlockedAny) {
    dirty = true;
    flush(); // unlocks persist and show in settings immediately
  }
}

/**
 * Apply a change to the stats, then check for newly unlocked achievements.
 * `event` says what caused the change; event-bound achievements (Night Owl)
 * only unlock when their event is present.
 */
export function recordStats(mutate: (s: PowerStats) => PowerStats, event: StatsEvent = {}) {
  ensureLoaded();
  stats = mutate(stats);
  scheduleSave();
  checkAchievements(event);
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
  collection = createCollection();
  stats = { ...EMPTY_STATS, collection: collection.saved, unlocked: {} };
  for (const fn of resetListeners) fn();
  dirty = true;
  flushPowerStats();
}
