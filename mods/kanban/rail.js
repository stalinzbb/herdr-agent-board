// The dev panel: dev servers (yours from dev.json, plus anything else listening),
// iOS simulators, connected iPhones, Android emulators.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, terminals, run, notify, appHome, shared, setShared } from "herdr";
import { ICON, STATUS, KIND, pal, dot, iconBtn, expand, tilde, readConfig, editConfig } from "./ui.js";

const DEV_COMMANDS = new Set(["node", "bun", "deno", "python", "python3", "Python", "ruby", "java", "php", "go", "vite", "next-serv", "esbuild"]);
const termName = (id) => `dev-${id}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 32);

export class Rail {
  constructor() {
    this.cfg = { servers: [] };
    this.listen = []; // { port, pid, cmd, cwd }
    this.sims = []; // { udid, name, os, booted }
    this.phones = []; // { name, os, online }
    this.droid = { avds: [], running: [], adb: null, emulator: null };
    this.crashed = {};
    this.wasLive = {};
    this.stopping = new Set();
    this.busy = new Set();
    this.showAllSims = false;
  }

  start(cx) {
    cx.spawn(async (cx) => {
      this.cfg = await readConfig("dev", { servers: [] });
      const sdk = expand(this.cfg.android_sdk ?? "~/Library/Android/sdk");
      this.droid.adb = `${sdk}/platform-tools/adb`;
      this.droid.emulator = `${sdk}/emulator/emulator`;
      await Promise.all([this.pollPorts(), this.pollSims(), this.pollPhones(), this.pollAndroid()]);
      cx.notify();
    });
    cx.timer.every(4000, (cx) => cx.spawn(async (cx) => { await this.pollPorts(); cx.notify(); }));
    cx.timer.every(8000, (cx) => cx.spawn(async (cx) => { await Promise.all([this.pollSims(), this.pollAndroid()]); cx.notify(); }));
    // xctrace takes a few seconds: phones are checked rarely.
    cx.timer.every(30000, (cx) => cx.spawn(async (cx) => { await this.pollPhones(); cx.notify(); }));
  }

  async pollPorts() {
    try {
      const r = await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]);
      const out = [];
      let pid = null, cmd = null;
      for (const line of r.stdout.split("\n")) {
        const k = line[0], v = line.slice(1);
        if (k === "p") pid = v;
        else if (k === "c") cmd = v;
        else if (k === "n") {
          const port = Number(v.split(":").pop());
          if (port && !out.some((o) => o.port === port)) out.push({ port, pid, cmd });
        }
      }
      const dev = out.filter((o) => o.port >= 1024 && o.port < 10000 && DEV_COMMANDS.has(o.cmd));
      const pids = [...new Set(dev.map((o) => o.pid))];
      if (pids.length) {
        const c = await exec("lsof", ["-a", "-d", "cwd", "-Fpn", "-p", pids.join(",")]);
        let cur = null;
        const cwd = {};
        for (const line of c.stdout.split("\n")) {
          if (line[0] === "p") cur = line.slice(1);
          else if (line[0] === "n" && cur) cwd[cur] = line.slice(1);
        }
        for (const o of dev) o.cwd = cwd[o.pid];
      }
      this.ports = new Set(out.map((o) => o.port));
      this.listen = dev.sort((a, b) => a.port - b.port);
    } catch {
      this.ports = new Set();
      this.listen = [];
    }
  }

  async pollSims() {
    try {
      const r = await exec("xcrun", ["simctl", "list", "devices", "available", "-j"]);
      const all = [];
      for (const [rt, devs] of Object.entries(JSON.parse(r.stdout).devices ?? {})) {
        const m = rt.match(/SimRuntime\.iOS-(\d+)-(\d+)/);
        if (!m) continue;
        for (const d of devs) all.push({ udid: d.udid, name: d.name, os: `iOS ${m[1]}.${m[2]}`, v: Number(m[1]) * 100 + Number(m[2]), booted: d.state === "Booted", iphone: d.name.startsWith("iPhone") });
      }
      this.sims = all;
    } catch {
      this.sims = [];
    }
  }

  async pollPhones() {
    try {
      const r = await exec("xcrun", ["xctrace", "list", "devices"]);
      const phones = [];
      let section = null;
      for (const line of r.stdout.split("\n")) {
        const h = line.match(/^== (.+) ==$/);
        if (h) { section = h[1]; continue; }
        if (section !== "Devices" && section !== "Devices Offline") continue;
        const m = line.match(/^(.+?) \(([\d.]+)\) \(([0-9A-Fa-f-]+)\)$/);
        if (m) phones.push({ name: m[1], os: `iOS ${m[2]}`, online: section === "Devices" });
      }
      this.phones = phones;
    } catch {
      this.phones = [];
    }
  }

  async pollAndroid() {
    try {
      const [a, d] = await Promise.all([
        exec(this.droid.emulator, ["-list-avds"]).catch(() => ({ stdout: "" })),
        exec(this.droid.adb, ["devices"]).catch(() => ({ stdout: "" })),
      ]);
      this.droid.avds = a.stdout.split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("INFO"));
      this.droid.running = d.stdout.split("\n").slice(1).map((l) => l.split(/\s+/)).filter((p) => p[0] && p[1] === "device").map((p) => p[0]);
    } catch {
      this.droid.avds = [];
      this.droid.running = [];
    }
  }

  // ---- servers

  serverState(s) {
    const t = terminals().find((t) => t.name === termName(s.id) && t.state === "live");
    const up = s.port ? this.ports?.has(s.port) : !!t;
    if (t) {
      this.wasLive[s.id] = true;
      delete this.crashed[s.id];
    } else if (this.wasLive[s.id]) {
      delete this.wasLive[s.id];
      if (!this.stopping.delete(s.id)) {
        this.crashed[s.id] = true;
        notify({ title: `${s.name} stopped`, body: "It exited on its own. Start it again from the dev panel.", level: "error" });
      }
    }
    if (t) return { term: t.address, word: up ? "Running" : "Starting", color: up ? STATUS.done : STATUS.working, up };
    if (up) return { word: "Running outside Herdr", color: STATUS.done, up };
    if (this.crashed[s.id]) return { word: "Crashed", color: STATUS.blocked };
    return { word: "Stopped", color: STATUS.idle };
  }

  startServer(s, cx) {
    const cmd = s.argv.map((a) => (/^[\w./:=@-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(" ");
    this.busy.add(s.id);
    cx.spawn(async (cx) => {
      // A login, interactive zsh: the same PATH (nvm, yarn) as your own terminals.
      const r = await exec("hc", ["run", "--bg", "--no-parent", "--name", termName(s.id), "--label", `kanban.dev=${s.id}`, "--cwd", expand(s.folder), "--", "/bin/zsh", "-lic", cmd]).catch((e) => ({ code: 1, stderr: String(e) }));
      this.busy.delete(s.id);
      if (r.code !== 0) notify({ title: `Couldn't start ${s.name}`, body: (r.stderr || r.stdout || "").trim().slice(0, 200), level: "error" });
      cx.notify();
    });
  }

  stopServer(s, st) {
    this.stopping.add(s.id);
    run("terminal.kill", { terminal: st.term });
  }

  reload(s, cx) {
    cx.spawn(async () => {
      const r = await exec("curl", ["-fsS", "-m", "3", `http://localhost:${s.port}/reload`]).catch(() => ({ code: 1 }));
      notify(r.code === 0 ? { title: "Reloading the app", level: "info", timeout: 2000 } : { title: "Reload didn't reach Metro", body: "Is an app connected to it?", level: "warning" });
    });
  }

  // ---- devices

  simAction(sim, cx) {
    this.busy.add(sim.udid);
    cx.spawn(async (cx) => {
      if (sim.booted) await exec("xcrun", ["simctl", "shutdown", sim.udid]).catch(() => null);
      else {
        await exec("xcrun", ["simctl", "boot", sim.udid]).catch(() => null);
        await exec("open", ["-a", "Simulator"]).catch(() => null);
      }
      await this.pollSims();
      this.busy.delete(sim.udid);
      cx.notify();
    });
  }

  bootAvd(avd, cx) {
    this.busy.add(avd);
    cx.spawn(async (cx) => {
      await exec("hc", ["run", "--bg", "--no-parent", "--name", termName("emu-" + avd), "--", this.droid.emulator, "-avd", avd]).catch(() => null);
      this.busy.delete(avd);
      cx.notify();
    });
  }

  // ---- drawing

  isOpen(key, byDefault) {
    if (!this.fold) {
      try { this.fold = JSON.parse(localStorage.getItem("fold") ?? "{}"); } catch { this.fold = {}; }
    }
    return this.fold[key] ?? byDefault;
  }

  toggle(key, byDefault) {
    this.fold[key] = !this.isOpen(key, byDefault);
    try { localStorage.setItem("fold", JSON.stringify(this.fold)); } catch {}
  }

  // A folding section: header with a one-line summary, then its rows when open.
  section(p, key, label, summary, rows, byDefault = true, action = null) {
    const open = this.isOpen(key, byDefault);
    const head = h_flex()
      .id(`sec-${key}`)
      .flex_none()
      .h(34)
      .mt(6)
      .mx(4)
      .px(8)
      .gap(6)
      .items_center()
      .rounded(9)
      .cursor_pointer()
      .hover((s) => s.bg(p.hover))
      .on_mouse_down("left", (_e, cx) => { this.toggle(key, byDefault); cx.notify(); })
      .child(div().w(10).text_size(10).text_color(p.faint).child(open ? "▾" : "▸"))
      .child(div().text_size(12.5).font_semibold().text_color(p.muted).child(label))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(p.faint).child(summary))
      .when(!!action, (el) => el.child(action));
    return open ? [head, ...rows] : [head];
  }

  // What's running, for the board's cards. Only written when it changes (every write re-renders all mods).
  publish(states, others, booted) {
    const value = {
      servers: states.filter(([, st]) => st.up || st.term).map(([s, st]) => ({
        id: s.id, name: s.name, folder: expand(s.folder), port: s.port ?? null, url: s.url ?? null, term: st.term ?? null, devices: !!s.devices,
      })),
      others: others.map((o) => ({ port: o.port, cmd: o.cmd, cwd: o.cwd ?? null })),
      sims: booted.map((s) => ({ name: s.name, os: s.os })),
      android: this.droid.running,
    };
    const text = JSON.stringify(value);
    if (text !== this.published) {
      this.published = text;
      if (JSON.stringify(shared("kanban.dev")) !== text) setShared("kanban.dev", value);
    }
  }

  render(cx) {
    const p = pal();
    const servers = this.cfg.servers ?? [];
    const known = new Set(servers.map((s) => s.port).filter(Boolean));
    const others = this.listen.filter((o) => !known.has(o.port));
    const booted = this.sims.filter((s) => s.booted);
    const newest = Math.max(0, ...this.sims.map((s) => s.v));
    const offer = this.sims
      .filter((s) => !s.booted && (this.showAllSims ? true : s.iphone && s.v === newest))
      .sort((a, b) => b.v - a.v || a.name.localeCompare(b.name))
      .slice(0, this.showAllSims ? 40 : 3);
    const states = servers.map((s) => [s, this.serverState(s)]);
    this.publish(states, others, booted);
    const live = states.filter(([, st]) => st.up || st.term || st.word === "Crashed");
    const idle = states.filter(([, st]) => !(st.up || st.term || st.word === "Crashed"));
    const online = this.phones.filter((d) => d.online);
    const offline = this.phones.filter((d) => !d.online);

    const serverRow = ([s, st]) => {
      const busy = this.busy.has(s.id);
      const actions = [];
      if (st.term) actions.push(iconBtn(`logs-${s.id}`, "terminal", () => run("terminal.peek", { terminal: st.term }), p));
      if (st.up && s.reload) actions.push(iconBtn(`reload-${s.id}`, "reload", (_e, cx) => this.reload(s, cx), p));
      if (st.up && (s.url || s.port)) actions.push(iconBtn(`open-${s.id}`, "external", () => exec("open", [s.url ?? `http://localhost:${s.port}`]), p));
      if (st.term) actions.push(iconBtn(`stop-${s.id}`, "square", () => this.stopServer(s, st), p));
      else if (!st.up) actions.push(iconBtn(`start-${s.id}`, busy ? "spinner" : "play", (_e, cx) => !busy && this.startServer(s, cx), p));
      return row(p, `srv-${s.id}`, st.color, s.name, [s.project, s.port ? `:${s.port}` : null, st.word].filter(Boolean).join(" · "), actions, !st.up && !st.term && st.word !== "Crashed");
    };

    // What's running now: the only thing shown until you open the rest.
    const running = [
      ...live.map(serverRow),
      ...others.map((o) =>
        row(p, `port-${o.port}`, KIND.port.color, `:${o.port}  ${o.cmd}`, tilde(o.cwd) ?? `pid ${o.pid}`, [
          iconBtn(`open-port-${o.port}`, "external", () => exec("open", [`http://localhost:${o.port}`]), p),
        ])),
      ...booted.map((s) =>
        row(p, `sim-${s.udid}`, KIND.device.color, s.name, `${s.os} · Simulator`, [
          iconBtn(`simapp-${s.udid}`, "external", () => exec("open", ["-a", "Simulator"]), p),
          iconBtn(`simoff-${s.udid}`, this.busy.has(s.udid) ? "spinner" : "power", (_e, cx) => this.simAction(s, cx), p),
        ])),
      ...online.map((d, i) => row(p, `phone-on-${i}`, KIND.device.color, d.name, `${d.os} · Connected`, [])),
      ...this.droid.running.map((serial) =>
        row(p, `adb-${serial}`, KIND.device.color, serial, "Android emulator", [
          iconBtn(`adboff-${serial}`, "power", () => exec(this.droid.adb, ["-s", serial, "emu", "kill"]), p),
        ])),
    ];

    // Everything that could run, folded.
    const sub = (label) => div().px(12).pt(10).pb(2).text_size(11.5).text_color(p.faint).child(label);
    const rest = [];
    if (idle.length) rest.push(sub("Servers"), ...idle.map(serverRow));
    if (offer.length || !this.showAllSims) {
      rest.push(sub("iOS simulators"), ...offer.map((s) =>
        row(p, `sim-${s.udid}`, null, s.name, s.os, [
          iconBtn(`simon-${s.udid}`, this.busy.has(s.udid) ? "spinner" : "play", (_e, cx) => this.simAction(s, cx), p),
        ], true)));
      rest.push(div().id("sims-more").mx(12).mt(2).text_size(12).text_color(p.faint).cursor_pointer().hover((s) => s.text_color(p.ink))
        .on_mouse_down("left", (_e, cx) => { this.showAllSims = !this.showAllSims; cx.notify(); })
        .child(this.showAllSims ? "Show fewer" : "All simulators"));
    }
    if (this.droid.avds.length) rest.push(sub("Android emulators"), ...this.droid.avds.map((avd) =>
      row(p, `avd-${avd}`, null, avd.replace(/_/g, " "), "Emulator", [
        iconBtn(`avdon-${avd}`, this.busy.has(avd) ? "spinner" : "play", (_e, cx) => this.bootAvd(avd, cx), p),
      ], true)));
    if (offline.length) rest.push(sub("Devices"), ...offline.map((d, i) => row(p, `phone-off-${i}`, null, d.name, `${d.os} · Offline`, [], true)));
    const restSummary = [
      idle.length && `${idle.length} server${idle.length > 1 ? "s" : ""}`,
      `${this.sims.filter((s) => !s.booted).length} simulators`,
      this.droid.avds.length && `${this.droid.avds.length} emulator${this.droid.avds.length > 1 ? "s" : ""}`,
      offline.length && `${offline.length} offline`,
    ].filter(Boolean).join(" · ");

    return v_flex()
      .id("rail")
      .size_full()
      .bg(p.col)
      .text_color(p.ink)
      .overflow_y_scrollbar()
      .pb(12)
      .child(
        h_flex().flex_none().h(36).mt(6).px(12).gap(8).items_center()
          .child(div().text_size(12.5).font_semibold().text_color(p.muted).child("Running"))
          .child(div().flex_1().text_size(12).text_color(p.faint).child(String(running.length)))
          .child(iconBtn("edit-dev", "logs", () => editConfig("dev"), p, { label: "Servers" })))
      .when(!!this.cfg.error, (el) => el.child(note(p, `dev.json: ${this.cfg.error}`, STATUS.blocked)))
      .children(running.length ? running : [note(p, "Nothing running. Start a server or a simulator below.")])
      .child(div().h(1).mx(12).mt(10).bg(p.line))
      .children(this.section(p, "rest", "Not running", restSummary, rest, false));
  }
}

function section(p, label, action) {
  return h_flex()
    .flex_none()
    .h(36)
    .mt(8)
    .px(12)
    .items_center()
    .child(div().flex_1().text_size(12.5).font_semibold().text_color(p.muted).child(label))
    .when(!!action, (el) => el.child(action));
}

function sub(p, label) {
  return div().px(12).pt(8).pb(2).text_size(12).text_color(p.faint).child(label);
}

function note(p, text, color) {
  return div().px(12).py(4).text_size(12).text_color(color ?? p.faint).child(text);
}

function row(p, id, color, title, meta, actions, quiet = false) {
  return h_flex()
    .id(id)
    .flex_none()
    .mx(4)
    .px(8)
    .h(40)
    .gap(8)
    .items_center()
    .rounded(10)
    .hover((s) => s.bg(p.hover))
    .child(color ? dot(color) : div().w(7).h(7).rounded_full().flex_none().border_1().border_color(p.faint))
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .child(div().truncate().text_size(13).text_color(quiet ? p.muted : p.ink).child(title))
        .when(!!meta, (el) => el.child(div().truncate().text_size(11.5).text_color(p.faint).child(meta))))
    .child(h_flex().flex_none().gap(2).children(actions));
}
