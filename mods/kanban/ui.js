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

// What a marker means, by color, everywhere (sidebar, board, rail tabs, Riff). The status colors above say
// what an agent is doing (needs you / working / done); these say what a session has attached to it.
// Red stays "asked you something", so a riff, a port and a device each get a hue of their own.
export const KIND = {
  ask: { color: STATUS.blocked, label: "Waiting on your answer" },
  riff: { color: "#a78bfa", label: "Has a riff open (a question with live controls)" },
  task: { color: "#4c9aff", label: "Tasks" },
  port: { color: "#22d3ee", label: "A dev server is running here" },
  device: { color: "#f472b6", label: "A simulator or device is in use" },
};

// A theme color with an alpha, when it's plain #rrggbb.
export const tint = (color, alpha = "26") => (/^#[0-9a-f]{6}$/i.test(color) ? color + alpha : color);

// A marker: the kind's dot alone, or with `text` a small pill in the kind's color. The tooltip says what it is.
export function mark(kind, text, id, tip) {
  const k = KIND[kind];
  const el = text
    ? h_flex().flex_none().h(16).px(6).gap(4).items_center().rounded(8).bg(tint(k.color)).text_size(10.5).font_medium().text_color(k.color)
        .child(div().w(5).h(5).flex_none().rounded_full().bg(k.color)).child(div().whitespace_nowrap().child(text))
    : div().flex_none().w(14).h(14).flex().items_center().justify_center().child(div().w(6).h(6).rounded_full().bg(k.color));
  return (id ? el.id(id) : el).tooltip(tip ?? k.label);
}

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

// One button for the whole panel, in three weights, so every action reads the same way.
//   primary    the one thing to do here (ink fill)
//   secondary  an equal-but-quieter choice (raised fill, hairline edge)
//   ghost      a small aside (no fill until you point at it)
// Every variant has a hover, a pressed and (where it can happen) a disabled state, and a hit
// area of at least 28px; a button that is busy keeps its label and swaps its icon for a spinner.
export function button(p, id, label, onPress, opts = {}) {
  const { variant = "secondary", icon, busy = false, disabled = false } = opts;
  const ghost = variant === "ghost";
  const live = !disabled && !busy;
  const fill = variant === "primary" ? p.ink : variant === "secondary" ? p.raised : "#00000000";
  const ink = disabled ? p.faint : variant === "primary" ? p.ground : ghost ? p.muted : p.ink;
  return h_flex().id(id).flex_none().h(ghost ? 28 : 32).px(ghost ? 10 : 12).gap(6).items_center().justify_center()
    .rounded(ghost ? 8 : 10).text_size(ghost ? 12 : 12.5).font_medium().whitespace_nowrap()
    .bg(disabled ? p.raised : fill).text_color(ink)
    .when(variant === "secondary", (el) => el.border_1().border_color(p.line))
    .when(live, (el) => el.cursor_pointer()
      .hover((s) => (variant === "primary" ? s.opacity(0.88) : s.bg(ghost ? p.hover : p.selected).text_color(p.ink)))
      .active((s) => s.opacity(0.7)))
    .when(!live, (el) => el.cursor_default())
    .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); if (live) onPress(e, cx); })
    .when(busy || !!icon, (el) => el.child(svg(ICON(busy ? "spinner" : icon)).size(13).flex_none()))
    .child(label);
}
