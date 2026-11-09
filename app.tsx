// Power Mode — frontend entry.
//
// - A content script runs the effects engine (lib/power-engine.ts) on every
//   text field, textarea, and contenteditable editor in the bb window.
// - A sidebar-footer button toggles it on/off in one click.
// - A command-palette entry (Mod+Alt+P by default) does the same.
// - An invisible app overlay feeds live thread status to Agent Power Mode.
// - The plugin's Settings page has themes, particle/glow sliders, effect
//   toggles, lifetime stats, and achievements.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreads,
  useBbContext,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  mountPowerEngine,
  syncAgentThreads,
  togglePowerMode,
} from "@/lib/power-engine";
import {
  DENSITY_RANGE,
  THEME_IDS,
  getPowerSettings,
  getSystemReducedMotion,
  initPowerStore,
  subscribePowerSettings,
  subscribeSystemMotion,
  updatePowerSettings,
  type Intensity,
  type PowerSettings,
} from "@/lib/power-store";
import {
  ACHIEVEMENTS,
  getPowerStats,
  resetPowerStats,
  subscribePowerStats,
} from "@/lib/power-stats";
import {
  AchievementComposer,
  AchievementObserver,
} from "./lib/achievement-observer";
import {
  availableTitles,
  challengeProgress,
  challengeProgressRatio,
} from "./lib/achievement-presentation";
import { getCollection, setCollectionPreference } from "./lib/power-stats";
import { THEMES } from "@/lib/power-themes";

function usePowerSettings(): PowerSettings {
  return useSyncExternalStore(subscribePowerSettings, getPowerSettings);
}

function usePowerStats() {
  return useSyncExternalStore(subscribePowerStats, getPowerStats);
}

const RUNNING_STATUSES = new Set(["active", "starting", "pending"]);

/**
 * Renders nothing. Reports every thread's status and the thread on screen to
 * the engine, which attributes agent output and finished turns per thread.
 */
function AgentWatcher() {
  const { threads } = experimental_useSidebarThreads();
  const { threadId } = useBbContext();
  useEffect(() => {
    syncAgentThreads(
      threads.map((t) => ({
        id: t.id,
        title: t.displayTitle,
        running: RUNNING_STATUSES.has(t.status),
        idle: t.status === "idle",
      })),
      threadId,
    );
  }, [threads, threadId]);
  useEffect(() => () => syncAgentThreads([], null), []);
  return null;
}

const INTENSITY_OPTIONS: { id: Intensity; label: string; hint: string }[] = [
  { id: "epic", label: "Epic", hint: "Sparks and a gentle rumble." },
  {
    id: "legendary",
    label: "Legendary",
    hint: "Twice the particles, harder shake.",
  },
  {
    id: "godlike",
    label: "Godlike",
    hint: "Everything. The whole screen shakes.",
  },
];

const EFFECT_OPTIONS: {
  key: keyof PowerSettings;
  label: string;
  hint: string;
}[] = [
  {
    key: "particles",
    label: "Particle effects",
    hint: "Turn particles off while continuing to collect achievements.",
  },
  {
    key: "protectText",
    label: "Keep text clear",
    hint: "Effects gently fade near the caret while you type, so the text stays readable.",
  },
  {
    key: "shake",
    label: "Editor shake",
    hint: "The text box jumps on every keystroke.",
  },
  {
    key: "screenShake",
    label: "Screen shake",
    hint: "The whole window quakes on combos and Enter.",
  },
  {
    key: "ghostLetters",
    label: "Flying letters",
    hint: "Each typed character launches off the caret.",
  },
  {
    key: "lightning",
    label: "Lightning",
    hint: "Bolts strike the caret at combo milestones.",
  },
  {
    key: "agentMode",
    label: "Agent Power Mode",
    hint: "Sparks fly while agents write their replies, with combos and a turn-complete finale.",
  },
  {
    key: "sound",
    label: "Sound",
    hint: "Synth blips that climb with the combo, booms on milestones.",
  },
];

function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-start gap-3 py-2">{children}</div>;
}

