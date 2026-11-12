// The sidebar: your sessions by project. Two more ways to read the same sessions, Turn and Kind, are
// written but switched off (MORE_VIEWS); with them on, a switch on top picks one (remembered, shared
// "kanban.side.view"):
//   Project - repo > branch > session, with running subagents under their agent (tree.js finds them).
//   Turn    - whose turn it is, like the board: each session with what's attached to it under it
//             (its riff, its ports and devices, its panes), then tasks in progress nobody is on.
//   Kind    - by what there is to look at: riffs, questions, ports, sessions and their panes, tasks.
//             A section only shows while it has something in it.
// A session is a tab. Its ports come from the Dev panel (shared "kanban.dev"), its riff from the
// bar's watcher (shared "kanban.riffs"), its task from the Tasks panel's cache, matched by the
// ticket key in the tab's name or branch.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, run, exec, home, appHome, shared, setShared, readTextFile, watchFolder, knownAgents } from "herdr";
import { ICON, STATUS, pal, dot, progIcon, tilde, ago, iconBtn, USER_CONFIG } from "./ui.js";
import { gitInfo } from "./git.js";
import { riffs, goToRiff } from "./riffs.js";
import { railTo, railShows } from "./railtabs.js";
import { Tree, model } from "./tree.js";

// What's attached to a session, by color. The same hues as ui.js KIND where that exists.
const K = { riff: "#a78bfa", port: "#2dd4bf", device: "#f472b6", task: "#4c9aff" };
const tint = (c, a = "26") => c + a;

const VIEWS = [
  { id: "project", label: "Project", tip: "By project: repo, branch, agent, subagents" },
  { id: "turn", label: "Turn", tip: "By whose turn it is, with each session's riff, ports and panes" },
  { id: "kind", label: "Kind", tip: "By what there is: riffs, questions, ports, sessions, tasks" },
];
const DAY = 24 * 60 * 60000;
const TASKS_SHOWN = 5;

