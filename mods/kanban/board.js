// The board: one card per tab, in a column by its agents' status. Plus its top bar.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, agents, run, exec, shared, setShared, setAgentOrder, openOverlay, home, window } from "herdr";
import { ICON, STATUS, pal, ago, dot, progIcon, iconBtn, tilde } from "./ui.js";
import { railTo } from "./railtabs.js";
import { demo, demoCards } from "./demo.js";

const COLUMNS = [
  { id: "blocked", label: "Needs you" },
  { id: "working", label: "In progress" },
  { id: "done", label: "Review" },
  { id: "idle", label: "Backlog" },
];

const scope = () => (shared("kanban.scope") === "space" ? "space" : "all");
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// A space's own color, the same on every card from it. No violets.
const HUES = ["#e5566f", "#f08c3c", "#e2b340", "#3fc07a", "#2bb5a5", "#4c9aff", "#d66bb3", "#a3a3a3"];
function hue(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

function project(space, lead) {
  const folder = tilde(lead?.cwd ?? space.folder ?? "");
  const name = space.name === "~" ? "Home" : space.name;
  return { name, path: folder && folder !== "~" && folder !== name && !folder.endsWith("/" + name) ? folder : null };
}

// How long each tab's agent worked on its last run, kept across restarts.
let runs = null;
function lastRuns() {
  if (!runs) {
    try { runs = JSON.parse(localStorage.getItem("runs") ?? "{}"); } catch { runs = {}; }
  }
  return runs;
}
function trackRun(tab) {
  const r = lastRuns();
  const cur = r[tab.id];
  if (tab.working_since) {
    if (cur?.since !== tab.working_since) r[tab.id] = { since: tab.working_since, ms: cur?.ms ?? null };
    else return;
  } else if (cur?.since) {
    r[tab.id] = { since: null, ms: (tab.changed_at ?? Date.now()) - cur.since };
  } else return;
  try { localStorage.setItem("runs", JSON.stringify(r)); } catch {}
}

function dur(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

// The running servers (and, through them, simulators) whose folder this card's terminals are in.
function devUse(c) {
  if (c.demo_dev) return c.demo_dev;
  const dev = shared("kanban.dev");
  if (!dev) return { servers: [], others: [], devices: false };
  const h = home();
  const near = (a, b) => a && b && a !== h && b !== h && (a === b || a.startsWith(b + "/") || b.startsWith(a + "/"));
  const hits = (folder) => c.folders.some((f) => near(f, folder));
  const servers = (dev.servers ?? []).filter((s) => hits(s.folder));
  const others = (dev.others ?? []).filter((o) => hits(o.cwd));
  return { servers, others, devices: servers.some((s) => s.devices), sims: dev.sims ?? [], android: dev.android ?? [] };
}

function devChips(p, c) {
  const u = devUse(c);
  const chip = (id, icon, label, color, onPress) =>
    h_flex()
      .id(id)
      .h(22)
      .px(8)
      .gap(5)
      .items_center()
      .rounded(11)
      .bg(p.ground)
      .text_size(11.5)
      .text_color(p.muted)
      .cursor_pointer()
      .hover((s) => s.text_color(p.ink))
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        onPress();
      })
      .child(dot(color, 6))
      .child(svg(ICON(icon)).size(12))
      .child(label);
  const out = [];
  for (const s of u.servers)
    out.push(chip(`dv-${c.tab.id}-${s.id}`, "server", s.port ? `${s.name} :${s.port}` : s.name, STATUS.done, () =>
      s.term ? run("terminal.peek", { terminal: s.term }) : exec("open", [s.url ?? `http://localhost:${s.port}`])));
  for (const o of u.others)
    out.push(chip(`dvo-${c.tab.id}-${o.port}`, "server", `${o.cmd} :${o.port}`, STATUS.done, () => exec("open", [`http://localhost:${o.port}`])));
  if (u.devices) {
    for (const sim of u.sims) out.push(chip(`dvs-${c.tab.id}-${sim.name}`, "phone", sim.name, STATUS.done, () => exec("open", ["-a", "Simulator"])));
    for (const a of u.android) out.push(chip(`dva-${c.tab.id}-${a}`, "phone", a.replace(/^emulator-/, "Android "), STATUS.done, () => {}));
  }
  return out;
}

export function cards() {
  if (demo()) return demoCards();
  const all = panes();
  const terms = terminals();
  const list = [];
  for (const s of spaces()) {
    if (scope() === "space" && !s.active) continue;
    for (const tab of s.tabs) {
      trackRun(tab);
      const mine = all.filter((p) => p.tab === tab.id);
      const lead = mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
      const live = clean(lead?.title);
      const prog = lead?.program?.name;
      const telling = live && live !== prog && live !== tab.name && !/^[~/]/.test(live) && !/^t\d+$/.test(live) && !live.includes("@");
      // An unnamed tab is only its number: lead with what its agent is doing instead.
      const title = tab.named ? tab.name : telling ? live : prog ?? `Tab ${tab.name}`;
      const agentTerms = mine.filter((p) => p.status && p.terminal).map((p) => p.terminal);
      list.push({
        space: s,
        tab,
        lead,
        title,
        subtitle: tab.named && telling ? live : null,
        agents: agentTerms,
        subs: terms.filter((t) => t.state === "live" && t.parent && agentTerms.includes(t.parent)),
        folders: [...new Set(mine.map((p) => p.cwd).filter(Boolean))],
        column: tab.status ?? "idle",
        current: s.active && tab.active,
      });
    }
  }
  return list;
}

