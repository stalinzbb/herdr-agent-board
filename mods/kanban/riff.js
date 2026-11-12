// The Riff panel: an agent's UI question, with live controls, for the pane you're on.
//
// An agent that needs your call on something visual (a spacing, a color, which variant, how a
// spring feels) runs riff.py with a question and DialKit-shaped controls. It shows here while that
// agent's pane is focused; you drag, maybe add a note, and Answer (or Skip). The answer goes back
// to the agent's waiting riff.py, and the riff closes. If the agent stopped waiting, the answer is
// typed into its terminal instead (hc send). Values are written as you drag, to <stem>.values.json
// and to the spec's `output`, so a dev server can show them live.
//
// The idea and the control shapes come from DialKit by Josh Puckett (github.com/joshpuckett/dialkit),
// rebuilt natively for Herdr (no DialKit code).

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, SliderState, Slider, SliderTrack, SliderIndicator, SliderThumb } from "gpui-base";
import { exec, home, readTextFile, writeTextFile, watchFolder, terminals, agents, focused, notify, settings } from "herdr";
import { ICON, STATUS, pal, tilde, dot } from "./ui.js";
import { demo, DEMO_RIFF } from "./demo.js";
import { RIFF_DIR, isSpec, stemOf, riffs, askerLabel, paneLabel, goToRiff } from "./riffs.js";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What the empty panel offers to send. It has to stand on its own: the agent may have been cleared,
// may not have the riff skill loaded (it started before the plugin was installed), and "riff" alone
// reads as "improvise some variations". So it names the skill, gives the fallback, and sets the scope.
const SAMPLE = "Riff me the matter-of-taste values in what you just built (spacing, sizes, colors, timing, motion). "
  + "Use the herdr-agent-board:riff skill; if you don't have it, run `python3 ~/.config/herdr-app/mods/kanban/riff.py --help` and follow that. "
  + "Have a small subagent draft the plan (most impact first, 2–8 controls each, defaults read from the code; check git if you don't remember what you built), "
  + "then open one riff at a time yourself and apply each answer before the next. Don't answer in prose.";

// ---- reading a DialKit config

const COLOR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgba?|hsla?|oklch|oklab|lab|lch|color)\(.*\))$/i;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// "borderRadius" / "border_radius" -> "Border radius"
function humanize(key) {
  const words = key.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// DialKit's rules: a tuple without a step, and a bare number, get these.
const inferStep = (min, max) => { const r = Math.abs(max - min); return r <= 1 ? 0.01 : r <= 10 ? 0.1 : r <= 100 ? 1 : 10; };
function inferRange(v) {
  const x3 = Number((v * 3).toFixed(6));
  if (v < 0) return { min: x3, max: -x3, step: 1 };
  if (v <= 1) return { min: 0, max: 1, step: 0.01 };
  if (v <= 10) return { min: 0, max: x3, step: 0.1 };
  if (v <= 100) return { min: 0, max: x3, step: 1 };
  return { min: 0, max: x3, step: 10 };
}
const decimals = (step) => (String(step).split(".")[1] ?? "").length;
const snap = (v, l) => Number(Math.min(l.max, Math.max(l.min, Math.round(v / l.step) * l.step)).toFixed(decimals(l.step)));

// Agents write these by hand: a range given backwards is swapped, an empty one widened, a missing or
// bad step inferred, and one that isn't numbers shows as unsupported instead of reaching Herdr.
function slider(path, label, [def, min, max, step]) {
  let [d, lo, hi] = [def, min, max].map(Number);
  if (![d, lo, hi].every(Number.isFinite)) return { kind: "unsupported", path, label, why: "its range isn't numbers" };
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) hi = lo + 1;
  const st = Number(step);
  return { kind: "slider", path, label, def: d, min: lo, max: hi, step: Number.isFinite(st) && st > 0 ? st : inferStep(lo, hi) };
}

// Herdr's SliderState applies `min` before `max` (default 100) and aborts the whole app when min > max,
// so a 400..700 range crashed it. The native slider only ever sees whole steps from 0: 0..n.
const MAX_STEPS = 10000;
const stepsOf = (l) => Math.max(1, Math.min(MAX_STEPS, Math.round((l.max - l.min) / l.step)));
const toIndex = (v, l) => Math.max(0, Math.min(stepsOf(l), Math.round(((Math.min(l.max, Math.max(l.min, v)) - l.min) / (l.max - l.min)) * stepsOf(l))));
const fromIndex = (i, l) => (i >= stepsOf(l) ? l.max : snap(l.min + (i / stepsOf(l)) * (l.max - l.min), l));

