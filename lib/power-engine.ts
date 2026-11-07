// The Power Mode effects engine. Runs as a trusted content script: listens for
// `input` events on any text field, textarea, or contenteditable editor in the
// bb window and answers every keystroke with particles, shake, a combo meter,
// floating letters, shockwaves, lightning, and (optionally) synth sound.
//
// Agent Power Mode: while an agent is running (reported by the app overlay
// through `setAgentRunning`), a MutationObserver watches the transcript
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
  subscribePowerSettings,
  updatePowerSettings,
  watchExternalChanges,
  type Intensity,
  type PowerSettings,
} from "./power-store";
import { flushPowerStats, recordStats, setUnlockHandler, type Achievement } from "./power-stats";
import { THEMES, type Theme } from "./power-themes";

// ---------------------------------------------------------------- tuning

const COMBO_TIMEOUT_MS = 3000;
const AGENT_TIMEOUT_MS = 4000;
/** Live particle cap at density 1×; scales with the Particles slider. */
const BASE_MAX_PARTICLES = 450;
const MAX_GLYPHS = 60;
const DPR = 1;
const BLOOM_SCALE = 0.25;
const HUE_STEP = 15;
const WPM_WINDOW_MS = 8000;
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

function milestoneFor(combo: number): Milestone | null {
  const exact = MILESTONES.find((m) => m.at === combo);
  if (exact) return exact;
  if (combo > 500 && combo % 250 === 0) {
    return { at: combo, title: `∞ POWER ∞ ×${combo}`, hue: (combo / 250) * 67 % 360 };
  }
  return null;
}

function tierName(combo: number): string {
  let name = "";
  for (const m of MILESTONES) if (combo >= m.at) name = m.title.replace(/!+$/, "");
  if (combo >= 750) name = "∞ POWER ∞";
  return name;
}

/** Palette drifts from ice → toxic → fire → plasma → full rainbow as the combo grows. */

// ---------------------------------------------------------------- types

type ParticleKind = "spark" | "ember" | "shard" | "glyph" | "ring" | "bolt" | "pixel" | "petal" | "code";

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
.pm-hud.pm-on{opacity:1;transform:none}
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
.pm-vignette{position:fixed;inset:0;z-index:2147482999;pointer-events:none;opacity:0;will-change:opacity;
  transition:opacity .4s ease;background:radial-gradient(ellipse at center,transparent 55%,var(--pm-glow) 140%)}