const order = (a, b) => (b.tab.changed_at ?? 0) - (a.tab.changed_at ?? 0) || a.space.index - b.space.index || a.tab.index - b.tab.index;

export function openPrompts(targets, title) {
  openOverlay({ mod: "kanban", props: { role: "prompts", targets, title }, kind: "popup", width: 300, height: 340 });
}

function ghost(id, label, onPress, p, on = false) {
  return div()
    .id(id)
    .flex_none()
    .h(28)
    .px(10)
    .flex()
    .items_center()
    .rounded(10)
    .text_size(12.5)
    .cursor_pointer()
    .text_color(on ? p.ink : p.muted)
    .when(on, (el) => el.bg(p.raised))
    .hover((s) => s.bg(p.hover).text_color(p.ink))
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      onPress();
    })
    .child(label);
}

export function bar() {
  const p = pal();
  const list = cards();
  const need = list.filter((c) => c.column === "blocked").length;
  const active = spaces().find((s) => s.active);
  const scopeName = demo() ? "Demo" : scope() === "space" ? (active?.name === "~" ? "Home" : active?.name ?? "") : "All spaces";
  const live = agents().map((a) => a.address);
  // macOS draws its window buttons over the bar (traffic_lights at x 14); leave them room
  // only while they show. Full screen hides them.
  const win = window();
  const lights = win.buttons && !win.fullscreen;
  return h_flex()
    .size_full()
    .pl(lights ? 84 : 14)
    .pr(10)
    .gap(4)
    .items_center()
    .bg(p.col)
    .text_color(p.ink)
    .child(image("mods/kanban/herdr.png").w(22).h(22).flex_none().mr(6))
    .child(div().text_size(14).font_semibold().child("Board"))
    .child(div().px(6).text_size(13).text_color(p.faint).child("/"))
    .child(div().text_size(13).text_color(p.muted).child(scopeName))
    .when(need > 0, (el) =>
      el.child(
        h_flex().ml(10).h(20).px(8).gap(6).items_center().rounded(9).bg("#e5566f26").text_color("#f2a0ae").text_size(12).font_medium()
          .child(dot(STATUS.blocked, 6))
          .child(`Needs you ${need}`)))
    .child(div().flex_1())
    .child(
      h_flex().gap(2).p(2).rounded(12).bg(p.ground)
        .child(ghost("scope-all", "All spaces", () => setShared("kanban.scope", "all"), p, scope() === "all"))
        .child(ghost("scope-space", "This space", () => setShared("kanban.scope", "space"), p, scope() === "space")))
    .child(div().w(6))
    .when(live.length > 0, (el) => el.child(ghost("prompt-all", "Prompt all", () => openPrompts(live, `All agents (${live.length})`), p)))
    .child(ghost("toggle-board", "Board ⌘B", () => run("layout.toggle", { id: "board" }), p))
    .child(ghost("toggle-rail", "Dev ⌘⇧E", () => railTo("dev"), p))
    .child(ghost("toggle-jira", `${shared("kanban.tasks.name") || "Tasks"}${(shared("kanban.jira.count") ?? 0) > 0 ? ` ${shared("kanban.jira.count")}` : ""} ⌘⇧J`, () => railTo("jira"), p))
    .child(ghost("to-classic", "Classic ⌘⇧K", () => run("layout.switch", { name: "main" }), p))
    .child(div().w(6))
    .child(
      h_flex()
        .id("new-card")
        .flex_none()
        .h(28)
        .px(10)
        .gap(6)
        .items_center()
        .rounded(10)
        .bg(p.ink)
        .text_color(p.ground)
        .text_size(12.5)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.opacity(0.88))
        .on_mouse_down("left", (_e, cx) => {
          cx.stop_propagation();
          run("tab.new", {});
        })
        .child(svg(ICON("plus")).size(13))
        .child("New card"));
}

export function board() {
  const p = pal();
  const list = cards();
  // agent.next / agent.prev walk the board left to right, top to bottom.
  const ordered = COLUMNS.flatMap((col) => list.filter((c) => c.column === col.id).sort(order));
  setAgentOrder(ordered.flatMap((c) => c.agents));
  return h_flex()
    .size_full()
    .bg(p.ground)
    .p(8)
    .gap(8)
    .items_start()
    .children(COLUMNS.map((col) => column(p, col, list.filter((c) => c.column === col.id).sort(order))));
}

