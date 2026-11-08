// Pure achievement state machine. All time, provenance and identities enter as events.
// Product targets live here; text is never part of persistent state.
export const RULES = {
  session: 600_000,
  window: 30_000,
  gap: 5_000,
  windowChars: 100,
  bucket: 10_000,
  bucketChars: 20,
  tolerance: 0.2,
  cruise: 40,
  fast: 80,
  baseline: 3,
  improvement: 5,
  seamLength: 200,
  seamEdits: 3,
  seamMin: 1,
  seamMax: 20,
  trimLength: 300,
  trimMin: 0.1,
  trimMax: 0.3,
  revisionChars: 100,
  revisionDrafts: 5,
  bloom: 100,
  biome: 100,
  bentoMin: 20,
  bentoMax: 80,
  symphony: 3,
  landing: 5,
  mission: 3,
  longThread: 10,
  baton: 40,
  rally: 3,
  weave: 80,
  panic: 42,
  spoon: 101,
  disco: 100,
  twist: 40,
  hourEdge: 30_000,
  lucky: 77,
  dragons: 5,
  comboIdle: 3_000,
} as const;
export const BIOMES = [
  "neon",
  "fire",
  "matrix",
  "sakura",
  "cyberpunk",
  "retro",
] as const;
export type Category = "Human" | "Agent" | "Together";
export interface Badge {
  id: string;
  category: Category;
  hidden: boolean;
  icon: string;
  title: string;
  description: string;
  flavor: string;
  requires: readonly string[];
}
function badge(
  id: string,
  category: Category,
  icon: string,
  title: string,
  description: string,
  flavor: string,
  requires: readonly string[],
  hidden = false,
): Badge {
  return { id, category, icon, title, description, flavor, requires, hidden };
}
export const CATALOG: readonly Badge[] = [
  badge(
    "cruise-control",
    "Human",
    "🚂",
    "Cruise Control",
    "Sustain 40 WPM for a qualifying 30 seconds.",
    "The keyboard has found its groove.",
    ["direct", "window"],
  ),
  badge(
    "afterburner",
    "Human",
    "🛫",
    "Afterburner",
    "Sustain 80 WPM for a qualifying 30 seconds.",
    "Please keep your fingers inside the spacecraft.",
    ["direct", "window"],
  ),
  badge(
    "ghost-chaser",
    "Human",
    "👻",
    "Ghost Chaser",
    "After three qualifying windows, beat your previous best by 5 WPM.",
    "Your only rival is yesterday's you.",
    ["direct", "window"],
  ),
  badge(
    "pocket-drummer",
    "Human",
    "🥁",
    "Pocket Drummer",
    "Enter 20 characters in each of three 10-second buckets, within 20% of their mean.",
    "Less panic. More pocket.",
    ["direct", "window"],
  ),
  badge(
    "stairway-flow",
    "Human",
    "🪜",
    "Stairway to Flow",
    "Finish three qualifying windows, each 5 WPM faster, in one session.",
    "One gear at a time.",
    ["direct", "window"],
  ),
  badge(
    "seamster",
    "Human",
    "🪡",
    "The Seamster",
    "Make three non-overlapping 1–20 character replacements in a 200-character draft.",
    "Good words are tailored.",
    ["edit"],
  ),
  badge(
    "less-better",
    "Human",
    "✂️",
    "Less, But Better",
    "Shorten a 300-character draft by 10–30%, then insert something.",
    "You found the sentence inside the sentence.",
    ["edit"],
  ),
  badge(
    "revision-superpower",
    "Human",
    "🛠️",
    "Revision Is a Superpower",
    "In five drafts, enter 100 characters then make a replacement.",
    "First drafts are allowed to be first drafts.",
    ["edit"],
  ),
  badge(
    "back-bloom",
    "Human",
    "🌱",
    "Back in Bloom",
    "Return after ten idle minutes and enter 100 new characters.",
    "Welcome back. The garden waited.",
    ["edit", "idle"],
  ),
  badge(
    "six-biomes",
    "Human",
    "🧭",
    "Six Biomes",
    "Enter 100 new characters in each theme.",
    "Same keyboard. Six different worlds.",
    ["edit"],
  ),
  badge(
    "hello-copilot",
    "Agent",
    "🐣",
    "Hello, Co-Pilot",
    "Observe one complete agent reply.",
    "A second pair of hands has entered the chat.",
    ["reply"],
  ),
  badge(
    "bento-box",
    "Agent",
    "🍱",
    "Bento Box",
    "Observe a complete reply of 20–80 words.",
    "Small serving. Nicely packed.",
    ["reply"],
  ),
  badge(
    "symphony-three",
    "Agent",
    "🎼",
    "Symphony in Three Turns",
    "Observe three complete replies in one thread this session.",
    "Now we're finding the arrangement.",
    ["reply"],
  ),
  badge(
    "lantern-keeper",
    "Agent",
    "🏮",
    "Lantern Keeper",
    "Observe a complete reply in each theme, using its start theme.",
    "Six colors of thinking out loud.",
    ["reply"],
  ),
  badge(
    "perfect-landing",
    "Agent",
    "🛬",
    "Perfect Landing",
    "Observe five complete replies of at least 20 words.",
    "And the crowd politely goes wild.",
    ["reply"],
  ),
  badge(
    "mission-control",
    "Agent",
    "🪐",
    "Mission Control",
    "Observe complete replies in three different threads.",
    "Three worlds, one control room.",
    ["reply"],
  ),
  badge(
    "long-thread",
    "Agent",
    "🧵",
    "The Long Thread",
    "Observe ten complete replies in one thread.",
    "A conversation becomes a collaboration.",
    ["reply"],
  ),
  badge(
    "pass-baton",
    "Together",
    "🤝",
    "Pass the Baton",
    "Enter 40 composer characters, submit, then observe a complete reply in that thread.",
    "Your spark. Their turn.",
    ["edit", "submit", "reply"],
  ),
  badge(
    "rally-race",
    "Together",
    "🏓",
    "Rally, Not a Race",
    "Complete three baton exchanges in one thread this session.",
    "Great work has a rhythm.",
    ["edit", "submit", "reply"],
  ),
  badge(
    "weave-together",
    "Together",
    "🧶",
    "Weave Together",
    "After a reply, enter 80 characters, revise, submit, then observe the next complete reply.",
    "Think, shape, hand over.",
    ["edit", "submit", "reply"],
  ),
  badge(
    "matching-jackets",
    "Together",
    "🎨",
    "Matching Jackets",
    "Complete a baton exchange in each theme without changing it during the exchange.",
    "A very small, very stylish team.",
    ["edit", "submit", "reply"],
  ),
  badge(
    "twin-engines",
    "Together",
    "🚀",
    "Twin Engines",
    "Earn a speed window, then complete a baton exchange in that thread this session.",
    "Two engines. One expedition.",
    ["window", "edit", "submit", "reply"],
  ),
  badge(
    "dont-panic",
    "Human",
    "🧮",
    "Don't Panic",
    "End a direct-input combo at exactly 42.",
    "You brought a keyboard. Close enough to a towel.",
    ["direct", "timeout"],
    true,
  ),
  badge(
    "no-spoon",
    "Human",
    "🕶️",
    "There Is No Spoon",
    "End a direct-input combo at exactly 101 in Matrix.",
    "The combo was inside you all along.",
    ["direct", "timeout"],
    true,
  ),
  badge(
    "petal-metal",
    "Human",
    "🌸",
    "Petal to the Metal",
    "Earn a qualifying 80 WPM window in Sakura.",
    "Soft colors. Extremely fast fingers.",
    ["window"],
    true,
  ),
  badge(
    "silent-disco",
    "Human",
    "🥷",
    "Silent Disco",
    "Reach a direct-input combo of 100 with sound, shake and lightning disabled.",
    "The party is an internal implementation detail.",
    ["direct"],
    true,
  ),
  badge(
    "rubber-duck",
    "Together",
    "🦆",
    "Rubber Duck Has Entered the Chat",
    "Manually enter 🦆 in a composer, submit, then observe a complete reply.",
    "Consultant hired. Fee: one breadcrumb.",
    ["edit", "submit", "reply"],
    true,
  ),
  badge(
    "plot-twist",
    "Human",
    "🪃",
    "Plot Twist",
    "Undo, redo, then enter 40 characters in that draft.",
    "Actually, past you had a point.",
    ["history", "edit"],
    true,
  ),
  badge(
    "temporal-pincer",
    "Human",
    "🕰️",
    "Temporal Pincer",
    "Enter characters within 30 seconds on each side of a local hour boundary.",
    "You typed in two hours at once.",
    ["edit"],
    true,
  ),
  badge(
    "lucky-seven",
    "Human",
    "🎲",
    "Lucky Seven",
    "End a direct-input combo at exactly 77 in Retro 8-bit.",
    "Secret stage unlocked.",
    ["direct", "timeout"],
    true,
  ),
  badge(
    "quiet-finale",
    "Agent",
    "🌑",
    "The Quiet Finale",
    "Observe a complete reply with particles, glow, sound, both shakes and lightning disabled.",
    "Applause can be silent.",
    ["reply"],
    true,
  ),
  badge(
    "here-dragons",
    "Human",
    "🐉",
    "Here Be Dragons",
    "Discover five other hidden achievements.",
    "The map was never complete.",
    ["discovery"],
    true,
  ),
];
export interface SavedCollection {
  version: 1;
  unlocked: Record<string, number>;
  biomes: Record<string, number>;
  best: number;
  windows: number;
  revisions: number;
  replies: number;
  landings: number;
  threads: Record<string, number>;
  lanterns: string[];
  jackets: string[];
  pin: string | null;
  title: string | null;
}
const dict = <T>(): Record<string, T> =>
  Object.create(null) as Record<string, T>;
