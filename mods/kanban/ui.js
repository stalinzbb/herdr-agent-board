// Shared bits: the board's palette, small controls, config files.

import { div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, appHome, home, readTextFile, exec } from "herdr";

export const ICON = (name) => `mods/kanban/${name}.svg`;

// Status colors: color means something (needs you / running / finished), never decoration.
export const STATUS = {
  blocked: "#e5566f",
  working: "#e2b340",
  done: "#3fc07a",
  idle: "#6b6b6b",
};

export function pal() {
  const t = theme();
  return {
    ...t,
    ground: t.canvas,
    col: t.chrome,
    card: t.surface,
    cardHover: t.raised,
    line: t.border,
    ink: t.foreground,
    muted: t.muted,
    faint: t.dim,
  };
}

export const expand = (p) => (p?.startsWith("~") ? home() + p.slice(1) : p);
export const tilde = (p) => {
  const h = home();
  return p && h && p.startsWith(h) ? "~" + p.slice(h.length) : p;
};

export function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export function dot(color, size = 7) {
  return div().w(size).h(size).rounded_full().flex_none().bg(color);
}

// A program's icon from Herdr's table (one-color glyph or picture).
export function progIcon(p, size, color) {
  if (!p?.icon) return svg(ICON("terminal")).size(size).flex_none().text_color(color);
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// A quiet icon button. Acts on mouse down and stops it there, so a card or a
// window-drag area underneath never also gets the press.
export function iconBtn(id, icon, onPress, p, opts = {}) {
  return h_flex()
    .id(id)
    .flex_none()
    .h(24)
    .px(opts.label ? 8 : 0)
    .when(!opts.label, (el) => el.w(24))
    .gap(5)
    .justify_center()
    .items_center()
    .rounded(9)
    .text_size(12)
    .text_color(opts.color ?? p.muted)
    .cursor_pointer()
    .hover((s) => s.bg(p.hover).text_color(p.ink))
    .on_mouse_down("left", (e, cx) => {
      cx.stop_propagation();
      onPress(e, cx);
    })
    .child(svg(ICON(icon)).size(14))
    .when(!!opts.label, (el) => el.child(opts.label));
}

// Settings live outside the code, so updating the mods never touches them:
// ~/.config/herdr-board/<name>.json, else the mod's defaults/<name>.json.
export const USER_CONFIG = () => `${home()}/.config/herdr-board`;
const DEFAULTS = () => `${appHome()}/mods/kanban/defaults`;

async function readOne(path) {
  try { return (await readTextFile(path)) || null; } catch { return null; }
}

export async function readConfig(name, fallback) {
  for (const path of [`${USER_CONFIG()}/${name}.json`, `${DEFAULTS()}/${name}.json`]) {
    const text = await readOne(path);
    if (!text) continue;
    try { return JSON.parse(text); } catch (e) { return { ...fallback, error: `${path.replace(home(), "~")}: ${e?.message ?? e}` }; }
  }
  return fallback;
}

// Opens your copy of a settings file, making it from the default the first time.
export function editConfig(name) {
  return exec("/bin/sh", ["-c", 'mkdir -p "$1" && { [ -f "$1/$2.json" ] || cp "$3/$2.json" "$1/$2.json"; } && open -t "$1/$2.json"', "sh", USER_CONFIG(), name, DEFAULTS()]);
}
