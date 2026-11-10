// Lifetime stats and achievements. The engine records events in memory on
// every keystroke; they are persisted at most every 2 seconds so typing never
// pays for a localStorage write. Unlocks notify through `onUnlock`.
//
// Several windows of one browser profile share the same localStorage document,
// so a window never overwrites it with its own copy. Each window keeps `synced`
// (the document as last seen in storage) and `stats` (synced + local activity
// not yet written). A flush runs under a Web Lock, re-reads storage and merges
// the local delta (`stats - synced`) into whatever is there. A reset writes a
// new random `epoch`; a window that sees a different epoch drops its pending
// delta and adopts storage, so a stale window cannot bring back old stats.

import {
  CATALOG,
  RULES,
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
  /** Characters entered, including paste, drop and dictation. */
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
  /** Longest run of ordnance pastes, each within five seconds of the last. */
  bestPasteChain: number;
  /** Combos (10+) rescued in the last 30% of the timer. */
  clutches: number;
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
  bestPasteChain: 0,
  clutches: 0,
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

/** Stats-driven badges. The first 19 are the original set; later ones read the paste ordnance and combo counters. */
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
    description: "Enter 1,000 characters.",
    check: (s) => s.chars >= 1_000,
  },
  {
    id: "chars-10k",
    icon: "📜",
    title: "Novelist",
    description: "Enter 10,000 characters.",
    check: (s) => s.chars >= 10_000,
  },
  {
    id: "chars-100k",
    icon: "🏛️",
    title: "Legend of the Keys",
    description: "Enter 100,000 characters.",
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
  {
    id: "chain-reaction",
    icon: "🧨",
    title: "Chain Reaction",
    description: "Chain three pastes, each within five seconds of the last.",
    flavor: "One more. It would be rude to stop now.",
    requires: ["ordnance-stats"],
    check: (s) => s.bestPasteChain >= 3,
  },
  {
    id: "clutch-player",
    icon: "⏱️",
    title: "Clutch Player",
    description: "Rescue a fading combo of 10 or more, 10 times.",
    flavor: "The timer bar has trust issues now.",
    requires: ["combo-stats"],
    check: (s) => s.clutches >= 10,
  },
];

export const COUNTER_KEYS = ["chars", "deletes", "pastes", "milestones", "agentChars", "agentTurns", "luckyDrops", "clutches"] as const;
export const BEST_KEYS = ["bestCombo", "bestWpm", "bestAgentWords", "bestPasteTier", "bestPasteChain"] as const;

/**
 * Merge this window's activity into the stored document. Counters add the local
 * delta (`local - synced`) to the stored value, bests take the max, themes union,
 * and unlocks union keeping the earliest timestamp. Pure.
 */
export function mergeStats(stored: PowerStats, local: PowerStats, synced: PowerStats): PowerStats {
  const out: PowerStats = { ...stored };
  for (const k of COUNTER_KEYS) out[k] = stored[k] + Math.max(0, local[k] - synced[k]);
  for (const k of BEST_KEYS) out[k] = Math.max(stored[k], local[k]);
  out.themesTried = THEME_IDS.filter((t) => stored.themesTried.includes(t) || local.themesTried.includes(t));
  const unlocked: Record<string, number> = { ...stored.unlocked };
  for (const [id, at] of Object.entries(local.unlocked)) {
    unlocked[id] = id in unlocked ? Math.min(unlocked[id], at) : at;
  }
  out.unlocked = unlocked;
  const a = stored.collection, b = local.collection, c = synced.collection;
  const saved = { ...a, unlocked: { ...a.unlocked } };
  for (const k of ["windows", "revisions", "replies", "landings"] as const)
    saved[k] = a[k] + Math.max(0, b[k] - c[k]);
  saved.best = Math.max(a.best, b.best);
  for (const k of ["biomes", "threads"] as const) {
    saved[k] = { ...a[k] };
    for (const [id, count] of Object.entries(b[k]))
      saved[k][id] = Math.min(k === "biomes" ? RULES.biome : RULES.longThread,
        (a[k][id] ?? 0) + Math.max(0, count - (c[k][id] ?? 0)));
  }
  for (const k of ["lanterns", "jackets"] as const)
    saved[k] = THEME_IDS.filter(t => a[k].includes(t) || b[k].includes(t));
  for (const k of ["pin", "title"] as const)
    saved[k] = b[k] !== c[k] ? b[k] : a[k];
  for (const id of Object.keys(unlocked))
    if (CATALOG.some(a => a.id === id)) saved.unlocked[id] = unlocked[id];
  out.collection = saved;
  return out;
}

