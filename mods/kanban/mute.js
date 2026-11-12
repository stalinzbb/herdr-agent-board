// Mute: Herdr's attention sounds (an agent needs you, or finished) on or off, in one place.
// It flips `sounds.enabled` in Herdr's own settings.json, so it also governs sounds Herdr plays itself.
// Toasts stay: they're silent. Bound to kanban.mute (⌘⇧M) and the speaker button in the top bar.

import { settings, appHome, readTextFile, writeTextFile, notify } from "herdr";

export const soundsOn = () => settings()?.sounds?.enabled !== false;

export async function toggleMute() {
  const path = `${appHome()}/settings.json`;
  try {
    const text = await readTextFile(path);
    const cfg = text ? JSON.parse(text) : {};
    const on = cfg.sounds?.enabled !== false;
    cfg.sounds = { ...(cfg.sounds ?? {}), enabled: !on };
    await writeTextFile(path, JSON.stringify(cfg, null, 2) + "\n", text);
    notify({ title: on ? "Sounds muted" : "Sounds on", body: on ? "Notifications still show, silently. ⌘⇧M turns sound back on." : undefined, level: "info", timeout: 2500 });
  } catch (e) {
    notify({ title: "Couldn't change sounds", body: String(e).slice(0, 160), level: "warning" });
  }
}