// Which view shows: shared, so a key can pick one too (kanban.side_project / side_turn / side_kind).
// Turn and Kind are off for now: the sidebar is the projects, with no switch. Set to true to bring them back.
const MORE_VIEWS = false;
const view = () => (MORE_VIEWS && VIEWS.some((v) => v.id === shared("kanban.side.view")) ? shared("kanban.side.view") : "project");

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const base = (p) => (p ?? "").replace(/\/+$/, "").split("/").pop();
// A pane title worth showing: not the program's name, a path, user@host or the terminal's own id (t5h).
const telling = (t, prog, term) => !!t && t !== prog && t !== term && !/^[~/]/.test(t) && !/^t\d+$/.test(t) && !t.includes("@");
const isAgent = (p) => !!(p.status && p.terminal);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function dur(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d`;
}

// The running servers (and, through them, simulators) whose folder one of these folders is in.
function devFor(folders) {
  const dev = shared("kanban.dev");
  if (!dev) return { servers: [], others: [], sims: [], android: [] };
  const h = home();
  const near = (a, b) => a && b && a !== h && b !== h && (a === b || a.startsWith(b + "/") || b.startsWith(a + "/"));
  const hits = (folder) => folders.some((f) => near(f, folder));
  const servers = (dev.servers ?? []).filter((s) => hits(s.folder));
  const devices = servers.some((s) => s.devices);
  return { servers, others: (dev.others ?? []).filter((o) => hits(o.cwd)), sims: devices ? dev.sims ?? [] : [], android: devices ? dev.android ?? [] : [] };
}

const taskFits = (t, tab, branch) =>
  t.source === "local"
    ? tab.named && tab.name === (t.summary ?? "").slice(0, 48)
    : new RegExp(`(^|[^A-Za-z0-9])${esc(t.key)}([^A-Za-z0-9]|$)`, "i").test(`${tab.named ? tab.name : ""} ${branch ?? ""}`);

// One per tab: what it is, whose turn, and what's attached.
function sessions(tasks) {
  const all = panes();
  const terms = terminals();
  const open = riffs();
  const out = [];
  for (const s of spaces()) {
    for (const tab of s.tabs) {
      const mine = all.filter((p) => p.tab === tab.id);
      if (!mine.length) continue;
      const ag = mine.filter(isAgent);
      const lead = ag[0] ?? mine.find((p) => p.focused) ?? mine[0];
      const live = clean(lead.title);
      const prog = lead.program?.name;
      const g = gitInfo(lead.cwd);
      // Any pane's riff counts: the one asking may no longer report a status.
      const riff = open.find((r) => mine.some((p) => p.terminal === r.terminal)) ?? null;
      const turn = tab.settled ? "done" : riff || tab.status === "blocked" ? "ask" : tab.status === "working" ? "working" : tab.status === "done" ? "new" : ag.length ? "ready" : "shell";
      const branch = lead.branch && lead.branch !== "HEAD" ? lead.branch : null;
      out.push({
        space: s, tab, lead, panes: mine, turn, riff, branch,
        title: tab.named ? tab.name : telling(live, prog, lead.terminal) && live !== tab.name ? live : ag.length ? prog ?? `Tab ${tab.name}` : base(lead.cwd) || prog || `Tab ${tab.name}`, // a plain terminal: its folder
        repo: g?.repo ?? (s.name === "~" ? "Home" : s.name),
        top: g?.top ?? lead.cwd ?? s.folder ?? "",
        linked: !!g?.linked,
        dev: devFor([...new Set(mine.map((p) => p.cwd).filter(Boolean))]),
        subs: terms.filter((t) => t.state === "live" && t.parent && ag.some((p) => p.terminal === t.parent)).length,
        task: tasks.find((t) => taskFits(t, tab, branch)) ?? null,
        current: s.active && tab.active,
        quiet: !!tab.changed_at && Date.now() - tab.changed_at > DAY,
      });
    }
  }
  return out;
}

const RANK = { ask: 0, new: 1, ready: 2, shell: 3 };
const TURN_COLOR = { ask: STATUS.blocked, working: STATUS.working, new: STATUS.done, ready: STATUS.idle, done: STATUS.idle };
const byTurn = (a, b) => RANK[a.turn] - RANK[b.turn] || (b.tab.changed_at ?? 0) - (a.tab.changed_at ?? 0);

function openSession(s, pane) {
  if (s.riff && !pane) return goToRiff(s.riff.terminal);
  run("space.select", { id: s.space.id });
  run("tab.select", { id: s.tab.id });
  if (pane) run("pane.focus", { pane });
}

// ---- rows

const line = (p, id, depth, onPress, h = 24) =>
  h_flex().id(id).flex_none().w_full().min_h(h).pl(8 + depth * 14).pr(8).gap(6).items_center().rounded(8)
    .when(!!onPress, (el) => el.cursor_pointer().hover((st) => st.bg(p.hover)).on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); onPress(cx); }));

const txt = (s, color, size = 11.5) => div().min_w(0).truncate().text_size(size).text_color(color).child(s);
const aside = (p, s) => div().flex_none().whitespace_nowrap().text_size(11).text_color(p.faint).child(s);
const pill = (color, s) => div().flex_none().px(5).h(16).flex().items_center().rounded(8).bg(tint(color)).text_size(10.5).font_medium().text_color(color).whitespace_nowrap().child(s);
const hollow = (p) => div().w(7).h(7).flex_none().rounded_full().border_1().border_color(p.faint);

function heading(p, color, label, n, action) {
  return h_flex().flex_none().w_full().h(28).mt(6).px(8).gap(6).items_center()
    .child(dot(color, 6))
    .child(div().text_size(11.5).font_semibold().text_color(p.muted).child(label))
    .child(div().text_size(11).text_color(p.faint).child(String(n)))
    .child(div().flex_1())
    .when(!!action, (el) => el.child(action));
}

const when = (s) => (s.turn === "working" && s.tab.working_since ? dur(Date.now() - s.tab.working_since) : s.tab.changed_at ? ago(Date.now() - s.tab.changed_at) : null);

// What a session has going on, in words: one small pill per kind, each kind in its own color
// (violet a riff, red a question, teal a running server, pink a device, blue the task it's on).
// Hover says more; a riff's pill opens it, a server's opens its page.
function marks(p, s, skip = [], tag = "s") {
  const ports = [
    ...s.dev.servers.map((v) => ({ text: v.port ? `:${v.port}` : v.name, tip: `${v.name} is running here${v.port ? ` on :${v.port}` : ""}`, go: () => exec("open", [v.url ?? `http://localhost:${v.port}`]) })),
    ...s.dev.others.map((o) => ({ text: `:${o.port}`, tip: `${o.cmd} is listening on :${o.port} here`, go: () => exec("open", [`http://localhost:${o.port}`]) })),
  ];
  const devices = [...s.dev.sims.map((x) => x.name), ...s.dev.android.map((a) => a.replace(/^emulator-/, "Android "))];
  const list = [
    s.riff && { kind: "riff", color: K.riff, text: "riff", tip: `Riff: ${s.riff.question}`, go: () => goToRiff(s.riff.terminal) },
    !s.riff && s.turn === "ask" && { kind: "ask", color: STATUS.blocked, text: "asks you", tip: "Waiting on your answer" },
    ...ports.slice(0, 2).map((x, i) => ({ kind: "port", id: `port${i}`, color: K.port, ...x })),
    ports.length > 2 && { kind: "port", id: "portn", color: K.port, text: `+${ports.length - 2}`, tip: ports.slice(2).map((x) => x.text).join(", ") },
    devices.length && { kind: "device", color: K.device, text: devices.length > 1 ? `${devices.length} devices` : "device", tip: `In use: ${devices.join(", ")}` },
    s.task && { kind: "task", color: K.task, text: s.task.source === "local" ? "task" : s.task.key, tip: s.task.summary },
  ].filter((m) => m && !skip.includes(m.kind));
  return list.map((m) => pill(m.color, m.text).id(`mk${tag}-${s.tab.id}-${m.id ?? m.kind}`).tooltip(m.tip)
    .when(!!m.go, (el) => el.cursor_pointer().hover((st) => st.opacity(0.8)).on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); m.go(); })));
}