interface StatsDoc {
  stats: PowerStats;
  /** Reset generation. Legacy documents have none and parse as "". */
  epoch: string;
  present: boolean;
}

const LOCK_NAME = "stats-lock";
const newEpoch = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

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
    pendingToasts.push(ACHIEVEMENTS.find((a) => a.id === id)!);
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
let synced: PowerStats = EMPTY_STATS;
let epoch = "";
let loaded = false;
let storedPresent = false;
/** A storage deletion already adopted locally, awaiting a fresh persisted epoch. */
let pendingClear = false;
let dirty = false;
let saveTimer = 0;
let flushQueued: Promise<void> | null = null;
/** A local reset whose write has not reached storage yet. */
let pendingReset = false;
/** Local unlocks waiting for the locked flush to confirm no other window claimed them first. */
let pendingToasts: Achievement[] = [];
const listeners = new Set<() => void>();
let unlockHandler: ((a: Achievement) => void) | null = null;

function key() {
  return powerStorageKey("stats");
}

function parseDoc(raw: string | null): StatsDoc {
  if (!raw) return { stats: EMPTY_STATS, epoch: "", present: false };
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== "object") return { stats: EMPTY_STATS, epoch: "", present: false };
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
      present: true,
      epoch: typeof v.epoch === "string" ? v.epoch : "",
      stats: {
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
        bestPasteChain: n("bestPasteChain"),
        clutches: n("clutches"),
        themesTried: Array.isArray(v.themesTried)
          ? THEME_IDS.filter((t) => (v.themesTried as unknown[]).includes(t))
          : [],
        unlocked,
      },
    };
  } catch {
    return { stats: EMPTY_STATS, epoch: "", present: false };
  }
}

function readDoc(): StatsDoc {
  try {
    return parseDoc(window.localStorage.getItem(key()));
  } catch {
    // A blocked read is not evidence of a reset. Keep the last known baseline.
    return { stats: synced, epoch, present: storedPresent };
  }
}

const same = (a: PowerStats, b: PowerStats) => a === b || JSON.stringify(a) === JSON.stringify(b);

function notify() {
  for (const l of listeners) l();
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  const doc = readDoc(); // never written back here: only a later flush writes
  stats = doc.stats;
  synced = structuredClone(doc.stats);
  epoch = doc.epoch;
  storedPresent = doc.present;
  try {
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", flushPowerStatsSync);
  } catch {
    // no window: best-effort
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

/**
 * Unlock achievements the current stats satisfy. Ids already in `storedUnlocked`
 * adopt that timestamp silently; only ids nobody has claimed notify.
 */
function claimUnlocks(storedUnlocked: Record<string, number>, defer = false, event: StatsEvent = {}): boolean {
  const ctx = { hour: new Date().getHours(), typed: event.typed === true };
  let changed = false;
  for (const a of ACHIEVEMENTS) {
    if (stats.unlocked[a.id] || !a.check(stats, ctx)) continue;
    const prior = storedUnlocked[a.id];
    stats = { ...stats, unlocked: { ...stats.unlocked, [a.id]: prior ?? Date.now() } };
    changed = true;
    if (prior === undefined) {
      collection.session.discoveries.push(a.id);
      if (defer) pendingToasts.push(a);
      else unlockHandler?.(a);
    }
  }
  return changed;
}

/**
 * Read-merge-write against storage. Fully synchronous, so local `recordStats`
 * calls cannot land between the merge and the rebase.
 */
function flushNow() {
  saveTimer = 0;
  ensureLoaded();
  const stored = readDoc();
  let base = stored.stats;
  let out: PowerStats;
  if (pendingReset) {
    // Our reset wins over whatever is stored; keep only activity since it.
    base = EMPTY_STATS;
    out = mergeStats(EMPTY_STATS, stats, synced);
  } else if (!stored.present && (storedPresent || pendingClear)) {
    // Deletion also resets legacy documents whose epoch was the empty string.
    epoch = newEpoch();
    base = EMPTY_STATS;
    out = pendingClear ? stats : structuredClone(EMPTY_STATS);
    if (!pendingClear) {
      collection = createCollection();
      pendingToasts = [];
      for (const fn of resetListeners) fn();
    }
  } else if (stored.epoch !== epoch || pendingClear) {
    // Another window reset: drop our stale delta and adopt storage.
    epoch = stored.epoch;
    out = structuredClone(stored.stats);
    collection = createCollection();
    pendingToasts = [];
    for (const fn of resetListeners) fn();
  } else {
    out = mergeStats(stored.stats, stats, synced);
  }
  const before = stats;
  const wasDirty = dirty;
  stats = same(out, stats) ? stats : out;
  collection.saved = stats.collection;
  claimUnlocks(base.unlocked, true);
  // Toast earlier local unlocks only if no other window had stored them first.
  const toasts = pendingToasts.filter((a) => a.id in stats.unlocked && !(a.id in base.unlocked));
  const doc = JSON.stringify({ ...stats, epoch });
  try {
    if (pendingReset || doc !== window.localStorage.getItem(key())) {
      window.localStorage.setItem(key(), doc);
    }
  } catch {
    // Keep the delta relative to storage, so a later successful flush retries it.
    synced = structuredClone(base);
    dirty = true;
    if (!stored.present && !pendingReset) pendingClear = true;
    if (wasDirty || stats !== before) notify();
    return;
  }
  pendingToasts = [];
  pendingReset = false;
  pendingClear = false;
  storedPresent = true;
  dirty = false;
  synced = structuredClone(stats);
  for (const a of toasts) unlockHandler?.(a);
  if (wasDirty || stats !== before) notify();
}

/** Flush under a cross-window lock when possible, else synchronously. */
function requestFlush(): Promise<void> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) {
    flushNow();
    return Promise.resolve();
  }
  if (flushQueued) return flushQueued; // resolves once the pending flush has written
  let ran = false;
  const run = () => {
    ran = true;
    flushQueued = null;
    flushNow();
  };
  const queued = locks.request(powerStorageKey(LOCK_NAME), run).catch(() => {
    if (!ran) run();
  });
  // Some lock implementations grant an available lock synchronously.
  if (!ran) flushQueued = queued;
  return queued;
}