function column(p, col, items) {
  return v_flex()
    .flex_1()
    .min_w(0)
    .h_full()
    .rounded(16)
    .bg(p.col)
    .child(
      h_flex()
        .flex_none()
        .h(36)
        .px(12)
        .gap(8)
        .items_center()
        .child(dot(STATUS[col.id]))
        .child(div().text_size(13).font_semibold().text_color(p.ink).child(col.label))
        .child(div().text_size(12).text_color(p.faint).child(String(items.length)))
        .child(div().flex_1())
        .when(col.id === "idle", (el) => el.child(iconBtn("col-add", "plus", () => run("tab.new", {}), p))))
    .child(
      v_flex()
        .id(`col-${col.id}`)
        .flex_1()
        .min_h(0)
        .px(8)
        .pb(8)
        .gap(8)
        .overflow_y_scrollbar()
        .when(items.length === 0, (el) =>
          el.child(div().px(4).py(6).text_size(12).text_color(p.faint).child("—")))
        .children(items.map((c) => card(p, c))));
}

function card(p, c) {
  const { tab, space, lead } = c;
  const now = Date.now();
  const when = !tab.working_since && tab.changed_at ? (now - tab.changed_at < 60000 ? "just now" : `${ago(now - tab.changed_at)} ago`) : null;
  const last = tab.demo_worked ? { ms: tab.demo_worked } : lastRuns()[tab.id];
  const worked = !tab.working_since && last?.ms ? `worked ${dur(last.ms)}` : null;
  const branch = lead?.branch ?? space.branch; // the tab's own agent, not the space's first terminal
  const proj = project(space, lead);
  return v_flex()
    .id(`card-${tab.id}`)
    .flex_none()
    .w_full()
    .px(12)
    .py(10)
    .gap(6)
    .rounded(12)
    .bg(c.current ? p.cardHover : p.card)
    .border_1()
    .border_color(c.current ? p.accent : p.line)
    .cursor_pointer()
    .hover((s) => s.bg(p.cardHover))
    .on_click(() => {
      run("space.select", { id: space.id });
      run("tab.select", { id: tab.id });
    })
    // Project
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .text_size(12)
        .child(dot(hue(space.id), 6))
        .child(div().flex_none().text_color(p.muted).child(proj.name))
        .when(!!proj.path, (el) => el.child(div().min_w(0).truncate().text_color(p.faint).child(proj.path)))
        .child(div().flex_1())
        .when(c.agents.length > 0, (el) =>
          el.child(iconBtn(`prompt-${tab.id}`, "message", () => openPrompts(c.agents, c.title), p))))
    // Title
    .child(
      h_flex()
        .gap(8)
        .items_start()
        .child(div().pt(2).child(progIcon(lead?.program, 14, p.muted)))
        .child(div().flex_1().min_w(0).text_size(14).font_medium().text_color(p.ink).child(c.title))
        .when(!!tab.working_since, (el) =>
          el.child(
            h_flex().flex_none().h(20).px(7).gap(5).items_center().rounded(9).bg("#e2b3401f").text_color(STATUS.working).text_size(12).font_medium()
              .child(svg(ICON("spinner")).size(11).spin(900))
              .child(dur(now - tab.working_since)))))
    .when(!!c.subtitle, (el) => el.child(div().truncate().text_size(12.5).text_color(p.muted).child(c.subtitle)))
    // Sub-agents
    .when(c.subs.length > 0, (el) =>
      el.child(
        h_flex().gap(4).flex_wrap().children(
          c.subs.slice(0, 6).map((t) =>
            h_flex()
              .id(`sub-${t.address}`)
              .h(22)
              .px(7)
              .gap(5)
              .items_center()
              .rounded(9)
              .bg(p.ground)
              .text_size(11.5)
              .text_color(p.muted)
              .cursor_pointer()
              .hover((s) => s.text_color(p.ink))
              .on_mouse_down("left", (_e, cx) => {
                cx.stop_propagation();
                run("terminal.peek", { terminal: t.address });
              })
              .child(dot(STATUS[t.status === "error" ? "blocked" : t.status] ?? STATUS.idle, 6))
              .child(t.name || t.program?.name || t.address)))
          .when(c.subs.length > 6, (el) => el.child(div().text_size(11.5).text_color(p.faint).child(`+${c.subs.length - 6}`)))))
    // Dev servers and devices this card's work is using
    .when(devChips(p, c).length > 0, (el) => el.child(h_flex().gap(4).flex_wrap().children(devChips(p, c))))
    // Meta
    .child(
      h_flex()
        .gap(8)
        .items_center()
        .text_size(12)
        .text_color(p.faint)
        .when(!!branch, (el) => el.child(div().min_w(0).truncate().child(branch)))
        .child(div().flex_1())
        .when(tab.panes > 1, (el) => el.child(div().flex_none().child(`${tab.panes} panes`)))
        .when(!!worked, (el) => el.child(div().flex_none().child(worked)))
        .when(!!worked && !!when, (el) => el.child(div().flex_none().child("·")))
        .when(!!when, (el) => el.child(div().flex_none().child(when))));
}