// The pills, on their own line under a session's title (so the title keeps its width). Null when none.
function markRow(p, s, depth, tag) {
  const list = marks(p, s, [], tag);
  return list.length ? h_flex().flex_none().w_full().min_h(20).pl(8 + depth * 14 + 32).pr(8).pb(2).gap(4).flex_wrap().items_center().children(list) : null;
}

// A session's first row: status, agent, title, what it has going on, how long.
function sessionRow(p, s, depth = 0, tag = "ss") {
  return line(p, `${tag}-${s.tab.id}`, depth, () => openSession(s), 26)
    .when(s.current, (el) => el.bg(p.raised))
    .child(s.turn === "shell" ? hollow(p) : dot(TURN_COLOR[s.turn], 7))
    .child(progIcon(s.lead.program, 13, p.muted))
    .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(s.turn === "shell" || s.turn === "done" ? p.muted : p.ink).child(s.title))
    .when(s.panes.length > 1, (el) => el.child(aside(p, `${s.panes.length} panes`)))
    .when(!!when(s), (el) => el.child(aside(p, when(s))));
}

// Where it works, and the ticket it's on.
function whereRow(p, s, depth) {
  return line(p, `sw-${s.tab.id}`, depth, null, 18).tooltip(tilde(s.lead.cwd ?? ""))
    .child(txt(s.repo, p.faint, 11).flex_none().max_w(110))
    .when(!!s.branch, (el) => el.child(svg(ICON(s.linked ? "layers" : "branch")).size(11).flex_none().text_color(p.faint)).child(txt(s.branch, p.faint, 11)))
    .child(div().flex_1())
    .when(!!s.task && s.task.source !== "local", (el) => el.child(pill(K.task, s.task.key)));
}

function riffRow(p, s, depth, label = "Your call") {
  return line(p, `sr-${s.tab.id}`, depth, () => goToRiff(s.riff.terminal))
    .child(dot(K.riff, 6))
    .child(div().flex_none().text_size(11.5).font_medium().text_color(K.riff).child(label))
    .child(txt(s.riff.question, p.muted));
}