function scheduleSave() {
  dirty = true;
  if (!saveTimer) saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    void requestFlush();
  }, 2000);
}

/** Another window changed the shared document. */
function onStorage(e: StorageEvent) {
  if (e.key !== null && e.key !== key()) return;
  if (e.storageArea && e.storageArea !== window.localStorage) return;
  if (pendingReset) return; // our reset overwrites it at the next flush
  // Events can arrive late and out of order, so read the current document
  // rather than trusting `newValue`. A cleared storage reads as an empty one.
  const doc = readDoc();
  if (doc.epoch !== epoch || !doc.present) {
    epoch = doc.epoch;
    stats = structuredClone(doc.stats);
    synced = structuredClone(doc.stats);
    collection = createCollection();
    pendingToasts = [];
    for (const fn of resetListeners) fn();
    dirty = false;
  } else {
    stats = mergeStats(doc.stats, stats, synced);
    synced = doc.stats;
  }
  storedPresent = doc.present;
  pendingClear = !doc.present;
  collection.saved = stats.collection;
  notify();
  checkAchievements();
  if (pendingClear) void requestFlush();
}

function checkAchievements(event: StatsEvent = {}) {
  // Cheap in-memory pre-check: typing must not touch storage unless something unlocks.
  const ctx = { hour: new Date().getHours(), typed: event.typed === true };
  if (!ACHIEVEMENTS.some((a) => !stats.unlocked[a.id] && a.check(stats, ctx))) return;
  const stored = pendingReset ? { stats: EMPTY_STATS, epoch } : readDoc();
  const prior = stored.epoch === epoch ? stored.stats.unlocked : {};
  if (claimUnlocks(prior, true, event)) {
    notify(); // unlocks show in settings immediately
    void requestFlush();
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
  ensureLoaded();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setUnlockHandler(handler: ((a: Achievement) => void) | null) {
  unlockHandler = handler;
}

/** Persist pending activity under the cross-window lock; resolves once written. */
export function flushPowerStats(): Promise<void> {
  ensureLoaded();
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = 0;
  return requestFlush();
}

/**
 * Teardown flush (dispose, pagehide): the page may unload before a lock is
 * granted, so this reads, merges and writes synchronously without the lock.
 */
export function flushPowerStatsSync() {
  if (!loaded) return;
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = 0;
  if (dirty || pendingReset || pendingClear) flushNow();
}

/** Start a new epoch with empty stats. Local state resets at once; storage follows under the lock. */
export function resetPowerStats() {
  ensureLoaded();
  epoch = newEpoch();
  collection = createCollection();
  stats = { ...EMPTY_STATS, collection: collection.saved, unlocked: {} };
  synced = structuredClone(stats);
  for (const fn of resetListeners) fn();
  pendingToasts = [];
  pendingReset = true;
  pendingClear = false;
  dirty = true;
  notify();
  void flushPowerStats();
}