// A config object -> nodes: leaves (slider, toggle, text, color, select, numbers, action),
// folders, and groups (spring, easing, pad: a folder whose value is one object).
function parse(cfg, prefix = "") {
  const out = [];
  for (const [key, v] of Object.entries(cfg ?? {})) {
    if (key.startsWith("_")) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const label = humanize(key);
    const sub = (name) => `${path}.${name}`;
    if (Array.isArray(v) && typeof v[0] === "number") out.push(slider(path, label, v));
    else if (typeof v === "number") { const r = inferRange(v); out.push(slider(path, label, [v, r.min, r.max, r.step])); }
    else if (typeof v === "boolean") out.push({ kind: "toggle", path, label, def: v });
    else if (typeof v === "string") out.push({ kind: COLOR.test(v.trim()) ? "color" : "text", path, label, def: v });
    else if (v && typeof v === "object") {
      const name = v.label ?? label;
      switch (v.type) {
        case undefined:
          out.push({ kind: "folder", path, label, collapsed: !!v._collapsed, children: parse(v, path) });
          break;
        case "slider":
          out.push(slider(path, name, [v.default ?? v.min ?? 0, v.min ?? 0, v.max ?? 100, v.step]));
          break;
        case "toggle":
          out.push({ kind: "toggle", path, label: name, def: !!v.default });
          break;
        case "text":
          out.push({ kind: "text", path, label: name, def: String(v.default ?? ""), placeholder: v.placeholder });
          break;
        case "color":
          out.push({ kind: "color", path, label: name, def: String(v.default ?? "#000000") });
          break;
        case "select":
        case "image": {
          const options = (v.options ?? []).map((o) => (o && typeof o === "object" ? { value: String(o.value), label: o.label ?? String(o.value) } : { value: String(o), label: String(o) }));
          if (!options.length) { out.push({ kind: "unsupported", path, label: name, why: "no options" }); break; }
          out.push({ kind: "select", path, label: name, options, def: String(v.default ?? options[0].value) });
          break;
        }
        case "spring":
          out.push(v.stiffness != null || v.damping != null || v.mass != null
            ? { kind: "group", path, label: name, fixed: { type: "spring" }, children: [
                slider(sub("stiffness"), "Stiffness", [v.stiffness ?? 200, 1, 1000, 1]),
                slider(sub("damping"), "Damping", [v.damping ?? 25, 0, 100, 1]),
                slider(sub("mass"), "Mass", [v.mass ?? 1, 0.1, 10, 0.1]) ] }
            : { kind: "group", path, label: name, fixed: { type: "spring" }, children: [
                slider(sub("visualDuration"), "Duration", [v.visualDuration ?? 0.3, 0, 2, 0.01]),
                slider(sub("bounce"), "Bounce", [v.bounce ?? 0.2, 0, 1, 0.01]) ] });
          break;
        case "easing":
          out.push({ kind: "group", path, label: name, fixed: { type: "easing" }, children: [
            slider(sub("duration"), "Duration", [v.duration ?? 0.3, 0, 2, 0.01]),
            { kind: "numbers", path: sub("ease"), label: "Curve", def: v.ease ?? [0.25, 0.1, 0.25, 1], count: 4 } ] });
          break;
        case "pad": {
          const axis = (a) => v[a] ?? [0, -1, 1, 0.01];
          out.push({ kind: "group", path, label: name, fixed: {}, children: [
            slider(sub("x"), v.labels?.x ?? "X", axis("x")),
            slider(sub("y"), v.labels?.y ?? "Y", axis("y")) ] });
          break;
        }
        case "action":
          out.push({ kind: "action", path, label: name });
          break;
        default:
          out.push({ kind: "unsupported", path, label: name, why: `"${v.type}" isn't a control here` });
      }
    }
  }
  return out;
}

