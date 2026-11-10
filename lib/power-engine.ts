// The Power Mode effects engine. Runs as a trusted content script: listens for
// `input` events on any text field, textarea, or contenteditable editor in the
// bb window and answers every keystroke with particles, shake, a combo meter,
// floating letters, shockwaves, lightning, and (optionally) synth sound.
//
// Agent Power Mode: while an agent is running (reported by the app overlay
// through `syncAgentThreads`), a MutationObserver watches the transcript
// (`[data-timeline-items]`) for text growth and sparks at the newest text.
//
// Rendering: a 1× particle canvas plus a quarter-resolution bloom canvas the
// browser upscales (bilinear) for a soft, strong glow at ~1/16 the fill cost.
//
// Everything it creates — canvases, HUD, styles, listeners, observers, timers,
// inline shake offsets — is restored or removed when the signal aborts.

import { toast } from "sonner";
import {
  getPowerSettings,
  getReducedMotion,
  subscribePowerSettings,
  updatePowerSettings,
  watchExternalChanges,
  watchSystemMotion,
  type Intensity,
  type PowerSettings,
} from "./power-store";
import { availableTitles, hudChallenge, rarityOf, type Rarity } from "./achievement-presentation";
import { ACHIEVEMENTS, onCollectionReset, getPowerStats, subscribePowerStats, flushPowerStatsSync, recordStats, setUnlockHandler, type Achievement } from "./power-stats";
import { ORDNANCE_SKINS, THEMES, type OrdnanceSkin, type OrdnanceSound, type Theme } from "./power-themes";

// ---------------------------------------------------------------- tuning

const COMBO_TIMEOUT_MS = 3000;
const AGENT_TIMEOUT_MS = 4000;
/** Rows that appear this soon after the visible thread changes are the swapped-in transcript, not new output. */
const AGENT_SETTLE_MS = 300;
/** Live particle cap at density 1×; scales with the Particles slider. */
const BASE_MAX_PARTICLES = 450;
const MAX_GLYPHS = 60;
const DPR = 1;
const BLOOM_SCALE = 0.25;
const HUE_STEP = 15;
const WPM_WINDOW_MS = 8000;
/** Ordnance pastes this close together build a chain. */
const PASTE_CHAIN_MS = 5000;
/** A keystroke in the last 30% of the combo timer is a clutch save. */
const CLUTCH_LEFT = 0.3;
const PHOTO_FINISH_LEFT = 0.06;
const MATRIX_CHARS = "01アイウエオカキクケコサシスセソタチツテトﾊﾋﾌﾍﾎ<>{}=+*";

const INTENSITY: Record<Intensity, { particles: number; shake: number; glyphs: number }> = {
  epic: { particles: 1, shake: 1, glyphs: 1 },
  legendary: { particles: 1.5, shake: 1.6, glyphs: 1 },
  godlike: { particles: 2.2, shake: 2.4, glyphs: 2 },
};

const AGENT_MILESTONES: { at: number; title: string }[] = [
  { at: 50, title: "AGENT IS COOKING" },
  { at: 150, title: "BIG BRAIN TIME" },
  { at: 300, title: "GALAXY BRAIN" },
  { at: 600, title: "SINGULARITY" },
  { at: 1000, title: "AGI ACHIEVED?!" },
];

interface Milestone {
  at: number;
  title: string;
  hue: number;
}

const MILESTONES: Milestone[] = [
  { at: 10, title: "NICE!", hue: 190 },
  { at: 25, title: "ON FIRE!", hue: 25 },
  { at: 50, title: "UNSTOPPABLE!", hue: 300 },
  { at: 100, title: "GODLIKE!", hue: 50 },
  { at: 200, title: "LEGENDARY!!", hue: 275 },
  { at: 350, title: "BEYOND MORTAL", hue: 0 },
  { at: 500, title: "ASCENDED", hue: 160 },
];

/**
 * The highest milestone crossed when the combo moves from `prev` to `next`.
 * A paste can add up to +100 at once, so an exact match would skip milestones.
 * Includes the endless `∞ POWER ∞` milestones every 250 past 500.
 */
export function milestoneCrossed(prev: number, next: number): Milestone | null {
  if (!(next > prev)) return null;
  const top = Math.floor(next / 250) * 250;
  if (top > 500 && top > prev) return { at: top, title: `∞ POWER ∞ ×${top}`, hue: (top / 250) * 67 % 360 };
  let found: Milestone | null = null;
  for (const m of MILESTONES) if (m.at > prev && m.at <= next) found = m;
  return found;
}

// ---------------------------------------------------------------- paste ordnance
//
// Pasting drops ordnance near the caret. The weapon tier grows ~×3 in paste
// length per level; a "lucky drop" upgrades a paste one tier (never into 8/9).

/** Lower bound (chars) of tiers 2…9. */
export const ORDNANCE_THRESHOLDS = [50, 200, 600, 2000, 6000, 20000, 60000, 200000] as const;
/** Combo bump per tier, 1 → 9. */
export const ORDNANCE_COMBO = [5, 10, 15, 20, 30, 40, 50, 75, 100] as const;
/** [min, max] item count per tier (pops, sticks, bomblets, rockets, bombs, hits, meteors, nukes, holes). */
const ORDNANCE_COUNT: readonly (readonly [number, number])[] = [
  [4, 6], [1, 3], [6, 6], [3, 6], [8, 12], [3, 3], [8, 10], [1, 1], [1, 1],
];
/** Most detonation timers a tier arms; checked against the pending cap before dropping. */
const ORDNANCE_ARMS = [6, 3, 7, 6, 12, 4, 11, 5, 1] as const;
/** Tiers from here on are "events": one runs at a time. */
const EVENT_TIER = 7;
const LUCKY_ODDS = 1 / 12;
/** Across all pastes, at most this many detonations may be pending. */
const MAX_PENDING_ORDNANCE = 24;
/** Impact points keep at least this distance from the caret. */
const CARET_CLEARANCE = 60;
/** Pool slots only weapon bodies (carriers) may use; see `room()`. */
const CARRIER_RESERVE = 40;

export interface OrdnancePick {
  tier: number;
  count: number;
  combo: number;
  lucky: boolean;
}

/** Weapon for a paste of `chars` characters. Pure; `rnd` drives the lucky drop. */
export function pickOrdnance(chars: number, rnd: () => number = Math.random): OrdnancePick {
  const n = Number.isFinite(chars) && chars > 0 ? chars : 0;
  let tier = 1;
  for (const at of ORDNANCE_THRESHOLDS) if (n >= at) tier++;
  // Position within the tier (log scale) picks the count, so it is deterministic.
  const lo = tier === 1 ? 1 : ORDNANCE_THRESHOLDS[tier - 2];
  const hi = tier === 9 ? lo * 3 : ORDNANCE_THRESHOLDS[tier - 1];
  const frac = Math.min(1, Math.max(0, Math.log(Math.max(n, 1) / lo) / Math.log(hi / lo)));
  let lucky = false;
  // Never upgrade into the nuke or singularity (tiers 8–9).
  if (tier < 7 && rnd() < LUCKY_ODDS) {
    tier++;
    lucky = true;
  }
  const [min, max] = ORDNANCE_COUNT[tier - 1];
  const count = lucky ? min : min + Math.round(frac * (max - min));
  return { tier, count, combo: ORDNANCE_COMBO[tier - 1], lucky };
}

let ordnanceRandom: () => number = Math.random;
/** Test seam: makes the lucky-drop roll deterministic (null restores Math.random). */
export function setOrdnanceRandom(fn: (() => number) | null) {
  ordnanceRandom = fn ?? Math.random;
}

export interface OrdnanceDebug {
  particles: number;
  maxParticles: number;
  ordnance: number;
  pending: number;
  event: boolean;
  /** Detonation timers armed by the latest paste. */
  lastArmed: number;
  lastTier: number;
  dimmed: boolean;
  /** Mean distance of pullable particles to the active singularity. */
  pullDistance: number | null;
  /** Live particles per kind. */
  kinds: Record<string, number>;
}
let debugHook: (() => OrdnanceDebug) | null = null;
/** Test seam: live ordnance counters of the mounted engine. */
export function ordnanceDebug(): OrdnanceDebug | null {
  return debugHook?.() ?? null;
}

function tierName(combo: number): string {
  let name = "";
  for (const m of MILESTONES) if (combo >= m.at) name = m.title.replace(/!+$/, "");
  if (combo >= 750) name = "∞ POWER ∞";
  return name;
}

/** Palette drifts from ice → toxic → fire → plasma → full rainbow as the combo grows. */

// ---------------------------------------------------------------- types

type ParticleKind =
  | "spark" | "ember" | "shard" | "glyph" | "ring" | "bolt" | "pixel" | "petal" | "code" | "ordnance" | "smoke"
  | "shell" | "flare" | "scorch";

/** Kinds that follow their own path or stay put: a singularity does not pull them. */
function pullable(kind: ParticleKind): boolean {
  return kind !== "ring" && kind !== "bolt" && kind !== "glyph" && kind !== "ordnance"
    && kind !== "shell" && kind !== "flare" && kind !== "scorch";
}

type OrdVariant =
  | "cracker" | "stick" | "canister" | "bomblet" | "rocket" | "bomber"
  | "bomb" | "reticle" | "beam" | "meteor" | "nuke" | "hole";

/** A weapon body (carrier) tweened along an arc, drawn in its skin's style. */
interface Ord {
  variant: OrdVariant;
  skin: OrdnanceSkin;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  /** Arc height in px (positive bulges upward). */
  lift: number;
  /** ms before it appears. */
  delay: number;
  /** ms of motion after `delay`; it then rests at the target. */
  fly: number;
  ease: "in" | "out" | "linear";
  /** Beam sweep distance (px) across its life. */
  sweep?: number;
}

interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
  spin: number;
  angle: number;
  text?: string;
  points?: number[];
  ord?: Ord;
  /** A spark that twinkles with a four-point glint. */
  star?: boolean;
}

interface ShakeState {
  prev: string;
  prevWillChange: string;
  baseTranslate: string;
  prevPosition?: string;
  prevLeft?: string;
  prevTop?: string;
  baseLeft?: number;
  baseTop?: number;
  amp: number;
}

// ---------------------------------------------------------------- helpers

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", ""]);

function editableTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof HTMLElement)) return null;
  // xterm receives keystrokes through an invisible helper textarea, whose
  // position and focus it manages itself. Treating it as an editor shakes
  // that input and measures a fake caret instead of the visible terminal.
  if (node.closest(".xterm")) return null;
  if (node instanceof HTMLTextAreaElement) return node;
  if (node instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(node.type) ? node : null;
  if (node.isContentEditable) {
    // Shake the editor root, not whatever inline node the event bubbled from.
    let root: HTMLElement = node;
    while (root.parentElement && root.parentElement.isContentEditable) root = root.parentElement;
    return root;
  }
  return null;
}

const MIRROR_PROPS = [
  "boxSizing", "width", "height", "overflowX", "overflowY",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight", "fontFamily",
  "textAlign", "textTransform", "textIndent", "letterSpacing", "wordSpacing", "tabSize",
] as const;

/** Caret position in viewport coordinates for inputs/textareas (mirror-div technique). */
function fieldCaret(el: HTMLInputElement | HTMLTextAreaElement): { x: number; y: number } | null {
  const pos = el.selectionEnd;
  if (pos == null) return null;
  const style = window.getComputedStyle(el);
  const mirror = document.createElement("div");
  const ms = mirror.style;
  for (const prop of MIRROR_PROPS) ms[prop] = style[prop];
  ms.position = "absolute";
  ms.visibility = "hidden";
  ms.top = "0";
  ms.left = "-9999px";
  ms.whiteSpace = el instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
  ms.overflowWrap = "break-word";
  mirror.textContent = el.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const rect = el.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 16;
  const x = rect.left + marker.offsetLeft - el.scrollLeft;
  const y = rect.top + marker.offsetTop - el.scrollTop + lineHeight / 2;
  mirror.remove();
  return {
    x: Math.min(Math.max(x, rect.left), rect.right),
    y: Math.min(Math.max(y, rect.top), rect.bottom),
  };
}

/** Caret position for contenteditable editors (ProseMirror, CodeMirror, …). */
function selectionCaret(fallback: HTMLElement): { x: number; y: number } | null {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rects = range.getClientRects();
    const r = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (r && (r.width > 0 || r.height > 0 || r.left > 0 || r.top > 0)) {
      return { x: r.right, y: r.top + r.height / 2 };
    }
    const node = sel.focusNode;
    const el = node instanceof HTMLElement ? node : node?.parentElement;
    if (el) {
      const er = el.getBoundingClientRect();
      if (er.width > 0 || er.height > 0) return { x: er.left + 4, y: er.top + Math.min(er.height, 24) / 2 };
    }
  }
  const fr = fallback.getBoundingClientRect();
  return { x: fr.left + fr.width / 2, y: fr.top + fr.height / 2 };
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

// ---------------------------------------------------------------- styles