function portRows(p, s, depth) {
  const open = (url) => exec("open", [url]);
  return [
    ...s.dev.servers.map((v) => line(p, `sp-${s.tab.id}-${v.id}`, depth, () => (v.term ? run("terminal.peek", { terminal: v.term }) : open(v.url ?? `http://localhost:${v.port}`)))
      .child(dot(K.port, 6)).child(txt(v.port ? `:${v.port}` : "server", K.port).flex_none()).child(txt(v.name, p.muted))),
    ...s.dev.others.map((o) => line(p, `so-${s.tab.id}-${o.port}`, depth, () => open(`http://localhost:${o.port}`))
      .child(dot(K.port, 6)).child(txt(`:${o.port}`, K.port).flex_none()).child(txt(o.cmd, p.muted))),
    ...[...s.dev.sims.map((x) => x.name), ...s.dev.android.map((a) => a.replace(/^emulator-/, "Android "))].map((name, i) =>
      line(p, `sd-${s.tab.id}-${i}`, depth, () => exec("open", ["-a", "Simulator"])).child(dot(K.device, 6)).child(txt(name, p.muted))),
  ];
}

// Each pane of a tab that has several: what runs in it, and where if that isn't the tab's branch.
function paneRows(p, s, depth) {
  if (s.panes.length < 2) return [];
  return s.panes.map((x) => {
    const t = clean(x.title);
    const name = telling(t, x.program?.name, x.terminal) ? t : x.program?.name ?? (x.mod ? x.mod : "terminal");
    const where = x.branch && x.branch !== s.branch ? x.branch : x.cwd && (x.cwd !== s.lead.cwd || !isAgent(x)) ? base(x.cwd) : null;
    return line(p, `pn-${x.pane}`, depth, () => openSession(s, x.pane), 22)
      .when(x.focused && s.current, (el) => el.bg(p.raised))
      .child(isAgent(x) ? dot(STATUS[x.status === "error" ? "blocked" : x.status] ?? STATUS.idle, 5) : div().w(5).flex_none())
      .child(progIcon(x.program, 12, p.faint))
      .child(txt(name, isAgent(x) ? p.muted : p.faint).flex_1())
      .when(!!where, (el) => el.child(aside(p, where)));
  });
}

// Everything under a session's first row.
function attached(p, s, depth) {
  const rows = [whereRow(p, s, depth)];
  if (s.riff) rows.push(riffRow(p, s, depth));
  else if (s.turn === "ask") rows.push(line(p, `sa-${s.tab.id}`, depth, null).child(dot(STATUS.blocked, 6)).child(txt("Needs your answer", "#f2a0ae")));
  else if (s.turn === "new") rows.push(line(p, `sn-${s.tab.id}`, depth, null).child(dot(STATUS.done, 6)).child(txt("Finished · not seen yet", "#7fd9a6")));
  if (s.subs) rows.push(line(p, `sb-${s.tab.id}`, depth, null).child(dot(STATUS.working, 5)).child(txt(`${s.subs} subagent${s.subs > 1 ? "s" : ""} running`, p.faint)));
  rows.push(...portRows(p, s, depth), ...paneRows(p, s, depth));
  return rows;
}

const block = (rows) => v_flex().flex_none().w_full().gap(1).children(rows);
const quietText = (p, s) => div().px(8).py(6).text_size(12).text_color(p.faint).child(s);

export class Sidebar {
  constructor() {
    this.tree = new Tree(false);
    this.tasks = [];
    this.showDone = false;
    try { this.folded = new Set(JSON.parse(localStorage.getItem("side-folded") ?? "[]")); } catch { this.folded = new Set(); }
    this.allTasks = false;
  }

  start(cx) {
    this.tree.start(cx); // git, subagents and the once-a-minute redraw
    cx.spawn(async () => { try { this.agents = await knownAgents({ on: spaces().find((s) => s.active)?.machine ?? null }); } catch {} });
    cx.spawn(async (cx) => {
      const cache = `${home()}/.cache/herdr-kanban`;
      await exec("mkdir", ["-p", cache]).catch(() => null);
      for (;;) {
        if (await this.loadTasks()) cx.notify();
        if (!(await watchFolder(cache).catch(() => null))) await new Promise((r) => cx.timer.after(30000, r));
      }
    });
    // Your own tasks are in the settings folder, not the cache.
    cx.spawn(async (cx) => {
      for (;;) {
        const changed = await watchFolder(USER_CONFIG()).catch(() => null);
        if (!changed) { await new Promise((r) => cx.timer.after(30000, r)); continue; }
        if (changed.some((f) => /tasks(\.local)?\.json$|jira\.json$/.test(f))) { this.cfg = null; if (await this.loadTasks()) cx.notify(); }
      }
    });
  }