`;

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

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
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

/** Cached `hsl()` strings so the render loop allocates no strings per particle. */
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
// whether any agent is running and when a turn finishes. The engine may mount
// before or after the overlay, so the latest state is kept here.

interface AgentHooks {
  running(running: boolean): void;
  turnDone(title: string): void;
}
let agentRunning = false;
let agentHooks: AgentHooks | null = null;

export function setAgentRunning(running: boolean) {
  if (running === agentRunning) return;
  agentRunning = running;
  agentHooks?.running(running);
}

export function agentTurnFinished(title: string) {
  agentHooks?.turnDone(title);
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
    '<div class="pm-hud-label">COMBO</div><div class="pm-hud-count">0</div><div class="pm-hud-tier"></div><div class="pm-hud-wpm"></div><div class="pm-hud-bar"><div class="pm-hud-fill"></div></div>';
  const hudLabel = hud.querySelector<HTMLElement>(".pm-hud-label")!;
  const hudCount = hud.querySelector<HTMLElement>(".pm-hud-count")!;
  const hudTier = hud.querySelector<HTMLElement>(".pm-hud-tier")!;
  const hudWpm = hud.querySelector<HTMLElement>(".pm-hud-wpm")!;
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
  const keyLog: { t: number; n: number }[] = [];

  // Agent combo (words the agent has written this turn)
  let agentWords = 0;
  let lastAgentAt = 0;
  let agentMilestone = 0;

  // Text protection: the editor being typed in.
  let activeEditor: HTMLElement | null = null;
  let lastCaretY = 0;

  // Adaptive quality: if frames get slow, spawn fewer particles until they recover.
  let quality = 1;
  let frameEma = 16.7;

  const maxParticles = () => Math.round(Math.min(1200, Math.max(150, BASE_MAX_PARTICLES * settings.density)));
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

  function room(count: number): number {
    return Math.max(0, Math.min(Math.round(count * quality * settings.density), maxParticles() - particles.length));
  }

  function sparkKind(): ParticleKind {
    switch (theme.shape) {
      case "pixel": return "pixel";
      case "petal": return "petal";
      case "code": return "code";
      default: return "spark";
    }
  }

  function burst(x: number, y: number, hue: number, requested: number, power: number, kind: ParticleKind = sparkKind()) {
    const count = room(requested);
    const retro = theme.id === "retro";
    for (let i = 0; i < count; i++) {
      const angle = kind === "ember" ? rand(-Math.PI * 0.9, -Math.PI * 0.1) : rand(0, Math.PI * 2);
      const speed = rand(0.25, 1) * power * (kind === "petal" ? 0.5 : kind === "code" ? 0.4 : 1);
      const long = kind === "ember" || kind === "petal" || kind === "code";
      const life = long ? rand(700, 1300) : rand(350, 800);
      particles.push({
        kind, x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (kind === "spark" || kind === "pixel" ? power * 0.35 : 0),
        life, maxLife: life,
        size: kind === "shard" ? rand(3, 7) : kind === "pixel" ? (Math.random() < 0.5 ? 4 : 6) : kind === "petal" ? rand(4, 7) : rand(1.5, 3.8),
        hue: retro ? theme.hue(Math.floor(rand(0, 7)), 0) : hue + rand(-25, 25),
        spin: rand(-0.3, 0.3),
        angle: rand(0, Math.PI * 2),
        text: kind === "code" ? MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)] : undefined,
      });
    }
  }

  function ring(x: number, y: number, hue: number, size: number, life = 520) {
    if (particles.length >= maxParticles()) return;
    particles.push({ kind: "ring", x, y, vx: 0, vy: 0, life, maxLife: life, size, hue, spin: 0, angle: 0 });
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

  // ---- shake (editor translation, viewport-safe page offsets)

  function shakeElement(el: HTMLElement, amp: number) {
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

  function flash(hue: number, x = window.innerWidth / 2, y = window.innerHeight / 2) {
    for (const el of transient) if (el.classList.contains("pm-flash")) return; // one at a time
    const el = document.createElement("div");
    el.className = "pm-flash";
    el.setAttribute("aria-hidden", "true");
    setTheme(el, hue);
    el.style.setProperty("--pm-fx", `${x}px`);
    el.style.setProperty("--pm-fy", `${y}px`);
    document.documentElement.appendChild(el);
    transient.add(el);
    later(() => { el.remove(); transient.delete(el); }, 500);
  }

  function slam(title: string, subtitle: string, hue: number, variant: "" | "quiet" | "agent" = "") {
    for (const el of transient) if (el.classList.contains("pm-slam")) { el.remove(); transient.delete(el); }
    const el = document.createElement("div");
    el.className = `pm-slam${variant ? ` pm-${variant}` : ""}${theme.id === "retro" ? " pm-retro" : ""}`;
    el.setAttribute("aria-hidden", "true");
    setTheme(el, hue);
    el.textContent = title;
    if (subtitle) {
      const small = document.createElement("small");
      small.textContent = subtitle;
      el.appendChild(small);
    }
    document.documentElement.appendChild(el);
    transient.add(el);
    later(() => { el.remove(); transient.delete(el); }, variant === "quiet" ? 1150 : 1650);
  }

  function explode(x: number, y: number, hue: number, mult: number) {
    burst(x, y, hue, 90 * mult, 13);
    if (theme.shape === "glow") burst(x, y, (hue + 40) % 360, 35 * mult, 7, "ember");
    ring(x, y, hue, 340, 700);
    ring(x, y, (hue + 60) % 360, 220, 520);
    // Keep the flash's bright center off the text being typed.
    if (settings.protectText) flash(hue);
    else flash(hue, x, y);
  }

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

  function showHud(label: string, count: number, tier: string, hue: number) {
    hudLabel.textContent = label;
    hudCount.textContent = String(count);
    tierText = setText(hudTier, tier, tierText);
    applyTheme(hue);
    hud.classList.add("pm-on");
    bumpHud();
  }

  function hideHudIfIdle() {
    if (combo === 0 && agentWords === 0) {
      hud.classList.remove("pm-on");
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
    if (combo >= 25 && combo > settings.bestCombo) {
      slam(`×${combo}`, "NEW RECORD", theme.hue(combo, performance.now()));
      updatePowerSettings({ bestCombo: combo });
      if (settings.sound) synth.fanfare();
    }
    combo = 0;
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
    screenShake(10 * INTENSITY[settings.intensity].shake);
    if (settings.lightning) {
      const bolts = m.at >= 100 ? 4 : m.at >= 50 ? 3 : 1;
      for (let i = 0; i < bolts; i++) later(() => bolt(x, y, hue), i * 70);
    }
    if (settings.sound) synth.fanfare();
    recordStats((s) => ({ ...s, milestones: s.milestones + 1 }));
  }

  // ---- achievements

  function onUnlock(a: Achievement) {
    toast(`${a.icon}  Achievement unlocked: ${a.title}`, { description: a.description });
    if (!settings.enabled) return;
    attach();
    const x = window.innerWidth - 120;
    const y = 90;
    burst(x, y, 48, 60, 8, "spark");
    ring(x, y, 48, 160, 600);
    if (settings.sound) synth.chime();
    start();
  }
  setUnlockHandler(onUnlock);

  // ---- user input

  function onInput(event: Event) {
    if (!settings.enabled) return;
    const target = editableTarget(event.composedPath()[0] ?? event.target);
    if (!target) return;
    const inputEvent = event as InputEvent;
    const inputType = inputEvent.inputType ?? "insertText";
    if (inputType.startsWith("history") || inputType === "insertReplacementText") return;
    const deleting = inputType.startsWith("delete");
    const newline = inputType === "insertParagraph" || inputType === "insertLineBreak" || inputEvent.data === "\n";
    const pasted = inputType === "insertFromPaste" || inputType === "insertFromDrop";

    attach();
    // Read layout once, before any writes in this handler.
    const caret =
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        ? fieldCaret(target)
        : selectionCaret(target);
    if (!caret) return;

    const now = performance.now();
    if (now - lastKeyAt > COMBO_TIMEOUT_MS && combo > 0) endCombo();
    lastKeyAt = now;
    combo += pasted ? 10 : 1;
    const typed = deleting || pasted ? 0 : Math.max(1, inputEvent.data?.length ?? 1);
    if (typed) keyLog.push({ t: now, n: typed });

    const tune = INTENSITY[settings.intensity];
    const hue = theme.hue(combo, now);
    const heat = Math.min(combo / 100, 1); // 0 → 1 as the combo builds
    const { x, y } = caret;
    activeEditor = target;
    lastCaretY = y;

    if (deleting) {
      burst(x, y, theme.id === "neon" || theme.id === "fire" ? 355 : hue, 8 * tune.particles, 5, theme.shape === "pixel" ? "pixel" : "shard");
      if (settings.shake) shakeElement(target, 3 * tune.shake);
    } else {
      const count = (6 + heat * 14) * tune.particles * (pasted ? 5 : 1);
      burst(x, y, hue, count, 3 + heat * 6);
      if (heat > 0.25 && theme.shape === "glow") burst(x, y, (hue + 30) % 360, count / 4, 2, "ember");
      if (settings.ghostLetters && inputEvent.data && !pasted) {
        const chars = Array.from(inputEvent.data).slice(0, 3);
        for (const ch of chars) if (ch.trim()) for (let i = 0; i < tune.glyphs; i++) glyph(x, y, hue, ch, 1 + heat * 0.8);
      }
      if (settings.shake) shakeElement(target, (2.5 + heat * 5) * tune.shake);
      if (settings.intensity === "godlike" && combo > 50) screenShake(1.2 * heat * tune.shake);
    }

    if (newline || pasted) {
      ring(x, y, hue, pasted ? 260 : 120);
      burst(x, y, hue, 30 * tune.particles, 9);
      if (settings.lightning && combo >= 25) bolt(x, y, hue);
      if (settings.sound) synth.boom();
      screenShake(4 * tune.shake);
    }

    if (settings.sound) synth.key(combo, deleting);

    const milestone = !deleting ? milestoneFor(combo) : null;
    if (milestone) onMilestone(milestone, x, y);

    showHud("COMBO", combo, tierName(combo), hue);
    const speed = wpm(now);
    wpmText = setText(hudWpm, speed > 0 ? `${speed} WPM` : "", wpmText);
    vignette.style.opacity = (Math.round(heat * 10) / 20).toFixed(2); // ≤ .5, 11 steps

    const currentCombo = combo;
    recordStats((s) => ({
      ...s,
      chars: s.chars + typed,
      deletes: s.deletes + (deleting ? 1 : 0),
      pastes: s.pastes + (pasted ? 1 : 0),
      bestCombo: Math.max(s.bestCombo, currentCombo),
      bestWpm: keyLog.length >= 15 ? Math.max(s.bestWpm, speed) : s.bestWpm,
    }));
    start();
  }
  document.addEventListener("input", onInput, { capture: true, signal });

  // ---- agent output

  const rowLengths = new WeakMap<Element, number>();
  const touched = new Map<HTMLElement, Node>();
  let agentFlushTimer = 0;
  let observing = false;

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const node = r.target;
      const el = node instanceof Element ? node : node.parentElement;
      if (!el) continue;
      const row = el.closest<HTMLElement>("[data-timeline-row-id]");
      if (!row || !row.closest("[data-timeline-items]")) continue;
      if (el.closest('[contenteditable="true"],textarea,input')) continue;
      const last = r.type === "childList" && r.addedNodes.length ? r.addedNodes[r.addedNodes.length - 1] : node;
      touched.set(row, last);
    }
    if (touched.size && !agentFlushTimer) agentFlushTimer = window.setTimeout(flushAgent, 70);
  });

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
    let totalDelta = 0;
    for (const [row, node] of touched) {
      const len = row.textContent?.length ?? 0;
      const prev = rowLengths.get(row);
      rowLengths.set(row, len);
      // A row seen for the first time only counts when it is small (a new
      // streaming reply), not a virtualized old row scrolling back into view.
      const delta = prev === undefined ? (len < 80 ? len : 0) : len - prev;
      if (delta <= 0 || delta > 2000) continue;
      totalDelta += delta;
      const point = lastTextPoint(node);
      if (!point) continue;
      attach();
      const hue = theme.hue(agentWords + combo, now);
      const tune = INTENSITY[settings.intensity];
      burst(point.x, point.y, hue, Math.min(delta, 60) / 3 * tune.particles, 3 + Math.min(agentWords / 200, 1) * 4);
      if (settings.ghostLetters && node instanceof Text) {
        const tail = Array.from(node.data.slice(-Math.min(delta, 4))).filter((c) => c.trim());
        for (const ch of tail.slice(-2)) glyph(point.x, point.y, hue, ch, 0.9);
      }
      // Timeline rows are positioned and animated by the host. Moving a row
      // interferes with virtualization and its entrance/layout animations.
    }
    touched.clear();
    if (totalDelta <= 0) return;

    lastAgentAt = now;
    agentWords += Math.max(1, Math.round(totalDelta / 5.5));
    const added = totalDelta;
    recordStats((s) => ({ ...s, agentChars: s.agentChars + added }));

    const next = AGENT_MILESTONES.find((m) => m.at > agentMilestone && agentWords >= m.at);
    if (next) {
      agentMilestone = next.at;
      const hue = theme.hue(next.at, now);
      slam(next.title, `${agentWords} WORDS`, hue, "agent");
      explode(window.innerWidth / 2, window.innerHeight * 0.3, hue, 0.5);
      if (settings.lightning && next.at >= 300) bolt(window.innerWidth / 2, window.innerHeight * 0.3, hue);
      if (settings.sound) synth.fanfare();
    }
    if (combo === 0) showHud("AGENT", agentWords, "WORDS", theme.hue(agentWords, now));
    start();
  }

  function updateObserver() {
    const want = settings.enabled && settings.agentMode && agentRunning && !disposed;
    if (want === observing) return;
    observing = want;
    if (want) observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    else observer.disconnect();
  }

  function endAgentCombo() {
    agentWords = 0;
    agentMilestone = 0;
    hideHudIfIdle();
  }

  agentHooks = {
    running() {
      updateObserver();
    },
    turnDone(title) {
      if (!settings.enabled || !settings.agentMode) return;
      const words = agentWords;
      recordStats((s) => ({ ...s, agentTurns: s.agentTurns + 1, bestAgentWords: Math.max(s.bestAgentWords, words) }));
      if (words >= 20) {
        attach();
        const hue = theme.hue(words, performance.now());
        const name = title.length > 32 ? `${title.slice(0, 31)}…` : title;
        slam("TURN COMPLETE", `${words} WORDS · ${name}`, hue, "agent");
        explode(window.innerWidth / 2, window.innerHeight * 0.3, hue, 0.8);
        if (settings.sound) synth.fanfare();
        start();
      }
      endAgentCombo();
    },
  };

  // ---- text protection
  // Fade only the overlay pixels. Inserting fixed canvases into host editor
  // containers changes stacking and containing blocks during layout animations.

  function erase(c: CanvasRenderingContext2D, scale: number, r: DOMRect, strength: number, pad: number) {
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.globalCompositeOperation = "destination-out";
    c.globalAlpha = strength * 0.5;
    c.fillRect(r.left - pad, r.top - pad, r.width + pad * 2, r.height + pad * 2);
    c.globalAlpha = strength;
    c.fillRect(r.left, r.top, r.width, r.height);
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
  }

  function focusedEditor(): HTMLElement | null {
    const el = activeEditor;
    if (!el || !el.isConnected) return null;
    const focused = document.activeElement;
    return focused && (el === focused || el.contains(focused)) ? el : null;
  }

  function caretBand(el: HTMLElement): DOMRect | null {
    const r = el.getBoundingClientRect();
    if (r.height <= window.innerHeight * 0.4) return null;
    const top = Math.max(r.top, lastCaretY - 36);
    const bottom = Math.min(r.bottom, lastCaretY + 36);
    return new DOMRect(r.left, top, r.width, Math.max(0, bottom - top));
  }

  function protectTextZones(useBloom: boolean) {
    const editor = focusedEditor();
    if (!editor) return;
    const r = caretBand(editor) ?? editor.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    if (ctx) erase(ctx, DPR, r, 0.94, 12);
    if (useBloom && bctx) erase(bctx, BLOOM_SCALE, r, 0.94, 12);
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

  function frame(now: number) {
    if (disposed) { raf = 0; return; }
    // Keep raf set while rendering: combo records/achievements can synchronously
    // change settings and call start(). They must not create a second loop.
    try {
      renderFrame(now);
    } finally {
      raf = 0;
    }
    if (particles.length > 0 || shakes.size > 0 || combo > 0 || agentWords > 0) {
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
      else hudFill.style.transform = `scaleX(${left.toFixed(3)})`;
    } else if (agentWords > 0) {
      const left = 1 - (now - lastAgentAt) / AGENT_TIMEOUT_MS;
      // End when the bar runs out even if the turn is still going (tool calls,
      // thinking): otherwise the HUD sits there empty until the turn finishes.
      if (left <= 0) endAgentCombo();
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
      let w = 0;
      let textAlive = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) continue;
        particles[w++] = p;
        const t = p.life / p.maxLife; // 1 → 0
        switch (p.kind) {
          case "spark":
          case "ember": {
            p.vy += (p.kind === "ember" ? -0.03 : 0.22 * g) * step;
            p.vx *= Math.pow(0.97, step);
            p.x += p.vx * step;
            p.y += p.vy * step;
            const r = p.size * (0.4 + t * 0.6) * 3.2;
            const sprite = glowSprite(p.hue);
            ctx.globalAlpha = t;
            ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
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
    const themeChanged = next.theme !== settings.theme;
    settings = next;
    theme = THEMES[next.theme];
    themeBucket = -1;
    applyThemeStatic();
    // Discard stale bloom pixels before changing layer visibility. Redraw even
    // when the engine was idle when a visual setting changed.
    clearCanvases();
    if (!next.shake || !next.screenShake) {
      for (const [el, state] of shakes) {
        if (el === document.body ? !next.screenShake : !next.shake) releaseShake(el, state);
      }
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
      if (next.sound) synth.powerUp();
      start();
    } else if (was && !next.enabled) {
      combo = 0;
      agentWords = 0;
      agentMilestone = 0;
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
    flushPowerStats();
    if (raf) cancelAnimationFrame(raf);
    if (agentFlushTimer) window.clearTimeout(agentFlushTimer);
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
    restoreShakes();
    clearCanvases();
    for (const el of transient) el.remove();
    transient.clear();
    detach();
    document.documentElement.style.removeProperty("--pm-font");
    style.remove();
    synth.dispose();
    particles = [];
  }
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}

/** Flip Power Mode on/off (footer button, command palette). */
export function togglePowerMode() {
  updatePowerSettings({ enabled: !getPowerSettings().enabled });
}