function ReduceMotion({ settings }: { settings: PowerSettings }) {
  // Re-render on OS flips: the settings snapshot itself does not change then.
  const system = useSyncExternalStore(subscribeSystemMotion, getSystemReducedMotion, () => false);
  const effective = settings.reduceMotion ?? system;
  const overridden = settings.reduceMotion !== null;
  return (
    <Row>
      <Checkbox
        id="power-mode-reduceMotion"
        className="mt-0.5"
        checked={effective}
        onCheckedChange={(checked) => updatePowerSettings({ reduceMotion: checked === true })}
      />
      <label htmlFor="power-mode-reduceMotion" className="cursor-pointer">
        <div className="text-sm">Reduce motion</div>
        <div className="text-xs text-muted-foreground">
          No shake, full-screen flashes or lightning. {overridden ? "Your choice overrides the system setting." : `Following your system setting (${system ? "reduced motion on" : "off"}).`}
        </div>
      </label>
      {overridden && (
        <Button variant="ghost" size="sm" onClick={() => updatePowerSettings({ reduceMotion: null })}>
          Use system setting
        </Button>
      )}
    </Row>
  );
}

function SettingsSection() {
  const settings = usePowerSettings();
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
        <div>
          <div className="text-sm font-semibold">
            Power Mode is {settings.enabled ? "ON ⚡" : "off"}
          </div>
          <p className="text-xs text-muted-foreground">
            Toggle any time with the ⚡ button in the sidebar footer, or “Power
            Mode: Toggle” in the command palette. Saved per browser window.
          </p>
        </div>
        <Button
          variant={settings.enabled ? "outline" : "default"}
          onClick={() => togglePowerMode()}
        >
          {settings.enabled ? "Turn off" : "Unleash"}
        </Button>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium">Intensity</div>
        <div
          className="grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label="Intensity"
        >
          {INTENSITY_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={settings.intensity === option.id}
              onClick={() => updatePowerSettings({ intensity: option.id })}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                settings.intensity === option.id
                  ? "border-foreground bg-state-active"
                  : "border-border hover:bg-state-hover",
              )}
            >
              <div className="text-sm font-semibold">{option.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {option.hint}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium">Theme</div>
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          role="radiogroup"
          aria-label="Theme"
        >
          {THEME_IDS.map((id) => {
            const theme = THEMES[id];
            const selected = settings.theme === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => updatePowerSettings({ theme: id })}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  selected
                    ? "border-foreground bg-state-active"
                    : "border-border hover:bg-state-hover",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {theme.emoji} {theme.name}
                  </span>
                  <span className="flex" aria-hidden>
                    {theme.swatch.map((color) => (
                      <span
                        key={color}
                        className="-ml-1 size-3 rounded-full ring-1 ring-background"
                        style={{ background: color }}
                      />
                    ))}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {theme.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Slider
          label="Particles"
          value={settings.density}
          min={DENSITY_RANGE.min}
          max={DENSITY_RANGE.max}
          step={0.25}
          format={(v) => `${v.toFixed(2).replace(/0$/, "")}×`}
          hint="How many particles each keystroke spawns. Power Mode still thins them out automatically if frames get slow."
          onChange={(density) => updatePowerSettings({ density })}
        />
        <Slider
          label="Glow"
          value={settings.glow}
          min={0}
          max={1}
          step={0.05}
          format={(v) => (v === 0 ? "Off" : `${Math.round(v * 100)}%`)}
          hint="Strength of the bloom halo. It renders at quarter resolution, so even 100% is cheap."
          onChange={(glow) => updatePowerSettings({ glow })}
        />
      </div>

      <ReduceMotion settings={settings} />

      <div>
        <div className="mb-1 text-sm font-medium">Effects</div>
        <div className="divide-y divide-border">
          {EFFECT_OPTIONS.map((option) => {
            const id = `power-mode-${option.key}`;
            return (
              <Row key={option.key}>
                <Checkbox
                  id={id}
                  className="mt-0.5"
                  checked={settings[option.key] === true}
                  onCheckedChange={(checked) =>
                    updatePowerSettings({
                      [option.key]: checked === true,
                    } as Partial<PowerSettings>)
                  }
                />
                <label htmlFor={id} className="cursor-pointer">
                  <div className="text-sm">{option.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {option.hint}
                  </div>
                </label>
              </Row>
            );
          })}
        </div>
      </div>

      <StatsAndAchievements />
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint: string;
  format(value: number): string;
  onChange(value: number): void;
}) {
  const id = `power-mode-slider-${props.label.toLowerCase()}`;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <label htmlFor={id} className="font-medium">
          {props.label}
        </label>
        <span className="tabular-nums text-muted-foreground">
          {props.format(props.value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
        className="w-full cursor-pointer accent-foreground"
      />
      <p className="mt-1 text-xs text-muted-foreground">{props.hint}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-lg font-semibold tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Category accent colors; the engine's unlock banner and confetti use the same hues. */
const CATEGORY_COLOR: Record<string, string> = {
  Human: "hsl(48 100% 55%)",
  Agent: "hsl(190 100% 55%)",
  Together: "hsl(300 100% 65%)",
};
const SECRET_COLOR = "hsl(45 100% 60%)";

function Meter({
  value,
  color,
  className,
}: {
  value: number;
  color: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-foreground/10",
        className,
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{
          width: `${Math.round(value * 100)}%`,
          background: `linear-gradient(90deg, ${color}, #fff)`,
          boxShadow: value > 0 ? `0 0 8px ${color}` : undefined,
        }}
      />
    </div>
  );
}

export function StatsAndAchievements() {
  const stats = usePowerStats();
  const [category, setCategory] = useState("All");
  const [onlyUnlocked, setOnlyUnlocked] = useState(false);
  const collection = getCollection();
  const titles = availableTitles(stats);
  const visible = ACHIEVEMENTS.filter(
    (a) =>
      (category === "All" || a.category === category) &&
      (!onlyUnlocked || stats.unlocked[a.id]),
  );
  const next = ACHIEVEMENTS.find((a) => !a.hidden && !stats.unlocked[a.id]);
  const unlockedCount = ACHIEVEMENTS.filter((a) => stats.unlocked[a.id]).length;
  const secretsFound = ACHIEVEMENTS.filter(
    (a) => a.hidden && stats.unlocked[a.id],
  ).length;
  const completion = unlockedCount / ACHIEVEMENTS.length;
  const fresh = new Set(collection.session.discoveries);
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Stats</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Characters typed" value={stats.chars} />
        <Stat label="Best combo" value={stats.bestCombo} />
        <Stat label="Best WPM" value={stats.bestWpm} />
        <Stat label="Milestones hit" value={stats.milestones} />
        <Stat label="Agent chars cheered" value={stats.agentChars} />
        <Stat
          label="Longest agent reply"
          value={`${stats.bestAgentWords} words`}
        />
        <Stat label="Agent turns" value={stats.agentTurns} />
        <Stat
          label="Biggest paste tier"
          value={stats.bestPasteTier ? `Tier ${stats.bestPasteTier}` : "—"}
        />
      </div>
      <div className="pt-2 text-sm font-medium">Achievements</div>
      <div
        className="rounded-lg border border-border bg-card p-3"
        aria-label="Collection progress"
      >
        <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
          <span className="font-semibold">
            {Math.round(completion * 100)}% collected
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {unlockedCount} of {ACHIEVEMENTS.length} badges · {secretsFound}{" "}
            {secretsFound === 1 ? "secret" : "secrets"} found
          </span>
        </div>
        <Meter
          value={completion}
          color={completion >= 1 ? SECRET_COLOR : CATEGORY_COLOR.Agent}
          className="h-2"
        />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {(["Human", "Agent", "Together"] as const).map((c) => {
            const all = ACHIEVEMENTS.filter((a) => a.category === c);
            const got = all.filter((a) => stats.unlocked[a.id]).length;
            return (
              <span key={c} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-full"
                  style={{
                    background: CATEGORY_COLOR[c],
                    boxShadow: `0 0 6px ${CATEGORY_COLOR[c]}`,
                  }}
                />
                {c} {got}/{all.length}
              </span>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Agent badges record observed activity. They do not judge correctness or
        task success. A session ends after ten idle minutes or reload.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Collection</span>
          <select
            className={SELECT_CLASS}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {["All", "Human", "Agent", "Together"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={onlyUnlocked}
            onCheckedChange={(v) => setOnlyUnlocked(v === true)}
          />
          Unlocked only
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">HUD title</span>
          <select
            className={SELECT_CLASS}
            value={
              titles.includes(collection.saved.title ?? "")
                ? (collection.saved.title ?? "")
                : ""
            }
            onChange={(e) =>
              setCollectionPreference({ title: e.target.value || null })
            }
          >
            <option value="">None</option>
            {titles.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Titles: five Human, five Agent, three Together, or five discoveries. Pin
        one visible challenge for a quiet reminder beside WPM.
      </p>
      <section
        aria-label="Session postcard"
        className="rounded-lg border p-3 text-sm"
      >
        <strong>Your session postcard</strong>
        <p>
          Personal best: {Math.round(collection.saved.best)} sustained WPM ·
          Session best: {Math.round(collection.session.best)} WPM
        </p>
        <p>
          New discoveries:{" "}
          {collection.session.discoveries
            .map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.title)
            .join(", ") || "Room for a little surprise."}
        </p>
        <p>
          {next
            ? `Next challenge: ${next.title} — ${challengeProgress(next.id, stats)}`
            : "The collection is complete. Enjoy the view."}
        </p>
      </section>
      {!visible.length && <p>No discoveries in this view yet.</p>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {visible.map((a) => {
          const at = stats.unlocked[a.id];
          if (a.hidden && !at)
            return (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2"
              >
                <span
                  className="grid size-10 flex-none place-items-center rounded-full text-2xl opacity-55"
                  style={{
                    background:
                      "repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, currentColor 10%, transparent) 4px 8px)",
                  }}
                  aria-hidden
                >
                  ◇
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Undiscovered</div>
                  <div className="text-xs text-muted-foreground">
                    A discovery awaits.
                  </div>
                </div>
              </li>
            );
          const color = a.hidden ? SECRET_COLOR : CATEGORY_COLOR[a.category];
          const ratio = at ? null : challengeProgressRatio(a.id, stats);
          return (
            <li
              key={a.id}
              className={cn(
                "relative flex items-center gap-3 overflow-hidden rounded-lg border px-3 py-2 pl-4",
                at
                  ? "border-border bg-card"
                  : "border-dashed border-border opacity-70",
              )}
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-1"
                style={{
                  background: color,
                  opacity: at ? 1 : 0.45,
                  boxShadow: at ? `0 0 10px ${color}` : undefined,
                }}
              />
              <span
                className={cn(
                  "grid size-10 flex-none place-items-center rounded-full text-2xl",
                  !at && "grayscale",
                )}
                style={
                  at
                    ? {
                        background: `radial-gradient(circle, color-mix(in srgb, ${color} 35%, transparent), transparent 72%)`,
                        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 60%, transparent)`,
                      }
                    : undefined
                }
                aria-hidden
              >
                {at ? a.icon : "🔒"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">{a.title}</div>
                  {at && fresh.has(a.id) && (
                    <span
                      className="rounded-full px-1.5 py-px text-[10px] font-bold tracking-widest text-background"
                      style={{ background: color, boxShadow: `0 0 8px ${color}` }}
                    >
                      NEW
                    </span>
                  )}
                  {at && a.hidden && (
                    <span
                      className="text-[10px] font-bold tracking-widest"
                      style={{ color }}
                    >
                      SECRET
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {a.description}
                  {at ? ` · ${new Date(at).toLocaleDateString()}` : ""}
                </div>
                {at && a.flavor && <p className="text-xs">{a.flavor}</p>}
                {!at && (
                  <p className="text-xs">{challengeProgress(a.id, stats)}</p>
                )}
                {ratio !== null && (
                  <Meter value={ratio} color={color} className="mt-1 h-1" />
                )}
                {!a.hidden && (
                  <button
                    type="button"
                    className="text-xs underline"
                    aria-pressed={collection.saved.pin === a.id}
                    onClick={() =>
                      setCollectionPreference({
                        pin: collection.saved.pin === a.id ? null : a.id,
                      })
                    }
                  >
                    {collection.saved.pin === a.id ? "Unpin" : "Pin challenge"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (
              window.confirm("Reset all Power Mode stats and achievements?")
            ) {
              resetPowerStats();
              updatePowerSettings({ bestCombo: 0 });
            }
          }}
        >
          Reset stats & achievements
        </Button>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "power-engine",
    mount({ pluginId, signal }) {
      initPowerStore(pluginId);
      return mountPowerEngine(signal);
    },
  });

  app.experimental_sidebarFooter.register({
    kind: "action",
    id: "toggle",
    label: "Toggle Power Mode",
    icon: "Zap",
    onActivate: () => togglePowerMode(),
  });

  app.commands.register({
    id: "toggle",
    title: "Power Mode: Toggle",
    defaultShortcut: { key: "p", mod: true, alt: true },
    run: () => togglePowerMode(),
  });

  app.slots.experimental_appOverlay({
    id: "agent-watcher",
    component: AgentWatcher,
  });
  app.slots.experimental_appOverlay({
    id: "achievement-observer",
    component: AchievementObserver,
  });
  app.composer.customize({
    id: "achievement-input",
    scopes: ["thread", "new-thread"],
    banners: [
      { id: "observer", chrome: "bare", component: AchievementComposer },
    ],
  });
  app.slots.navPanel({
    id: "achievements",
    path: "achievements",
    title: "Power Mode achievements",
    icon: "Zap",
    component: StatsAndAchievements,
  });

  app.slots.settingsSection({
    id: "power",
    title: "Power Mode",
    description: "Particles, shake, combos, and lightning while you type.",
    component: SettingsSection,
  });
});