const CSS = `
.pm-hud{position:fixed;top:56px;right:28px;z-index:2147483001;pointer-events:none;text-align:right;
  font-family:var(--pm-font);opacity:0;transform:translateX(30px) scale(.9);
  transition:opacity .25s ease,transform .25s cubic-bezier(.2,1.6,.4,1);will-change:transform,opacity}
.pm-hud{transform-origin:top right}
.pm-hud.pm-on{opacity:1;transform:scale(var(--pm-hud-scale,1))}
.pm-hud-next{font-size:10px;font-weight:800;letter-spacing:.18em;color:#fff;opacity:.6;min-height:13px;margin-top:1px}
.pm-hud.pm-light .pm-hud-next{color:#111;text-shadow:0 0 6px #fff}
.pm-hud.pm-record .pm-hud-label{color:#ffd76a;text-shadow:0 0 10px rgba(255,200,60,.9)}
.pm-hud.pm-record .pm-hud-label::before{content:"👑 "}
.pm-hud.pm-light.pm-record .pm-hud-label{color:#a16207;text-shadow:0 0 6px #fff}
.pm-pop{position:fixed;z-index:2147483002;pointer-events:none;white-space:nowrap;font-family:var(--pm-font);
  font-weight:900;font-style:italic;font-size:22px;letter-spacing:.06em;color:#fff;-webkit-text-stroke:1px var(--pm-deep);paint-order:stroke fill;
  text-shadow:0 0 14px var(--pm-glow),2px 3px 0 var(--pm-deep);will-change:transform,opacity;
  animation:pm-pop .95s cubic-bezier(.2,1.6,.4,1) forwards}
.pm-pop.pm-retro{font-style:normal;letter-spacing:0}
.pm-pop.pm-light{color:var(--pm-color);-webkit-text-stroke:2px #fff;text-shadow:2px 3px 0 var(--pm-deep),0 0 14px var(--pm-glow)}
@keyframes pm-pop{0%{opacity:0;transform:translate(-50%,-50%) scale(.3) rotate(-12deg)}
  16%{opacity:1;transform:translate(-50%,-50%) scale(1.3) rotate(-6deg)}28%{transform:translate(-50%,-50%) scale(1) rotate(-6deg)}
  70%{opacity:1;transform:translate(-50%,-120%) scale(1) rotate(-6deg)}100%{opacity:0;transform:translate(-50%,-190%) scale(.94) rotate(-6deg)}}
.pm-hud.pm-hot{animation:pm-hot 1s ease-in-out infinite alternate}
@keyframes pm-hot{0%{filter:drop-shadow(0 0 6px var(--pm-glow))}100%{filter:drop-shadow(0 0 22px var(--pm-glow)) brightness(1.15)}}
.pm-hud.pm-danger .pm-hud-label{color:#ff6b6b;text-shadow:0 0 10px rgba(255,80,80,.9)}
.pm-hud.pm-danger .pm-hud-label::after{content:" · FADING"}
.pm-hud.pm-danger .pm-hud-fill{background:linear-gradient(90deg,#7f1d1d,#ef4444,#fff);animation:pm-danger .3s steps(2,end) infinite}
.pm-hud.pm-danger .pm-hud-bar{animation:pm-jitter .14s linear infinite}
@keyframes pm-danger{0%{opacity:1}100%{opacity:.4}}
@keyframes pm-jitter{0%{transform:translate(0,0)}25%{transform:translate(1.5px,-1px)}50%{transform:translate(-1.5px,1px)}75%{transform:translate(1px,1.5px)}100%{transform:translate(0,0)}}
.pm-hud-label{font-size:12px;font-weight:900;letter-spacing:.45em;color:#fff;opacity:.85;text-shadow:0 0 8px var(--pm-glow)}
.pm-hud-count{font-size:64px;line-height:1;font-weight:900;font-style:italic;letter-spacing:-.02em;
  background:linear-gradient(180deg,#fff 0%,var(--pm-color) 55%,var(--pm-deep) 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 12px var(--pm-glow));display:inline-block;will-change:transform}
.pm-hud-count.pm-bump{animation:pm-bump .18s cubic-bezier(.2,2,.4,1)}
.pm-hud-tier{font-size:13px;font-weight:900;letter-spacing:.2em;color:var(--pm-color);min-height:16px;text-shadow:0 0 8px var(--pm-glow)}
.pm-hud-wpm{font-size:11px;font-weight:800;letter-spacing:.25em;color:#fff;opacity:.8;min-height:14px;margin-top:2px}
.pm-hud-bar{margin-top:6px;margin-left:auto;width:180px;height:5px;border-radius:9px;background:rgba(255,255,255,.12);overflow:hidden}
.pm-hud-fill{height:100%;width:100%;transform-origin:right center;will-change:transform;
  background:linear-gradient(90deg,var(--pm-deep),var(--pm-color),#fff)}
.pm-retro .pm-hud-count,.pm-retro.pm-slam{font-style:normal;letter-spacing:0}
.pm-retro .pm-hud-bar,.pm-retro .pm-hud-fill{border-radius:0}
@keyframes pm-bump{0%{transform:scale(1.55) rotate(-6deg)}100%{transform:scale(1) rotate(0)}}
.pm-slam{position:fixed;left:50%;top:38%;z-index:2147483002;pointer-events:none;white-space:nowrap;
  font-family:var(--pm-font);font-weight:900;font-style:italic;
  font-size:clamp(40px,8vw,112px);letter-spacing:-.02em;color:#fff;
  -webkit-text-stroke:2px var(--pm-deep);
  text-shadow:0 0 24px var(--pm-glow),4px 6px 0 var(--pm-deep);
  will-change:transform,opacity;animation:pm-slam 1.6s cubic-bezier(.15,1.4,.35,1) forwards}
.pm-slam small{display:block;text-align:center;font-size:.22em;letter-spacing:.6em;font-style:normal;-webkit-text-stroke:0;margin-top:.2em}
.pm-slam .pm-ch{display:inline-block;white-space:pre;animation:pm-ch .55s cubic-bezier(.2,1.8,.4,1) both;animation-delay:calc(var(--i) * 26ms)}
@keyframes pm-ch{0%{opacity:0;transform:translateY(.55em) scale(1.7) rotate(9deg)}100%{opacity:1;transform:none}}
.pm-slam.pm-streak::before{content:"";position:absolute;left:50%;top:50%;width:150vw;height:.85em;z-index:-1;pointer-events:none;
  background:linear-gradient(90deg,transparent,var(--pm-glow) 28%,rgba(255,255,255,.85) 50%,var(--pm-glow) 72%,transparent);
  mix-blend-mode:screen;animation:pm-streak .75s ease-out both}
.pm-slam.pm-streak.pm-light::before{mix-blend-mode:normal;background:linear-gradient(90deg,transparent,var(--pm-glow) 35%,var(--pm-glow) 65%,transparent)}
@keyframes pm-streak{0%{opacity:.95;transform:translate(-50%,-50%) scaleX(0)}30%{opacity:.7;transform:translate(-50%,-50%) scaleX(1) scaleY(.55)}
  100%{opacity:0;transform:translate(-50%,-50%) scaleX(1.08) scaleY(.03)}}
.pm-slam.pm-lost{font-size:clamp(26px,4vw,56px);color:#fff;-webkit-text-stroke:1px #7f1d1d;
  text-shadow:0 0 18px rgba(239,68,68,.8),3px 4px 0 #7f1d1d;animation:pm-lost 1.3s ease-in forwards}
.pm-slam.pm-lost small{letter-spacing:.3em}
@keyframes pm-lost{
  0%{opacity:1;transform:translate(-50%,-50%) scale(1.15) rotate(-3deg)}
  12%{transform:translate(calc(-50% + 7px),-50%) scale(1) rotate(2deg)}
  24%{transform:translate(calc(-50% - 7px),-50%) rotate(-2deg)}
  36%{transform:translate(-50%,-50%) rotate(0)}
  60%{opacity:1;transform:translate(-50%,-48%) rotate(0)}
  100%{opacity:0;transform:translate(-50%,30%) rotate(8deg)}}
.pm-badge{position:fixed;left:50%;top:13%;z-index:2147483002;pointer-events:none;transform:translateX(-50%);
  display:flex;align-items:center;gap:14px;padding:12px 24px 12px 14px;border-radius:18px;font-family:var(--pm-font);color:#fff;
  background:linear-gradient(135deg,rgba(12,12,24,.94),rgba(34,30,58,.9));border:1px solid var(--pm-color);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 0 36px var(--pm-glow),0 14px 44px rgba(0,0,0,.45);
  overflow:hidden;will-change:transform,opacity;animation:pm-badge 3.4s cubic-bezier(.2,1.4,.4,1) both}
.pm-badge::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.38) 50%,transparent 65%);
  transform:translateX(-130%);animation:pm-sheen 1.1s ease .45s forwards}
.pm-badge-icon{font-size:32px;line-height:1;width:56px;height:56px;flex:none;display:grid;place-items:center;border-radius:50%;
  background:radial-gradient(circle,var(--pm-glow),transparent 72%);box-shadow:0 0 0 2px var(--pm-color),0 0 20px var(--pm-glow);
  animation:pm-badge-icon .7s cubic-bezier(.2,1.9,.4,1) .12s both}
.pm-badge-kicker{font-size:10px;font-weight:900;letter-spacing:.45em;color:var(--pm-color);text-shadow:0 0 8px var(--pm-glow)}
.pm-badge-title{font-size:22px;line-height:1.15;font-weight:900;font-style:italic;letter-spacing:-.01em;white-space:nowrap}
.pm-badge-sub{font-size:11px;opacity:.78;max-width:380px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes pm-badge{0%{opacity:0;transform:translate(-50%,-48px) scale(.82)}10%{opacity:1;transform:translate(-50%,0) scale(1.05)}16%{transform:translate(-50%,0) scale(1)}
  86%{opacity:1;transform:translate(-50%,0) scale(1)}100%{opacity:0;transform:translate(-50%,-28px) scale(.96)}}
@keyframes pm-sheen{to{transform:translateX(130%)}}
@keyframes pm-badge-icon{0%{transform:scale(0) rotate(-40deg)}100%{transform:scale(1) rotate(0)}}
.pm-badge-icon{position:relative}
.pm-badge-rays{position:absolute;inset:-40px;border-radius:50%;z-index:-1;opacity:.5;
  background:repeating-conic-gradient(from 0deg,var(--pm-glow) 0 8deg,transparent 8deg 22.5deg);
  -webkit-mask:radial-gradient(circle,#000 28%,transparent 68%);mask:radial-gradient(circle,#000 28%,transparent 68%);
  animation:pm-rays 7s linear infinite}
@keyframes pm-rays{to{transform:rotate(360deg)}}
.pm-badge-more{display:flex;margin-left:6px}
.pm-badge-more span{font-size:18px;line-height:1;width:30px;height:30px;display:grid;place-items:center;border-radius:50%;margin-left:-8px;
  background:rgba(20,18,36,.92);box-shadow:0 0 0 1px var(--pm-color);animation:pm-badge-icon .5s cubic-bezier(.2,1.9,.4,1) both;
  animation-delay:calc(.3s + var(--i) * 80ms)}
.pm-badge.pm-light .pm-badge-more span{background:#fff}
.pm-badge-meter{position:absolute;left:0;bottom:0;height:3px;width:var(--pm-from,0%);
  background:linear-gradient(90deg,var(--pm-deep),var(--pm-color),#fff);box-shadow:0 0 8px var(--pm-glow);animation:pm-meter .9s ease .55s forwards}
@keyframes pm-meter{to{width:var(--pm-to,0%)}}
.pm-badge.pm-r-epic,.pm-badge.pm-r-legendary,.pm-badge.pm-r-secret{border-width:2px;padding:14px 28px 15px 16px}
.pm-badge.pm-r-epic .pm-badge-title,.pm-badge.pm-r-legendary .pm-badge-title,.pm-badge.pm-r-secret .pm-badge-title{font-size:26px}
.pm-badge.pm-r-legendary{border-color:transparent;
  background:linear-gradient(135deg,rgba(12,12,24,.96),rgba(34,30,58,.94)) padding-box,
    conic-gradient(from var(--pm-spin,0deg),#ff5f6d,#ffc371,#47e5a0,#38bdf8,#c084fc,#ff5f6d) border-box;
  animation:pm-badge 3.4s cubic-bezier(.2,1.4,.4,1) both,pm-spin 3s linear infinite}
.pm-badge.pm-r-legendary.pm-light{background:linear-gradient(135deg,rgba(255,255,255,.98),rgba(243,242,255,.96)) padding-box,
    conic-gradient(from var(--pm-spin,0deg),#ff5f6d,#ffc371,#47e5a0,#38bdf8,#c084fc,#ff5f6d) border-box}
@property --pm-spin{syntax:"<angle>";inherits:false;initial-value:0deg}
@keyframes pm-spin{to{--pm-spin:360deg}}
.pm-badge.pm-retro .pm-badge-title{font-style:normal}.pm-badge.pm-retro{border-radius:0}
.pm-badge.pm-light{color:#111;background:linear-gradient(135deg,rgba(255,255,255,.97),rgba(243,242,255,.94));box-shadow:0 0 0 1px rgba(0,0,0,.06),0 0 30px var(--pm-glow),0 14px 40px rgba(0,0,0,.18)}
.pm-badge.pm-light .pm-badge-kicker{color:var(--pm-deep)}
@keyframes pm-slam{
  0%{opacity:0;transform:translate(-50%,-50%) scale(4) rotate(-12deg)}
  14%{opacity:1;transform:translate(-50%,-50%) scale(.92) rotate(-4deg)}
  22%{transform:translate(-50%,-50%) scale(1.06) rotate(-4deg)}
  70%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(-4deg)}
  100%{opacity:0;transform:translate(-50%,-80%) scale(1.15) rotate(-4deg)}}
.pm-slam.pm-quiet{font-size:clamp(22px,3vw,40px);animation-duration:1.1s;-webkit-text-stroke:0;opacity:.8}
.pm-slam.pm-agent{font-size:clamp(28px,5vw,72px);top:30%}
.pm-flash{position:fixed;inset:0;z-index:2147483000;pointer-events:none;will-change:opacity;
  background:radial-gradient(circle at var(--pm-fx,50%) var(--pm-fy,50%),var(--pm-flash) 0%,transparent 60%);
  animation:pm-flash .45s ease-out forwards}
@keyframes pm-flash{0%{opacity:.7}100%{opacity:0}}
.pm-hud.pm-light .pm-hud-label,.pm-hud.pm-light .pm-hud-wpm{color:#111;text-shadow:0 0 6px #fff,0 0 2px #fff}
.pm-hud.pm-light .pm-hud-count{background:linear-gradient(180deg,var(--pm-color) 0%,var(--pm-color) 45%,var(--pm-deep) 100%);
  -webkit-background-clip:text;background-clip:text;filter:drop-shadow(0 0 1px #fff) drop-shadow(0 2px 8px var(--pm-glow))}
.pm-hud.pm-light .pm-hud-tier{color:var(--pm-deep);text-shadow:0 0 6px #fff}
.pm-hud.pm-light .pm-hud-bar{background:rgba(0,0,0,.1)}
.pm-hud.pm-light .pm-hud-fill{background:linear-gradient(90deg,var(--pm-deep),var(--pm-color))}
.pm-slam.pm-light{color:var(--pm-color);-webkit-text-stroke:2px #fff;paint-order:stroke fill;
  text-shadow:4px 6px 0 var(--pm-deep),0 0 28px var(--pm-glow)}
.pm-slam.pm-light small{color:var(--pm-deep);text-shadow:0 0 8px #fff}
.pm-slam.pm-light.pm-quiet{color:#333;-webkit-text-stroke:0;text-shadow:0 0 10px #fff}
.pm-vignette.pm-light{background:radial-gradient(ellipse at center,transparent 60%,var(--pm-glow) 160%)}
.pm-flash.pm-big{background:radial-gradient(circle at var(--pm-fx,50%) var(--pm-fy,50%),#fff 0%,var(--pm-flash) 40%,transparent 90%);
  animation-duration:.9s}
.pm-flash.pm-big.pm-light{background:radial-gradient(circle at var(--pm-fx,50%) var(--pm-fy,50%),var(--pm-flash) 0%,transparent 80%)}
.pm-dim{position:fixed;inset:0;z-index:2147482998;pointer-events:none;will-change:opacity;
  background:radial-gradient(ellipse at center,transparent 45%,rgba(0,0,0,.5) 125%);animation:pm-dim-in .5s ease forwards}
.pm-dim.pm-light{background:radial-gradient(ellipse at center,transparent 50%,rgba(0,0,0,.18) 125%)}
@keyframes pm-dim-in{0%{opacity:0}100%{opacity:1}}
.pm-vignette{position:fixed;inset:0;z-index:2147482999;pointer-events:none;opacity:0;will-change:opacity;
  transition:opacity .4s ease;background:radial-gradient(ellipse at center,transparent 55%,var(--pm-glow) 140%)}
`;

// ---------------------------------------------------------------- haptics

/** Vibration patterns (ms on/off/on…) for the big moments. Scale is deliberate: bigger event, longer buzz. */
export const HAPTICS = {
  powerOn: [40],
  comboLost: [30, 40, 30, 40, 90],
  record: [90, 60, 90, 60, 220],
  nuke: [320, 90, 120, 90, 120],
  singularity: [450, 120, 200],
  agentMilestone: [50, 40, 80],
  turnComplete: [60, 60, 120],
  collection: [200, 100, 200, 100, 450],
} as const;

/** Milestone buzz grows with the milestone's rank (0 = the first). */
export function milestoneHaptic(rank: number): number[] {
  const r = Math.max(0, Math.min(rank, 7));
  return r < 2 ? [50 + 15 * r] : [60 + 15 * r, 50, 100 + 30 * r];
}

export const UNLOCK_HAPTICS: Record<Rarity, readonly number[]> = {
  common: [40],
  rare: [60, 50, 60],
  epic: [80, 50, 80, 50, 160],
  secret: [80, 50, 80, 50, 160],
  legendary: [120, 60, 120, 60, 300],
};

type VibrateFn = (pattern: number[]) => boolean;
let vibrateFn: VibrateFn | null = null;
/** Test seam: capture vibration patterns instead of calling navigator.vibrate (null restores it). */
export function setVibrate(fn: VibrateFn | null) {
  vibrateFn = fn;
}
function vibrate(pattern: number[]): void {
  if (vibrateFn) {
    vibrateFn(pattern);
    return;
  }
  // Missing on desktop and iOS Safari; Chrome also refuses before the first user gesture.
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some embedders throw instead of returning false; haptics are best-effort.
  }
}

// ---------------------------------------------------------------- sound

class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private static readonly SCALE = [0, 3, 5, 7, 10]; // minor pentatonic

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.18;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  key(combo: number, deleting: boolean) {
    if (deleting) {
      this.tone(160, 0.07, "sawtooth", 0.25, 0, 70);
      return;
    }
    const step = combo % 15;
    const octave = Math.floor(step / 5);
    const semis = Synth.SCALE[step % 5] + octave * 12 + Math.min(Math.floor(combo / 50), 3) * 2;
    this.tone(330 * Math.pow(2, semis / 12), 0.09, "square", 0.12);
  }

  boom() {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.tone(140, 0.5, "sine", 0.9, 0, 35);
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    src.connect(gain).connect(this.master);
    src.start();
  }

  fanfare() {
    this.boom();
    [0, 4, 7, 12].forEach((s, i) => this.tone(262 * Math.pow(2, s / 12), 0.35, "sawtooth", 0.12, i * 0.07));
  }

  chime() {
    [0, 7, 12, 16, 19].forEach((s, i) => this.tone(523 * Math.pow(2, s / 12), 0.4, "triangle", 0.18, i * 0.06));
  }

  powerUp() {
    this.tone(110, 0.6, "sawtooth", 0.3, 0, 880);
    this.tone(220, 0.6, "square", 0.12, 0.05, 1760);
  }

  powerDown() {
    this.tone(660, 0.5, "triangle", 0.25, 0, 60);
  }

  /** Firework shell bursting: a soft, short crack. `at` is a start offset (s). */
  pop(at = 0) {
    const f = 260 + Math.random() * 260;
    this.tone(f, 0.16, "triangle", 0.09, at, f * 0.35);
    this.tone(f * 3, 0.06, "square", 0.03, at);
  }

  /** Combo rescued at the last moment: two quick rising blips. */
  clutch() {
    this.tone(660, 0.09, "square", 0.1, 0, 990);
    this.tone(990, 0.14, "triangle", 0.14, 0.08, 1480);
  }

  /** Combo broke: a short, sour slide down. */
  lost() {
    this.tone(440, 0.28, "sawtooth", 0.18, 0, 150);
    this.tone(330, 0.3, "square", 0.08, 0.05, 110);
  }

  // ---- ordnance sounds. `flavor` re-voices them per theme; `at` is a Web
  // Audio start offset (s), so staggered sounds need no extra timers.

  private noiseBuffer: AudioBuffer | null = null;
  private voices = new Map<string, number[]>();

  /** At most 3 overlapping instances of the same sound. */
  private claim(name: string, at: number, dur: number): boolean {
    const ctx = this.ensure();
    if (!ctx || !this.master) return false;
    const now = ctx.currentTime;
    const live = (this.voices.get(name) ?? []).filter((end) => end > now + at);
    if (live.length >= 3) return false;
    live.push(now + at + dur);
    this.voices.set(name, live);
    return true;
  }

  private wave(flavor: OrdnanceSound, base: OscillatorType): OscillatorType {
    switch (flavor) {
      case "bit":
      case "chip": return "square";
      case "soft": return base === "sine" ? "sine" : "triangle";
      case "glitch": return base === "sine" ? "sine" : "sawtooth";
      default: return base;
    }
  }

  private ftone(flavor: OrdnanceSound, freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number) {
    const k = flavor === "heavy" ? 0.75 : 1;
    const v = flavor === "soft" ? vol * 0.6 : vol;
    this.tone(freq * k, dur, this.wave(flavor, type), v, at, slideTo ? slideTo * k : undefined);
    // Glitch: a detuned, slightly late twin.
    if (flavor === "glitch") this.tone(freq * 1.03, dur * 0.8, "sawtooth", v * 0.5, at + 0.02, slideTo ? slideTo * 0.97 : undefined);
  }

  private noise(flavor: OrdnanceSound, dur: number, vol: number, at = 0, filter?: { type: BiquadFilterType; freq: number; to?: number }, swell = false) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (!this.noiseBuffer) {
      const len = Math.floor(ctx.sampleRate * 2);
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = dur > 2;
    const gain = ctx.createGain();
    const level = vol * (flavor === "heavy" ? 1.3 : flavor === "soft" ? 0.5 : flavor === "chip" ? 0.6 : 1);
    if (swell) {
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + dur);
    } else {
      gain.gain.setValueAtTime(level, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    let node: AudioNode = src;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.frequency.setValueAtTime(filter.freq, t);
      if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t + dur);
      node = node.connect(f);
    }
    node.connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Noise ticks: firecracker pops. */
  crackle(flavor: OrdnanceSound, at = 0) {
    if (!this.claim("crackle", at, 0.1)) return;
    for (let i = 0; i < 3; i++) this.noise(flavor, 0.03, 0.5, at + i * 0.025, { type: "highpass", freq: 1800 });
    if (flavor === "chip" || flavor === "bit") this.ftone(flavor, 900, 0.05, "square", 0.15, at);
  }

  /** Band-passed hiss of a burning fuse. */
  fuse(flavor: OrdnanceSound, dur: number, at = 0) {
    if (!this.claim("fuse", at, dur)) return;
    this.noise(flavor, dur, 0.18, at, { type: "bandpass", freq: 3200, to: 4200 });
  }

  /** Metallic clack: a canister splitting open. */
  pin(flavor: OrdnanceSound, at = 0) {
    if (!this.claim("pin", at, 0.1)) return;
    this.ftone(flavor, 1800, 0.06, "square", 0.2, at);
    this.ftone(flavor, 2650, 0.08, "triangle", 0.15, at + 0.01);
  }

  /** Noise sweep: a rocket launch. */
  whoosh(flavor: OrdnanceSound, at = 0) {
    if (!this.claim("whoosh", at, 0.45)) return;
    this.noise(flavor, 0.45, 0.35, at, { type: "bandpass", freq: 400, to: 2400 });
  }

  /** Falling whistle: a dropped bomb. */
  whistle(flavor: OrdnanceSound, dur: number, at = 0) {
    if (!this.claim("whistle", at, dur)) return;
    this.ftone(flavor, 1200, dur, "sine", 0.12, at, 400);
  }

  /** Rising charge: an orbital strike locking on. */
  charge(flavor: OrdnanceSound, dur: number, at = 0) {
    if (!this.claim("charge", at, dur)) return;
    this.ftone(flavor, 200, dur, "sawtooth", 0.14, at, 1600);
  }

  /** Short sweep down: a beam firing. */
  zap(flavor: OrdnanceSound, at = 0) {
    if (!this.claim("zap", at, 0.3)) return;
    this.ftone(flavor, 1400, 0.28, "square", 0.22, at, 120);
  }

  /** Two-tone warning siren. */
  siren(flavor: OrdnanceSound, at = 0) {
    if (!this.claim("siren", at, 1.2)) return;
    for (let i = 0; i < 4; i++) this.ftone(flavor, i % 2 ? 880 : 660, 0.28, "square", 0.14, at + i * 0.3);
  }

  /** An explosion; `size` 0–1 scales depth and length. */
  blast(flavor: OrdnanceSound, size: number, at = 0) {
    if (!this.claim("blast", at, 0.5)) return;
    this.ftone(flavor, 150 - size * 50, 0.35 + size * 0.4, "sine", 0.5 + size * 0.4, at, 35);
    this.noise(flavor, 0.25 + size * 0.4, 0.3 + size * 0.3, at, { type: "lowpass", freq: 2400 - size * 1400, to: 200 });
    if (flavor === "glitch") this.noise(flavor, 0.08, 0.3, at + 0.12, { type: "highpass", freq: 3000 });
  }

  /** Long sub drop plus a rumbling noise tail. */
  nuke(flavor: OrdnanceSound, at = 0) {
    if (!this.claim("nuke", at, 2.6)) return;
    this.ftone(flavor, 60, 2.5, "sine", 1, at, 25);
    this.noise(flavor, 2.2, 0.7, at, { type: "lowpass", freq: 900, to: 120 });
  }

  /** Reversed noise swell into a sub drop: a singularity collapsing. */
  implode(flavor: OrdnanceSound, dur: number, at = 0) {
    if (!this.claim("implode", at, dur + 0.6)) return;
    this.noise(flavor, dur, 0.5, at, { type: "lowpass", freq: 300, to: 3000 }, true);
    this.ftone(flavor, 220, 0.6, "sine", 0.9, at + dur, 28);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.voices.clear();
  }
}

// ---------------------------------------------------------------- glow sprites
//
// Canvas shadowBlur is re-rasterized for every shape on every frame and was the
// main cost at high combos. Instead, each hue bucket gets one prerendered
// radial-gradient sprite, and every glowing particle is a single drawImage.

const SPRITE_SIZE = 64;
const spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * Light theme: effects are drawn as saturated "ink" with normal blending
 * instead of additive light (white-hot cores vanish on a white page).
 */
let lightMode = false;
/** Canvas blend for glowing effects: additive light on dark, normal on light. */
const glowBlend = (): GlobalCompositeOperation => (lightMode ? "source-over" : "lighter");
const styleCache = new Map<string, string>();

function bucket(hue: number): number {
  return ((Math.round(hue / HUE_STEP) * HUE_STEP) % 360 + 360) % 360;
}

