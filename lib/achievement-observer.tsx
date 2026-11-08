import { useEffect, useRef } from "react";
import {
  useComposer,
  useSdk,
  useBbContext,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { observeComposer, type InputObservation } from "./achievement-input";
import { AgentObservation } from "./achievement-agent";
import { getPowerSettings, subscribePowerSettings } from "./power-store";
import {
  getCollection,
  recordAchievementEvent,
  onCollectionReset,
  flushPowerStats,
} from "./power-stats";
const flags = () => {
  const s = getPowerSettings();
  return {
    theme: s.theme,
    silent: !s.sound && !s.shake && !s.screenShake && !s.lightning,
    quiet:
      !s.particles &&
      !s.glow &&
      !s.sound &&
      !s.shake &&
      !s.screenShake &&
      !s.lightning,
  };
};
export function observeAchievement(event: InputObservation) {
  if (
    !getPowerSettings().enabled &&
    event.type !== "disconnect" &&
    event.type !== "context"
  )
    return;
  recordAchievementEvent({
    now: performance.now(),
    wall: Date.now(),
    thread: null,
    ...flags(),
    ...event,
  });
}
/** Invisible marker scopes native input to the SDK handle which owns this banner. */
export function AchievementComposer() {
  const composer = useComposer(),
    ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current || composer.scope.kind === "queued-message") return;
    const thread =
      composer.scope.kind === "thread" ? composer.scope.threadId : null;
    const stop = observeComposer(
      { key: composer.key, thread, marker: ref.current },
      observeAchievement,
    );
    const unsub = composer.onSubmitted(() =>
      observeAchievement({ type: "submit", editor: composer.key, thread }),
    );
    return () => {
      stop();
      unsub();
      observeAchievement({ type: "context" });
    };
  }, [composer, composer.key]);
  return <span ref={ref} hidden aria-hidden="true" />;
}
export function AchievementObserver() {
  const sdk = useSdk(),
    { threadId } = useBbContext(),
    navigate = useBbNavigate();
  const settingsHistory = useRef([{ at: Date.now(), ...flags() }]);
  useEffect(() => {
    const unsubscribe = subscribePowerSettings(() => {
      const next = flags();
      settingsHistory.current.push({ at: Date.now(), ...next });
      // Keep the last ten minutes plus the preceding snapshot; no document text.
      const h = settingsHistory.current;
      while (h.length > 1 && h[1].at < Date.now() - 600_000) h.shift();
      observeAchievement({
        type: getPowerSettings().enabled ? "settings" : "disconnect",
      });
    });
    const timer = window.setInterval(() => {
      const c = getCollection();
      if (
        c.window ||
        c.rhythm ||
        c.combo ||
        (c.session.lastActivity !== null &&
          performance.now() - c.session.lastActivity >= 600_000)
      )
        observeAchievement({ type: "tick" });
    }, 250);
    const open = () => navigate.toPluginPanel("achievements");
    window.addEventListener("power-mode:gallery", open);
    window.addEventListener("pagehide", flushPowerStats);
    return () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("power-mode:gallery", open);
      window.removeEventListener("pagehide", flushPowerStats);
      flushPowerStats();
    };
  }, [navigate]);
  useEffect(() => {
    observeAchievement({ type: "context" });
    if (!threadId) return;
    const abort = new AbortController();
    let timer = 0,
      generation = 0;
    const adapter = new AgentObservation((event) => {
      if (event.type === "start" && event.wall) {
        const h = settingsHistory.current,
          prior = [...h].reverse().find((x) => x.at <= event.wall!);
        // If the start predates our settings observation, it is partial.
        if (!prior) return;
        observeAchievement({
          ...event,
          theme: prior.theme,
          quiet:
            prior.quiet &&
            h.filter((x) => x.at >= event.wall!).every((x) => x.quiet),
        });
      } else observeAchievement(event);
    }, threadId);
    const reset = () => {
      generation++;
      adapter.disconnect();
    };
    const unreset = onCollectionReset(reset);
    let enabled = getPowerSettings().enabled,
      agentMode = getPowerSettings().agentMode;
    const unsettings = subscribePowerSettings(() => {
      const next = getPowerSettings();
      if (enabled !== next.enabled || agentMode !== next.agentMode) reset();
      enabled = next.enabled;
      agentMode = next.agentMode;
    });
    async function poll() {
      const run = generation;
      try {
        if (
          !getPowerSettings().enabled ||
          !getPowerSettings().agentMode ||
          document.visibilityState === "hidden"
        ) {
          adapter.disconnect();
          return;
        }
        if (adapter.afterSeq === null) {
          const rows = await sdk.threads.events.list({
            threadId: threadId!,
            order: "desc",
            limit: "1",
            signal: abort.signal,
          });
          if (!abort.signal.aborted && run === generation)
            adapter.seed(rows[0]?.seq ?? 0);
        } else {
          // Bounded pages; continue on the next tick without dropping events.
          const rows = await sdk.threads.events.list({
            threadId: threadId!,
            afterSeq: String(adapter.afterSeq),
            order: "asc",
            limit: "200",
            signal: abort.signal,
          });
          if (!abort.signal.aborted && run === generation) adapter.accept(rows);
        }
      } catch {
        if (!abort.signal.aborted) adapter.disconnect();
      } finally {
        if (!abort.signal.aborted) timer = window.setTimeout(poll, 1000);
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
      unreset();
      unsettings();
      adapter.disconnect();
    };
  }, [sdk, threadId]);
  return null;
}
