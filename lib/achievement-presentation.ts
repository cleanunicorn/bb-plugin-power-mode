import { ACHIEVEMENTS, getCollection, type PowerStats } from "./power-stats";
import { progress } from "./achievement-rules";
export const TITLES = [
  "Rhythm Mage",
  "Co-Pilot",
  "Duet Captain",
  "Secret Cartographer",
] as const;
export function availableTitles(stats: PowerStats): string[] {
  const count = (category: string) =>
    ACHIEVEMENTS.filter(
      (a) => !a.hidden && a.category === category && stats.unlocked[a.id],
    ).length;
  return [
    count("Human") >= 5 ? TITLES[0] : null,
    count("Agent") >= 5 ? TITLES[1] : null,
    count("Together") >= 3 ? TITLES[2] : null,
    ACHIEVEMENTS.filter((a) => a.hidden && stats.unlocked[a.id]).length >= 5
      ? TITLES[3]
      : null,
  ].filter((x): x is (typeof TITLES)[number] => x !== null);
}
export function challengeProgress(id: string, stats: PowerStats): string {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a || (a.hidden && !stats.unlocked[id])) return "";
  if (stats.unlocked[id]) return "Discovered";
  if (a.requires.includes("legacy-stats")) {
    let value = 0,
      target = 1,
      label = "";
    if (id.startsWith("combo-")) {
      value = stats.bestCombo;
      target = Number(id.slice(6));
      label = "best combo";
    } else if (id.startsWith("wpm-")) {
      value = stats.bestWpm;
      target = Number(id.slice(4));
      label = "burst WPM";
    } else if (id.startsWith("chars-")) {
      value = stats.chars;
      target = Number(id.slice(6, -1)) * 1000;
      label = "characters";
    } else if (id === "first-spark") {
      value = stats.chars;
      label = "characters";
    } else if (id === "deletes-500") {
      value = stats.deletes;
      target = 500;
      label = "deletions";
    } else if (id === "pastes-25") {
      value = stats.pastes;
      target = 25;
      label = "pastes";
    } else if (id === "agent-hype") {
      value = stats.agentChars;
      target = 1000;
      label = "observed characters";
    } else if (id === "agent-500") {
      value = stats.bestAgentWords;
      target = 500;
      label = "observed words";
    } else if (id === "agent-turns-25") {
      value = stats.agentTurns;
      target = 25;
      label = "observed turns";
    } else if (id === "theme-tourist") {
      value = stats.themesTried.length;
      target = 6;
      label = "themes tried";
    } else return "A moment to discover";
    return `${Math.min(value, target)} / ${target} ${label}`;
  }
  if (a.requires.includes("ordnance-stats")) {
    if (id === "bombardier")
      return `${Math.min(stats.bestPasteTier, 5)} / 5 best paste tier`;
    if (id === "lucky-drop")
      return `${Math.min(stats.luckyDrops, 1)} / 1 lucky drops`;
    if (id === "pyrotechnician")
      return `${Math.min(stats.milestones, 100)} / 100 milestones`;
    if (id === "doomsday")
      return `${Math.min(stats.bestPasteTier, 8)} / 8 best paste tier`;
    if (id === "chain-reaction")
      return `${Math.min(stats.bestPasteChain, 3)} / 3 best paste chain`;
    return "A moment to discover";
  }
  if (a.requires.includes("combo-stats")) {
    if (id === "clutch-player")
      return `${Math.min(stats.clutches, 10)} / 10 clutch saves`;
    return "A moment to discover";
  }
  const p = progress(id, getCollection());
  return `${Math.round(p.value * 10) / 10} / ${p.target} ${p.label}`;
}
/**
 * Progress toward a visible challenge as 0–1, or null when there is nothing
 * to measure (unlocked, hidden-and-locked, or a moment-based badge).
 */
export function challengeProgressRatio(
  id: string,
  stats: PowerStats,
): number | null {
  const text = challengeProgress(id, stats);
  const m = /^([\d.]+) \/ ([\d.]+)/.exec(text);
  if (!m) return null;
  const target = Number(m[2]);
  if (!(target > 0)) return null;
  return Math.max(0, Math.min(1, Number(m[1]) / target));
}
export function hudChallenge(stats: PowerStats): string {
  const c = getCollection(),
    a = ACHIEVEMENTS.find((a) => a.id === c.saved.pin && !a.hidden);
  const title = availableTitles(stats).includes(c.saved.title ?? "")
    ? c.saved.title
    : null;
  const ghost =
    a &&
    ["cruise-control", "afterburner", "ghost-chaser", "stairway-flow"].includes(
      a.id,
    )
      ? ` · 👻 PB ${Math.round(c.saved.best)} WPM`
      : "";
  return [
    title,
    a
      ? `${a.icon} ${a.title} · ${challengeProgress(a.id, stats)}${ghost}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export type Rarity = "common" | "rare" | "epic" | "legendary" | "secret";
const RARE = new Set([
  "combo-100", "chars-10k", "wpm-60", "agent-500", "theme-tourist", "bombardier",
  "lucky-drop", "chain-reaction", "clutch-player", "ghost-chaser", "stairway-flow",
]);
const EPIC = new Set(["combo-250", "wpm-100", "agent-turns-25", "pyrotechnician", "afterburner"]);
const LEGENDARY = new Set(["combo-500", "chars-100k", "wpm-140"]);
/** Cosmetic rarity: it only picks how loud the unlock celebration and gallery card are. */
export function rarityOf(a: { id: string; hidden: boolean }): Rarity {
  if (a.hidden) return "secret";
  if (LEGENDARY.has(a.id)) return "legendary";
  if (EPIC.has(a.id)) return "epic";
  return RARE.has(a.id) ? "rare" : "common";
}
/**
 * Up to `limit` locked, visible badges that are closest to unlocking
 * (highest measurable progress first; untouched ones are left out).
 */
export function closestChallenges(stats: PowerStats, limit = 3) {
  return ACHIEVEMENTS.filter((a) => !a.hidden && !stats.unlocked[a.id])
    .map((a) => ({ a, ratio: challengeProgressRatio(a.id, stats) ?? 0 }))
    .filter((x) => x.ratio > 0 && x.ratio < 1)
    .sort((x, y) => y.ratio - x.ratio)
    .slice(0, limit);
}