function glowSprite(hue: number): HTMLCanvasElement {
  const key = bucket(hue);
  const cacheKey = `${lightMode ? "l" : "d"}${key}`;
  let sprite = spriteCache.get(cacheKey);
  if (sprite) return sprite;
  sprite = document.createElement("canvas");
  sprite.width = sprite.height = SPRITE_SIZE;
  const g = sprite.getContext("2d");
  if (g) {
    const c = SPRITE_SIZE / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    if (lightMode) {
      // Saturated, slightly dark core so it reads on white; soft colored halo.
      grad.addColorStop(0, `hsla(${key},100%,40%,1)`);
      grad.addColorStop(0.18, `hsla(${key},100%,47%,0.95)`);
      grad.addColorStop(0.42, `hsla(${key},100%,50%,0.35)`);
      grad.addColorStop(0.7, `hsla(${key},100%,55%,0.1)`);
      grad.addColorStop(1, `hsla(${key},100%,60%,0)`);
    } else {
      grad.addColorStop(0, `hsla(${key},100%,96%,1)`);
      grad.addColorStop(0.15, `hsla(${key},100%,72%,1)`);
      grad.addColorStop(0.4, `hsla(${key},100%,58%,0.45)`);
      grad.addColorStop(0.7, `hsla(${key},100%,52%,0.12)`);
      grad.addColorStop(1, `hsla(${key},100%,50%,0)`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  }
  spriteCache.set(cacheKey, sprite);
  return sprite;
}

let scorchCache: HTMLCanvasElement | null = null;
/** Dark soot blotch for impact marks. */
function scorchSprite(): HTMLCanvasElement {
  if (scorchCache) return scorchCache;
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = SPRITE_SIZE;
  const c = sprite.getContext("2d")!;
  const r = SPRITE_SIZE / 2;
  const g = c.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, "rgba(8,6,10,.85)");
  g.addColorStop(0.45, "rgba(12,10,14,.55)");
  g.addColorStop(0.8, "rgba(16,14,18,.15)");
  g.addColorStop(1, "rgba(16,14,18,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return (scorchCache = sprite);
}

/** Cached `hsl()` strings so the render loop allocates no strings per particle. */
const smokeSprites = new Map<string, HTMLCanvasElement>();
/** Soft gray puff; darker on light pages so it reads as smoke, not haze. */
function smokeSprite(): HTMLCanvasElement {
  const key = lightMode ? "l" : "d";
  let sprite = smokeSprites.get(key);
  if (sprite) return sprite;
  sprite = document.createElement("canvas");
  sprite.width = sprite.height = SPRITE_SIZE;
  const c = sprite.getContext("2d")!;
  const r = SPRITE_SIZE / 2;
  const g = c.createRadialGradient(r, r, 0, r, r, r);
  const tone = lightMode ? "70,70,80" : "200,200,215";
  g.addColorStop(0, `rgba(${tone},.5)`);
  g.addColorStop(0.5, `rgba(${tone},.22)`);
  g.addColorStop(1, `rgba(${tone},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  smokeSprites.set(key, sprite);
  return sprite;
}

function hsl(hue: number, light: number): string {
  // On a light page, pull pastel/bright lightness down into a 30–50% "ink" range.
  const l = lightMode ? Math.round(30 + (light / 100) * 20) : light;
  const key = `${bucket(hue)}:${l}`;
  let value = styleCache.get(key);
  if (!value) {
    value = `hsl(${bucket(hue)},100%,${l}%)`;
    styleCache.set(key, value);
  }
  return value;
}

// ---------------------------------------------------------------- agent bridge
//
// The app overlay (a React slot with access to live thread status) reports
// every thread's status plus the thread the route shows. The engine attributes
// transcript activity to the visible thread only, keeps one counter per thread,
// and finishes a turn for the thread that actually finished. The engine may
// mount before or after the overlay, so the latest snapshot is kept here.

export interface AgentThreadInfo {
  id: string;
  title: string;
  /** An agent turn is in progress (active, starting or pending). */
  running: boolean;
  /** The thread is idle: a running to not-running change means its turn completed. */
  idle: boolean;
}

interface AgentSnapshot {
  threads: readonly AgentThreadInfo[];
  /** The thread whose transcript is on screen, or null when unknown. */
  visibleId: string | null;
}

interface AgentHooks {
  sync(snapshot: AgentSnapshot): void;
}
let agentSnapshot: AgentSnapshot = { threads: [], visibleId: null };
let agentHooks: AgentHooks | null = null;

export function syncAgentThreads(threads: readonly AgentThreadInfo[], visibleId: string | null) {
  agentSnapshot = { threads, visibleId };
  agentHooks?.sync(agentSnapshot);
}

// ---------------------------------------------------------------- engine

export function mountPowerEngine(signal: AbortSignal): () => void {
  let settings: PowerSettings = getPowerSettings();
  let theme: Theme = THEMES[settings.theme];
  let disposed = false;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  // Keep effect overlays outside the page content that shakes.
  function overlayCanvas(z: string): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.setAttribute("aria-hidden", "true");
    Object.assign(c.style, {
      position: "fixed", inset: "0", width: "100vw", height: "100vh",
      pointerEvents: "none", zIndex: z,
    });
    return c;
  }
  const canvas = overlayCanvas("2147483000");
  const ctx = canvas.getContext("2d");
  const bloom = overlayCanvas("2147482999");
  bloom.style.willChange = "opacity";
  const bctx = bloom.getContext("2d");

  const hud = document.createElement("div");
  hud.className = "pm-hud";
  hud.setAttribute("aria-hidden", "true");
  hud.innerHTML =
    '<div class="pm-hud-label">COMBO</div><div class="pm-hud-count">0</div><div class="pm-hud-tier"></div><div class="pm-hud-next"></div><div class="pm-hud-wpm"></div><div class="pm-hud-bar"><div class="pm-hud-fill"></div></div>';
  const hudLabel = hud.querySelector<HTMLElement>(".pm-hud-label")!;
  const hudCount = hud.querySelector<HTMLElement>(".pm-hud-count")!;
  const hudTier = hud.querySelector<HTMLElement>(".pm-hud-tier")!;
  const hudNext = hud.querySelector<HTMLElement>(".pm-hud-next")!;
  const hudWpm = hud.querySelector<HTMLElement>(".pm-hud-wpm")!;
  const challenge=document.createElement("div");challenge.className="pm-hud-wpm pm-hud-challenge";
  challenge.style.cssText="font-size:11px;max-width:260px;line-height:1.5;letter-spacing:normal";
  hudWpm.after(challenge);
  const updateChallenge=()=>{challenge.textContent=hudChallenge(getPowerStats());challenge.hidden=!challenge.textContent;};
  const unsubscribeChallenge=subscribePowerStats(updateChallenge);updateChallenge();
  const hudFill = hud.querySelector<HTMLElement>(".pm-hud-fill")!;

  const vignette = document.createElement("div");
  vignette.className = "pm-vignette";
  vignette.setAttribute("aria-hidden", "true");

  const transient = new Set<HTMLElement>();
  const timers = new Set<number>();
  let attached = false;

  function attach() {
    if (attached) return;
    attached = true;
    document.documentElement.append(bloom, canvas, vignette, hud);
    resize();
    applyThemeStatic();
  }

  function detach() {
    if (!attached) return;
    attached = false;
    canvas.remove();
    bloom.remove();
    vignette.remove();
    hud.remove();
  }

  function resize() {
    canvas.width = Math.floor(window.innerWidth * DPR);
    canvas.height = Math.floor(window.innerHeight * DPR);
    bloom.width = Math.ceil(window.innerWidth * BLOOM_SCALE);
    bloom.height = Math.ceil(window.innerHeight * BLOOM_SCALE);
  }
  window.addEventListener("resize", resize, { signal });

  const synth = new Synth();
  let particles: Particle[] = [];
  let glyphCount = 0;
  const shakes = new Map<HTMLElement, ShakeState>();
  let combo = 0;
  let lastKeyAt = 0;
  let raf = 0;
  let lastFrame = 0;
  let themeBucket = -1;
  let tierText = "";
  let wpmText = "";
  let nextText = "";
  let hudScale = "";
  /** This combo has passed the saved record. */
  let recordPace = false;
  let flameAcc = 0;
  const keyLog: { t: number; n: number }[] = [];

  // Agent combo (words the agent has written this turn)
  // One counter per running thread. Words are only credited to the thread whose
  // transcript is on screen, so `partial` marks a turn that was partly unseen.
  interface AgentTurn { words: number; milestone: number; partial: boolean }
  const agentTurns = new Map<string, AgentTurn>();
  const runningIds = new Set<string>();
  let visibleId: string | null = null;
  let settleUntil = 0;
  let agentHudActive = false;
  let lastAgentAt = 0;

  // Text protection: the editor being typed in.
  let activeEditor: HTMLElement | null = null;
  let lastCaretX = 0;
  let lastCaretY = 0;

  // Adaptive quality: if frames get slow, spawn fewer particles until they recover.
  let quality = 1;
  let frameEma = 16.7;

  const maxParticles = () => !settings.particles ? 0 : Math.round(Math.min(1200, Math.max(150, BASE_MAX_PARTICLES * settings.density)));
  const bloomOn = () => theme.bloom && settings.glow > 0.01;

  function setTheme(target: HTMLElement, hue: number) {
    const h = bucket(hue);
    target.classList.toggle("pm-light", lightMode);
    if (lightMode) {
      target.style.setProperty("--pm-color", `hsl(${h} 100% 45%)`);
      target.style.setProperty("--pm-deep", `hsl(${(h + 330) % 360} 100% 25%)`);
      target.style.setProperty("--pm-glow", `hsl(${h} 100% 50% / .45)`);
      target.style.setProperty("--pm-flash", `hsl(${h} 100% 50% / .22)`);
    } else {
      target.style.setProperty("--pm-color", `hsl(${h} 100% 62%)`);
      target.style.setProperty("--pm-deep", `hsl(${(h + 330) % 360} 100% 32%)`);
      target.style.setProperty("--pm-glow", `hsl(${h} 100% 55% / .75)`);
      target.style.setProperty("--pm-flash", `hsl(${h} 100% 70% / .5)`);
    }
  }

  function applyThemeStatic() {
    for (const el of [hud, document.documentElement]) el.style.setProperty("--pm-font", theme.font);
    hud.classList.toggle("pm-retro", theme.id === "retro");
    // On a light page a big pastel haze looks muddy: keep the bloom subtler.
    const strength = 0.35 + settings.glow * 0.65;
    bloom.style.opacity = bloomOn() ? String(lightMode ? strength * 0.6 : strength) : "0";
  }

  // ---- light / dark detection
  //
  // bb toggles a `dark` class on <html>; fall back to the page background's
  // luminance, then to the OS color scheme.

  function luminance(color: string): number | null {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a] = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (a !== undefined && a < 0.5) return null;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function detectLight(): boolean {
    const root = document.documentElement;
    if (root.classList.contains("dark")) return false;
    if (root.classList.contains("light")) return true;
    for (const el of [document.body, root]) {
      const l = el ? luminance(window.getComputedStyle(el).backgroundColor) : null;
      if (l !== null) return l > 0.5;
    }
    return !window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function refreshColorMode() {
    const next = detectLight();
    if (next === lightMode) return;
    lightMode = next;
    themeBucket = -1; // force HUD/vignette variables to re-apply
    styleCache.clear();
    smokeSprites.clear();
    applyThemeStatic();
  }

  let modeCheck = 0;
  const modeObserver = new MutationObserver(() => {
    if (!modeCheck) modeCheck = requestAnimationFrame(() => { modeCheck = 0; refreshColorMode(); });
  });
  modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", refreshColorMode, { signal });
  lightMode = detectLight();

  // ---- spawners

  /**
   * Debris budget. The top CARRIER_RESERVE slots of the pool are left for
   * ordnance bodies, so bombs still appear during a busy combo.
   */
  function room(count: number): number {
    const free = maxParticles() - CARRIER_RESERVE - particles.length;
    return Math.max(0, Math.min(Math.round(count * quality * settings.density), free));
  }

  function sparkKind(): ParticleKind {
    switch (theme.shape) {
      case "pixel": return "pixel";
      case "petal": return "petal";
      case "code": return "code";
      default: return "spark";
    }
  }

  /**
   * `src` is the theme whose palette applies (ordnance keeps the theme it was
   * dropped with); `dir`/`spread` aim the burst instead of a full circle.
   */
  function burst(
    x: number, y: number, hue: number, requested: number, power: number, kind: ParticleKind = sparkKind(),
    opts: { src?: Theme; dir?: number; spread?: number } = {},
  ) {
    const count = room(requested);
    const src = opts.src ?? theme;
    const retro = src.id === "retro";
    const spread = opts.spread ?? 0.6;
    for (let i = 0; i < count; i++) {
      const angle =
        opts.dir !== undefined ? opts.dir + rand(-spread, spread)
        : kind === "ember" ? rand(-Math.PI * 0.9, -Math.PI * 0.1) : rand(0, Math.PI * 2);
      const speed = rand(0.25, 1) * power * (kind === "petal" ? 0.5 : kind === "code" ? 0.4 : 1);
      const long = kind === "ember" || kind === "petal" || kind === "code";
      const life = long ? rand(700, 1300) : rand(350, 800);
      particles.push({
        kind, x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (kind === "spark" || kind === "pixel" ? power * 0.35 : 0),
        life, maxLife: life,
        size: kind === "shard" ? rand(3, 7) : kind === "pixel" ? (Math.random() < 0.5 ? 4 : 6) : kind === "petal" ? rand(4, 7) : rand(1.5, 3.8),
        hue: retro ? src.hue(Math.floor(rand(0, 7)), 0) : hue + rand(-25, 25),
        spin: rand(-0.3, 0.3),
        angle: rand(0, Math.PI * 2),
        text: kind === "code" ? MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)] : undefined,
        star: kind === "spark" && Math.random() < 0.14,
      });
    }
  }

  /** Slots left for one-off effect particles, below the carrier reserve. */
  function spare(): boolean {
    return particles.length < maxParticles() - CARRIER_RESERVE;
  }

  /** A hot core that blooms and fades in a few frames, giving a blast its punch. */
  function flare(x: number, y: number, hue: number, size: number, src: Theme = theme) {
    // A local flash is still a flash; pixel art has no soft glow.
    if (getReducedMotion() || src.shape === "pixel" || !spare()) return;
    const life = 170 + 130 * size;
    particles.push({ kind: "flare", x, y, vx: 0, vy: 0, life, maxLife: life, size: 36 + 120 * size, hue, spin: 0, angle: 0 });
  }

  /** Molten impact mark that cools and fades. Glow and code themes only; `size` 0–1. */
  function scorch(x: number, y: number, hue: number, size: number, src: Theme = theme) {
    if ((src.shape !== "glow" && src.shape !== "code") || !spare()) return;
    const life = 900 + 1100 * size;
    const r = 14 + 44 * size;
    // Cracks: [angle, length, bend] triples radiating from the center.
    const points: number[] = [];
    const cracks = 5 + Math.round(size * 4);
    for (let i = 0; i < cracks; i++) points.push((i / cracks) * Math.PI * 2 + rand(-0.35, 0.35), r * rand(0.55, 1.25), rand(-0.5, 0.5));
    particles.push({ kind: "scorch", x, y, vx: 0, vy: 0, life, maxLife: life, size: r, hue, spin: 0, angle: 0, points });
  }

  function ring(x: number, y: number, hue: number, size: number, life = 520) {
    if (particles.length >= maxParticles()) return;
    particles.push({ kind: "ring", x, y, vx: 0, vy: 0, life, maxLife: life, size, hue, spin: 0, angle: 0 });
  }

  /** Lingering puffs that rise and spread after a blast; `size` scales the plume. */
  function smoke(x: number, y: number, requested: number, size: number) {
    const count = room(requested);
    for (let i = 0; i < count; i++) {
      // Short enough that the power-on plume is gone within ~1.5 s.
      const life = rand(650, 1250) * (0.75 + size * 0.25);
      particles.push({
        kind: "smoke", x: x + rand(-8, 8) * size, y: y + rand(-6, 6) * size,
        vx: rand(-0.55, 0.55) * size, vy: rand(-1.1, -0.35),
        life, maxLife: life, size: rand(9, 18) * size, hue: 0,
        spin: rand(-0.02, 0.02), angle: rand(0, Math.PI * 2),
      });
    }
  }

  function glyph(x: number, y: number, hue: number, text: string, scale: number) {
    if (glyphCount >= MAX_GLYPHS || particles.length >= maxParticles()) return;
    glyphCount++;
    const life = rand(650, 1000);
    particles.push({
      kind: "glyph", x, y: y - 6,
      vx: rand(-1.2, 1.2), vy: rand(-4.5, -2.5),
      life, maxLife: life, size: rand(0.8, 1.1) * scale,
      hue, spin: rand(-0.12, 0.12), angle: rand(-0.3, 0.3), text,
    });
  }

  function bolt(x: number, y: number, hue: number) {
    if (getReducedMotion()) return;
    if (particles.length >= maxParticles()) return;
    const points: number[] = [];
    let px = x + rand(-260, 260);
    let py = -10;
    const segments = 12;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      points.push(px, py);
      px = px + (x - px) * (1 / (segments - i + 1)) + rand(-34, 34) * (1 - t);
      py = -10 + (y + 10) * ((i + 1) / segments);
    }
    points.push(x, y);
    particles.push({ kind: "bolt", x, y, vx: 0, vy: 0, life: 260, maxLife: 260, size: rand(1.5, 2.5), hue, spin: 0, angle: 0, points });
  }

  // ---- haptics

  let buzzUntil = 0;
  let buzzWeight = 0;
  /**
   * Vibrate for a big moment. While a pattern is still playing, a weaker one is
   * dropped and a stronger one replaces it, so stacked events (a milestone
   * landing with a badge) never queue up a long rattle.
   */
  function buzz(pattern: readonly number[]) {
    if (!settings.enabled || !settings.haptics || document.hidden) return;
    const weight = pattern.reduce((n, ms) => n + ms, 0);
    const now = performance.now();
    if (now < buzzUntil && weight <= buzzWeight) return;
    buzzUntil = now + weight;
    buzzWeight = weight;
    vibrate([...pattern]);
  }

  /** Cut a pattern that is still playing (power off, haptics off, dispose). */
  function stopBuzz() {
    if (performance.now() < buzzUntil) vibrate([0]);
    buzzUntil = 0;
    buzzWeight = 0;
  }

  // ---- shake (editor translation, viewport-safe page offsets)

  function shakeElement(el: HTMLElement, amp: number) {
    if (getReducedMotion()) return;
    const existing = shakes.get(el);
    if (existing) {
      existing.amp = Math.min(Math.max(existing.amp, amp), 12);
      return;
    }
    const cs = window.getComputedStyle(el);
    const state: ShakeState = {
      prev: el.style.translate, prevWillChange: el.style.willChange,
      baseTranslate: cs.translate, amp: Math.min(amp, 12),
    };
    if (el === document.body) {
      // A transform (including will-change:translate) on body rebases every
      // fixed sidebar, terminal and dialog. Relative offsets move page content
      // without changing the containing block of fixed descendants.
      state.prevPosition = el.style.position;
      state.prevLeft = el.style.left;
      state.prevTop = el.style.top;
      state.baseLeft = cs.position === "static" ? 0 : parseFloat(cs.left) || 0;
      state.baseTop = cs.position === "static" ? 0 : parseFloat(cs.top) || 0;
      if (cs.position === "static") el.style.position = "relative";
    } else {
      el.style.willChange = "translate";
    }
    shakes.set(el, state);
  }

  function screenShake(amp: number) {
    if (!settings.screenShake) return;
    shakeElement(document.body, amp);
  }

  function releaseShake(el: HTMLElement, s: ShakeState) {
    if (el === document.body) {
      el.style.position = s.prevPosition ?? "";
      el.style.left = s.prevLeft ?? "";
      el.style.top = s.prevTop ?? "";
    } else {
      el.style.translate = s.prev;
      el.style.willChange = s.prevWillChange;
    }
    shakes.delete(el);
  }

  function restoreShakes() {
    for (const [el, s] of shakes) releaseShake(el, s);
  }

  // ---- transient DOM effects

  function later(fn: () => void, ms: number) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  }

  /** A cosmetic follow-up: dropped if Power Mode is switched off before it fires. */
  function fx(fn: () => void, ms: number) {
    const epoch = fxEpoch;
    later(() => {
      if (disposed || !settings.enabled || epoch !== fxEpoch) return;
      fn();
      start();
    }, ms);
  }

  /** A small floating callout ("CLUTCH!", "CHAIN ×3") that pops and drifts up. */
  function pop(text: string, x: number, y: number, hue: number) {
    let live = 0;
    for (const el of transient) if (el.classList.contains("pm-pop")) live++;
    if (live >= 4) return;
    const el = document.createElement("div");
    el.className = `pm-pop${theme.id === "retro" ? " pm-retro" : ""}`;
    el.setAttribute("aria-hidden", "true");
    setTheme(el, hue);
    el.style.left = `${clampTo(x, window.innerWidth, 90)}px`;
    el.style.top = `${clampTo(y, window.innerHeight, 60)}px`;
    el.textContent = text;
    document.documentElement.appendChild(el);
    transient.add(el);
    later(() => { el.remove(); transient.delete(el); }, 980);
  }

  /** Where callouts about the combo appear: left of the HUD, clear of the counter. */
  function hudSpot(): { x: number; y: number } {
    return { x: window.innerWidth - 330, y: 110 };
  }

  /**
   * A firework: a shell climbs from the bottom edge to (tx, ty), then bursts in
   * the theme's own particles. The burst is scheduled, not detected in the frame loop.
   */
  function firework(tx: number, ty: number, hue: number, size = 1, delay = 0) {
    // An open singularity owns the sky: nothing new launches until it bursts.
    if (!settings.particles || pull) return;
    const fly = rand(380, 520);
    const launch = () => {
      const H = window.innerHeight;
      const sx = clampTo(tx + rand(-120, 120), window.innerWidth);
      if (particles.length < maxParticles()) {
        particles.push({
          kind: "shell", x: sx, y: H + 8, vx: 0, vy: 0, life: fly, maxLife: fly, size: 2 + size, hue,
          spin: rand(0, Math.PI * 2), angle: 0, points: [sx, H + 8, tx, ty],
        });
      }
      fx(() => {
        const mult = INTENSITY[settings.intensity].particles;
        flare(tx, ty, hue, 0.3 * size);
        burst(tx, ty, hue, 42 * size * mult, 6.5 * size);
        burst(tx, ty, (hue + 45) % 360, 16 * size * mult, 3.2 * size);
        ring(tx, ty, hue, 80 * size, 420);
        if (settings.sound) synth.pop();
      }, fly);
    };
    if (delay > 0) fx(launch, delay);
    else launch();
  }

  /** `count` fireworks spread across the upper half of the window. */
  function fireworks(count: number, hue: number, size = 1, hueStep = 40) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (let i = 0; i < count; i++) {
      // Even columns with jitter, so a volley never bunches up in one corner.
      const col = (i + 0.5) / count;
      firework(W * (0.12 + 0.76 * col) + rand(-40, 40), H * rand(0.16, 0.42), (hue + i * hueStep) % 360, size * rand(0.85, 1.15), i * 110);
    }
  }

  function flash(hue: number, x = window.innerWidth / 2, y = window.innerHeight / 2, big = false) {
    // Reduced motion: no full-viewport flashes at all (the big one is a white-out).
    if (getReducedMotion()) return;
    for (const el of transient) {
      if (!el.classList.contains("pm-flash")) continue;
      if (!big) return; // one at a time; a big (white-out) flash replaces it
      el.remove();
      transient.delete(el);
    }
    const el = document.createElement("div");
    el.className = big ? "pm-flash pm-big" : "pm-flash";
    el.setAttribute("aria-hidden", "true");
    setTheme(el, hue);
    el.style.setProperty("--pm-fx", `${x}px`);
    el.style.setProperty("--pm-fy", `${y}px`);
    document.documentElement.appendChild(el);
    transient.add(el);
    later(() => { el.remove(); transient.delete(el); }, big ? 950 : 500);
  }

  function slam(title: string, subtitle: string, hue: number, variant: "" | "quiet" | "agent" | "lost" = "", src: Theme = theme) {
    for (const el of transient) if (el.classList.contains("pm-slam")) { el.remove(); transient.delete(el); }
    const el = document.createElement("div");
    // Big slams get a light streak wiping across behind the title.
    const streak = variant === "" && !getReducedMotion();
    el.className = `pm-slam${variant ? ` pm-${variant}` : ""}${streak ? " pm-streak" : ""}${src.id === "retro" ? " pm-retro" : ""}`;
    el.setAttribute("aria-hidden", "true");
    setTheme(el, hue);
    // Big slams land letter by letter; quiet ones (and reduced motion) stay a single run of text.
    // The title stays one element (its text is the first child), with a span per letter inside.
    const letters = Array.from(title);
    if ((variant === "" || variant === "agent") && letters.length <= 24 && !getReducedMotion()) {
      const run = document.createElement("span");
      run.className = "pm-title";
      letters.forEach((ch, i) => {
        const span = document.createElement("span");
        span.className = "pm-ch";
        span.style.setProperty("--i", String(i));
        span.textContent = ch;
        run.appendChild(span);
      });
      el.appendChild(run);
    } else el.textContent = title;
    if (subtitle) {
      const small = document.createElement("small");
      small.textContent = subtitle;
      el.appendChild(small);
    }
    document.documentElement.appendChild(el);
    transient.add(el);
    later(() => { el.remove(); transient.delete(el); }, variant === "quiet" ? 1150 : variant === "lost" ? 1350 : 1650);
  }

  const RARITY_KICKER: Record<Rarity, string> = {
    common: "ACHIEVEMENT UNLOCKED", rare: "RARE ACHIEVEMENT", epic: "EPIC ACHIEVEMENT",
    legendary: "LEGENDARY ACHIEVEMENT", secret: "SECRET DISCOVERED",
  };

  /**
   * Achievement unlock banner: icon over spinning rays, kicker and title in the
   * category's color, a sheen sweep, the other badges of the batch and a
   * collection meter that fills to the new total. `note` replaces the flavor line.
   */
  function badgeBanner(a: Achievement, others: readonly Achievement[], hue: number, note = "") {
    for (const el of transient) if (el.classList.contains("pm-badge")) { el.remove(); transient.delete(el); }
    const extra = others.length;
    const rarity = rarityOf(a);
    const el = document.createElement("div");
    el.className = `pm-badge pm-r-${rarity}${theme.id === "retro" ? " pm-retro" : ""}`;
    el.setAttribute("aria-hidden", "true");
    setTheme(el, hue);
    const unlocked = getPowerStats().unlocked;
    const total = ACHIEVEMENTS.length;
    const have = ACHIEVEMENTS.reduce((n, x) => n + (unlocked[x.id] ? 1 : 0), 0);
    const icon = document.createElement("div");
    icon.className = "pm-badge-icon";
    icon.textContent = a.icon;
    if (!getReducedMotion()) {
      const rays = document.createElement("div");
      rays.className = "pm-badge-rays";
      icon.appendChild(rays);
    }
    const text = document.createElement("div");
    const kicker = document.createElement("div");
    kicker.className = "pm-badge-kicker";
    kicker.textContent = `${RARITY_KICKER[rarity]} · ${have}/${total}`;
    const title = document.createElement("div");
    title.className = "pm-badge-title";
    title.textContent = extra > 0 ? `${a.title} +${extra}` : a.title;
    const sub = document.createElement("div");
    sub.className = "pm-badge-sub";
    sub.textContent = note || (extra > 0 ? `${extra + 1} achievements unlocked at once` : (a.flavor ?? a.description));
    text.append(kicker, title, sub);
    el.append(icon, text);
    if (extra > 0) {
      const more = document.createElement("div");
      more.className = "pm-badge-more";
      others.slice(0, 4).forEach((o, i) => {
        const chip = document.createElement("span");
        chip.style.setProperty("--i", String(i));
        chip.textContent = o.icon;
        more.appendChild(chip);
      });
      el.appendChild(more);
    }
    const meter = document.createElement("div");
    meter.className = "pm-badge-meter";
    meter.style.setProperty("--pm-from", `${(Math.max(0, have - 1 - extra) / total) * 100}%`);
    meter.style.setProperty("--pm-to", `${(have / total) * 100}%`);
    el.appendChild(meter);
    document.documentElement.appendChild(el);
    transient.add(el);
    later(() => { el.remove(); transient.delete(el); }, 3450);
    return el;
  }

  function explode(x: number, y: number, hue: number, mult: number) {
    flare(x, y, hue, 0.7);
    burst(x, y, hue, 90 * mult, 13);
    if (theme.shape === "glow") burst(x, y, (hue + 40) % 360, 35 * mult, 7, "ember");
    smoke(x, y, 6 * mult, 1);
    ring(x, y, hue, 340, 700);
    ring(x, y, (hue + 60) % 360, 220, 520);
    // Keep the flash's bright center off the text being typed.
    if (settings.protectText) flash(hue);
    else flash(hue, x, y);
  }

  // ---- paste ordnance
  //
  // Weapon bodies ("carriers") are `ordnance` particles tweened along arcs.
  // Every detonation is scheduled with `arm()`, never detected in the frame
  // loop, so a dropped frame can't skip an impact and tests stay deterministic.

  interface Drop {
    skin: OrdnanceSkin;
    /** Theme captured at drop: switching themes mid-flight keeps the skin. */
    src: Theme;
    hue: number;
    power: number;
    shake: number;
    chars: number;
    tier: number;
    lucky: boolean;
    /** A combo milestone slammed on this paste: skip the small/warning slams. */
    milestone: boolean;
    /** Position in a run of quick pastes (1 = not chained). */
    chain: number;
  }

  /** Bumped on disable and dispose: stale detonation timers become no-ops. */
  let ordnanceEpoch = 0;
  /** Bumped on disable, dispose and when a singularity opens: pending fireworks and callouts are dropped. */
  let fxEpoch = 0;
  let pendingOrdnance = 0;
  /** A tier 7+ "event" (meteor shower, nuke, singularity) is running. */
  let eventActive = false;
  let armedThisPaste = 0;
  let lastTier = 0;
  /** Active singularity: live particles are pulled toward it. */
  let pull: { x: number; y: number } | null = null;
  let dim: HTMLElement | null = null;
  /** Combo added by pastes beyond the old flat +10; excluded from records. */
  let pasteBonus = 0;
  /** Ordnance pastes in a row, each within PASTE_CHAIN_MS of the last. */
  let pasteChain = 0;
  let lastOrdnanceAt = -Infinity;

  function arm(fn: () => void, ms: number) {
    const epoch = ordnanceEpoch;
    pendingOrdnance++;
    armedThisPaste++;
    later(() => {
      if (epoch !== ordnanceEpoch) return;
      pendingOrdnance--;
      if (disposed || !settings.enabled) return;
      fn();
      start();
    }, ms);
  }

  function setDim(on: boolean) {
    if (!on) {
      dim?.remove();
      dim = null;
      return;
    }
    if (dim) return;
    dim = document.createElement("div");
    dim.className = lightMode ? "pm-dim pm-light" : "pm-dim";
    dim.setAttribute("aria-hidden", "true");
    document.documentElement.appendChild(dim);
  }

  /** Drop everything in flight (disable, dispose). */
  function resetOrdnance() {
    ordnanceEpoch++;
    fxEpoch++;
    pendingOrdnance = 0;
    eventActive = false;
    pull = null;
    pendingPaste = null;
    pasteBonus = 0;
    pasteChain = 0;
    lastOrdnanceAt = -Infinity;
    setDim(false);
  }

  /** The weapon for a paste, or null for the plain paste burst (no text, or over the caps). */
  function planOrdnance(chars: number): OrdnancePick | null {
    if (!(chars > 0)) return null;
    let pick = pickOrdnance(chars, ordnanceRandom);
    if (pick.tier >= EVENT_TIER && eventActive) {
      pick = { tier: 5, count: ORDNANCE_COUNT[4][0], combo: ORDNANCE_COMBO[4], lucky: false };
    }
    if (pendingOrdnance + ORDNANCE_ARMS[pick.tier - 1] > MAX_PENDING_ORDNANCE) return null;
    return pick;
  }

  function clampTo(v: number, size: number, margin = 24) {
    return Math.min(Math.max(v, margin), Math.max(margin, size - margin));
  }

  /** A point in the viewport, `minR`–`maxR` from the caret and never within CARET_CLEARANCE of it. */
  function impactNear(x: number, y: number, minR: number, maxR: number, angle?: number): { x: number; y: number } {
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (let i = 0; i < 12; i++) {
      const a = angle !== undefined && i === 0 ? angle : rand(0, Math.PI * 2);
      const r = rand(Math.max(minR, CARET_CLEARANCE), Math.max(maxR, CARET_CLEARANCE + 1));
      const px = clampTo(x + Math.cos(a) * r, W);
      const py = clampTo(y + Math.sin(a) * r, H);
      if (Math.hypot(px - x, py - y) >= CARET_CLEARANCE) return { x: px, y: py };
    }
    // Caret in a tight corner: use the far side of the screen.
    return { x: x < W / 2 ? clampTo(W - 24, W) : 24, y: clampTo(y, H) };
  }

  function debrisKind(d: Drop): ParticleKind {
    return d.skin.debris;
  }

  function shardKind(d: Drop): ParticleKind {
    return d.src.shape === "pixel" ? "pixel" : d.src.shape === "code" ? "code" : "shard";
  }

  /** One explosion in the dropped skin; `size` 0–1. */
  function blast(d: Drop, x: number, y: number, size: number, opts: { flash?: boolean; big?: boolean; dir?: number } = {}) {
    const aimed = opts.dir !== undefined ? { src: d.src, dir: opts.dir, spread: 1.1 } : { src: d.src };
    // Pushed first, so the debris draws over the mark and the hot core.
    // Small pops (bomblets, dynamite) leave no mark and no flare: they come in swarms.
    if (size >= 0.4) {
      scorch(x, y, d.hue, size, d.src);
      flare(x, y, d.hue, size, d.src);
    }
    burst(x, y, d.hue, (20 + 70 * size) * d.power, 6 + 8 * size, debrisKind(d), aimed);
    if (d.src.shape === "glow") burst(x, y, (d.hue + 40) % 360, (6 + 24 * size) * d.power, 3 + 4 * size, "ember", { src: d.src });
    ring(x, y, d.hue, 60 + 280 * size, 400 + 320 * size);
    if (size >= 0.5) ring(x, y, (d.hue + 30) % 360, 40 + 160 * size, 260 + 200 * size);
    smoke(x, y, (2 + 7 * size) * d.power, 0.6 + size);
    if (opts.flash) {
      // Keep the flash's bright center off the text being typed.
      if (settings.protectText) flash(d.hue, undefined, undefined, opts.big);
      else flash(d.hue, x, y, opts.big);
    }
    screenShake((2 + 8 * size) * d.shake);
    if (settings.sound) synth.blast(d.skin.sound, size);
  }

  /** Spawn a weapon body. Carriers skip `room()` and use the reserved slots. */
  function carrier(
    d: Drop, variant: OrdVariant,
    o: { sx: number; sy: number; tx?: number; ty?: number; lift?: number; delay?: number; fly?: number; hold?: number;
      ease?: Ord["ease"]; size?: number; sweep?: number },
  ) {
    if (particles.length >= maxParticles()) return; // only past the reserve, see room()
    const delay = o.delay ?? 0;
    const fly = Math.max(1, o.fly ?? 1);
    const life = delay + fly + (o.hold ?? 0);
    particles.push({
      kind: "ordnance", x: o.sx, y: o.sy, vx: 0, vy: 0, life, maxLife: life,
      size: o.size ?? 1, hue: d.hue, spin: rand(-0.25, 0.25), angle: 0,
      ord: {
        variant, skin: d.skin, sx: o.sx, sy: o.sy, tx: o.tx ?? o.sx, ty: o.ty ?? o.sy,
        lift: o.lift ?? 0, delay, fly, ease: o.ease ?? "out", sweep: o.sweep,
      },
    });
  }

  function weaponSlam(d: Drop) {
    if (d.milestone && d.tier <= 2) return; // don't cut off the milestone slam for a pop
    const sub = `${d.lucky ? "LUCKY DROP · " : ""}${d.chain > 1 ? `CHAIN ×${d.chain} · ` : ""}${d.chars.toLocaleString("en-US")} CHARS`;
    slam(d.skin.titles[d.tier - 1], sub, d.hue, d.tier <= 2 ? "quiet" : "", d.src);
  }

  // Tier 1: a string of pops crackling in a line next to the caret.
  function firecracker(d: Drop, x: number, y: number, n: number) {
    const W = window.innerWidth;
    const side = x > W - 200 ? -1 : x < 200 ? 1 : Math.random() < 0.5 ? -1 : 1;
    const dy = rand(-14, 14);
    for (let i = 0; i < n; i++) {
      const px = clampTo(x + side * (CARET_CLEARANCE + 8 + i * 16), W);
      const py = clampTo(y + dy + rand(-5, 5), window.innerHeight);
      const at = 80 + i * 60;
      carrier(d, "cracker", { sx: px, sy: py, hold: at - 1 });
      if (settings.sound) synth.crackle(d.skin.sound, at / 1000);
      arm(() => {
        burst(px, py, d.hue, 12 * d.power, 4, debrisKind(d), { src: d.src });
        ring(px, py, d.hue, 34, 300);
        if (i === 0) weaponSlam(d);
        screenShake(1.2 * d.shake);
      }, at);
    }
  }

  // Tier 2: sticks tossed out on an arc; fuses burn, then pop.
  function dynamite(d: Drop, x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const p = impactNear(x, y, 60, 200);
      const fly = 380;
      const fuse = 600 + i * 120 + rand(0, 60);
      carrier(d, "stick", { sx: x, sy: y, tx: p.x, ty: p.y, lift: 70, fly, hold: fuse });
      if (settings.sound) synth.fuse(d.skin.sound, fuse / 1000, fly / 1000);
      arm(() => {
        blast(d, p.x, p.y, 0.35);
        burst(p.x, p.y, d.hue, 14 * d.power, 7, shardKind(d), { src: d.src });
        if (i === 0) weaponSlam(d);
      }, fly + fuse);
    }
  }

  // Tier 3: a canister splits at its apex; bomblets fan out and ripple.
  function cluster(d: Drop, x: number, y: number, n: number) {
    const apex = { x: clampTo(x + rand(-50, 50), window.innerWidth), y: Math.max(40, y - rand(120, 170)) };
    const up = 420;
    const drop = 300;
    carrier(d, "canister", { sx: x, sy: y, tx: apex.x, ty: apex.y, lift: 30, fly: up });
    const offset = rand(0, Math.PI * 2);
    const spots = Array.from({ length: n }, (_, j) => impactNear(x, y, 90, 150, offset + (j / n) * Math.PI * 2));
    arm(() => {
      if (settings.sound) synth.pin(d.skin.sound);
      burst(apex.x, apex.y, d.hue, 10 * d.power, 3, debrisKind(d), { src: d.src });
      spots.forEach((s, j) => {
        carrier(d, "bomblet", { sx: apex.x, sy: apex.y, tx: s.x, ty: s.y, lift: 40, fly: drop, hold: j * 70 });
      });
      weaponSlam(d);
    }, up);
    spots.forEach((s, j) => arm(() => blast(d, s.x, s.y, 0.28, { flash: j === n - 1 }), up + drop + j * 70));
  }

  // Tier 4: rockets from the screen edges curve into points around the caret.
  function rockets(d: Drop, x: number, y: number, n: number) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (let i = 0; i < n; i++) {
      const p = impactNear(x, y, 80, 240);
      const side = Math.floor(rand(0, 3));
      const s = side === 0 ? { x: -30, y: rand(0, H * 0.6) } : side === 1 ? { x: W + 30, y: rand(0, H * 0.6) } : { x: rand(0, W), y: -30 };
      const delay = i * 90;
      const fly = rand(350, 550);
      carrier(d, "rocket", { sx: s.x, sy: s.y, tx: p.x, ty: p.y, lift: side === 2 ? 0 : rand(40, 120), delay, fly, ease: "in" });
      if (settings.sound) synth.whoosh(d.skin.sound, delay / 1000);
      const dir = Math.atan2(p.y - s.y, p.x - s.x);
      arm(() => {
        blast(d, p.x, p.y, 0.4, { dir, flash: i === n - 1 });
        burst(p.x, p.y, d.hue, 10 * d.power, 9, shardKind(d), { src: d.src, dir, spread: 0.4 });
        if (i === 0) weaponSlam(d);
      }, delay + fly);
    }
  }

  // Tier 5: a bomber crosses the top and drops a line of bombs on the caret's row.
  function carpet(d: Drop, x: number, y: number, n: number) {
    const W = window.innerWidth;
    const row = clampTo(y, window.innerHeight, 40);
    const top = 46;
    const ltr = Math.random() < 0.5;
    const startX = ltr ? -80 : W + 80;
    const endX = ltr ? W + 80 : -80;
    const pass = 1700;
    carrier(d, "bomber", { sx: startX, sy: top, tx: endX, ty: top, fly: pass, ease: "linear" });
    const margin = 60;
    for (let i = 0; i < n; i++) {
      const k = ltr ? i : n - 1 - i;
      let bx = n === 1 ? W / 2 : margin + (k / (n - 1)) * Math.max(0, W - margin * 2);
      if (Math.abs(bx - x) < CARET_CLEARANCE && Math.abs(row - y) < CARET_CLEARANCE) {
        bx = clampTo(x + (bx >= x ? 1 : -1) * CARET_CLEARANCE, W);
        if (Math.abs(bx - x) < CARET_CLEARANCE) bx = clampTo(x - (bx >= x ? 1 : -1) * CARET_CLEARANCE, W);
      }
      const tDrop = (pass * (bx - startX)) / (endX - startX);
      const fall = 260 + Math.max(0, row - top) * 0.45;
      carrier(d, "bomb", { sx: bx, sy: top + 10, tx: bx, ty: row, delay: tDrop, fly: fall, ease: "in" });
      if (settings.sound) synth.whistle(d.skin.sound, fall / 1000, tDrop / 1000);
      arm(() => {
        blast(d, bx, row, 0.4, { flash: i === n - 1 });
        if (i === 0) weaponSlam(d);
      }, tDrop + fall);
    }
  }

  // Tier 6: a reticle locks on, then a beam sweeps through three blasts.
  function orbital(d: Drop, x: number, y: number) {
    const H = window.innerHeight;
    const W = window.innerWidth;
    const above = y > 200;
    const ty = clampTo(above ? y - rand(90, 150) : y + rand(90, 150), H, 40);
    const tx = clampTo(x + rand(-80, 80), W, 180);
    const lock = 600;
    const fire = 520;
    const sweep = 300 * (Math.random() < 0.5 ? -1 : 1);
    carrier(d, "reticle", { sx: tx, sy: ty, hold: lock - 1 });
    if (!d.milestone) slam(d.skin.lockTitle, "", d.hue, "quiet", d.src);
    if (settings.sound) synth.charge(d.skin.sound, lock / 1000);
    arm(() => {
      carrier(d, "beam", { sx: tx - sweep / 2, sy: ty, tx: tx + sweep / 2, ty, fly: fire, hold: 120, ease: "linear" });
      if (settings.sound) synth.zap(d.skin.sound);
      weaponSlam(d);
    }, lock);
    for (let k = 0; k < 3; k++) {
      const f = (k + 0.5) / 3;
      const hx = clampTo(tx - sweep / 2 + sweep * f, W);
      arm(() => blast(d, hx, ty, 0.5, { flash: k === 2 }), lock + fire * f);
    }
  }

  // Tier 7 (event): the edges dim; meteors streak in from a top corner.
  function meteors(d: Drop, x: number, y: number, n: number) {
    const W = window.innerWidth;
    eventActive = true;
    setDim(true);
    const fromLeft = Math.random() < 0.5;
    const fly = 520;
    let t = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) t += rand(120, 200);
      const last = i === n - 1;
      const p = impactNear(x, y, 80, 320);
      const sx = fromLeft ? rand(-120, W * 0.3) : rand(W * 0.7, W + 120);
      carrier(d, "meteor", { sx, sy: -60, tx: p.x, ty: p.y, delay: t, fly, ease: "in", size: last ? 2 : rand(0.8, 1.3) });
      if (settings.sound) synth.whoosh(d.skin.sound, t / 1000);
      arm(() => {
        blast(d, p.x, p.y, last ? 0.9 : 0.45, { flash: last, big: last });
        // Crater glow: slow embers that linger.
        burst(p.x, p.y, (d.hue + 20) % 360, 12 * d.power, 1.2, d.src.shape === "glow" ? "ember" : debrisKind(d), { src: d.src });
        if (i === 0) weaponSlam(d);
      }, t + fly);
    }
    arm(() => {
      eventActive = false;
      setDim(false);
    }, t + fly + 400);
  }

  // Tier 8 (event): siren, a slow bomb, a white-out, a mushroom cloud and aftershocks.
  function nuke(d: Drop, x: number, y: number) {
    eventActive = true;
    const p = impactNear(x, y, 110, 220);
    const fall = 1500;
    if (!d.milestone) slam(d.skin.incomingTitle, "", d.hue, "", d.src);
    if (settings.sound) {
      synth.siren(d.skin.sound);
      synth.whistle(d.skin.sound, (fall - 300) / 1000, 0.3);
    }
    carrier(d, "nuke", { sx: p.x, sy: -60, tx: p.x, ty: p.y, fly: fall, ease: "in" });
    arm(() => {
      blast(d, p.x, p.y, 1, { flash: true, big: true });
      ring(p.x, p.y, d.hue, 600, 1300);
      ring(p.x, p.y, (d.hue + 30) % 360, 450, 1050);
      ring(p.x, p.y, (d.hue + 60) % 360, 300, 800);
      // Mushroom stem: a rising column.
      burst(p.x, p.y, (d.hue + 20) % 360, 40 * d.power, 6, d.src.shape === "glow" ? "ember" : debrisKind(d),
        { src: d.src, dir: -Math.PI / 2, spread: 0.18 });
      if (settings.lightning) for (let k = 0; k < 3; k++) bolt(p.x + rand(-60, 60), p.y, d.hue);
      screenShake(12 * d.shake);
      buzz(HAPTICS.nuke);
      if (settings.sound) synth.nuke(d.skin.sound);
      weaponSlam(d);
    }, fall);
    arm(() => {
      // Mushroom cap spreading sideways.
      const cy = Math.max(30, p.y - 150);
      for (const dir of [0, Math.PI]) {
        burst(p.x, cy, d.hue, 25 * d.power, 6, debrisKind(d), { src: d.src, dir, spread: 0.35 });
      }
      ring(p.x, cy, d.hue, 160, 700);
    }, fall + 450);
    for (let k = 0; k < 3; k++) {
      arm(() => {
        const q = impactNear(x, y, 110, 280);
        blast(d, q.x, q.y, 0.45);
        if (k === 2) eventActive = false;
      }, fall + 350 * (k + 1));
    }
  }

  // Tier 9 (event): a black hole pulls every particle in, then goes supernova.
  function singularity(d: Drop, x: number, y: number) {
    eventActive = true;
    const p = impactNear(x, y, 100, 180);
    const pullMs = 1200;
    carrier(d, "hole", { sx: p.x, sy: p.y, hold: pullMs + 200 });
    // The hole owns the sky: fireworks still climbing or queued are swallowed.
    fxEpoch++;
    particles = particles.filter((q) => q.kind !== "shell");
    pull = { x: p.x, y: p.y };
    if (settings.sound) synth.implode(d.skin.sound, pullMs / 1000);
    arm(() => {
      pull = null;
      eventActive = false;
      const W = window.innerWidth;
      const H = window.innerHeight;
      ring(p.x, p.y, d.hue, Math.hypot(W, H), 1400);
      ring(p.x, p.y, (d.hue + 120) % 360, Math.max(W, H) * 0.6, 1000);
      burst(p.x, p.y, d.hue, maxParticles(), 16, debrisKind(d), { src: d.src });
      if (d.src.shape === "glow") burst(p.x, p.y, (d.hue + 60) % 360, maxParticles(), 8, "ember", { src: d.src });
      if (settings.protectText) flash(d.hue, undefined, undefined, true);
      else flash(d.hue, p.x, p.y, true);
      if (settings.lightning) for (let k = 0; k < 6; k++) bolt(clampTo(p.x + rand(-300, 300), W), clampTo(p.y + rand(-120, 120), H), d.hue);
      screenShake(12 * d.shake);
      buzz(HAPTICS.singularity);
      if (settings.sound) {
        synth.blast(d.skin.sound, 1);
        if (d.skin.sound === "soft") synth.chime();
      }
      weaponSlam(d);
    }, pullMs);
  }

  function dropOrdnance(pick: OrdnancePick, x: number, y: number, chars: number, milestone: boolean) {
    armedThisPaste = 0;
    lastTier = pick.tier;
    const tune = INTENSITY[settings.intensity];
    const now = performance.now();
    pasteChain = now - lastOrdnanceAt < PASTE_CHAIN_MS ? pasteChain + 1 : 1;
    lastOrdnanceAt = now;
    const chain = pasteChain;
    const d: Drop = {
      skin: ORDNANCE_SKINS[theme.id], src: theme, hue: theme.hue(combo, now),
      // Each link of a chain hits a little harder (up to +60%).
      power: tune.particles * Math.min(1.6, 1 + 0.2 * (chain - 1)), shake: tune.shake,
      chars, tier: pick.tier, lucky: pick.lucky, milestone, chain,
    };
    if (pick.lucky) {
      // A four-leaf shower, a gold ring and a gold firework announce the upgrade before the weapon lands.
      ring(x, y, 48, 170, 650);
      burst(x, y, 48, 24 * d.power, 5);
      if (settings.ghostLetters) for (let i = 0; i < 7; i++) glyph(x + rand(-30, 30), y, 48, "🍀", 1.1);
      firework(clampTo(x + rand(-90, 90), window.innerWidth, 60), Math.max(50, y - rand(150, 230)), 48, 0.9);
      pop("LUCKY!", x, y - 64, 48);
      if (settings.sound) synth.chime();
    }
    if (chain > 1) {
      // The chain callout stacks under the lucky one; rings widen with the chain.
      pop(`CHAIN ×${chain}`, x, y - (pick.lucky ? 96 : 64), d.hue);
      ring(x, y, (d.hue + 180) % 360, 90 + Math.min(chain, 6) * 30, 480);
    }
    recordStats((s) => ({
      ...s,
      bestPasteTier: Math.max(s.bestPasteTier, pick.tier),
      luckyDrops: s.luckyDrops + (pick.lucky ? 1 : 0),
      bestPasteChain: Math.max(s.bestPasteChain, chain),
    }));
    switch (pick.tier) {
      case 1: firecracker(d, x, y, pick.count); break;
      case 2: dynamite(d, x, y, pick.count); break;
      case 3: cluster(d, x, y, pick.count); break;
      case 4: rockets(d, x, y, pick.count); break;
      case 5: carpet(d, x, y, pick.count); break;
      case 6: orbital(d, x, y); break;
      case 7: meteors(d, x, y, pick.count); break;
      case 8: nuke(d, x, y); break;
      default: singularity(d, x, y); break;
    }
  }

  debugHook = () => {
    let ordnance = 0;
    let sum = 0;
    let n = 0;
    const kinds: Record<string, number> = {};
    for (const p of particles) {
      kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
      if (p.kind === "ordnance") ordnance++;
      else if (pull && pullable(p.kind)) {
        sum += Math.hypot(p.x - pull.x, p.y - pull.y);
        n++;
      }
    }
    return {
      particles: particles.length, maxParticles: maxParticles(), ordnance, pending: pendingOrdnance,
      event: eventActive, lastArmed: armedThisPaste, lastTier, dimmed: dim !== null,
      pullDistance: pull && n ? sum / n : null,
      kinds,
    };
  };

  // ---- HUD

  function bumpHud() {
    hudCount.classList.remove("pm-bump");
    requestAnimationFrame(() => hudCount.classList.add("pm-bump"));
  }

  function applyTheme(hue: number) {
    const b = bucket(hue);
    if (b === themeBucket) return;
    themeBucket = b;
    setTheme(hud, hue);
    setTheme(vignette, hue);
  }

  function setText(el: HTMLElement, value: string, cache: string): string {
    if (value !== cache) el.textContent = value;
    return value;
  }

  /** "13 TO GODLIKE": how far the combo is from its next milestone. */
  function nextMilestone(count: number): string {
    for (const m of MILESTONES) if (m.at > count) return `${m.at - count} TO ${m.title.replace(/!+$/, "")}`;
    return `${(Math.floor(count / 250) + 1) * 250 - count} TO ∞ POWER ∞`;
  }

  function showHud(label: string, count: number, tier: string, hue: number, next = "") {
    hudLabel.textContent = label;
    hudCount.textContent = String(count);
    tierText = setText(hudTier, tier, tierText);
    nextText = setText(hudNext, next, nextText);
    // The counter swells as the combo climbs (up to +30% at 500).
    const scale = label === "COMBO" ? (1 + Math.min(count, 500) / 500 * 0.3).toFixed(2) : "1";
    if (scale !== hudScale) hud.style.setProperty("--pm-hud-scale", (hudScale = scale));
    applyTheme(hue);
    hud.classList.add("pm-on");
    hud.classList.toggle("pm-hot", label === "COMBO" && count >= 100 && !getReducedMotion());
    bumpHud();
  }

  function hideHudIfIdle() {
    if (combo === 0 && !agentHudActive) {
      hud.classList.remove("pm-on", "pm-hot", "pm-danger", "pm-record");
      vignette.style.opacity = "0";
      wpmText = setText(hudWpm, "", wpmText);
    }
  }

  function wpm(now: number): number {
    while (keyLog.length && now - keyLog[0].t > WPM_WINDOW_MS) keyLog.shift();
    let chars = 0;
    for (const k of keyLog) chars += k.n;
    if (chars < 10 || keyLog.length < 2) return 0;
    const span = Math.max(now - keyLog[0].t, 3000);
    return Math.round(chars / 5 / (span / 60000));
  }

  // ---- combo

  function endCombo() {
    // Records count paste bumps only up to the old flat +10 per paste, so one
    // huge paste can't unlock combo achievements on its own.
    const earned = combo - pasteBonus;
    if (earned >= 25 && earned > settings.bestCombo) {
      const hue = theme.hue(earned, performance.now());
      const over = settings.bestCombo > 0 ? ` · +${earned - settings.bestCombo}` : "";
      slam(`×${earned}`, `NEW RECORD${over}`, hue);
      // A gold volley for the new best; bigger records earn more shells.
      fireworks(earned >= 250 ? 5 : earned >= 100 ? 4 : 3, 45, 1.1, 12);
      if (settings.ghostLetters) for (let i = 0; i < 4; i++) glyph(window.innerWidth / 2 + rand(-140, 140), window.innerHeight * 0.42, 45, "👑", 1.3);
      updatePowerSettings({ bestCombo: earned });
      buzz(HAPTICS.record);
      if (settings.sound) synth.fanfare();
    } else if (earned >= 25) {
      // The streak broke: the counter shatters off the HUD.
      const r = hudCount.getBoundingClientRect();
      const x = r.width ? r.left + r.width / 2 : window.innerWidth - 80;
      const y = r.height ? r.top + r.height / 2 : 100;
      burst(x, y, 355, 26, 7, theme.shape === "pixel" ? "pixel" : "shard");
      smoke(x, y, 3, 0.8);
      slam("COMBO LOST", `×${earned}`, 355, "lost");
      buzz(HAPTICS.comboLost);
      if (settings.sound) synth.lost();
    }
    hud.classList.remove("pm-hot", "pm-danger", "pm-record");
    combo = 0;
    recordPace = false;
    pasteBonus = 0;
    keyLog.length = 0;
    hideHudIfIdle();
  }

  function milestoneHue(m: Milestone): number {
    return theme.ownMilestoneHue ? theme.hue(m.at, performance.now()) : m.hue;
  }

  function onMilestone(m: Milestone, x: number, y: number) {
    const hue = milestoneHue(m);
    const mult = INTENSITY[settings.intensity].particles;
    explode(x, y, hue, mult);
    explode(window.innerWidth / 2, window.innerHeight * 0.38, hue, mult * 0.5);
    slam(m.title, `${m.at} COMBO`, hue);
    // Higher milestones earn a bigger show: one more firework per rank (none at 10).
    const rank = m.at > 500 ? MILESTONES.length : MILESTONES.findIndex((x) => x.at === m.at);
    fireworks(Math.min(rank, 6), hue, 0.9 + rank * 0.05);
    if (rank >= 3) fx(() => ring(x, y, (hue + 30) % 360, Math.max(window.innerWidth, window.innerHeight) * 0.55, 900), 140);
    screenShake(10 * INTENSITY[settings.intensity].shake);
    buzz(milestoneHaptic(rank));
    if (settings.lightning) {
      const bolts = m.at >= 100 ? 4 : m.at >= 50 ? 3 : 1;
      for (let i = 0; i < bolts; i++) later(() => bolt(x, y, hue), i * 70);
    }
    if (settings.sound) synth.fanfare();
    recordStats((s) => ({ ...s, milestones: s.milestones + 1 }));
  }

  // ---- achievements

  const unlockBatch: Achievement[] = [];
  let unlockTimer = 0;
  /** Cosmetic titles already earned, so a newly available one can be announced once. */
  let knownTitles = new Set(availableTitles(getPowerStats()));
  const unresetUnlock = onCollectionReset(() => {
    window.clearTimeout(unlockTimer);
    unlockTimer = 0;
    unlockBatch.length = 0;
    knownTitles = new Set();
  });
  const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, secret: 3, legendary: 4 };
  const RARITY_SHELLS: Record<Rarity, number> = { common: 0, rare: 1, epic: 3, secret: 3, legendary: 5 };

  /** The overlay celebration for a batch of unlocks; `replay` re-shows one from the gallery. */
  function celebrate(batch: readonly Achievement[], replay: boolean) {
    if (!batch.length || !settings.enabled || getReducedMotion()) return;
    // The rarest badge of the batch leads the banner.
    const lead = batch.reduce((best, a) => (RARITY_RANK[rarityOf(a)] > RARITY_RANK[rarityOf(best)] ? a : best), batch[0]);
    const others = batch.filter((a) => a !== lead);
    const rarity = rarityOf(lead);
    // Secrets are gold; otherwise the category picks the color.
    const hue = lead.hidden ? 45 : { Human: 48, Agent: 190, Together: 300 }[lead.category];
    const stats = getPowerStats();
    let note = "";
    if (!replay) {
      const fresh = availableTitles(stats).filter((t) => !knownTitles.has(t));
      for (const t of fresh) knownTitles.add(t);
      if (fresh.length) note = `New title to equip: ${fresh.join(", ")}`;
    }
    const complete = !replay && ACHIEVEMENTS.every((a) => stats.unlocked[a.id]);
    attach();
    // With particles off the toast is the whole feedback; no overlay banner.
    const el = settings.particles ? badgeBanner(lead, others, hue, note) : null;
    const r = el ? el.getBoundingClientRect() : null;
    const cx = r && r.width ? r.left + r.width / 2 : window.innerWidth / 2;
    const cy = r && r.height ? r.bottom : window.innerHeight * 0.2;
    if (settings.particles) {
      const mult = INTENSITY[settings.intensity].particles;
      burst(cx, cy, hue, (lead.category === "Together" ? 90 : 60) * mult, 8);
      burst(cx, cy, (hue + 40) % 360, 30 * mult, 5, "ember");
      ring(cx, cy, hue, lead.category === "Together" ? 260 : 200, 650);
      if (rarity !== "common") ring(cx, cy, (hue + 30) % 360, 140, 500);
      if (settings.ghostLetters) for (const a of batch.slice(0, 5)) glyph(cx + rand(-70, 70), cy, hue, a.icon, 1.2);
      // Rarer badges (or a bigger batch) launch more fireworks.
      fireworks(Math.min(6, RARITY_SHELLS[rarity] + Math.min(others.length, 2)), hue, 1, rarity === "legendary" ? 60 : 25);
    }
    if (complete) {
      fx(() => {
        slam("COLLECTION COMPLETE", `${ACHIEVEMENTS.length} OF ${ACHIEVEMENTS.length} BADGES`, 45);
        fireworks(6, 45, 1.3, 60);
        buzz(HAPTICS.collection);
        if (settings.sound) synth.fanfare();
      }, 900);
    }
    screenShake(rarity === "legendary" ? 8 : rarity === "common" ? 4 : 6);
    if (!replay) buzz(UNLOCK_HAPTICS[rarity]);
    if (settings.sound) {
      synth.chime();
      if (rarity === "legendary" || rarity === "epic") synth.fanfare();
    }
    start();
  }

  function onUnlock(a: Achievement) {
    unlockBatch.push(a);
    if (unlockTimer) return;
    unlockTimer = window.setTimeout(() => {
      unlockTimer = 0;
      const batch = unlockBatch.splice(0), first = batch[0];
      if (!first) return;
      const copy = { Human: "Finding your groove", Agent: "Co-pilot sighted", Together: "A lovely exchange" }[first.category];
      toast(`${first.icon} ${copy}: ${batch.length === 1 ? first.title : `${batch.length} achievements unlocked`}`, {
        description: batch.length === 1 ? (first.flavor ?? first.description) : "Your collection has new stories.",
        action: { label: "View gallery", onClick: () => window.dispatchEvent(new Event("power-mode:gallery")) },
      });
      celebrate(batch, false);
    }, 150);
  }
  // The gallery replays an earned badge's celebration on request.
  window.addEventListener("power-mode:replay-unlock", (event) => {
    const id = (event as CustomEvent<unknown>).detail;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (a && getPowerStats().unlocked[a.id]) celebrate([a], true);
  }, { signal });
  setUnlockHandler(onUnlock);

  // ---- user input

  // Paste length: `insertFromPaste` input events in <input>/<textarea> carry
  // `data: null`, so the length is read from the paste/drop event just before
  // it (only `.length`; the string is never copied or scanned).
  interface PendingPaste { chars: number; target: HTMLElement; at: number; event: Event; epoch: number }
  let pendingPaste: PendingPaste | null = null;
  const PASTE_SLOT_MS = 1000;

  // Some OS dictation/paste tools emit null data (or insertReplacementText).
  // Keep only a transient editor baseline so we can measure the inserted span,
  // including replacements, rather than guessing one character per event.
  const editorTexts = new WeakMap<HTMLElement, string>();
  const editorText = (target: HTMLElement) =>
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      ? target.value : target.textContent ?? "";
  function rememberEditor(event: Event) {
    const target = editableTarget(event.composedPath()[0] ?? event.target);
    if (target) editorTexts.set(target, editorText(target));
  }
  document.addEventListener("focusin", rememberEditor, { capture: true, signal });
  document.addEventListener("beforeinput", rememberEditor, { capture: true, signal });
  const initialEditor = editableTarget(document.activeElement);
  if (initialEditor) editorTexts.set(initialEditor, editorText(initialEditor));
  function insertedLength(before: string, after: string): number {
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let oldEnd = before.length, newEnd = after.length;
    while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
    return newEnd - start;
  }
  function matchingPaste(target: HTMLElement): PendingPaste | null {
    const slot = pendingPaste;
    return slot && performance.now() - slot.at < PASTE_SLOT_MS &&
      (slot.target === target || slot.target.contains(target) || target.contains(slot.target)) ? slot : null;
  }

  function onPasteCapture(event: Event) {
    if (!settings.enabled) return;
    const target = editableTarget(event.composedPath()[0] ?? event.target);
    if (!target) return;
    editorTexts.set(target, editorText(target));
    const data = (event as ClipboardEvent).clipboardData ?? (event as DragEvent).dataTransfer ?? null;
    let chars = 0;
    try {
      chars = data?.getData("text/plain").length ?? 0;
    } catch {
      chars = 0;
    }
    const slot: PendingPaste = { chars, target, at: performance.now(), event, epoch: ordnanceEpoch };
    pendingPaste = slot;
    later(() => {
      if (pendingPaste !== slot) return; // the input event consumed it
      pendingPaste = null;
      // Rich editors (ProseMirror, Lexical, CodeMirror) cancel the native paste
      // and insert the text themselves, so no input event follows.
      if (slot.epoch !== ordnanceEpoch || !settings.enabled || !slot.event.defaultPrevented || slot.chars === 0) return;
      if (!slot.target.isConnected || editableTarget(slot.target) !== slot.target) return;
      editorTexts.set(slot.target, editorText(slot.target));
      attach();
      const caret = caretOf(slot.target);
      if (caret) react(slot.target, caret, { deleting: false, newline: false, pasted: true, data: null, chars: slot.chars });
    }, 0);
  }
  document.addEventListener("paste", onPasteCapture, { capture: true, signal });
  document.addEventListener("drop", onPasteCapture, { capture: true, signal });

  function pasteLength(target: HTMLElement, event: InputEvent, inserted: number): number {
    const slot = matchingPaste(target);
    if (slot) {
      pendingPaste = null;
      return slot.chars;
    }
    const dropped = event.dataTransfer?.getData("text/plain").length;
    if (dropped) return dropped;
    return event.data?.length || inserted;
  }

  function caretOf(target: HTMLElement): { x: number; y: number } | null {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      ? fieldCaret(target)
      : selectionCaret(target);
  }

  function onInput(event: Event) {
    const target = editableTarget(event.composedPath()[0] ?? event.target);
    if (!target) return;
    const previous = editorTexts.get(target);
    const text = editorText(target);
    editorTexts.set(target, text);
    if (!settings.enabled) return;
    const inputEvent = event as InputEvent;
    const inputType = inputEvent.inputType ?? "insertText";
    if (inputType.startsWith("history")) return;
    const deleting = inputType.startsWith("delete");
    const newline = inputType === "insertParagraph" || inputType === "insertLineBreak" || inputEvent.data === "\n";
    const pasted = inputType === "insertFromPaste" || inputType === "insertFromDrop" ||
      (!deleting && matchingPaste(target) !== null);
    const inserted = inputEvent.data == null && !deleting && !matchingPaste(target) && previous !== undefined
      ? insertedLength(previous, text) : 0;
    const chars = deleting ? 0 : pasted ? pasteLength(target, inputEvent, inserted)
      : inputEvent.data?.length ?? (newline || previous === undefined ? 1 : inserted);
    // Bulk input and corrections have no per-key timing. Keep their full
    // character count without manufacturing a typing-speed record.
    const timed = !pasted && inputType !== "insertReplacementText" && chars === 1;

    attach();
    // Read layout once, before any writes in this handler.
    const caret = caretOf(target);
    if (!caret) return;
    react(target, caret, { deleting, newline, pasted, data: inputEvent.data, chars, timed });
  }

  function react(
    target: HTMLElement, caret: { x: number; y: number },
    ev: { deleting: boolean; newline: boolean; pasted: boolean; data: string | null; chars: number; timed?: boolean },
  ) {
    const { deleting, newline, pasted, data } = ev;
    const now = performance.now();
    if (now - lastKeyAt > COMBO_TIMEOUT_MS && combo > 0) endCombo();
    // A keystroke while the timer bar is fading rescues the combo.
    const left = combo >= 10 ? 1 - (now - lastKeyAt) / COMBO_TIMEOUT_MS : 1;
    const clutch = left < CLUTCH_LEFT && !deleting;
    lastKeyAt = now;
    // Pastes with text drop ordnance; empty (image/file) pastes and pastes over
    // the caps keep the plain paste burst.
    const pick = pasted ? planOrdnance(ev.chars) : null;
    if (pasted) armedThisPaste = lastTier = 0;
    const prev = combo;
    const bump = pick ? pick.combo : pasted ? 10 : 1;
    combo += bump;
    if (pasted) pasteBonus += Math.max(0, bump - 10);
    const typed = ev.timed ? ev.chars : 0;
    if (typed) keyLog.push({ t: now, n: typed });

    const tune = INTENSITY[settings.intensity];
    const hue = theme.hue(combo, now);
    const heat = Math.min(combo / 100, 1); // 0 → 1 as the combo builds
    const { x, y } = caret;
    activeEditor = target;
    lastCaretX = x;
    lastCaretY = y;
    const plainPaste = pasted && !pick;

    if (deleting) {
      burst(x, y, theme.id === "neon" || theme.id === "fire" ? 355 : hue, 8 * tune.particles, 5, theme.shape === "pixel" ? "pixel" : "shard");
      if (settings.shake) shakeElement(target, 3 * tune.shake);
    } else {
      const count = (6 + heat * 14) * tune.particles * (plainPaste ? 5 : 1);
      burst(x, y, hue, count, 3 + heat * 6);
      if (heat > 0.25 && theme.shape === "glow") burst(x, y, (hue + 30) % 360, count / 4, 2, "ember");
      if (settings.ghostLetters && data && !pasted) {
        const chars = Array.from(data).slice(0, 3);
        for (const ch of chars) if (ch.trim()) for (let i = 0; i < tune.glyphs; i++) glyph(x, y, hue, ch, 1 + heat * 0.8);
      }
      if (settings.shake) shakeElement(target, (2.5 + heat * 5) * tune.shake);
      if (settings.intensity === "godlike" && combo > 50) screenShake(1.2 * heat * tune.shake);
    }

    if (newline || plainPaste) {
      ring(x, y, hue, pasted ? 260 : 120);
      burst(x, y, hue, 30 * tune.particles, 9);
      if (settings.lightning && combo >= 25) bolt(x, y, hue);
      if (settings.sound) synth.boom();
      screenShake(4 * tune.shake);
    }

    if (settings.sound) synth.key(combo, deleting);

    const milestone = !deleting ? milestoneCrossed(prev, combo) : null;
    if (milestone) onMilestone(milestone, x, y);
    // After the milestone: weapon slams fire at detonation, after its slam.
    if (pick) dropOrdnance(pick, x, y, ev.chars, milestone !== null);

    showHud("COMBO", combo, tierName(combo), hue, nextMilestone(combo));
    const earnedNow = combo - pasteBonus;
    if (!recordPace && earnedNow >= 25 && earnedNow > settings.bestCombo) {
      // Passed the saved record mid-combo: crown the HUD, and say so if there was a record to beat.
      recordPace = true;
      hud.classList.add("pm-record");
      if (settings.bestCombo >= 25) {
        const spot = hudSpot();
        pop("NEW BEST!", spot.x, spot.y, 45);
        if (!pull) {
          ring(spot.x, spot.y, 45, 110, 500);
          burst(spot.x, spot.y, 45, 18 * tune.particles, 5);
        }
        if (settings.sound) synth.chime();
      }
    } else if (clutch) {
      const spot = hudSpot();
      pop(left < PHOTO_FINISH_LEFT ? "PHOTO FINISH!" : "CLUTCH!", spot.x, spot.y, 140);
      if (!pull) {
        ring(spot.x, spot.y, 140, 80, 420);
        burst(spot.x, spot.y, 140, 12 * tune.particles, 4);
      }
      if (settings.sound) synth.clutch();
    }
    const speed = wpm(now);
    wpmText = setText(hudWpm, speed > 0 ? `${speed} WPM` : "", wpmText);
    vignette.style.opacity = (Math.round(heat * 10) / 20).toFixed(2); // ≤ .5, 11 steps

    const earned = combo - pasteBonus;
    recordStats((s) => ({
      ...s,
      chars: s.chars + ev.chars,
      deletes: s.deletes + (deleting ? 1 : 0),
      pastes: s.pastes + (pasted ? 1 : 0),
      clutches: s.clutches + (clutch ? 1 : 0),
      bestCombo: Math.max(s.bestCombo, earned),
      bestWpm: typed > 0 && keyLog.length >= 15 ? Math.max(s.bestWpm, speed) : s.bestWpm,
    }), { typed: typed > 0 });
    start();
  }
  document.addEventListener("input", onInput, { capture: true, signal });

  // ---- agent output

  const rowTexts = new WeakMap<Element, string>();
  const wordCount = (text: string) => (text.match(/\S+/gu) ?? []).length;
  // BB's command approval preview renders only the first four lines while
  // collapsed. Count that stable prefix in either state; its remaining lines
  // are not available in the DOM when collapsed.
  function agentRowText(row: Element): string {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let text = "";
    const seenPreviews = new Set<Element>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const preview = node.parentElement?.closest('[data-testid="command-preview"]');
      const child = preview && node.parentElement?.closest("pre, button");
      if (preview && child?.parentElement === preview) {
        if (child.matches("pre") && !seenPreviews.has(child)) {
          seenPreviews.add(child);
          text += (child.textContent ?? "").split("\n").slice(0, 4).join("\n");
        }
        continue;
      }
      // Other timeline controls use CSS clamping, so their full content is
      // already present and only the control label needs to be excluded.
      const control = node.parentElement?.closest('button[aria-expanded]');
      if (control && row.contains(control) && /^(Show more|Show less)$/.test(control.textContent?.trim() ?? "")) continue;
      text += node.textContent ?? "";
    }
    return text;
  }
  const touched = new Map<HTMLElement, Node>();
  let agentFlushTimer = 0;
  let observing = false;

  function collectAgentMutations(records: MutationRecord[]) {
    for (const r of records) {
      const node = r.target;
      const el = node instanceof Element ? node : node.parentElement;
      if (!el) continue;
      const row = el.closest<HTMLElement>("[data-timeline-row-id]");
      if (!row || !row.closest("[data-timeline-items]")) {
        for (const added of Array.from(r.addedNodes)) {
          if (!(added instanceof Element)) continue;
          const rows = [added, ...Array.from(added.querySelectorAll("[data-timeline-row-id]"))];
          for (const candidate of rows) {
            if (candidate instanceof HTMLElement && candidate.matches("[data-timeline-row-id]") && candidate.closest("[data-timeline-items]")) touched.set(candidate, candidate);
          }
        }
        continue;
      }
      if (el.closest('[contenteditable="true"],textarea,input')) continue;
      const last = r.type === "childList" && r.addedNodes.length ? r.addedNodes[r.addedNodes.length - 1] : node;
      touched.set(row, last);
    }
    if (touched.size && !agentFlushTimer) agentFlushTimer = window.setTimeout(flushAgent, 70);
  }
  const observer = new MutationObserver(collectAgentMutations);

  function lastTextPoint(node: Node): { x: number; y: number } | null {
    let text: Text | null = null;
    if (node instanceof Text) text = node;
    else if (node instanceof Element) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data.trim()) text = n as Text;
    }
    if (!text || !text.isConnected) return null;
    const range = document.createRange();
    range.setStart(text, text.data.length);
    range.collapse(true);
    const rects = range.getClientRects();
    const r = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!r || (r.top === 0 && r.left === 0)) return null;
    if (r.bottom < 0 || r.top > window.innerHeight) return null; // off-screen
    return { x: r.right, y: r.top + r.height / 2 };
  }

  function flushAgent() {
    agentFlushTimer = 0;
    if (!settings.enabled || !settings.agentMode) {
      touched.clear();
      return;
    }
    const now = performance.now();
    // Rows only count for the thread on screen. While the transcript is being
    // swapped (or when no running thread is visible) texts are recorded as the
    // new baseline without crediting anyone.
    const creditId = creditTarget();
    let turn: AgentTurn | undefined;
    if (creditId !== null && now >= settleUntil) {
      turn = agentTurns.get(creditId);
      // Power mode was off when this turn began, so part of it went unseen.
      if (!turn) agentTurns.set(creditId, (turn = { words: 0, milestone: 0, partial: true }));
    }
    if (!turn) {
      for (const row of touched.keys()) rowTexts.set(row, agentRowText(row));
      touched.clear();
      return;
    }
    let totalDelta = 0;
    let wordDelta = 0;
    for (const [row, node] of touched) {
      const text = agentRowText(row);
      const previous = rowTexts.get(row) ?? "";
      rowTexts.set(row, text);
      const delta = text.length - previous.length;
      wordDelta += wordCount(text) - wordCount(previous);
      if (delta <= 0) continue;
      totalDelta += delta;
      const point = lastTextPoint(node);
      if (!point) continue;
      attach();
      const hue = theme.hue(turn.words + combo, now);
      const tune = INTENSITY[settings.intensity];
      burst(point.x, point.y, hue, Math.min(delta, 60) / 3 * tune.particles, 3 + Math.min(turn.words / 200, 1) * 4);
      if (settings.ghostLetters && node instanceof Text) {
        const tail = Array.from(node.data.slice(-Math.min(delta, 4))).filter((c) => c.trim());
        for (const ch of tail.slice(-2)) glyph(point.x, point.y, hue, ch, 0.9);
      }
      // Timeline rows are positioned and animated by the host. Moving a row
      // interferes with virtualization and its entrance/layout animations.
    }
    touched.clear();
    turn.words = Math.max(0, turn.words + wordDelta);
    if (totalDelta <= 0 && wordDelta === 0) return;

    lastAgentAt = now;
    agentHudActive = true;
    const added = totalDelta;
    recordStats((s) => ({ ...s, agentChars: s.agentChars + added }));

    const next = AGENT_MILESTONES.find((m) => m.at > turn.milestone && turn.words >= m.at);
    if (next) {
      turn.milestone = next.at;
      const hue = theme.hue(next.at, now);
      slam(next.title, `${turn.words} WORDS`, hue, "agent");
      explode(window.innerWidth / 2, window.innerHeight * 0.3, hue, 0.5);
      fireworks(next.at >= 600 ? 3 : next.at >= 150 ? 2 : 1, hue, 0.9);
      if (settings.lightning && next.at >= 300) bolt(window.innerWidth / 2, window.innerHeight * 0.3, hue);
      buzz(HAPTICS.agentMilestone);
      if (settings.sound) synth.fanfare();
    }
    if (combo === 0) {
      const ahead = AGENT_MILESTONES.find((m) => m.at > turn.words);
      showHud("AGENT", turn.words, "WORDS", theme.hue(turn.words, now), ahead ? `${ahead.at - turn.words} TO ${ahead.title}` : "");
    }
    start();
  }

  /** The running thread that transcript activity belongs to, if there is one. */
  function creditTarget(): string | null {
    if (visibleId !== null) return runningIds.has(visibleId) ? visibleId : null;
    // The route is unknown: only credit when there is no other candidate.
    return runningIds.size === 1 ? [...runningIds][0] : null;
  }

  function updateObserver() {
    const want = settings.enabled && settings.agentMode && runningIds.size > 0 && !disposed;
    if (want === observing) return;
    observing = want;
    if (want) {
      document.querySelectorAll("[data-timeline-items] [data-timeline-row-id]").forEach((row) => {
        rowTexts.set(row, agentRowText(row));
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    } else {
      for (const turn of agentTurns.values()) turn.partial = true;
      collectAgentMutations(observer.takeRecords());
      observer.disconnect();
      if (agentFlushTimer) window.clearTimeout(agentFlushTimer);
      agentFlushTimer = 0;
      if (touched.size) flushAgent();
    }
  }

  /** Flush buffered rows while the attribution that produced them still holds. */
  function flushPendingAgent() {
    if (observing) collectAgentMutations(observer.takeRecords());
    if (agentFlushTimer) window.clearTimeout(agentFlushTimer);
    agentFlushTimer = 0;
    if (touched.size) flushAgent();
  }

  function finishAgentTurn(info: AgentThreadInfo, wasCredited: boolean, onScreen: boolean) {
    const turn = agentTurns.get(info.id);
    agentTurns.delete(info.id);
    // A turn that was never watched (or was only partly watched) has no
    // trustworthy word count, so it only counts as a turn.
    const words = turn && !turn.partial ? turn.words : 0;
    recordStats((s) => ({ ...s, agentTurns: s.agentTurns + 1, bestAgentWords: Math.max(s.bestAgentWords, words) }));
    if (!wasCredited) return;
    // Only the finished thread's own HUD ends; a background finish leaves the
    // visible thread's combo alone.
    agentHudActive = false;
    if (turn && onScreen && turn.words >= 20) {
      attach();
      const hue = theme.hue(turn.words, performance.now());
      const name = info.title.length > 32 ? `${info.title.slice(0, 31)}…` : info.title;
      slam("TURN COMPLETE", `${turn.words} WORDS · ${name}`, hue, "agent");
      explode(window.innerWidth / 2, window.innerHeight * 0.3, hue, 0.8);
      // The finale scales with the reply: two shells, up to five for a 600-word turn.
      fireworks(Math.min(5, 2 + Math.floor(turn.words / 200)), hue, 1, 50);
      buzz(HAPTICS.turnComplete);
      if (settings.sound) synth.fanfare();
      start();
    }
    hideHudIfIdle();
  }

  function syncAgent(snapshot: AgentSnapshot) {
    // Buffered rows belong to the attribution as it was before this update.
    flushPendingAgent();
    const before = creditTarget();
    const previousVisibleId = visibleId;
    const known = new Set(snapshot.threads.map((t) => t.id));
    const nowRunning = new Set(snapshot.threads.filter((t) => t.running).map((t) => t.id));
    const finishing = settings.enabled && settings.agentMode;
    for (const info of snapshot.threads) {
      if (!runningIds.has(info.id) || nowRunning.has(info.id)) continue;
      if (info.idle && finishing) {
        finishAgentTurn(info, before === info.id, snapshot.visibleId === null || snapshot.visibleId === info.id);
      } else agentTurns.delete(info.id);
    }
    runningIds.clear();
    for (const id of nowRunning) runningIds.add(id);
    visibleId = snapshot.visibleId;
    for (const id of [...agentTurns.keys()]) if (!known.has(id) || !runningIds.has(id)) agentTurns.delete(id);
    const after = creditTarget();
    for (const id of runningIds) {
      let turn = agentTurns.get(id);
      if (!turn) agentTurns.set(id, (turn = { words: 0, milestone: 0, partial: !settings.enabled || !settings.agentMode }));
      if (id !== after) turn.partial = true;
    }
    if (previousVisibleId !== visibleId) settleUntil = performance.now() + AGENT_SETTLE_MS;
    if (after !== before || previousVisibleId !== visibleId) {
      // The transcript on screen is being swapped: ignore it while it settles
      // and let the HUD follow the new thread's own counter.
      agentHudActive = false;
      hideHudIfIdle();
    }
    updateObserver();
  }

  agentHooks = { sync: syncAgent };
  syncAgent(agentSnapshot);

  // ---- text protection
  // Fade only the overlay pixels. Inserting fixed canvases into host editor
  // containers changes stacking and containing blocks during layout animations.

  function fadeCaret(c: CanvasRenderingContext2D, scale: number, x: number, y: number) {
    // A soft ellipse keeps the current text readable without cutting an
    // editor-sized rectangle out of particles and bloom.
    c.save();
    c.setTransform(scale * 72, 0, 0, scale * 24, scale * x, scale * y);
    const fade = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    fade.addColorStop(0, "rgba(0,0,0,.7)");
    fade.addColorStop(0.4, "rgba(0,0,0,.5)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    c.globalCompositeOperation = "destination-out";
    c.globalAlpha = 1;
    c.fillStyle = fade;
    c.fillRect(-1, -1, 2, 2);
    c.restore();
  }

  function focusedEditor(): HTMLElement | null {
    const el = activeEditor;
    if (!el || !el.isConnected) return null;
    const focused = document.activeElement;
    return focused && (el === focused || el.contains(focused)) ? el : null;
  }

  function protectTextZones(useBloom: boolean) {
    const editor = focusedEditor();
    if (!editor) return;
    const r = editor.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const x = Math.min(Math.max(lastCaretX, r.left), r.right);
    const y = Math.min(Math.max(lastCaretY, r.top), r.bottom);
    if (ctx) fadeCaret(ctx, DPR, x, y);
    if (useBloom && bctx) fadeCaret(bctx, BLOOM_SCALE, x, y);
  }

  function clearCanvases() {
    for (const c of [ctx, bctx]) {
      if (!c) continue;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    }
  }

  // ---- render loop

  function start() {
    if (!raf && !disposed) {
      lastFrame = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  function drawBolt(c: CanvasRenderingContext2D, pts: number[]) {
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.stroke();
  }

  // ---- ordnance rendering
  //
  // One draw treatment per skin style (tube, solid, glyph, paper, hardedge,
  // pixel) over shared per-variant geometry, so the 6 × 9 skins stay table-driven.

  /** Pixel-art sprites for the retro style: `#` body, `o` highlight, `*` spark. */
  const PIXEL_SPRITES: Partial<Record<OrdVariant, string[]>> = {
    cracker: ["*", "#", "#", "#"],
    stick: ["..*", ".#.", "###", "#o#", "###", ".#."],
    bomblet: [".#.", "#o#", ".#."],
    canister: ["####", "#oo#", "####", "#oo#", "####"],
    rocket: ["#....", "###..", "####o", "###..", "#...."],
    bomber: ["..##......", "..###.....", "#########o", "..###.....", "..##......"],
    bomb: ["..#..", ".###.", "#####", "#ooo#", ".###.", "#.#.#"],
    meteor: [".##.", "####", "#oo#", ".##."],
    nuke: [".###.", "#####", "#o#o#", "#####", "#####", ".###.", "#.#.#"],
  };

  /** Labels for the glyph (Matrix) style. */
  const GLYPH_LABELS: Partial<Record<OrdVariant, string>> = {
    cracker: "*", stick: "TNT", canister: "{…}", rocket: "=>>", bomber: "[▓▓▓]",
    bomb: "[0]", meteor: "█", nuke: "☢", hole: "NULL",
  };

  /** Variant body as a path in local coordinates (+x is "forward"). */
  function bodyPath(c: CanvasRenderingContext2D, o: Ord, size: number) {
    c.beginPath();
    const paper = o.skin.style === "paper";
    switch (o.variant) {
      case "cracker": c.rect(-3, -6, 6, 12); break;
      case "stick":
        if (paper) { c.rect(-9, -10, 6, 20); c.rect(-3, -10, 6, 20); c.rect(3, -10, 6, 20); }
        else c.rect(-4, -11, 8, 22);
        break;
      case "canister": c.roundRect(-7, -10, 14, 20, paper ? 7 : 3); break;
      case "bomblet": c.arc(0, 0, 4.5, 0, Math.PI * 2); break;
      case "rocket":
        c.moveTo(13, 0); c.lineTo(4, -4); c.lineTo(-9, -4); c.lineTo(-14, -9); c.lineTo(-14, 9); c.lineTo(-9, 4); c.lineTo(4, 4);
        c.closePath();
        break;
      case "bomber":
        if (paper) {
          // Paper crane.
          c.moveTo(26, -6); c.lineTo(4, 2); c.lineTo(-22, -10); c.lineTo(-8, 4); c.lineTo(-26, -4); c.lineTo(-4, 8); c.lineTo(10, 4);
          c.closePath();
          c.moveTo(-2, 2); c.lineTo(-14, -26); c.lineTo(8, 0); c.closePath();
        } else {
          c.ellipse(0, 0, 30, 6, 0, 0, Math.PI * 2);
          c.moveTo(8, 0); c.lineTo(-6, -24); c.lineTo(-13, -24); c.lineTo(-4, 0); c.lineTo(-13, 24); c.lineTo(-6, 24); c.closePath();
          c.moveTo(-22, 0); c.lineTo(-30, -10); c.lineTo(-34, -10); c.lineTo(-30, 0); c.closePath();
        }
        break;
      case "bomb":
        if (paper) c.roundRect(-8, -7, 16, 14, 6); // lantern
        else { c.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2); c.moveTo(-7, 0); c.lineTo(-14, -6); c.lineTo(-14, 6); c.closePath(); }
        break;
      case "nuke":
        c.ellipse(0, 0, 24, 13, 0, 0, Math.PI * 2);
        c.moveTo(-20, 0); c.lineTo(-33, -12); c.lineTo(-33, 12); c.closePath();
        break;
      case "meteor": c.arc(0, 0, 6 * size, 0, Math.PI * 2); break;
      default: c.arc(0, 0, 5, 0, Math.PI * 2);
    }
  }

  function drawPixelSprite(c: CanvasRenderingContext2D, rows: string[], cell: number, hue: number) {
    const w = rows[0].length * cell;
    const h = rows.length * cell;
    for (let r = 0; r < rows.length; r++) {
      for (let k = 0; k < rows[r].length; k++) {
        const ch = rows[r][k];
        if (ch === ".") continue;
        c.fillStyle = ch === "*" ? hsl(50, 60) : ch === "o" ? hsl(hue, 80) : hsl(hue, 45);
        c.fillRect(k * cell - w / 2, r * cell - h / 2, cell, cell);
      }
    }
  }

  /** Fill/stroke the current body path in the skin's treatment. */
  function paintBody(c: CanvasRenderingContext2D, o: Ord, p: Particle) {
    switch (o.skin.style) {
      case "tube":
        c.globalAlpha = 0.18;
        c.fillStyle = hsl(p.hue, 60);
        c.fill();
        c.globalAlpha = 1;
        c.lineWidth = 2;
        c.strokeStyle = hsl(p.hue, 70);
        c.stroke();
        break;
      case "solid":
        c.fillStyle = hsl(p.hue - 8, 32);
        c.fill();
        c.lineWidth = 1.5;
        c.strokeStyle = hsl(p.hue + 20, 58);
        c.stroke();
        break;
      case "paper":
        c.fillStyle = hsl(p.hue, 82);
        c.fill();
        c.lineWidth = 1.5;
        c.strokeStyle = lightMode ? hsl(p.hue, 30) : "#fff";
        c.stroke();
        break;
      default: {
        // hardedge: chromatic split (cyan/magenta ghosts), occasional glitch slice.
        const jitter = Math.random() < 0.12 ? rand(-5, 5) : 0;
        c.globalAlpha = 0.65;
        c.translate(-2 + jitter, 0);
        c.fillStyle = hsl(185, 55);
        c.fill();
        c.translate(4, 0);
        c.fillStyle = hsl(305, 55);
        c.fill();
        c.translate(-2 - jitter, 0);
        c.globalAlpha = 1;
        c.fillStyle = hsl(p.hue, 60);
        c.fill();
      }
    }
  }

  function setLocal(c: CanvasRenderingContext2D, x: number, y: number, angle: number, scale = 1) {
    const cos = Math.cos(angle) * scale * DPR;
    const sin = Math.sin(angle) * scale * DPR;
    c.setTransform(cos, sin, -sin, cos, x * DPR, y * DPR);
  }

  function glowAt(x: number, y: number, hue: number, r: number, alpha: number, useBloom: boolean) {
    const sprite = glowSprite(hue);
    if (ctx) {
      ctx.globalCompositeOperation = glowBlend();
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
    }
    if (useBloom && bctx) {
      const br = r * 2.4;
      bctx.globalAlpha = alpha;
      bctx.drawImage(sprite, x - br, y - br, br * 2, br * 2);
    }
  }

  /** A single trail/fuse particle; skipped when the pool is full. */
  function puff(x: number, y: number, hue: number, kind: ParticleKind, vx = rand(-0.4, 0.4), vy = rand(-0.6, 0.2)) {
    if (particles.length >= maxParticles() - CARRIER_RESERVE || Math.random() > quality) return;
    const life = rand(300, 650);
    particles.push({
      kind, x, y, vx, vy, life, maxLife: life,
      size: kind === "pixel" ? 3 : kind === "petal" ? rand(2.5, 4) : rand(1.2, 2.6),
      hue: hue + rand(-15, 15), spin: rand(-0.3, 0.3), angle: rand(0, Math.PI * 2),
      text: kind === "code" ? MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)] : undefined,
    });
  }

  function trailKind(o: Ord): ParticleKind {
    return o.skin.debris === "spark" ? "ember" : o.skin.debris;
  }

  function drawOrdnance(c: CanvasRenderingContext2D, p: Particle, step: number, useBloom: boolean) {
    const o = p.ord!;
    const elapsed = p.maxLife - p.life;
    if (elapsed < o.delay) return;
    const e0 = Math.min(1, (elapsed - o.delay) / o.fly);
    const e = o.ease === "in" ? e0 * e0 : o.ease === "out" ? 1 - (1 - e0) * (1 - e0) : e0;
    const px = p.x;
    const py = p.y;
    p.x = o.sx + (o.tx - o.sx) * e;
    p.y = o.sy + (o.ty - o.sy) * e - o.lift * 4 * e * (1 - e);
    const moving = e0 < 1 && elapsed - o.delay > 0;
    if (moving && (p.x !== px || p.y !== py)) {
      p.vx = p.x - px;
      p.vy = p.y - py;
    }
    const t = p.life / p.maxLife;
    const style = o.skin.style;
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;

    switch (o.variant) {
      case "reticle": {
        // Shrinks while locking on; blinks, then holds steady.
        const k = elapsed / Math.max(1, p.maxLife);
        if (k < 0.7 && Math.floor(elapsed / 90) % 2 === 1) break;
        const r = 22 + 46 * (1 - k);
        c.setTransform(DPR, 0, 0, DPR, 0, 0);
        c.strokeStyle = hsl(p.hue, 60);
        c.lineWidth = style === "pixel" ? 3 : 2;
        c.beginPath();
        if (style === "pixel") c.rect(Math.round(p.x - r), Math.round(p.y - r), Math.round(r * 2), Math.round(r * 2));
        else c.arc(p.x, p.y, r, 0, Math.PI * 2);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          c.moveTo(p.x + dx * r * 0.55, p.y + dy * r * 0.55);
          c.lineTo(p.x + dx * r * 1.35, p.y + dy * r * 1.35);
        }
        c.stroke();
        if (style === "glyph") {
          c.font = `700 13px ${THEMES.matrix.font}`;
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillStyle = hsl(p.hue, 70);
          c.fillText(o.skin.lockTitle, p.x, p.y - r - 14);
        }
        glowAt(p.x, p.y, p.hue, 8, 0.9, useBloom);
        break;
      }
      case "beam": {
        // A column from the top of the screen, sweeping sideways.
        const w = style === "hardedge" ? 10 : 16;
        const bx = style === "pixel" ? Math.round(p.x / 4) * 4 : p.x;
        c.setTransform(DPR, 0, 0, DPR, 0, 0);
        const fade = Math.min(1, t * 4);
        if (style === "glyph") {
          c.font = `700 15px ${THEMES.matrix.font}`;
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillStyle = hsl(p.hue, 70);
          c.globalAlpha = fade;
          for (let gy = (elapsed / 4) % 18; gy < p.y; gy += 18) {
            c.fillText(MATRIX_CHARS[(Math.floor(gy) * 7 + Math.floor(elapsed / 60)) % MATRIX_CHARS.length], bx, gy);
          }
        } else {
          if (style === "hardedge") {
            c.globalAlpha = 0.6 * fade;
            c.fillStyle = hsl(185, 55);
            c.fillRect(bx - w / 2 - 4, 0, w, p.y);
            c.fillStyle = hsl(305, 55);
            c.fillRect(bx - w / 2 + 4, 0, w, p.y);
          }
          c.globalAlpha = 0.55 * fade;
          c.fillStyle = hsl(p.hue, 60);
          c.fillRect(bx - w / 2, 0, w, p.y);
          c.globalAlpha = fade;
          c.fillStyle = lightMode ? hsl(p.hue, 20) : "#fff";
          c.fillRect(bx - w / 6, 0, w / 3, p.y);
        }
        if (useBloom && bctx) {
          bctx.globalAlpha = 0.8 * fade;
          bctx.fillStyle = hsl(p.hue, 60);
          bctx.fillRect(bx - w * 1.5, 0, w * 3, p.y);
        }
        glowAt(bx, p.y, p.hue, 40, fade, useBloom);
        break;
      }
      case "hole": {
        // Opens, wobbles (lensing), then collapses in its last 200 ms.
        const open = Math.min(1, elapsed / 300);
        const collapse = Math.min(1, p.life / 200);
        const r = (6 + 22 * open) * collapse;
        p.angle += 0.08 * step;
        const wob = 1 + Math.sin(elapsed / 70) * 0.12;
        c.setTransform(DPR, 0, 0, DPR, 0, 0);
        c.lineWidth = style === "pixel" ? 4 : 3;
        for (let k = 0; k < 2; k++) {
          c.strokeStyle = hsl(p.hue + k * 40, 60 + k * 10);
          c.globalAlpha = 0.9 - k * 0.3;
          c.beginPath();
          c.ellipse(p.x, p.y, r * (2.3 + k * 0.5) * wob, r * (0.8 + k * 0.2) / wob, p.angle + k, 0, Math.PI * 2);
          c.stroke();
        }
        c.globalAlpha = 1;
        c.fillStyle = "#000";
        c.beginPath();
        if (style === "pixel") c.rect(Math.round(p.x - r), Math.round(p.y - r), Math.round(r * 2), Math.round(r * 2));
        else c.arc(p.x, p.y, r, 0, Math.PI * 2);
        c.fill();
        if (style === "glyph") {
          c.font = `700 12px ${THEMES.matrix.font}`;
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillStyle = hsl(p.hue, 70);
          c.fillText(GLYPH_LABELS.hole!, p.x, p.y + r + 14);
        }
        if (useBloom && bctx) {
          bctx.globalAlpha = 0.9;
          bctx.strokeStyle = hsl(p.hue, 60);
          bctx.lineWidth = 12;
          bctx.beginPath();
          bctx.ellipse(p.x, p.y, r * 2.4 * wob, r * 0.9 / wob, p.angle, 0, Math.PI * 2);
          bctx.stroke();
        }
        break;
      }
      default: {
        // Rockets and meteors face their flight; bombs face down; sticks and
        // canisters tumble while airborne.
        let angle = 0;
        if (o.variant === "rocket" || o.variant === "meteor") angle = Math.atan2(p.vy, p.vx);
        else if (o.variant === "bomb" || o.variant === "nuke") angle = Math.PI / 2;
        else if (o.variant === "bomber") angle = o.tx < o.sx ? Math.PI : 0;
        else if (moving) { p.angle += p.spin * step; angle = p.angle; }
        else angle = p.angle;
        const size = o.variant === "meteor" ? p.size : 1;

        if (o.variant === "meteor") {
          // Long glowing tail behind the head.
          const len = 90 * size;
          const back = Math.atan2(p.vy, p.vx) + Math.PI;
          c.setTransform(DPR, 0, 0, DPR, 0, 0);
          const tx = p.x + Math.cos(back) * len;
          const ty = p.y + Math.sin(back) * len;
          const grad = c.createLinearGradient(p.x, p.y, tx, ty);
          grad.addColorStop(0, hsl(p.hue, 70));
          grad.addColorStop(1, "rgba(0,0,0,0)");
          c.strokeStyle = grad;
          c.lineWidth = 5 * size;
          c.lineCap = "round";
          c.beginPath();
          c.moveTo(p.x, p.y);
          c.lineTo(tx, ty);
          c.stroke();
          c.lineCap = "butt";
        }

        if (style === "glyph") {
          let label = GLYPH_LABELS[o.variant] ?? (p.spin > 0 ? "1" : "0");
          if (o.variant === "rocket" && p.vx < 0) label = "<<=";
          setLocal(c, p.x, p.y, 0);
          c.font = `700 ${o.variant === "nuke" ? 34 : o.variant === "meteor" ? Math.round(15 * size) : 16}px ${THEMES.matrix.font}`;
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillStyle = hsl(p.hue, 72);
          c.fillText(label, 0, 0);
        } else if (style === "pixel") {
          const rows = PIXEL_SPRITES[o.variant];
          if (rows) {
            const cell = o.variant === "nuke" ? 6 : o.variant === "meteor" ? Math.round(3 * size) : 3;
            const flip = (o.variant === "rocket" || o.variant === "bomber") && (p.vx < 0 || o.tx < o.sx);
            c.setTransform(flip ? -DPR : DPR, 0, 0, DPR, Math.round(p.x / 2) * 2 * DPR, Math.round(p.y / 2) * 2 * DPR);
            drawPixelSprite(c, rows, cell, p.hue);
          }
        } else {
          setLocal(c, p.x, p.y, angle);
          bodyPath(c, o, size);
          paintBody(c, o, p);
          if (o.variant === "nuke" && style !== "paper") {
            // Hazard band.
            c.fillStyle = hsl(55, 55);
            c.fillRect(-4, -11, 5, 22);
          }
        }
        c.setTransform(DPR, 0, 0, DPR, 0, 0);

        // Fuse on landed sticks: shrinks and spits sparks.
        if (o.variant === "stick" && !moving) {
          const left = p.life / Math.max(1, p.maxLife - o.fly);
          const fx = p.x + 4;
          const fy = p.y - 11 - 12 * left;
          c.strokeStyle = hsl(30, 40);
          c.lineWidth = 1.5;
          c.beginPath();
          c.moveTo(p.x, p.y - 11);
          c.lineTo(fx, fy);
          c.stroke();
          glowAt(fx, fy, 45, 7, 0.9, useBloom);
          if (Math.random() < 0.4) puff(fx, fy, 40, o.skin.debris === "pixel" ? "pixel" : o.skin.debris === "code" ? "code" : "spark", rand(-1.2, 1.2), rand(-2, -0.5));
        }
        if (o.variant === "cracker") glowAt(p.x, p.y - 7, 45, 5, 0.7, useBloom);
        // Trails for things in flight.
        if (moving && (o.variant === "rocket" || o.variant === "meteor" || o.variant === "nuke") && Math.random() < 0.7) {
          puff(p.x - p.vx, p.y - p.vy, p.hue + 20, trailKind(o));
        }
        if (useBloom && bctx && o.variant !== "cracker") {
          const r = (o.variant === "nuke" ? 30 : o.variant === "bomber" ? 26 : 10) * size;
          bctx.globalAlpha = 0.7;
          bctx.drawImage(glowSprite(p.hue), p.x - r * 2, p.y - r * 2, r * 4, r * 4);
        }
      }
    }
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = glowBlend();
  }

  function frame(now: number) {
    if (disposed) { raf = 0; return; }
    // Keep raf set while rendering: combo records/achievements can synchronously
    // change settings and call start(). They must not create a second loop.
    try {
      renderFrame(now);
    } catch (error) {
      // A throwing frame used to end the loop with its last frame (and bloom)
      // frozen on the fixed canvases. Drop the animation state that may be
      // half-updated, wipe the layers and let the loop idle or continue.
      console.error("[power-mode] render frame failed", error);
      particles = [];
      glyphCount = 0;
      clearCanvases();
    } finally {
      raf = 0;
    }
    if (particles.length > 0 || shakes.size > 0 || combo > 0 || agentHudActive || pendingOrdnance > 0) {
      raf = requestAnimationFrame(frame);
    } else {
      clearCanvases();
    }
  }

  function renderFrame(now: number) {
    const dt = Math.min(now - lastFrame, 50);
    lastFrame = now;
    const step = dt / 16.67;

    frameEma = frameEma * 0.9 + dt * 0.1;
    if (frameEma > 24) quality = Math.max(0.3, quality * 0.96);
    else if (frameEma < 18) quality = Math.min(1, quality + 0.01);

    // Combo timers
    if (combo > 0) {
      const left = 1 - (now - lastKeyAt) / COMBO_TIMEOUT_MS;
      if (left <= 0) endCombo();
      else {
        hudFill.style.transform = `scaleX(${left.toFixed(3)})`;
        hud.classList.toggle("pm-danger", left < CLUTCH_LEFT && combo >= 10 && !getReducedMotion());
        // Past 100 the counter burns: embers (or the theme's own sparks) rise from behind it.
        // The fire is fed by typing: it dies down once the timer has drained a quarter.
        if (combo >= 100 && left > 0.75 && settings.particles && !pull) {
          flameAcc += dt;
          if (flameAcc >= 70) {
            flameAcc = 0;
            const fxh = window.innerWidth - 28 - rand(8, 120);
            const hue = theme.hue(combo, now);
            if (theme.shape === "glow") burst(fxh, rand(96, 132), hue, 1, 1.8, "ember");
            else burst(fxh, rand(96, 132), hue, 1, 1.6, sparkKind(), { dir: -Math.PI / 2, spread: 0.5 });
          }
        }
      }
    } else if (agentHudActive) {
      const left = 1 - (now - lastAgentAt) / AGENT_TIMEOUT_MS;
      // End when the bar runs out even if the turn is still going (tool calls,
      // thinking): otherwise the HUD sits there empty until the turn finishes.
      if (left <= 0) {
        agentHudActive = false;
        hideHudIfIdle();
      }
      else hudFill.style.transform = `scaleX(${left.toFixed(3)})`;
    }

    // Shake: random offset that decays each frame
    for (const [el, s] of shakes) {
      if (!el.isConnected || s.amp < 0.4) {
        releaseShake(el, s);
        continue;
      }
      const x = rand(-s.amp, s.amp).toFixed(1);
      const y = rand(-s.amp, s.amp).toFixed(1);
      if (el === document.body) {
        el.style.left = `${s.baseLeft! + Number(x)}px`;
        el.style.top = `${s.baseTop! + Number(y)}px`;
      } else {
        const [baseX = "0px", baseY = "0px", baseZ] = s.baseTranslate === "none" ? [] : s.baseTranslate.split(/\s+/);
        el.style.translate = `calc(${baseX} + ${x}px) calc(${baseY} + ${y}px)${baseZ ? ` ${baseZ}` : ""}`;
      }
      s.amp *= Math.pow(0.8, step);
    }

    const useBloom = bloomOn() && bctx !== null;
    const bloomRadius = 2.2 + settings.glow * 2.3;
    if (useBloom && bctx) {
      bctx.setTransform(BLOOM_SCALE, 0, 0, BLOOM_SCALE, 0, 0);
      bctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      bctx.globalCompositeOperation = glowBlend();
    }

    if (ctx) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = glowBlend();
      const g = theme.gravity;
      const floor = window.innerHeight - 2;
      let w = 0;
      let textAlive = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) continue;
        particles[w++] = p;
        const t = p.life / p.maxLife; // 1 → 0
        if (pull && pullable(p.kind)) {
          // Singularity: bend velocities toward the hole; swallow what reaches it.
          const dx = pull.x - p.x;
          const dy = pull.y - p.y;
          const dist = Math.hypot(dx, dy) || 1;
          const f = Math.min(1.4, 700 / (dist + 80)) * step;
          p.vx += (dx / dist) * f;
          p.vy += (dy / dist) * f;
          if (dist < 14) p.life = Math.min(p.life, 50);
        }
        switch (p.kind) {
          case "ordnance":
            drawOrdnance(ctx, p, step, useBloom);
            break;
          case "spark":
          case "ember": {
            p.vy += (p.kind === "ember" ? -0.03 : 0.22 * g) * step;
            p.vx *= Math.pow(0.97, step);
            p.x += p.vx * step;
            p.y += p.vy * step;
            if (p.y > floor && p.vy > 0) { p.y = floor; p.vy *= -0.45; p.vx *= 0.8; }
            const r = p.size * (0.4 + t * 0.6) * 3.2;
            const sprite = glowSprite(p.hue);
            // Fast sparks leave a short streak behind them (cheap motion blur).
            const speed = Math.hypot(p.vx, p.vy);
            if (p.kind === "spark" && speed > 3) {
              ctx.globalAlpha = t * 0.55;
              ctx.strokeStyle = hsl(p.hue, 70);
              ctx.lineWidth = Math.max(1, p.size * 0.8);
              ctx.lineCap = "round";
              ctx.beginPath();
              ctx.moveTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4);
              ctx.lineTo(p.x, p.y);
              ctx.stroke();
              ctx.lineCap = "butt";
            }
            ctx.globalAlpha = t;
            ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
            if (p.star) {
              // A four-point glint that flickers as the spark flies.
              const arm = r * (1.5 + Math.sin(p.life / 45 + p.angle) * 0.9);
              ctx.globalAlpha = t * 0.85;
              ctx.strokeStyle = lightMode ? hsl(p.hue, 60) : "#fff";
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(p.x - arm, p.y);
              ctx.lineTo(p.x + arm, p.y);
              ctx.moveTo(p.x, p.y - arm);
              ctx.lineTo(p.x, p.y + arm);
              ctx.stroke();
            }
            if (useBloom && bctx) {
              const br = r * bloomRadius;
              bctx.globalAlpha = t;
              bctx.drawImage(sprite, p.x - br, p.y - br, br * 2, br * 2);
            }
            break;
          }
          case "pixel": {
            p.vy += 0.22 * g * step;
            p.x += p.vx * step;
            p.y += p.vy * step;
            if (p.y > floor && p.vy > 0) { p.y = floor; p.vy *= -0.6; p.vx *= 0.85; }
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = t > 0.25 ? 1 : t * 4; // 8-bit: no gradual fade until the end
            ctx.fillStyle = hsl(p.hue, 55);
            ctx.fillRect(Math.round(p.x / 2) * 2, Math.round(p.y / 2) * 2, p.size, p.size);
            ctx.globalCompositeOperation = glowBlend();
            break;
          }
          case "petal": {
            p.vy = Math.min(p.vy + 0.05 * step, 1.6);
            p.vx *= Math.pow(0.96, step);
            p.x += (p.vx + Math.sin(p.life / 160 + p.spin * 10) * 0.9) * step;
            p.y += p.vy * step;
            p.angle += p.spin * 0.4 * step;
            const cos = Math.cos(p.angle) * DPR;
            const sin = Math.sin(p.angle) * DPR;
            ctx.globalCompositeOperation = "source-over";
            ctx.setTransform(cos, sin, -sin, cos, p.x * DPR, p.y * DPR);
            ctx.globalAlpha = Math.min(1, t * 1.5);
            ctx.fillStyle = hsl(p.hue, 82);
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
            ctx.globalCompositeOperation = glowBlend();
            if (useBloom && bctx) {
              const br = p.size * bloomRadius * 1.5;
              bctx.globalAlpha = t * 0.6;
              bctx.drawImage(glowSprite(p.hue), p.x - br, p.y - br, br * 2, br * 2);
            }
            break;
          }
          case "code": {
            textAlive++;
            p.vy = Math.min(p.vy + 0.12 * g * step, 4);
            p.vx *= Math.pow(0.9, step);
            p.x += p.vx * step;
            p.y += p.vy * step;
            if (Math.random() < 0.05) p.text = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
            if (useBloom && bctx) {
              const br = 9 * bloomRadius;
              bctx.globalAlpha = t * 0.7;
              bctx.drawImage(glowSprite(p.hue), p.x - br, p.y - br, br * 2, br * 2);
            }
            break;
          }
          case "shard": {
            p.vy += 0.22 * step;
            p.vx *= Math.pow(0.97, step);
            p.x += p.vx * step;
            p.y += p.vy * step;
            if (p.y > floor && p.vy > 0) { p.y = floor; p.vy *= -0.4; p.vx *= 0.7; p.spin *= 0.5; }
            p.angle += p.spin * step;
            const cos = Math.cos(p.angle) * DPR;
            const sin = Math.sin(p.angle) * DPR;
            ctx.setTransform(cos, sin, -sin, cos, p.x * DPR, p.y * DPR);
            ctx.globalAlpha = t;
            ctx.fillStyle = hsl(p.hue, 55);
            ctx.fillRect(-p.size / 2, -p.size / 6, p.size, p.size / 3);
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
            break;
          }
          case "shell": {
            // Tweened along its launch path (ease-out), with a short tapering tail.
            const pts = p.points!;
            const u = 1 - t;
            const at = (v: number) => {
              const e = 1 - (1 - v) * (1 - v);
              return [pts[0] + (pts[2] - pts[0]) * e + Math.sin(v * 10 + p.spin) * 4, pts[1] + (pts[3] - pts[1]) * e] as const;
            };
            const [hx, hy] = at(u);
            const [bx, by] = at(Math.max(0, u - 0.16));
            p.x = hx;
            p.y = hy;
            ctx.globalAlpha = 0.25 + 0.5 * t;
            ctx.strokeStyle = hsl(p.hue, 70);
            ctx.lineWidth = p.size;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(hx, hy);
            ctx.stroke();
            ctx.lineCap = "butt";
            ctx.globalAlpha = 1;
            if (theme.shape === "pixel") {
              ctx.globalCompositeOperation = "source-over";
              ctx.fillStyle = hsl(p.hue, 60);
              ctx.fillRect(Math.round(hx / 2) * 2 - 3, Math.round(hy / 2) * 2 - 3, 6, 6);
              ctx.globalCompositeOperation = glowBlend();
            } else {
              const r = p.size * 3.4;
              const sprite = glowSprite(p.hue);
              ctx.drawImage(sprite, hx - r, hy - r, r * 2, r * 2);
              if (useBloom && bctx) {
                const br = r * bloomRadius;
                bctx.globalAlpha = 0.9;
                bctx.drawImage(sprite, hx - br, hy - br, br * 2, br * 2);
              }
            }
            break;
          }
          case "flare": {
            // Swells slightly while it fades fast (quadratic).
            const r = p.size * (0.65 + 0.35 * (1 - t));
            const sprite = glowSprite(p.hue);
            ctx.globalAlpha = t * t * (lightMode ? 0.3 : 0.85);
            ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
            if (useBloom && bctx) {
              const br = r * 1.5;
              bctx.globalAlpha = t * t * (lightMode ? 0.4 : 1);
              bctx.drawImage(sprite, p.x - br, p.y - br, br * 2, br * 2);
            }
            break;
          }
          case "scorch": {
            const pts = p.points ?? [];
            // Soot stays, then fades over the last 40% of its life.
            const soot = Math.min(1, t * 2.5);
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = soot * (lightMode ? 0.5 : 0.75);
            ctx.drawImage(scorchSprite(), p.x - p.size, p.y - p.size * 0.8, p.size * 2, p.size * 1.6);
            ctx.globalCompositeOperation = glowBlend();
            // The molten core and its cracks cool quickly.
            const heat = t * t * t;
            if (heat > 0.02) {
              const cr = p.size * 0.75;
              const sprite = glowSprite(p.hue);
              ctx.globalAlpha = heat * (lightMode ? 0.35 : 0.8);
              ctx.drawImage(sprite, p.x - cr, p.y - cr * 0.8, cr * 2, cr * 1.6);
            }
            const glow = Math.min(1, t * t * 1.6);
            ctx.globalAlpha = glow * 0.9;
            ctx.strokeStyle = hsl(p.hue, 68);
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            for (let k = 0; k + 2 < pts.length; k += 3) {
              const a = pts[k];
              const len = pts[k + 1];
              const mid = a + pts[k + 2];
              ctx.moveTo(p.x + Math.cos(a) * len * 0.12, p.y + Math.sin(a) * len * 0.1);
              ctx.lineTo(p.x + Math.cos(mid) * len * 0.55, p.y + Math.sin(mid) * len * 0.44);
              ctx.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len * 0.8);
            }
            ctx.stroke();
            break;
          }
          case "smoke": {
            p.vy -= 0.004 * step;
            p.vx *= Math.pow(0.985, step);
            p.x += (p.vx + Math.sin(p.life / 220 + p.angle) * 0.15) * step;
            p.y += p.vy * step;
            p.size += 0.22 * step;
            // Fade in, then out; never into the bloom layer.
            const a = Math.sin(Math.PI * (1 - t)) * (lightMode ? 0.55 : 0.45);
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = a;
            if (theme.shape === "pixel") {
              ctx.fillStyle = lightMode ? "#4a4a55" : "#b8b8c8";
              const s = Math.round(p.size / 6) * 4;
              ctx.fillRect(Math.round(p.x / 4) * 4 - s / 2, Math.round(p.y / 4) * 4 - s / 2, s, s);
            } else {
              ctx.drawImage(smokeSprite(), p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
            }
            ctx.globalCompositeOperation = glowBlend();
            break;
          }
          case "ring": {
            const r = p.size * (1 - t * t);
            ctx.globalAlpha = t * 0.35;
            ctx.strokeStyle = hsl(p.hue, 60);
            ctx.lineWidth = 10 * t + 4;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = t;
            ctx.strokeStyle = hsl(p.hue, 75);
            ctx.lineWidth = 2 + 3 * t;
            ctx.stroke();
            if (useBloom && bctx) {
              bctx.globalAlpha = t * 0.8;
              bctx.strokeStyle = hsl(p.hue, 60);
              bctx.lineWidth = 14 + 10 * settings.glow;
              bctx.beginPath();
              bctx.arc(p.x, p.y, r, 0, Math.PI * 2);
              bctx.stroke();
            }
            break;
          }
          case "bolt": {
            const pts = p.points ?? [];
            const a = t * (Math.random() > 0.3 ? 1 : 0.4);
            ctx.strokeStyle = hsl(p.hue, 60);
            ctx.globalAlpha = a * 0.25;
            ctx.lineWidth = p.size * 7;
            drawBolt(ctx, pts);
            ctx.globalAlpha = a * 0.6;
            ctx.lineWidth = p.size * 3;
            drawBolt(ctx, pts);
            ctx.strokeStyle = lightMode ? hsl(p.hue, 0) : "#fff";
            ctx.globalAlpha = a;
            ctx.lineWidth = p.size;
            drawBolt(ctx, pts);
            if (useBloom && bctx) {
              bctx.strokeStyle = hsl(p.hue, 65);
              bctx.globalAlpha = a;
              bctx.lineWidth = 24 + 16 * settings.glow;
              drawBolt(bctx, pts);
            }
            break;
          }
          case "glyph": {
            textAlive++;
            p.vy += 0.12 * step;
            p.x += p.vx * step;
            p.y += p.vy * step;
            p.angle += p.spin * step * 0.3;
            const r = 22 * p.size * (1 + (1 - t) * 0.8);
            const sprite = glowSprite(p.hue);
            ctx.globalAlpha = t * 0.6;
            ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
            if (useBloom && bctx) {
              const br = r * bloomRadius * 0.7;
              bctx.globalAlpha = t * 0.8;
              bctx.drawImage(sprite, p.x - br, p.y - br, br * 2, br * 2);
            }
            break;
          }
        }
      }
      particles.length = w;

      // Text pass on top: flying letters, then matrix code; font set once per group.
      glyphCount = 0;
      if (textAlive > 0) {
        ctx.globalCompositeOperation = "source-over";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const kind of ["glyph", "code"] as const) {
          ctx.font = kind === "glyph" ? `900 22px ${theme.font}` : `700 15px ${THEMES.matrix.font}`;
          for (const p of particles) {
            if (p.kind !== kind) continue;
            if (kind === "glyph") glyphCount++;
            const t = p.life / p.maxLife;
            const s = kind === "glyph" ? p.size * (1 + (1 - t) * 0.8) : 1;
            const cos = Math.cos(p.angle) * s * DPR;
            const sin = Math.sin(p.angle) * s * DPR;
            if (kind === "glyph") ctx.setTransform(cos, sin, -sin, cos, p.x * DPR, p.y * DPR);
            else ctx.setTransform(DPR, 0, 0, DPR, p.x * DPR, p.y * DPR);
            ctx.globalAlpha = t;
            ctx.fillStyle = hsl(p.hue, kind === "glyph" ? 80 : 70);
            ctx.fillText(p.text ?? "", 0, 0);
          }
        }
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      }
      ctx.globalAlpha = 1;
    }
    if (bctx) bctx.globalAlpha = 1;
    if (settings.protectText && particles.length > 0) protectTextZones(useBloom);
  }

  // ---- settings changes (toggle from the footer, settings page, other tabs)

  function onSettings() {
    const next = getPowerSettings();
    const was = settings.enabled;
    if (!next.particles) { particles=[]; glyphCount=0; }
    const themeChanged = next.theme !== settings.theme;
    if (!next.enabled || !next.haptics) stopBuzz();
    settings = next;
    theme = THEMES[next.theme];
    themeBucket = -1;
    applyThemeStatic();
    // Discard stale bloom pixels before changing layer visibility. Redraw even
    // when the engine was idle when a visual setting changed.
    clearCanvases();
    const reduced = getReducedMotion();
    if (reduced || !next.shake || !next.screenShake) {
      for (const [el, state] of shakes) {
        if (reduced || (el === document.body ? !next.screenShake : !next.shake)) releaseShake(el, state);
      }
    }
    if (reduced) {
      for (const el of transient) {
        if (el.classList.contains("pm-flash")) { el.remove(); transient.delete(el); }
      }
      particles = particles.filter((p) => p.kind !== "bolt");
    }
    if (next.enabled) start();
    updateObserver();
    if (next.enabled && (themeChanged || !was)) {
      const id = next.theme;
      recordStats((s) => (s.themesTried.includes(id) ? s : { ...s, themesTried: [...s.themesTried, id] }));
    }
    if (!was && next.enabled) {
      attach();
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight * 0.45;
      const hue = theme.hue(0, performance.now());
      explode(cx, cy, hue, INTENSITY[next.intensity].particles);
      if (next.lightning) for (let i = 0; i < 4; i++) later(() => bolt(cx + rand(-200, 200), cy, hue), i * 90);
      slam("POWER MODE", `${theme.name.toUpperCase()} · ${next.intensity.toUpperCase()}`, hue);
      screenShake(12);
      buzz(HAPTICS.powerOn);
      if (next.sound) synth.powerUp();
      start();
    } else if (was && !next.enabled) {
      resetOrdnance();
      combo = 0;
      recordPace = false;
      hud.classList.remove("pm-hot", "pm-danger", "pm-record");
      for (const el of transient) if (el.classList.contains("pm-pop") || el.classList.contains("pm-badge")) { el.remove(); transient.delete(el); }
      agentTurns.clear();
      agentHudActive = false;
      hud.classList.remove("pm-on");
      vignette.style.opacity = "0";
      restoreShakes();
      clearCanvases();
      particles = [];
      glyphCount = 0;
      slam("power mode off", "", 220, "quiet");
      if (next.sound) synth.powerDown();
      later(() => { if (!settings.enabled) detach(); }, 1200);
    } else if (next.enabled && themeChanged) {
      // Preview the new theme with a burst.
      attach();
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight * 0.45;
      explode(cx, cy, theme.hue(30, performance.now()), 0.7);
      slam(`${theme.emoji} ${theme.name.toUpperCase()}`, "", theme.hue(30, performance.now()), "quiet");
      start();
    }
  }
  const unsubscribe = subscribePowerSettings(onSettings);
  watchExternalChanges(signal);
  watchSystemMotion(signal);
  if (settings.enabled) attach();
  updateObserver();

  // ---- cleanup

  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    observer.disconnect();
    modeObserver.disconnect();
    if (modeCheck) cancelAnimationFrame(modeCheck);
    agentHooks = null;
    setUnlockHandler(null);
    unsubscribeChallenge();
    unresetUnlock();
    window.clearTimeout(unlockTimer);
    unlockBatch.length=0;
    flushPowerStatsSync();
    if (raf) cancelAnimationFrame(raf);
    if (agentFlushTimer) window.clearTimeout(agentFlushTimer);
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
    resetOrdnance();
    debugHook = null;
    restoreShakes();
    clearCanvases();
    for (const el of transient) el.remove();
    transient.clear();
    detach();
    document.documentElement.style.removeProperty("--pm-font");
    style.remove();
    synth.dispose();
    stopBuzz();
    particles = [];
  }
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}

/** Flip Power Mode on/off (footer button, command palette). */
export function togglePowerMode() {
  updatePowerSettings({ enabled: !getPowerSettings().enabled });
}