export function parseCollection(raw: unknown): SavedCollection {
  const v =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = (x: unknown) =>
    typeof x === "number" && Number.isFinite(x) ? Math.max(0, x) : 0;
  const numbers = (x: unknown, max: number) => {
    const out = dict<number>();
    if (x && typeof x === "object")
      for (const [k, v] of Object.entries(x))
        if (k.length <= 300) out[k] = Math.floor(Math.min(max, n(v)));
    return out;
  };
  const unlocked = dict<number>();
  for (const [k, at] of Object.entries(
    numbers(v.unlocked, Number.MAX_SAFE_INTEGER),
  ))
    if (CATALOG.some((a) => a.id === k) && at > 0) unlocked[k] = at;
  const themes = (x: unknown) =>
    BIOMES.filter((t) => Array.isArray(x) && x.includes(t));
  return {
    version: 1,
    unlocked,
    biomes: numbers(v.biomes, RULES.biome),
    best: n(v.best),
    windows: Math.floor(n(v.windows)),
    revisions: Math.floor(n(v.revisions)),
    replies: Math.floor(n(v.replies)),
    landings: Math.floor(n(v.landings)),
    threads: numbers(v.threads, RULES.longThread),
    lanterns: themes(v.lanterns),
    jackets: themes(v.jackets),
    pin:
      typeof v.pin === "string" &&
      CATALOG.some((a) => a.id === v.pin && !a.hidden)
        ? v.pin
        : null,
    title:
      typeof v.title === "string" &&
      [
        "Rhythm Mage",
        "Co-Pilot",
        "Duet Captain",
        "Secret Cartographer",
      ].includes(v.title)
        ? v.title
        : null,
  };
}
interface Draft {
  lastInputWall: number;
  editor: string;
  thread: string | null;
  entered: number;
  peak: number;
  ranges: [number, number][];
  revised: boolean;
  counted: boolean;
  trimmed: boolean;
  history: number;
  afterRedo: number;
  duck: boolean;
  theme: string | null;
  afterReply: boolean;
  weaveEntered: number;
}
interface Handoff {
  at: number;
  entered: number;
  revised: boolean;
  duck: boolean;
  theme: string | null;
  afterReply: boolean;
  speed: boolean;
}
interface Window {
  start: number;
  last: number;
  chars: number;
  buckets: number[];
  theme: string | null;
  thread: string | null;
}
interface Turn {
  thread: string;
  at: number;
  theme: string;
  quiet: boolean;
  handoff?: Handoff;
}
export interface Session {
  best: number;
  discoveries: string[];
  replies: Record<string, number>;
  rallies: Record<string, number>;
  speed: Record<string, boolean>;
  lastReply: Record<string, boolean>;
  lastActivity: number | null;
  bloom: number | null;
  stair: number[];
}
export interface Collection {
  saved: SavedCollection;
  session: Session;
  lastSeq: number;
  lastNow: number;
  draft?: Draft;
  window?: Window;
  combo?: {
    count: number;
    last: number;
    theme: string | null;
    silent: boolean;
  };
  previousInput?: { now: number; wall: number };
  pending: Record<string, Handoff>;
  turns: Record<string, Turn>;
}
const session = (): Session => ({
  best: 0,
  discoveries: [],
  replies: dict(),
  rallies: dict(),
  speed: dict(),
  lastReply: dict(),
  lastActivity: null,
  bloom: null,
  stair: [],
});
export function createCollection(saved?: unknown): Collection {
  return {
    saved: parseCollection(saved),
    session: session(),
    lastSeq: 0,
    lastNow: 0,
    pending: dict(),
    turns: dict(),
  };
}
export interface AchievementEvent {
  type:
    | "edit"
    | "history"
    | "submit"
    | "clear"
    | "context"
    | "settings"
    | "tick"
    | "start"
    | "activity"
    | "complete"
    | "disconnect";
  seq: number;
  now: number;
  wall: number;
  editor?: string;
  thread: string | null;
  theme: string;
  quiet: boolean;
  silent: boolean;
  inserted?: number;
  removed?: number;
  from?: number;
  length?: number;
  provenance?: "direct" | "ime" | "paste" | "unknown";
  duck?: boolean;
  history?: "undo" | "redo";
  turn?: string;
  status?: string;
  words?: number;
  fresh?: boolean;
}
export function publicCard(a: Badge, unlocked: Record<string, number>) {
  return a.hidden && !unlocked[a.id]
    ? { title: "Undiscovered", description: "A discovery awaits.", icon: "◇" }
    : {
        title: a.title,
        description: a.description,
        icon: a.icon,
        flavor: a.flavor,
        at: unlocked[a.id],
      };
}
// Mutates only its explicit argument, returns exactly the newly earned IDs.
export function reduceCollection(s: Collection, e: AchievementEvent): string[] {
  if (!Number.isFinite(e.now) || !Number.isFinite(e.wall) || e.seq <= s.lastSeq)
    return [];
  s.lastSeq = e.seq;
  if (e.now < s.lastNow) {
    s.draft = undefined;
    s.window = undefined;
    s.combo = undefined;
    s.previousInput = undefined;
    s.pending = dict();
    s.turns = dict();
    s.session = session();
  }
  s.lastNow = e.now;
  const earned: string[] = [];
  const award = (id: string) => {
    if (!Object.hasOwn(s.saved.unlocked, id)) {
      s.saved.unlocked[id] = e.wall;
      earned.push(id);
      s.session.discoveries.push(id);
    }
  };
  const resetLocal = () => {
    s.draft = undefined;
    s.window = undefined;
    s.combo = undefined;
    s.previousInput = undefined;
  };
  const idle =
    s.session.lastActivity !== null &&
    e.now - s.session.lastActivity >= RULES.session;
  const eligible =
    e.type === "edit" && (e.provenance === "direct" || e.provenance === "ime");
  if (idle) {
    resetLocal();
    s.pending = dict();
    s.turns = dict();
    s.session = session();
    s.session.bloom = 0;
  }
  const activity =
    eligible ||
    e.type === "history" ||
    e.type === "start" ||
    e.type === "activity" ||
    e.type === "complete";
  if (activity) s.session.lastActivity = e.now;
  if (e.type === "disconnect") {
    resetLocal();
    s.pending = dict();
    s.turns = dict();
    return earned;
  }
  if (e.type === "context") {
    resetLocal();
    s.pending = dict();
    return earned;
  }
  if (e.type === "settings") {
    if (s.window && s.window.theme !== e.theme) s.window.theme = null;
    if (s.draft && s.draft.theme !== e.theme) s.draft.theme = null;
    if (s.combo) {
      if (s.combo.theme !== e.theme) s.combo.theme = null;
      s.combo.silent &&= e.silent;
    }
    for (const p of Object.values(s.pending))
      if (p.theme !== e.theme) p.theme = null;
    for (const t of Object.values(s.turns)) {
      t.quiet &&= e.quiet;
      if (t.handoff && t.handoff.theme !== e.theme) t.handoff.theme = null;
    }
  }
  // Natural timeout only; context/dispose/reset never manufactures exact endings.
  if (s.combo && e.now - s.combo.last >= RULES.comboIdle) {
    const c = s.combo;
    if (c.count === RULES.panic) award("dont-panic");
    if (c.count === RULES.spoon && c.theme === "matrix") award("no-spoon");
    if (c.count === RULES.lucky && c.theme === "retro") award("lucky-seven");
    s.combo = undefined;
  }
  const w = s.window;
  if (w && e.now >= w.start + RULES.window) {
    if (
      w.chars >= RULES.windowChars &&
      w.start + RULES.window - w.last <= RULES.gap
    ) {
      const speed = w.chars / 5 / (RULES.window / 60_000),
        previous = s.saved.best;
      if (speed >= RULES.cruise) award("cruise-control");
      if (speed >= RULES.fast) award("afterburner");
      if (speed >= RULES.fast && w.theme === "sakura") award("petal-metal");
      if (
        s.saved.windows >= RULES.baseline &&
        speed >= previous + RULES.improvement
      )
        award("ghost-chaser");
      s.saved.windows++;
      s.saved.best = Math.max(previous, speed);
      s.session.best = Math.max(s.session.best, speed);
      const stairs = s.session.stair;
      if (stairs.length && speed < stairs.at(-1)! + RULES.improvement)
        stairs.length = 0;
      stairs.push(speed);
      if (stairs.length >= 3) {
        award("stairway-flow");
        stairs.shift();
      }
      if (w.thread) s.session.speed[w.thread] = true;
    } else s.session.stair = [];
    const mean = w.buckets.reduce((a, b) => a + b, 0) / 3;
    if (
      w.buckets.every(
        (n) =>
          n >= RULES.bucketChars &&
          Math.abs(n - mean) <= mean * RULES.tolerance + 1e-9,
      )
    )
      award("pocket-drummer");
    s.window = undefined;
  }
  if (e.type === "edit") {
    if (
      s.draft &&
      (s.draft.editor !== e.editor || s.draft.thread !== e.thread)
    ) {
      resetLocal();
      s.pending = dict();
    }
    const count = eligible ? Math.max(0, e.inserted ?? 0) : 0;
    if (!s.draft)
      s.draft = {
        editor: e.editor ?? "",
        thread: e.thread,
        entered: 0,
        peak: e.length ?? 0,
        ranges: [],
        revised: false,
        counted: false,
        trimmed: false,
        history: 0,
        afterRedo: 0,
        duck: false,
        theme: e.theme,
        lastInputWall: e.wall,
        afterReply: !!(e.thread && s.session.lastReply[e.thread]),
        weaveEntered: 0,
      };
    const d = s.draft;
    if (d.theme !== e.theme) d.theme = null;
    if (!eligible) {
      s.window = undefined;
      s.combo = undefined;
      d.ranges = [];
      d.history = 0;
      d.trimmed = false;
      d.peak = e.length ?? 0;
    }
    if (eligible) {
      s.saved.biomes[e.theme] = Math.min(
        RULES.biome,
        (s.saved.biomes[e.theme] ?? 0) + count,
      );
      if (BIOMES.every((t) => (s.saved.biomes[t] ?? 0) >= RULES.biome))
        award("six-biomes");
      if (s.session.bloom !== null) {
        s.session.bloom += count;
        if (s.session.bloom >= RULES.bloom) award("back-bloom");
      }
      if (count > 0) {
        const p = s.previousInput,
          date = new Date(e.wall),
          edge =
            date.getMinutes() * 60_000 +
            date.getSeconds() * 1000 +
            date.getMilliseconds();
        if (
          p &&
          e.now - p.now <= RULES.hourEdge * 2 &&
          Math.abs(e.wall - p.wall - (e.now - p.now)) < 1000 &&
          edge <= RULES.hourEdge &&
          e.wall - p.wall > edge &&
          e.wall - p.wall - edge <= RULES.hourEdge
        )
          award("temporal-pincer");
        s.previousInput = { now: e.now, wall: e.wall };
      }
      const removed = e.removed ?? 0,
        from = e.from ?? 0,
        inserted = e.inserted ?? 0;
      // Retain only disjoint ranges and remap later spans through this edit.
      const overlap = d.ranges.some(([a, b]) => from < b && from + removed > a);
      d.ranges = d.ranges
        .filter(([a, b]) => !(from < b && from + removed > a))
        .map(([a, b]) =>
          a >= from + removed
            ? [a + inserted - removed, b + inserted - removed]
            : [a, b],
        );
      if (removed > 0 && inserted > 0) {
        d.revised ||= d.afterReply && d.weaveEntered >= RULES.weave;
        if (d.entered >= RULES.revisionChars && !d.counted) {
          d.counted = true;
          s.saved.revisions++;
          if (s.saved.revisions >= RULES.revisionDrafts)
            award("revision-superpower");
        }
        if (!overlap && removed >= RULES.seamMin && removed <= RULES.seamMax)
          d.ranges.push([from, from + inserted]);
        if (d.ranges.length > RULES.seamEdits) d.ranges.shift();
        if (
          (e.length ?? 0) >= RULES.seamLength &&
          d.ranges.length >= RULES.seamEdits
        )
          award("seamster");
      }
      if (count > 0 && d.trimmed) award("less-better");
      const length = e.length ?? 0;
      if (
        d.peak >= RULES.trimLength &&
        length <= d.peak * (1 - RULES.trimMin) &&
        length >= d.peak * (1 - RULES.trimMax)
      )
        d.trimmed = true;
      else if (length < d.peak * (1 - RULES.trimMax)) d.trimmed = false;
      d.peak = Math.max(d.peak, length);
      d.entered += count;
      if (count > 0 || (e.removed ?? 0) > 0) d.lastInputWall = e.wall;
      if (d.afterReply) d.weaveEntered += count;
      d.duck ||= !!e.duck;
      if (d.history === 2) {
        d.afterRedo += count;
        if (d.afterRedo >= RULES.twist) award("plot-twist");
      }
      if (e.provenance === "direct" && count > 0) {
        if (s.window && e.now - s.window.last > RULES.gap) {
          s.window = undefined;
          s.session.stair = [];
        }
        s.window ??= {
          start: e.now,
          last: e.now,
          chars: 0,
          buckets: [0, 0, 0],
          theme: e.theme,
          thread: e.thread,
        };
        const win = s.window;
        win.last = e.now;
        win.chars += count;
        win.buckets[
          Math.min(2, Math.floor((e.now - win.start) / RULES.bucket))
        ] += count;
        if (win.theme !== e.theme) win.theme = null;
        s.combo ??= { count: 0, last: e.now, theme: e.theme, silent: e.silent };
        s.combo.count += count;
        s.combo.last = e.now;
        s.combo.silent &&= e.silent;
        if (s.combo.theme !== e.theme) s.combo.theme = null;
        if (s.combo.count >= RULES.disco && s.combo.silent)
          award("silent-disco");
      } else if (count > 0) {
        s.window = undefined;
        s.combo = undefined;
      }
    }
  }
  if (e.type === "history" && s.draft) {
    s.window = undefined;
    s.combo = undefined;
    s.draft.ranges = [];
    s.draft.trimmed = false;
    s.draft.history = e.history === "undo" ? 1 : s.draft.history === 1 ? 2 : 0;
    s.draft.afterRedo = 0;
  }
  if (e.type === "submit" && e.thread && s.draft?.thread === e.thread) {
    const d = s.draft;
    const handoff: Handoff = {
      at: d.lastInputWall,
      entered: d.entered,
      revised: d.revised,
      duck: d.duck,
      theme: d.theme,
      afterReply: d.afterReply,
      speed: !!s.session.speed[e.thread],
    };
    // Server start can precede the local successful-submit acknowledgement.
    // Correlate by the last input timestamp, never by the acknowledgement time.
    const active = Object.values(s.turns).find(
      (t) => t.thread === e.thread && t.at >= handoff.at && !t.handoff,
    );
    if (active) active.handoff = handoff;
    else s.pending[e.thread] = handoff;
    s.draft = undefined;
    s.window = undefined;
    s.combo = undefined;
  }
  if (e.type === "clear") s.draft = undefined;
  if (e.type === "start" && e.thread && e.turn) {
    const key = JSON.stringify([e.thread, e.turn]);
    if (!s.turns[key]) {
      s.turns[key] = {
        thread: e.thread,
        at: e.wall,
        theme: e.theme,
        quiet: e.quiet,
        handoff:
          s.pending[e.thread]?.at <= e.wall ? s.pending[e.thread] : undefined,
      };
      delete s.pending[e.thread];
    }
  }
  if (e.type === "complete" && e.thread && e.turn) {
    const key = JSON.stringify([e.thread, e.turn]),
      t = s.turns[key];
    delete s.turns[key];
    if (t && e.status === "completed" && e.fresh && (e.words ?? 0) > 0) {
      const words = e.words!;
      s.saved.replies++;
      s.session.replies[e.thread] = (s.session.replies[e.thread] ?? 0) + 1;
      s.saved.threads[e.thread] = Math.min(
        RULES.longThread,
        (s.saved.threads[e.thread] ?? 0) + 1,
      );
      if (!s.saved.lanterns.includes(t.theme)) s.saved.lanterns.push(t.theme);
      award("hello-copilot");
      if (words >= RULES.bentoMin && words <= RULES.bentoMax)
        award("bento-box");
      if (s.session.replies[e.thread] >= RULES.symphony)
        award("symphony-three");
      if (s.saved.lanterns.length >= BIOMES.length) award("lantern-keeper");
      if (words >= RULES.bentoMin) {
        s.saved.landings++;
        if (s.saved.landings >= RULES.landing) award("perfect-landing");
      }
      if (Object.keys(s.saved.threads).length >= RULES.mission)
        award("mission-control");
      if (s.saved.threads[e.thread] >= RULES.longThread) award("long-thread");
      if (t.quiet && e.quiet) award("quiet-finale");
      const p = t.handoff;
      if (p) {
        if (p.duck) award("rubber-duck");
        if (p.entered >= RULES.baton) {
          award("pass-baton");
          s.session.rallies[e.thread] = (s.session.rallies[e.thread] ?? 0) + 1;
          if (s.session.rallies[e.thread] >= RULES.rally) award("rally-race");
          if (p.afterReply && p.entered >= RULES.weave && p.revised)
            award("weave-together");
          if (p.speed) award("twin-engines");
          if (
            p.theme &&
            p.theme === t.theme &&
            p.theme === e.theme &&
            !s.saved.jackets.includes(p.theme)
          )
            s.saved.jackets.push(p.theme);
          if (s.saved.jackets.length >= BIOMES.length)
            award("matching-jackets");
        }
      }
      s.session.lastReply[e.thread] = true;
      if (s.draft?.thread === e.thread) {
        s.draft.afterReply = true;
        s.draft.weaveEntered = 0;
        s.draft.revised = false;
      }
    }
  }
  if (
    CATALOG.filter(
      (a) => a.hidden && a.id !== "here-dragons" && s.saved.unlocked[a.id],
    ).length >= RULES.dragons
  )
    award("here-dragons");
  return earned;
}
export function progress(
  id: string,
  s: Collection,
): { value: number; target: number; label: string } {
  const d = s.draft,
    max = (r: Record<string, number>) => Math.max(0, ...Object.values(r));
  const values: Record<string, [number, number, string]> = {
    "six-biomes": [
      BIOMES.filter((t) => (s.saved.biomes[t] ?? 0) >= RULES.biome).length,
      6,
      "biomes explored",
    ],
    "cruise-control": [s.saved.best, RULES.cruise, "sustained WPM"],
    afterburner: [s.saved.best, RULES.fast, "sustained WPM"],
    "ghost-chaser": [
      Math.min(s.saved.windows, 3),
      3,
      "baseline windows; then improve by 5 WPM",
    ],
    "stairway-flow": [s.session.stair.length, 3, "rising windows this session"],
    "pocket-drummer": [
      s.window?.buckets.filter((n) => n >= RULES.bucketChars).length ?? 0,
      3,
      "steady buckets",
    ],
    seamster: [d?.ranges.length ?? 0, 3, "separate replacements"],
    "less-better": [d?.trimmed ? 1 : 0, 1, "qualifying trims; then insert"],
    "revision-superpower": [s.saved.revisions, 5, "drafts revised"],
    "back-bloom": [s.session.bloom ?? 0, 100, "returning characters"],
    "hello-copilot": [s.saved.replies, 1, "complete replies observed"],
    "bento-box": [
      s.saved.unlocked[id] ? 1 : 0,
      1,
      "20–80 word replies observed",
    ],
    "symphony-three": [
      max(s.session.replies),
      3,
      "replies in one thread this session",
    ],
    "lantern-keeper": [s.saved.lanterns.length, 6, "themes observed"],
    "perfect-landing": [s.saved.landings, 5, "landings observed"],
    "mission-control": [
      Object.keys(s.saved.threads).length,
      3,
      "threads observed",
    ],
    "long-thread": [max(s.saved.threads), 10, "replies in one thread"],
    "pass-baton": [
      d?.entered ?? 0,
      40,
      "composer characters; then submit and observe",
    ],
    "rally-race": [max(s.session.rallies), 3, "exchanges this session"],
    "weave-together": [
      d?.afterReply ? d.entered : 0,
      80,
      "characters; then revise, submit and observe",
    ],
    "matching-jackets": [s.saved.jackets.length, 6, "matching themes"],
    "twin-engines": [
      Object.keys(s.session.speed).length ? 1 : 0,
      1,
      "speed windows; then exchange",
    ],
  };
  const [value, target, label] = values[id] ?? [0, 1, "discoveries"];
  return { value: Math.min(value, target), target, label };
}