const leavesOf = (nodes) => nodes.flatMap((n) => (n.children ? leavesOf(n.children) : [n]));
const VALUE_KINDS = new Set(["slider", "toggle", "text", "color", "select", "numbers"]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fmt(v) {
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}

// ---- one panel: a spec, its controls' native states, and the values you've set

function buildPanel(stem, text, spec, old, saved) {
  const nodes = parse(spec.controls);
  const leaves = leavesOf(nodes).filter((l) => VALUE_KINDS.has(l.kind));
  const panel = { stem, text, spec, nodes, leaves, values: {}, states: {}, note: old?.note ?? null, seen: old?.seen ?? Date.now() };
  const prev = old ? Object.fromEntries(old.leaves.map((l) => [l.path, l])) : {};
  for (const l of leaves) {
    let v = l.def;
    // Keep what you'd changed, unless the agent moved that control's default (it applied it).
    const was = prev[l.path];
    if (was && was.kind === l.kind && same(was.def, l.def)) v = old.values[l.path];
    else if (!old && saved?.defaults && same(saved.defaults[l.path], l.def) && saved.flat?.[l.path] !== undefined) v = saved.flat[l.path];
    panel.values[l.path] = v;
  }
  return panel;
}

// Native states are made once per panel (never in render).
function makeStates(panel, self) {
  const focusable = (field, key) => {
    field.on("focus", (_e, cx) => { panel.focus = key; cx.notify(); });
    field.on("blur", (_e, cx) => { if (panel.focus === key) panel.focus = null; cx.notify(); });
  };
  for (const l of panel.leaves) {
    const v = panel.values[l.path];
    if (l.kind === "slider") {
      const s = SliderState.new({ min: 0, max: stepsOf(l), step: 1, value: toIndex(v, l) });
      const field = InputState.new({ value: String(v) });
      s.on("change", (x, cx) => {
        panel.values[l.path] = fromIndex(x, l);
        if (panel.focus !== l.path) field.set_value(String(panel.values[l.path]));
        self.flush(panel, cx);
        cx.notify();
      });
      s.on("release", (_x, cx) => self.flush(panel, cx));
      const commit = (cx) => {
        const n = Number(field.value());
        if (Number.isFinite(n)) {
          // Typed values may go past the slider's range: you asked for it.
          panel.values[l.path] = Number(n.toFixed(Math.max(decimals(l.step), decimals(n))));
          s.set_value(toIndex(n, l));
          self.flush(panel, cx);
        }
        field.set_value(String(panel.values[l.path]));
        cx.notify();
      };
      field.on("submit", (_e, cx) => commit(cx));
      field.on("focus", (_e, cx) => { panel.focus = l.path; cx.notify(); });
      field.on("blur", (_e, cx) => { if (panel.focus === l.path) panel.focus = null; commit(cx); });
      panel.states[l.path] = { slider: s, field };
    } else if (l.kind === "text" || l.kind === "color" || l.kind === "numbers") {
      const field = InputState.new({ value: l.kind === "numbers" ? v.join(", ") : String(v), placeholder: l.placeholder });
      field.on("change", (_e, cx) => {
        const raw = field.value();
        if (l.kind === "numbers") {
          const nums = raw.split(/[\s,]+/).filter(Boolean).map(Number);
          if (nums.length !== l.count || nums.some((n) => !Number.isFinite(n))) { panel.bad = { ...panel.bad, [l.path]: true }; cx.notify(); return; }
          panel.bad = { ...panel.bad, [l.path]: false };
          panel.values[l.path] = nums;
        } else panel.values[l.path] = raw;
        self.flush(panel, cx);
        cx.notify();
      });
      focusable(field, l.path);
      panel.states[l.path] = { field };
    }
  }
  if (!panel.note) {
    panel.note = InputState.new({ placeholder: "Add a note" });
    panel.note.on("change", (_e, cx) => cx.notify());
    panel.note.on("submit", (_e, cx) => self.answer(panel, cx, "answered"));
    focusable(panel.note, "__note");
  }
}

function releaseStates(panel, keepNote) {
  for (const st of Object.values(panel.states)) { st.slider?.release(); st.field?.release(); }
  if (!keepNote) panel.note?.release();
}

// Native states (sliders, fields) need a live host call with a window: `init` or an event handler.
// The scan is a task, and neither a task after an await, a timer callback nor
// the init of a nested view the task creates is one: making them there throws "[uninitialized]".
// So the scan only reads riffs; their controls are made by the panel's pointer handlers, the moment
// you move onto the Riff tab, and until then a riff shows its values as text.

// Values as the app reads them: nested like `controls`, groups as one object ({ type: "spring", ... }).
function nested(panel) {
  const walk = (nodes) => {
    const o = {};
    for (const n of nodes) {
      const k = n.path.split(".").pop();
      if (n.kind === "folder") o[k] = walk(n.children);
      else if (n.kind === "group") o[k] = { ...n.fixed, ...walk(n.children) };
      else if (VALUE_KINDS.has(n.kind)) o[k] = panel.values[n.path];
    }
    return o;
  };
  return walk(panel.nodes);
}

const changesOf = (panel) => panel.leaves.filter((l) => !same(panel.values[l.path], l.def));


const changedMap = (panel) => Object.fromEntries(changesOf(panel).map((l) => [l.path, { from: l.def, to: panel.values[l.path] }]));

export class Riff {
  constructor() {
    this.panels = new Map(); // stem -> panel
    this.retired = []; // replaced panels whose native states wait for an event to be released
    this.written = {}; // path -> the text we last wrote there
  }

  start(cx) {
    // Made once here: native states can't be made while drawing.
    this.demoPanel = buildPanel("demo", "", DEMO_RIFF, null, null);
    makeStates(this.demoPanel, this);
    // Folder events can stop coming (the watch fails, or an event names only riff.py's temp file),
    // and the bar's list doesn't depend on them. So scan on any event, on a slow timer, and whenever
    // the bar lists a riff this panel hasn't got: the panel can't fall behind the list again.
    this.wake = null;
    const tick = () => { const w = this.wake; this.wake = null; w?.(); };
    cx.spawn(async (cx) => {
      await exec("mkdir", ["-p", RIFF_DIR()]).catch(() => null);
      for (;;) {
        await this.scan(cx).then(() => { this.scanError = null; }, (e) => { this.scanError = String(e?.message ?? e); });
        cx.notify();
        await new Promise((r) => { this.wake = r; cx.timer.after(4000, tick); });
      }
    });
    cx.spawn(async () => {
      for (;;) {
        const changed = await watchFolder(RIFF_DIR()).catch(() => null);
        if (!changed) { await new Promise((r) => cx.timer.after(5000, r)); continue; }
        if (changed.some((p) => isSpec(p) || p.endsWith(".json.tmp"))) tick();
      }
    });
  }

  // From a pointer event (a live host call): make the controls of riffs that arrived since, and
  // release the ones of riffs that closed or changed.
  makePending(cx) {
    for (const [old, keepNote] of this.retired.splice(0)) releaseStates(old, keepNote);
    let made = false;
    for (const panel of this.panels.values()) {
      if (!panel.pending) continue;
      try {
        makeStates(panel, this);
        panel.pending = false;
        made = true;
      } catch (e) {
        panel.error = `Couldn't make its controls: ${e?.message ?? e}`;
        panel.pending = false;
        panel.broken = true;
      }
    }
    if (made) cx.notify();
  }

  // The bar's list has a riff this panel hasn't loaded (or failed to): scan now, not at the next tick.
  catchUp() {
    if (demo() || Date.now() - (this.scanned ?? 0) < 1000) return;
    if (riffs().some((r) => !this.panels.has(r.stem) && !this.broken?.[r.stem])) this.wake?.();
  }

  async scan(cx) {
    this.scanned = Date.now();
    const ls = await exec("/bin/ls", ["-1", RIFF_DIR()]).catch(() => ({ stdout: "" }));
    const stems = ls.stdout.split("\n").filter(isSpec).map(stemOf);
    this.broken = Object.fromEntries(Object.entries(this.broken ?? {}).filter(([s]) => stems.includes(s)));
    for (const stem of [...this.panels.keys()]) {
      if (!stems.includes(stem) && !this.panels.get(stem).answered) {
        // Closed (answered, or by the agent): forget what we wrote, so a new riff with this id writes afresh.
        const gone = this.panels.get(stem);
        if (!gone.pending) this.retired.push([gone, false]);
        this.panels.delete(stem);
        for (const s of [".json", ".values.json", ".answer.json"]) delete this.written[`${RIFF_DIR()}/${stem}${s}`];
      }
    }
    // One riff that can't be shown never stops the others: its error shows in its place.
    for (const stem of stems) {
      try {
        await this.load(stem, cx);
        delete this.broken[stem];
      } catch (e) {
        this.broken[stem] = String(e?.message ?? e);
      }
    }
  }

  async load(stem, cx) {
    const text = await readTextFile(`${RIFF_DIR()}/${stem}.json`);
    const old = this.panels.get(stem);
    if (text == null) throw new Error("couldn't read its file");
    if (text === old?.text) return;
    let spec;
    try {
      spec = JSON.parse(text);
      if (!spec || typeof spec !== "object" || typeof spec.controls !== "object") throw new Error("needs a \"controls\" object");
    } catch (e) {
      // A half-written file: keep showing the last good one.
      if (old) { old.error = String(e?.message ?? e); return; }
      throw e;
    }
    let saved = null;
    if (!old) {
      try { saved = JSON.parse((await readTextFile(`${RIFF_DIR()}/${stem}.values.json`)) ?? "null"); } catch {}
    }
    const panel = buildPanel(stem, text, spec, old?.leaves ? old : null, saved);
    panel.pending = true;
    if (old) {
      // The new panel keeps the old one's note field; only its other states go.
      if (old.pending) panel.note = null; else this.retired.push([old, true]);
    }
    this.panels.set(stem, panel);
    this.flush(panel, cx);
  }

  // Writes the values (coalesced: as fast as the disk takes them, never two at once).
  flush(panel, cx) {
    if (panel.stem === "demo" || panel.answered) return;
    if (panel.writing) { panel.dirty = true; return; }
    panel.writing = true;
    cx.spawn(async () => {
      do {
        panel.dirty = false;
        const values = nested(panel);
        const flat = { ...panel.values };
        const defaults = Object.fromEntries(panel.leaves.map((l) => [l.path, l.def]));
        await this.put(`${RIFF_DIR()}/${panel.stem}.values.json`, JSON.stringify({ terminal: panel.spec.terminal, question: panel.spec.question, values, changed: changedMap(panel), flat, defaults }, null, 2) + "\n");
        const out = this.outputPath(panel);
        if (out) await this.put(out, JSON.stringify(values, null, 2) + "\n");
      } while (panel.dirty);
      panel.writing = false;
    });
  }

  outputPath(panel) {
    const o = panel.spec.output;
    if (!o || typeof o !== "string") return null;
    if (o.startsWith("~")) return home() + o.slice(1);
    if (o.startsWith("/")) return o;
    return panel.spec.cwd ? `${panel.spec.cwd.replace(/\/$/, "")}/${o}` : null;
  }

  async put(path, text) {
    if (this.written[path] === text) return true;
    for (let tries = 0; tries < 2; tries++) {
      const expected = this.written[path] !== undefined ? this.written[path] : await readTextFile(path).catch(() => null);
      if (expected === text) { this.written[path] = text; return true; }
      try {
        await writeTextFile(path, text, expected);
        this.written[path] = text;
        return true;
      } catch {
        // Someone else changed it: read it again and retry once.
        delete this.written[path];
      }
    }
    notify({ title: "Riff couldn't write", body: tilde(path), level: "warning", timeout: 4000 });
    return false;
  }

  reset(panel, cx) {
    for (const l of panel.leaves) {
      panel.values[l.path] = l.def;
      const st = panel.states[l.path];
      if (st?.slider) { st.slider.set_value(toIndex(l.def, l)); st.field.set_value(String(l.def)); }
      else if (st?.field) st.field.set_value(l.kind === "numbers" ? l.def.join(", ") : String(l.def));
    }
    panel.bad = {};
    this.flush(panel, cx);
    cx.notify();
  }

  // What the agent gets if it isn't waiting any more: typed into its terminal.
  message(panel, status, note, action) {
    const q = panel.spec.question ?? panel.stem;
    if (status === "skipped") return `Riff · ${q}: I skipped this one.${note ? `\nNote: ${note}` : ""}`;
    const changed = changesOf(panel);
    const lines = [`Riff · ${q}: ${action ? `I picked "${action.label}".` : changed.length ? "here's my call." : "the values you proposed are good."}`];
    for (const l of changed) lines.push(`- ${l.path}: ${fmt(l.def)} → ${fmt(panel.values[l.path])}`);
    if (note) lines.push(`Note: ${note}`);
    lines.push(`All values: ${JSON.stringify(nested(panel))}`);
    return lines.join("\n");
  }

  // Answer or skip: the waiting riff.py picks up <stem>.answer.json and closes the riff. If nobody
  // picks it up within 3 seconds, the agent stopped waiting: type it in, then close it here.
  // An action button answers too, saying which one was pressed.
  answer(panel, cx, status, action) {
    if (panel.answered) return;
    const note = panel.note?.value().trim() ?? "";
    const q = panel.spec.question ?? panel.stem;
    if (panel.stem === "demo") {
      notify({ title: `Demo: would ${status === "skipped" ? "skip" : "answer"} "${q}"`, body: status === "skipped" ? undefined : plural(changesOf(panel).length, "change"), level: "info", timeout: 2500 });
      return;
    }
    const term = terminals().find((t) => t.address === panel.spec.terminal && t.state === "live");
    if (!term) {
      notify({ title: "That agent is gone", body: "Its question is closed.", level: "warning", timeout: 3000 });
      this.close(panel, cx);
      return;
    }
    panel.answered = status;
    panel.failed = null;
    panel.delivery = "Sending…";
    cx.notify();
    const file = (s) => `${RIFF_DIR()}/${panel.stem}${s}`;
    // A send that didn't go through stays on the card, with why and a way to try again.
    const fail = (msg, cx) => {
      panel.answered = null;
      panel.delivery = null;
      panel.failed = { msg, status, action };
      cx.notify();
    };
    const ans = { status, question: q, action: action?.path ?? null, values: nested(panel), changed: changedMap(panel), note };
    cx.spawn(async (cx) => {
      const ok = await this.put(file(".answer.json"), JSON.stringify(ans, null, 2) + "\n");
      if (!ok) return fail(`Couldn't write the answer to ${tilde(file(".answer.json"))}.`, cx);
      // The waiting riff.py takes the file within a moment; check every half second, up to 3.
      let taken = false;
      for (let i = 0; i < 6 && !taken; i++) {
        await new Promise((r) => cx.timer.after(500, r));
        taken = !(await readTextFile(file(".answer.json")).catch(() => null));
      }
      if (taken) {
        panel.delivery = "Sent to the agent";
        cx.notify();
      } else if (status === "answered" || note) {
        // Nobody picked it up: the agent stopped waiting, so type it into its terminal.
        const r = await exec("hc", ["send", panel.spec.terminal, this.message(panel, status, note, action)]).catch((e) => ({ code: 1, stderr: String(e) }));
        if (r.code !== 0) {
          await exec("rm", ["-f", file(".answer.json")]).catch(() => null);
          delete this.written[file(".answer.json")];
          return fail(`Couldn't reach the agent: ${(r.stderr || r.stdout || "").trim().slice(0, 160) || "is it still running?"}`, cx);
        }
        panel.delivery = "Typed into the agent's terminal";
        cx.notify();
      } else {
        // Skipping with nothing to say needs no message.
        panel.delivery = "Skipped";
        cx.notify();
      }
      await new Promise((r) => cx.timer.after(1200, r));
      this.close(panel, cx);
    });
  }

  close(panel, cx) {
    this.panels.delete(panel.stem);
    if (!panel.pending) this.retired.push([panel, false]);
    const files = [".json", ".values.json", ".answer.json"].map((s) => `${RIFF_DIR()}/${panel.stem}${s}`);
    for (const f of files) delete this.written[f];
    cx.spawn(async (cx) => { await exec("rm", ["-f", ...files]).catch(() => null); cx.notify(); });
    cx.notify();
  }

  // ---- drawing

  isOpen(key, byDefault) {
    if (!this.fold) {
      try { this.fold = JSON.parse(localStorage.getItem("riff-fold") ?? "{}"); } catch { this.fold = {}; }
    }
    return this.fold[key] ?? byDefault;
  }

  toggle(key, byDefault) {
    this.fold[key] = !this.isOpen(key, byDefault);
    try { localStorage.setItem("riff-fold", JSON.stringify(this.fold)); } catch {}
  }

  // The focused pane's agent first, then the rest of its tab: a riff belongs to where you are.
  here() {
    if (demo()) return [this.demoPanel];
    const f = focused();
    const tab = new Set(agents().filter((a) => a.tab === f?.tab).map((a) => a.address));
    // A focused agent shown from another tab (a layout block) still owns its riffs here.
    for (const t of [f?.terminal, f?.agent]) if (t) tab.add(t);
    return [...this.panels.values()]
      .filter((p) => tab.has(p.spec.terminal))
      .sort((a, b) => (b.spec.terminal === f?.terminal) - (a.spec.terminal === f?.terminal) || b.seen - a.seen);
  }

  render() {
    const p = pal();
    this.catchUp();
    const here = this.here();
    const shown = new Set(here.map((x) => x.stem));
    const elsewhere = demo() ? [] : riffs().filter((r) => !shown.has(r.stem));
    // Nothing from this tab: the other tabs' riffs show in full, newest first, so you can answer
    // from here (the answer still goes to the agent that asked); "<who> asks" takes you there.
    const full = here.length ? [] : elsewhere.map((r) => this.panels.get(r.stem)).filter(Boolean).sort((a, b) => b.seen - a.seen);
    const rows = elsewhere.filter((r) => !full.some((x) => x.stem === r.stem));
    const total = here.length + full.length;
    return v_flex()
      .id("riff")
      .size_full()
      .bg(p.col)
      .text_color(p.ink)
      .overflow_y_scrollbar()
      .pb(16)
      .on_hover((_h, cx) => this.makePending(cx))
      .on_mouse_move((_e, cx) => { if ([...this.panels.values()].some((x) => x.pending) || this.retired.length) this.makePending(cx); })
      .on_mouse_down("left", (_e, cx) => this.makePending(cx))
      .when(total > 1, (el) => {
        const all = [...here, ...full];
        const anyOpen = all.some((x, i) => this.isOpen(`r-${x.stem}`, i === 0));
        return el.child(h_flex().px(12).pt(8).justify_end()
          .child(textBtn(p, "riff-fold-all", anyOpen ? "Collapse all" : "Expand all", (_e, cx) => {
            all.forEach((x) => { this.isOpen(`r-${x.stem}`, true); this.fold[`r-${x.stem}`] = !anyOpen; });
            try { localStorage.setItem("riff-fold", JSON.stringify(this.fold)); } catch {}
            cx.notify();
          })));
      })
      .children(here.map((panel, i) => this.riffView(p, panel, i, total)))
      .when(full.length > 0, (el) => el
        .child(div().px(16).pt(12).text_size(12).font_medium().text_color(p.muted).child(`Nothing from this tab · waiting on you elsewhere · ${full.length}`))
        .children(full.map((panel, i) => this.riffView(p, panel, i, total))))
      .when(rows.length > 0, (el) => el.child(this.waitingView(p, rows, full.length > 0 || here.length > 0)))
      .when(!here.length, (el) => el.child(this.emptyView(p, elsewhere.length > 0)))
      .when(!!this.scanError, (el) => el.child(div().px(16).pt(8).text_size(11.5).text_color(STATUS.blocked).child(`Riff couldn't read its folder: ${this.scanError}`)));
  }

  // Who "Ask" sends to: the focused pane's agent. If you're on a pane that isn't one (a dev
  // server, a simulator log, a mod), every agent in the tab, so you can pick which pane to ask.
  askTargets() {
    if (demo()) return [];
    const f = focused();
    const all = agents();
    const here = all.find((a) => a.address === f?.terminal || a.address === f?.agent);
    return here ? [here] : all.filter((a) => a.tab === f?.tab).slice(0, 3);
  }

  // Nothing open in this tab: one line, and a prompt to get one, ready to copy or send to an agent here.
  // While riffs wait elsewhere it folds to one row, so they stay on top.
  emptyView(p, compact) {
    const targets = this.askTargets();
    const open = !compact || this.askOpen;
    const btn = (id, label, onPress, primary) => div().id(id).flex_none().h(26).px(10).flex().items_center().rounded(8).text_size(12).font_medium()
      .bg(primary ? p.ink : p.raised).text_color(primary ? p.ground : p.muted)
      .cursor_pointer().hover((s) => s.opacity(0.9)).active((s) => s.opacity(0.75))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); onPress(cx); })
      .child(label);
    const ask = (a) => (cx) => cx.spawn(async () => {
      const r = await exec("hc", ["send", a.address, SAMPLE]).catch((e) => ({ code: 1, stderr: String(e) }));
      notify(r.code === 0 ? { title: "Asked for a riff", body: askerLabel(a), level: "success", timeout: 2000 } : { title: "Couldn't reach the agent", body: (r.stderr || "").trim().slice(0, 160), level: "warning" });
    });
    // On an agent's pane: "Ask this agent". On another pane: a button per agent in the tab, by name.
    const onAgent = targets.length === 1 && targets[0].address === (focused()?.terminal ?? focused()?.agent);
    const askLabel = (a) => (onAgent ? "Ask this agent" : `Ask ${paneLabel(a) ?? askerLabel(a)}`);
    const title = targets.length > 1 ? "No questions in this tab" : "No questions from this agent";
    return v_flex().flex_none().min_w(0).mx(12).mt(12).p(8).gap(8).rounded(16).bg(p.card)
      .child(h_flex().id("riff-ask-head").px(4).pt(2).gap(6).items_center()
        .when(compact, (el) => el.cursor_pointer().on_mouse_down("left", (_e, cx) => { this.askOpen = !this.askOpen; cx.notify(); }))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(p.muted).child(compact ? "Ask an agent for a riff" : title))
        .when(compact, (el) => el.child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(p.faint))))
      .when(open && !!this.promptOpen, (el) => el
        .child(div().w_full().min_w(0).px(10).py(8).rounded(8).bg(p.ground).text_size(11.5).text_color(p.muted).child(SAMPLE)))
      .when(open, (el) => el
        .child(h_flex().gap(6).justify_end().flex_wrap()
          .child(textBtn(p, "riff-prompt", this.promptOpen ? "Hide prompt" : "Show prompt", (_e, cx) => { this.promptOpen = !this.promptOpen; cx.notify(); }))
          .child(btn("riff-copy", this.copied ? "Copied" : "Copy prompt", (cx) => {
            cx.spawn(async (cx) => {
              await exec("/bin/sh", ["-c", 'printf %s "$1" | pbcopy', "sh", SAMPLE]).catch(() => null);
              this.copied = true; cx.notify();
              await new Promise((r) => cx.timer.after(1500, r));
              this.copied = false; cx.notify();
            });
          }))
          .children(targets.map((a, i) => btn(`riff-ask-${i}`, askLabel(a), ask(a), true)))));
  }

  // Other agents waiting on you: one row each, click to go there. A riff this panel couldn't load
  // says why, instead of vanishing.
  waitingView(p, list, more) {
    return v_flex().flex_none().mt(12)
      .child(div().px(16).pb(4).text_size(12).font_medium().text_color(p.muted).child(`${more ? "Also waiting" : "Waiting on you elsewhere"} · ${list.length}`))
      .children(list.map((r) => {
        const a = agents().find((x) => x.address === r.terminal);
        return h_flex().id(`wait-${r.stem}`).flex_none().mx(4).px(12).py(6).gap(8).items_center().rounded(10).cursor_pointer()
          .hover((s) => s.bg(p.hover))
          .on_mouse_down("left", () => goToRiff(r.terminal))
          .child(dot(STATUS.blocked, 7))
          .child(v_flex().flex_1().min_w(0)
            .child(div().min_w(0).truncate().text_size(12.5).child(r.question))
            .child(div().truncate().text_size(11.5).text_color(p.faint).child(askerLabel(a)))
            .when(!!this.broken?.[r.stem], (el) => el.child(div().w_full().min_w(0).text_size(11.5).text_color(STATUS.blocked).child(`Couldn't show it: ${this.broken[r.stem]}`))));
      }));
  }

  riffView(p, panel, index = 0, total = 1) {
    const agent = agents().find((a) => a.address === panel.spec.terminal);
    const changed = changesOf(panel).length;
    const out = this.outputPath(panel);
    const who = panel.stem === "demo" ? "Product page: new image gallery" : askerLabel(agent);
    const status = panel.answered ? (panel.delivery ?? "Sending…")
      : changed ? plural(changed, "change")
      : out ? `Live → ${tilde(out)}`
      : null;
    // With several riffs waiting, each folds to one line (the first stays open); one riff never folds.
    const key = `r-${panel.stem}`;
    const foldable = total > 1 && !panel.answered;
    const open = !foldable || this.isOpen(key, index === 0);
    const question = panel.spec.question ?? panel.stem;
    return v_flex()
      .flex_none()
      .mt(12)
      .child(v_flex().px(16).gap(2).min_w(0)
        // A riff from another pane in this tab: clicking who asks takes you to that pane.
        .child(h_flex().id(`who-${panel.stem}`).gap(6).items_center().min_w(0)
          .when(!!agent && agent.address !== focused()?.terminal, (el) => el.cursor_pointer()
            .hover((s) => s.opacity(0.8))
            .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); goToRiff(agent.address); }))
          .child(dot(STATUS.blocked, 6))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(p.faint).child(`${who} asks`)))
        .child(h_flex().id(`q-${panel.stem}`).gap(6).items_start().min_w(0)
          .when(foldable, (el) => el.cursor_pointer().on_mouse_down("left", (_e, cx) => { this.toggle(key, index === 0); cx.notify(); }))
          .when(foldable, (el) => el.child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none().mt(4).text_color(p.muted)))
          .child(div().flex_1().min_w(0).text_size(14).font_medium().when(!open, (el) => el.truncate()).child(question))
          .when(!open && changed > 0, (el) => el.child(h_flex().flex_none().gap(4).items_center().h(20)
            .child(div().w(5).h(5).rounded_full().bg(p.accent))
            .child(div().text_size(11).text_color(p.muted).child(String(changed))))))
        .when(open && !!panel.spec.about, (el) => el.child(div().w_full().min_w(0).text_size(11.5).text_color(p.faint).child(panel.spec.about))))
      .when(open && !!panel.error, (el) => el.child(div().w_full().min_w(0).px(16).pt(4).text_size(12).text_color(STATUS.blocked).child(panel.error)))
      // No controls yet (made on your first pointer move here): its values as text.
      .when(open && (panel.pending || panel.broken), (el) => el.child(v_flex().min_w(0).mx(12).mt(8).p(10).gap(6).rounded(16).bg(p.card)
        .children(panel.leaves.map((l) => h_flex().h(32).pl(12).pr(12).gap(8).items_center().rounded(10).bg(p.ground)
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(p.muted).child(l.label))
          .child(div().flex_shrink(1).min_w(0).max_w(140).truncate().text_size(12).font_family("Geist Mono").text_color(p.ink).child(fmt(panel.values[l.path])))))))
      .when(open && !panel.pending && !panel.broken, (el) => el.child(v_flex().min_w(0).mx(12).mt(8).p(10).gap(6).rounded(16).bg(p.card)
        .children(this.nodes(p, panel, panel.nodes))
        .child(div().h(2))
        .child(noteField(p, panel.note, panel.focus === "__note"))
        .when(!!panel.failed, (el) => el.child(v_flex().min_w(0).gap(6).p(8).rounded(8).bg(p.ground)
          .child(div().w_full().min_w(0).text_size(11.5).text_color(STATUS.blocked).child(panel.failed.msg))
          .child(h_flex().justify_end().child(textBtn(p, `retry-${panel.stem}`, "Try again", (_e, cx) => this.answer(panel, cx, panel.failed.status, panel.failed.action))))))
        .when(!!status, (el) => el.child(div().w_full().min_w(0).px(4).text_size(11.5).text_color(p.faint).child(status)))
        .child(h_flex().px(2).pt(2).gap(6).items_center().justify_end().min_w(0)
          .when(changed > 0 && !panel.answered, (el) => el.child(textBtn(p, `rst-${panel.stem}`, "Reset", (_e, cx) => this.reset(panel, cx))))
          .when(!panel.answered, (el) => el.child(textBtn(p, `skip-${panel.stem}`, "Skip", (_e, cx) => this.answer(panel, cx, "skipped"))))
          .child(sendBtn(p, `ans-${panel.stem}`, !panel.answered, !!panel.answered, "Answer", (cx) => this.answer(panel, cx, "answered"))))));
  }

  nodes(p, panel, nodes, depth = 0) {
    return nodes.map((n) => {
      if (n.kind !== "folder" && n.kind !== "group") return this.leaf(p, panel, n);
      // A section is a card of its own: a header (chevron, name, how many you've changed) that
      // folds the controls away. Cards nest one tone apart, so a card inside a card still reads.
      const key = `f-${panel.stem}-${n.path}`;
      const open = this.isOpen(key, !n.collapsed);
      const mine = leavesOf(n.children).filter((l) => VALUE_KINDS.has(l.kind));
      const changed = mine.filter((l) => !same(panel.values[l.path], l.def)).length;
      return v_flex().min_w(0).p(6).gap(6).rounded(14).bg(depth % 2 === 0 ? p.raised : p.card)
        .child(h_flex().id(key).h(32).pl(8).pr(10).gap(8).items_center().min_w(0).rounded(10).cursor_pointer()
          .hover((s) => s.bg(p.hover))
          .on_mouse_down("left", (_e, cx) => { this.toggle(key, !n.collapsed); cx.notify(); })
          .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(p.muted))
          .child(div().flex_1().min_w(0).truncate().text_size(12).font_medium().text_color(p.ink).child(n.label))
          .when(changed > 0, (el) => el.child(h_flex().flex_none().gap(4).items_center()
            .child(div().w(5).h(5).rounded_full().bg(p.accent))
            .child(div().text_size(11).text_color(p.muted).child(String(changed)))))
          .when(changed === 0 && !open, (el) => el.child(div().flex_none().text_size(11).text_color(p.faint).child(String(mine.length)))))
        .when(open, (el) => el.child(v_flex().min_w(0).gap(6).children(this.nodes(p, panel, n.children, depth + 1))));
    });
  }

  leaf(p, panel, l) {
    const v = panel.values[l.path];
    const st = panel.states[l.path];
    const changed = VALUE_KINDS.has(l.kind) && !same(v, l.def);
    const id = (kind) => `${kind}-${panel.stem}-${l.path}`;
    // Every control is one 28px bar, radius 8, the label inside on the left.
    const bar = (kind) => h_flex().id(id(kind)).h(32).pl(12).pr(4).gap(8).items_center().rounded(10).bg(p.ground).min_w(0).overflow_hidden();
    const label = () => h_flex().min_w(0).gap(6).items_center()
      .child(div().min_w(0).truncate().text_size(12).text_color(changed ? p.ink : p.muted).child(l.label))
      .when(changed, (el) => el.child(div().w(5).h(5).flex_none().rounded_full().bg(p.accent)));
    // A field shows its edge only while you type in it.
    const field = (state, opts = {}) => div()
      .id(id("fld"))
      .h(24)
      .px(6)
      .flex()
      .items_center()
      .rounded(8)
      .border_1()
      .border_color(panel.bad?.[l.path] ? STATUS.blocked : panel.focus === l.path ? p.accent : "#00000000")
      .cursor_text()
      .hover((s) => s.bg(p.hover))
      .when(opts.w != null, (el) => el.w(opts.w).flex_none())
      .when(opts.w == null, (el) => el.flex_1().min_w(0))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(state).w_full().text_size(12).text_color(p.ink).when(!!opts.mono, (el) => el.font_family("Geist Mono")));

    switch (l.kind) {
      case "slider": {
        const s = st.slider;
        // DialKit's bar: the fill is the value and the label rides on it.
        // Like DialKit, the line hides while it passes under the label (12px text ≈ 6.6px a character).
        // The measured width is on-screen points, after the person's zoom; the label estimate isn't.
        const w = this.widths?.[id("sz")];
        const zoom = Number(settings()?.zoom) || 1;
        const at = w ? (((Math.min(l.max, Math.max(l.min, v)) - l.min) / (l.max - l.min || 1)) * w) / zoom : null;
        const under = at != null && at > 4 && at < 10 + l.label.length * 6.6 + (changed ? 11 : 0) + 6;
        const line = under ? "#00000000" : changed ? p.accent : p.muted;
        return h_flex().gap(6).items_center()
          .child(div().id(id("sz")).flex_1().min_w(0)
            .on_size_change((size, cx) => {
              this.widths ??= {};
              if (Math.abs((this.widths[id("sz")] ?? 0) - size.width) > 0.5) { this.widths[id("sz")] = size.width; cx.notify(); }
            })
            .child(Slider.new(s).w_full().child(
            SliderTrack.new(s).h(32).w_full().cursor_pointer().child(
              SliderIndicator.new(s)
                .relative().w_full().h_full().rounded(10).bg(p.ground)
                // The value line is the fill's edge: it paints under the label, so text stays readable.
                .range_style((fill) => fill.rounded_l(8).border_r_2().border_color(line).bg(changed ? tint(p.accent, "33") : p.selected))
                .child(h_flex().absolute().top(0).left(10).right(6).h_full().items_center().overflow_hidden().child(label()))
                // The shell paints the thumb above everything: keep it as an invisible grab handle.
                .child(SliderThumb.new(s).id(id("thumb")).w(14).h(32).ml(-7))))))
          .child(field(st.field, { w: 56, mono: true }));
      }
      case "toggle":
        return bar("tg").pr(8).cursor_pointer().hover((s) => s.bg(p.hover))
          .on_mouse_down("left", (_e, cx) => { panel.values[l.path] = !v; this.flush(panel, cx); cx.notify(); })
          .child(div().flex_1().min_w(0).child(label()))
          .child(h_flex().w(36).h(20).flex_none().p(2).rounded(10).bg(v ? p.accent : p.raised).when(!!v, (el) => el.justify_end())
            .child(div().w(16).h(16).rounded(8).bg(v ? "#ffffff" : p.muted)));
      case "color": {
        const ok = HEX.test(String(v).trim());
        return bar("col")
          .child(div().flex_1().min_w(0).child(label()))
          .child(div().w(18).h(18).flex_none().rounded(5).border_1().border_color("#ffffff1a").when(ok, (el) => el.bg(String(v).trim())))
          .child(field(st.field, { w: 96, mono: true }));
      }
      case "text":
      case "numbers":
        return bar("txt").child(h_flex().flex_shrink(1).min_w(0).max_w(110).child(label())).child(field(st.field, { mono: l.kind === "numbers" }));
      case "select": {
        const seg = (o) => div().id(id(`opt-${o.value}`)).h(26).px(10).min_w(0).truncate().flex().items_center().rounded(8).text_size(12).cursor_pointer()
          .when(v === o.value, (el) => el.bg(p.raised))
          .text_color(v === o.value ? p.ink : p.faint)
          .hover((s) => s.text_color(p.ink))
          .active((s) => s.opacity(0.8))
          .on_mouse_down("left", (_e, cx) => { panel.values[l.path] = o.value; this.flush(panel, cx); cx.notify(); });
        // Short lists sit on the bar, segmented (22 + 3 + 3 = 28: radius 6 inside 8 at 2px in); long ones wrap below.
        const fits = l.options.length <= 3 && l.options.reduce((n, o) => n + o.label.length + 3, l.label.length) <= 30;
        if (fits) return bar("sel").pr(3).child(div().flex_1().min_w(0).child(label())).children(l.options.map((o) => seg(o).child(o.label)));
        return v_flex().gap(6).p(3).rounded(10).bg(p.ground).min_w(0)
          .child(h_flex().h(26).pl(9).items_center().min_w(0).child(label()))
          .child(h_flex().flex_wrap().gap(2).min_w(0).children(l.options.map((o) => seg(o).child(o.label))));
      }
      case "action":
        return h_flex().id(id("act")).h(32).px(12).items_center().justify_center().rounded(10).bg(p.raised)
          .text_size(12).text_color(p.muted).cursor_pointer().hover((s) => s.text_color(p.ink)).active((s) => s.opacity(0.8))
          .on_mouse_down("left", (_e, cx) => this.answer(panel, cx, "answered", l))
          .child(l.label);
      default:
        return div().w_full().min_w(0).px(10).text_size(11.5).text_color(p.faint).child(`${l.label}: ${l.why}`);
    }
  }
}