  fold(key) {
    this.folded.has(key) ? this.folded.delete(key) : this.folded.add(key);
    try { localStorage.setItem("side-folded", JSON.stringify([...this.folded])); } catch {}
  }

  // In progress on the Tasks panel's Today, by each tab's own reading of a status (status_map).
  async loadTasks() {
    const read = async (path) => { try { const t = await readTextFile(path); return t ? JSON.parse(t) : null; } catch { return null; } };
    if (!this.cfg) {
      const r = await exec("/usr/bin/env", ["python3", "-I", `${appHome()}/mods/kanban/tasks-sync.py`, "config"]).catch(() => null);
      try { this.cfg = JSON.parse(r.stdout); } catch { this.cfg = { tabs: [], sources: [] }; }
    }
    const cfg = this.cfg;
    const cache = `${home()}/.cache/herdr-kanban`;
    const [jira, github, linear, local] = await Promise.all([read(`${cache}/jira.json`), read(`${cache}/github.json`), read(`${cache}/linear.json`), read(`${USER_CONFIG()}/tasks.local.json`)]);
    const has = (s) => (cfg.sources ?? []).includes(s);
    const views = { ...(has("jira") ? jira?.views : {}), ...(has("github") ? github?.views : {}), ...(has("linear") ? linear?.views : {}) };
    const rows = (view) => view === "local"
      ? (local?.tasks ?? []).map((t) => ({ key: t.id, summary: t.title, status: t.status, category: { Doing: "indeterminate", Done: "done" }[t.status] ?? "new", updated: t.updated, source: "local" }))
      : views[view]?.issues ?? [];
    const site = jira?.site ?? cfg.site;
    const seen = new Set();
    const out = [];
    for (const tab of (cfg.tabs ?? []).filter((t) => !cfg.today_tabs || cfg.today_tabs.includes(t.id))) {
      for (const sec of tab.sections ?? []) {
        for (const i of rows(sec.view)) {
          if ((sec.status_map?.[i.status] ?? i.category) !== "indeterminate" || seen.has(i.key)) continue;
          seen.add(i.key);
          out.push({ key: i.key, summary: i.summary ?? "", status: i.status, type: i.type, source: i.source ?? "jira", updated: i.updated ?? 0, url: i.url ?? (i.source === "local" || !site ? null : `${site}/browse/${i.key}`) });
        }
      }
    }
    out.sort((a, b) => b.updated - a.updated);
    const changed = JSON.stringify(out) !== JSON.stringify(this.tasks);
    this.tasks = out;
    return changed;
  }

  // A new tab named after the task, the task as the agent's first message (as the Tasks panel does).
  startAgent(t) {
    const first = (this.agents ?? shared("kanban.agents")?.[""] ?? []).find((a) => a.installed);
    const name = `${t.source === "local" ? "" : `${t.key} `}${t.summary.slice(0, 48)}`;
    if (!first) return run("tab.new", { name });
    run("tab.new", { name, argv: first.run, task: `Work on this ${t.source === "local" ? "task" : `${t.type?.toLowerCase() ?? "ticket"}`}: ${t.summary}${t.url ? `\n${t.url}` : ""}` });
  }

  taskRow(p, t, on) {
    return line(p, `tk-${t.key}`, 0, () => (on ? openSession(on) : t.url ? exec("open", [t.url]) : null), 26)
      .tooltip(on ? `${t.status} · open its session` : t.url ? `${t.status} · open the ticket` : t.status)
      .child(dot(K.task, 6))
      .when(t.source !== "local", (el) => el.child(aside(p, t.key)))
      .child(txt(t.summary, p.ink, 12).flex_1())
      .children(on ? marks(p, on, ["task", "port", "device"], "t") : [])
      .when(!!on, (el) => el.child(pill(on.turn === "shell" ? STATUS.idle : TURN_COLOR[on.turn], on.turn === "working" ? "working" : on.turn === "ask" ? "asks you" : "open")))
      .when(!on, (el) => el.child(div().id(`tkgo-${t.key}`).flex_none().tooltip("Start an agent on it, in a new tab").child(iconBtn(`tkbtn-${t.key}`, "play", () => this.startAgent(t), p))));
  }

