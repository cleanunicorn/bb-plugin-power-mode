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

export const COUNTER_KEYS = ["chars", "deletes", "pastes", "milestones", "agentChars", "agentTurns"] as const;
export const BEST_KEYS = ["bestCombo", "bestWpm", "bestAgentWords"] as const;

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
  return out;
}

interface StatsDoc {
  stats: PowerStats;
  /** Reset generation. Legacy documents have none and parse as "". */
  epoch: string;
}

const LOCK_NAME = "stats-lock";

let stats: PowerStats = EMPTY_STATS;
let synced: PowerStats = EMPTY_STATS;
let epoch = "";
let loaded = false;
let dirty = false;
let saveTimer = 0;
let flushQueued = false;
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
  if (!raw) return { stats: EMPTY_STATS, epoch: "" };
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== "object") return { stats: EMPTY_STATS, epoch: "" };
    const n = (k: keyof PowerStats) =>
      typeof v[k] === "number" && Number.isFinite(v[k]) ? Math.max(0, Math.floor(v[k] as number)) : 0;
    const unlocked: Record<string, number> = {};
    if (v.unlocked && typeof v.unlocked === "object") {
      for (const [id, at] of Object.entries(v.unlocked as Record<string, unknown>)) {
        if (typeof at === "number" && ACHIEVEMENTS.some((a) => a.id === id)) unlocked[id] = at;
      }
    }
    return {
      epoch: typeof v.epoch === "string" ? v.epoch : "",
      stats: {
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
      },
    };
  } catch {
    return { stats: EMPTY_STATS, epoch: "" };
  }
}

function readDoc(): StatsDoc {
  try {
    return parseDoc(window.localStorage.getItem(key()));
  } catch {
    return { stats: EMPTY_STATS, epoch: "" };
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
  stats = synced = doc.stats;
  epoch = doc.epoch;
  try {
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", flushPowerStatsSync);
  } catch {
    // no window: best-effort
  }
}

/**
 * Unlock achievements the current stats satisfy. Ids already in `storedUnlocked`
 * adopt that timestamp silently; only ids nobody has claimed notify.
 */
function claimUnlocks(storedUnlocked: Record<string, number>, defer = false): boolean {
  const ctx = { hour: new Date().getHours() };
  let changed = false;
  for (const a of ACHIEVEMENTS) {
    if (stats.unlocked[a.id] || !a.check(stats, ctx)) continue;
    const prior = storedUnlocked[a.id];
    stats = { ...stats, unlocked: { ...stats.unlocked, [a.id]: prior ?? Date.now() } };
    changed = true;
    if (prior === undefined) {
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
  } else if (stored.epoch !== epoch) {
    // Another window reset: drop our stale delta and adopt storage.
    epoch = stored.epoch;
    out = stored.stats;
  } else {
    out = mergeStats(stored.stats, stats, synced);
  }
  const before = stats;
  stats = same(out, stats) ? stats : out;
  claimUnlocks(base.unlocked);
  // Toast earlier local unlocks only if no other window had stored them first.
  const toasts = pendingToasts.filter((a) => a.id in stats.unlocked && !(a.id in base.unlocked));
  pendingToasts = [];
  for (const a of toasts) unlockHandler?.(a);
  const doc = JSON.stringify({ ...stats, epoch });
  if (pendingReset || doc !== window.localStorage.getItem(key())) {
    try {
      window.localStorage.setItem(key(), doc);
    } catch {
      // ignore: stats are best-effort
    }
  }
  pendingReset = false;
  dirty = false;
  synced = stats;
  if (stats !== before) notify();
}

/** Flush under a cross-window lock when possible, else synchronously. */
function requestFlush(): Promise<void> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) {
    flushNow();
    return Promise.resolve();
  }
  if (flushQueued) return Promise.resolve();
  flushQueued = true;
  return locks
    .request(powerStorageKey(LOCK_NAME), () => {
      flushQueued = false;
      flushNow();
    })
    .catch(() => {
      flushQueued = false;
      flushNow();
    });
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
  if (doc.epoch !== epoch) {
    epoch = doc.epoch;
    stats = synced = doc.stats;
    dirty = false;
  } else {
    stats = mergeStats(doc.stats, stats, synced);
    synced = doc.stats;
  }
  notify();
  checkAchievements();
}

function checkAchievements() {
  const stored = pendingReset ? { stats: EMPTY_STATS, epoch } : readDoc();
  const prior = stored.epoch === epoch ? stored.stats.unlocked : {};
  if (claimUnlocks(prior, true)) {
    notify(); // unlocks show in settings immediately
    void requestFlush();
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
  if (dirty || pendingReset) flushNow();
}

/** Start a new epoch with empty stats. Local state resets at once; storage follows under the lock. */
export function resetPowerStats() {
  ensureLoaded();
  epoch = Math.random().toString(36).slice(2) + Date.now().toString(36);
  stats = synced = EMPTY_STATS;
  pendingToasts = [];
  pendingReset = true;
  dirty = true;
  notify();
  void flushPowerStats();
}