// A theme color with an alpha, when it's plain #rrggbb.
const tint = (color, alpha) => (/^#[0-9a-f]{6}$/i.test(color) ? color + alpha : color);

// The note: a field of its own, full width.
function noteField(p, state, focus) {
  return h_flex().flex_none().min_w(0).px(8).h(40).items_center().rounded(12).border_1()
    .border_color(focus ? p.accent : p.line).bg(p.ground).cursor_text()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .child(div().flex_1().min_w(0).child(Input.new(state).w_full().text_size(12).text_color(p.ink)));
}

// The send button: its own row, so a narrow panel never squeezes the note.
function sendBtn(p, id, can, busy, label, onSend) {
  return h_flex().id(`btn-${id}`).flex_none().h(32).pl(12).pr(14).gap(6).items_center().rounded(10).text_size(12.5).font_medium()
    .bg(can ? p.ink : p.raised)
    .text_color(can ? p.ground : p.faint)
    .when(can, (el) => el.cursor_pointer().hover((s) => s.opacity(0.9)).active((s) => s.opacity(0.75)))
    .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); if (can) onSend(cx); })
    .child(svg(ICON(busy ? "spinner" : "message")).size(13))
    .child(label);
}

function textBtn(p, id, label, onPress) {
  return div().id(id).flex_none().h(22).px(6).flex().items_center().rounded(6).text_size(11.5).text_color(p.faint).cursor_pointer()
    .hover((s) => s.bg(p.hover).text_color(p.ink))
    .active((s) => s.opacity(0.8))
    .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); onPress(e, cx); })
    .child(label);
}