  // Tasks in progress: `list` is [task, its session or null].
  taskSection(p, label, list) {
    if (!list.length) return [];
    const shown = this.allTasks ? list : list.slice(0, TASKS_SHOWN);
    const toTasks = iconBtn("side-tasks", "external", () => { if (railShows() !== "jira") railTo("jira"); }, p);
    return [
      heading(p, K.task, label, list.length, div().id("side-tasks-tip").tooltip("Open the Tasks panel").child(toTasks)),
      ...shown.map(([t, on]) => this.taskRow(p, t, on)),
      ...(list.length > TASKS_SHOWN ? [line(p, "tk-more", 0, (cx) => { this.allTasks = !this.allTasks; cx.notify(); }).child(txt(this.allTasks ? "Show fewer" : `${list.length - TASKS_SHOWN} more`, p.faint))] : []),
    ];
  }

  // By project: each repo, its branches (a worktree says so), their sessions most urgent first. A session
  // is one line; under it only what's alive: its agents when the tab has several, and running subagents.
  projectView(p, list) {
    const running = new Map(); // pane -> its running subagents
    for (const pr of model()) for (const co of pr.checkouts) for (const a of co.agents) if (a.pane?.pane) running.set(a.pane.pane, a.subs.filter((x) => !x.finished));
    const order = { ask: 0, working: 1, new: 2, ready: 3, shell: 4, done: 5 };
    const urgent = (a, b) => order[a.turn] - order[b.turn] || (b.tab.changed_at ?? 0) - (a.tab.changed_at ?? 0);
    const projects = new Map();
    for (const s of list) projects.set(s.repo, [...(projects.get(s.repo) ?? []), s]);
    const count = (ss, turn) => ss.filter((s) => s.turn === turn).length;
    const sorted = [...projects].sort(([an, a], [bn, b]) => count(b, "ask") - count(a, "ask") || count(b, "working") - count(a, "working") || an.localeCompare(bn));

    const subRows = (pane, depth) => {
      const subs = running.get(pane) ?? [];
      return [
        ...subs.slice(0, 4).map((x, i) => line(p, `pj-sub-${pane}-${i}`, depth, x.address ? () => run("terminal.peek", { terminal: x.address }) : null, 22)
          .child(div().w(7).flex_none().flex().justify_center().child(dot(STATUS.working, 5)))
          .child(txt(x.text, p.faint).flex_1())
          .child(aside(p, x.kind === "claude" ? x.type : "terminal"))),
        ...(subs.length > 4 ? [line(p, `pj-subm-${pane}`, depth, null, 20).child(div().w(7).flex_none()).child(txt(`${subs.length - 4} more running`, p.faint, 11))] : []),
      ];
    };
    const under = (s) => {
      const ag = s.panes.filter(isAgent);
      if (ag.length < 2) return ag.flatMap((x) => subRows(x.pane, 2));
      return ag.flatMap((x) => {
        const t = clean(x.title);
        const where = x.branch && x.branch !== s.branch ? x.branch : null;
        return [
          line(p, `pj-ag-${x.pane}`, 2, () => openSession(s, x.pane), 22)
            .when(x.focused && s.current, (el) => el.bg(p.raised))
            .child(dot(STATUS[x.status === "error" ? "blocked" : x.status] ?? STATUS.idle, 5))
            .child(progIcon(x.program, 12, p.faint))
            .child(txt(telling(t, x.program?.name, x.terminal) ? t : x.program?.name ?? "agent", p.muted).flex_1())
            .when(!!where, (el) => el.child(aside(p, where))),
          ...subRows(x.pane, 3),
        ];
      });
    };

    const out = [];
    for (const [name, ss] of sorted) {
      const key = `p:${name}`;
      const fold = this.folded.has(key);
      const asks = count(ss, "ask"), working = count(ss, "working");
      if (out.length) out.push(div().flex_none().h(1).mx(8).my(6).bg(p.line));
      out.push(line(p, `pj-${name}`, 0, (cx) => { this.fold(key); cx.notify(); }, 30)
        .tooltip(`${ss.length} session${ss.length > 1 ? "s" : ""}${asks ? ` · ${asks} waiting on you` : ""}${working ? ` · ${working} working` : ""}`)
        .child(svg(ICON(fold ? "chevron-right" : "chevron-down")).size(12).flex_none().text_color(p.faint))
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(p.ink).child(name))
        // One thing on the right, in words: who's waiting, else who's working, else how many when folded.
        .when(asks > 0, (el) => el.child(dot(STATUS.blocked, 6)).child(div().flex_none().text_size(11).text_color("#f2a0ae").child(`${asks} waiting`)))
        .when(!asks && working > 0, (el) => el.child(dot(STATUS.working, 6)).child(div().flex_none().text_size(11).text_color(p.muted).child(`${working} working`)))
        .when(!asks && !working && fold, (el) => el.child(aside(p, `${ss.length} session${ss.length > 1 ? "s" : ""}`))));
      if (fold) continue;
      const checkouts = new Map();
      for (const s of ss) checkouts.set(s.top, [...(checkouts.get(s.top) ?? []), s]);
      const groups = [...checkouts.values()].map((g) => g.sort(urgent)).sort((a, b) => urgent(a[0], b[0]) || Number(a[0].linked) - Number(b[0].linked));
      for (const g of groups) {
        const head = g[0];
        // The branch is a caption over its sessions; a folder that isn't a repo has none.
        if (head.branch) out.push(line(p, `pj-co-${head.top}`, 1, null, 22).tooltip(tilde(head.top))
          .child(svg(ICON(head.linked ? "layers" : "branch")).size(11).flex_none().text_color(p.faint))
          .child(txt(head.branch, p.faint, 11).flex_1())
          .when(head.linked, (el) => el.child(aside(p, "worktree"))));
        for (const s of g) out.push(block([sessionRow(p, s, 1, "pj"), markRow(p, s, 1, "p"), ...under(s)].filter(Boolean)));
      }
    }
    if (!out.length) out.push(quietText(p, "Nothing running yet. Start an agent with New ▾ and it shows up here, under its project."));
    return out;
  }

  // By whose turn it is: each session, then what it has under it.
  turnView(p, list) {
    const full = (s) => block([sessionRow(p, s), ...attached(p, s, 1)]);
    const you = list.filter((s) => RANK[s.turn] !== undefined).sort(byTurn);
    const loud = you.filter((s) => !(s.quiet && s.turn !== "ask" && s.turn !== "new"));
    const hush = you.filter((s) => !loud.includes(s));
    const working = list.filter((s) => s.turn === "working").sort((a, b) => (a.tab.working_since ?? 0) - (b.tab.working_since ?? 0));
    const done = list.filter((s) => s.turn === "done").sort((a, b) => (b.tab.settled_at ?? 0) - (a.tab.settled_at ?? 0));
    const asks = you.filter((s) => s.turn === "ask").length;
    const idle = this.tasks.filter((t) => !list.some((s) => s.task === t)).map((t) => [t, null]);
    return [
      heading(p, asks ? STATUS.blocked : STATUS.idle, "Your turn", you.length),
      ...(you.length ? [] : [quietText(p, "Nothing is waiting on you.")]),
      ...loud.map(full),
      // Untouched for a day: one line each, nothing under it.
      ...hush.map((s) => sessionRow(p, s).opacity(0.6)),
      heading(p, STATUS.working, "Working", working.length),
      ...(working.length ? working.map(full) : [quietText(p, "No agent is working.")]),
      ...(done.length ? [
        heading(p, STATUS.done, "Done", done.length, div().id("side-done").text_size(11).text_color(p.faint).cursor_pointer().hover((st) => st.text_color(p.ink))
          .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.showDone = !this.showDone; cx.notify(); }).child(this.showDone ? "Hide" : "Show")),
        ...(this.showDone ? done.map((s) => sessionRow(p, s)) : []),
      ] : []),
      ...this.taskSection(p, "In progress, no session", idle),
    ];
  }

  // By what there is to look at. Empty kinds don't show.
  kindView(p, list) {
    const out = [];
    const riffed = list.filter((s) => s.riff);
    if (riffed.length) out.push(heading(p, K.riff, "Riffs", riffed.length), ...riffed.map((s) => block([
      line(p, `kr-${s.tab.id}`, 0, () => goToRiff(s.riff.terminal), 26).child(dot(K.riff, 6)).child(txt(s.riff.question, p.ink, 12.5)),
      line(p, `krw-${s.tab.id}`, 1, null, 18).child(txt(`${s.title} asks`, p.faint, 11)),
    ])));
    const asks = list.filter((s) => s.turn === "ask" && !s.riff);
    if (asks.length) out.push(heading(p, STATUS.blocked, "Waiting on your answer", asks.length), ...asks.map((s) => sessionRow(p, s)));

    // Every running server and device once, with the sessions working in its folder.
    const dev = shared("kanban.dev") ?? {};
    const users = (hit) => list.filter(hit).map((s) => s.title).join(", ");
    const ports = [
      ...(dev.servers ?? []).map((v) => ({ id: `s${v.id}`, port: v.port, name: v.name, used: users((s) => s.dev.servers.some((x) => x.id === v.id)), go: () => (v.term ? run("terminal.peek", { terminal: v.term }) : exec("open", [v.url ?? `http://localhost:${v.port}`])) })),
      ...(dev.others ?? []).map((o) => ({ id: `o${o.port}`, port: o.port, name: o.cmd, used: users((s) => s.dev.others.some((x) => x.port === o.port)) || base(o.cwd), go: () => exec("open", [`http://localhost:${o.port}`]) })),
    ];
    const devices = [...(dev.sims ?? []).map((x) => x.name), ...(dev.android ?? []).map((a) => a.replace(/^emulator-/, "Android "))];
    if (ports.length) out.push(heading(p, K.port, "Ports", ports.length), ...ports.map((v) =>
      line(p, `kp-${v.id}`, 0, v.go, 26).child(dot(K.port, 6)).child(txt(v.port ? `:${v.port}` : "server", K.port, 12).flex_none()).child(txt(v.name, p.ink, 12).flex_none().max_w(90)).child(div().flex_1()).when(!!v.used, (el) => el.child(txt(v.used, p.faint, 11)))));
    if (devices.length) out.push(heading(p, K.device, "Devices", devices.length), ...devices.map((name, i) =>
      line(p, `kd-${i}`, 0, () => exec("open", ["-a", "Simulator"]), 26).child(dot(K.device, 6)).child(txt(name, p.ink, 12))));

    // Sessions: one line each, most urgent first; a tab with several panes lists them.
    const order = { ask: 0, working: 1, new: 2, ready: 3, shell: 4, done: 5 };
    const all = [...list].sort((a, b) => order[a.turn] - order[b.turn] || (b.tab.changed_at ?? 0) - (a.tab.changed_at ?? 0));
    out.push(heading(p, STATUS.idle, "Sessions", all.length));
    if (!all.length) out.push(quietText(p, "Nothing running yet. Start an agent with New ▾."));
    out.push(...all.map((s) => block([sessionRow(p, s), markRow(p, s, 0, "k"), ...paneRows(p, s, 1)].filter(Boolean))));

    out.push(...this.taskSection(p, "Tasks in progress", this.tasks.map((t) => [t, list.find((s) => s.task === t) ?? null])));
    return out;
  }

  switcher(p) {
    return h_flex().flex_none().h(36).px(6).items_center().child(
      h_flex().w_full().p(2).gap(2).rounded(10).bg(p.ground).children(VIEWS.map((v) =>
        div().id(`sv-${v.id}`).flex_1().h(22).flex().items_center().justify_center().rounded(8).text_size(11.5).cursor_pointer()
          .text_color(view() === v.id ? p.ink : p.faint)
          .when(view() === v.id, (el) => el.bg(p.raised))
          .hover((st) => st.text_color(p.ink))
          .tooltip(v.tip)
          .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); setShared("kanban.side.view", v.id); cx.notify(); })
          .child(v.label))));
  }

  render(cx) {
    const p = pal();
    const top = MORE_VIEWS ? this.switcher(p) : div().flex_none().h(6);
    const v = view();
    const list = sessions(this.tasks);
    return v_flex().size_full().bg(p.col).child(top).child(
      v_flex().id(`side-${v}`).flex_1().min_h(0).px(6).pb(8).gap(1).overflow_y_scrollbar()
        .children(v === "project" ? this.projectView(p, list) : v === "turn" ? this.turnView(p, list) : this.kindView(p, list)));
  }
}
