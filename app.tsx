// Power Mode — frontend entry.
//
// - A content script runs the effects engine (lib/power-engine.ts) on every
//   text field, textarea, and contenteditable editor in the bb window.
// - A sidebar-footer button toggles it on/off in one click.
// - A command-palette entry (Mod+Alt+P by default) does the same.
// - An invisible app overlay feeds live thread status to Agent Power Mode.
// - The plugin's Settings page has themes, particle/glow sliders, effect
//   toggles, lifetime stats, and achievements.
import { useEffect, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { definePluginApp, experimental_useSidebarThreads, useBbContext } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { mountPowerEngine, syncAgentThreads, togglePowerMode } from "@/lib/power-engine";
import {
  DENSITY_RANGE,
  THEME_IDS,
  getPowerSettings,
  initPowerStore,
  subscribePowerSettings,
  updatePowerSettings,
  type Intensity,
  type PowerSettings,
} from "@/lib/power-store";
import { ACHIEVEMENTS, getPowerStats, resetPowerStats, subscribePowerStats } from "@/lib/power-stats";
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
  { id: "legendary", label: "Legendary", hint: "Twice the particles, harder shake." },
  { id: "godlike", label: "Godlike", hint: "Everything. The whole screen shakes." },
];

const EFFECT_OPTIONS: { key: keyof PowerSettings; label: string; hint: string }[] = [
  { key: "protectText", label: "Keep text clear", hint: "Effects gently fade near the caret while you type, so the text stays readable." },
  { key: "shake", label: "Editor shake", hint: "The text box jumps on every keystroke." },
  { key: "screenShake", label: "Screen shake", hint: "The whole window quakes on combos and Enter." },
  { key: "ghostLetters", label: "Flying letters", hint: "Each typed character launches off the caret." },
  { key: "lightning", label: "Lightning", hint: "Bolts strike the caret at combo milestones." },
  { key: "agentMode", label: "Agent Power Mode", hint: "Sparks fly while agents write their replies, with combos and a turn-complete finale." },
  { key: "sound", label: "Sound", hint: "Synth blips that climb with the combo, booms on milestones." },
];

function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-start gap-3 py-2">{children}</div>;
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
            Toggle any time with the ⚡ button in the sidebar footer, or “Power Mode: Toggle” in the
            command palette. Saved per browser window.
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
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Intensity">
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
              <div className="mt-0.5 text-xs text-muted-foreground">{option.hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium">Theme</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
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
                  selected ? "border-foreground bg-state-active" : "border-border hover:bg-state-hover",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {theme.emoji} {theme.name}
                  </span>
                  <span className="flex" aria-hidden>
                    {theme.swatch.map((color) => (
                      <span key={color} className="-ml-1 size-3 rounded-full ring-1 ring-background" style={{ background: color }} />
                    ))}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{theme.description}</div>
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
                    updatePowerSettings({ [option.key]: checked === true } as Partial<PowerSettings>)
                  }
                />
                <label htmlFor={id} className="cursor-pointer">
                  <div className="text-sm">{option.label}</div>
                  <div className="text-xs text-muted-foreground">{option.hint}</div>
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
        <span className="tabular-nums text-muted-foreground">{props.format(props.value)}</span>
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
      <div className="text-lg font-semibold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function StatsAndAchievements() {
  const stats = usePowerStats();
  const unlockedCount = ACHIEVEMENTS.filter((a) => stats.unlocked[a.id]).length;
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Stats</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Characters typed" value={stats.chars} />
        <Stat label="Best combo" value={stats.bestCombo} />
        <Stat label="Best WPM" value={stats.bestWpm} />
        <Stat label="Milestones hit" value={stats.milestones} />
        <Stat label="Agent chars cheered" value={stats.agentChars} />
        <Stat label="Longest agent reply" value={`${stats.bestAgentWords} words`} />
        <Stat label="Agent turns" value={stats.agentTurns} />
        <Stat label="Achievements" value={`${unlockedCount}/${ACHIEVEMENTS.length}`} />
      </div>
      <div className="pt-2 text-sm font-medium">Achievements</div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {ACHIEVEMENTS.map((a) => {
          const at = stats.unlocked[a.id];
          return (
            <li
              key={a.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2",
                at ? "border-border bg-card" : "border-dashed border-border opacity-55",
              )}
            >
              <span className={cn("text-2xl", !at && "grayscale")} aria-hidden>
                {at ? a.icon : "🔒"}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{a.title}</div>
                <div className="text-xs text-muted-foreground">
                  {a.description}
                  {at ? ` · ${new Date(at).toLocaleDateString()}` : ""}
                </div>
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
            if (window.confirm("Reset all Power Mode stats and achievements?")) {
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

  app.slots.experimental_appOverlay({ id: "agent-watcher", component: AgentWatcher });

  app.slots.settingsSection({
    id: "power",
    title: "Power Mode",
    description: "Particles, shake, combos, and lightning while you type.",
    component: SettingsSection,
  });
});
