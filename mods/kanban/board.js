// The board: one card per tab, in a column by whose turn it is. Plus its top bar.
//
// Herdr reports an agent as working, blocked (it asked you something), done (it finished while you
// weren't looking; it turns idle once you look) or idle. Three of those mean the same thing for you,
// "it's my turn", so they share a column and keep the difference as a badge:
//   Your turn - asked you something or opened a riff (first), finished and unseen, then waiting for
//               a prompt, then plain terminals. Quiet for over a day folds away.
//   Working   - an agent is working, oldest first so cards don't jump.
//   Done      - tabs you marked done (Herdr's tab.settle: put away, still running). Opening one, or
//               its agent needing you, brings it back.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, agents, run, exec, shared, setShared, setAgentOrder, openOverlay, home, window, layout } from "herdr";
import { ICON, STATUS, pal, ago, dot, progIcon, iconBtn, tilde } from "./ui.js";
import { railTo } from "./railtabs.js";
import { riffs, goToRiff } from "./riffs.js";
import { gitInfo } from "./git.js";
import { demo, demoCards } from "./demo.js";

const COLUMNS = [
  { id: "you", label: "Your turn", color: STATUS.blocked, empty: "Nothing is waiting on you." },
  { id: "working", label: "Working", color: STATUS.working, empty: "No agent is working." },
  { id: "done", label: "Done", color: STATUS.done, empty: "Finished with a card? Mark it done (✓) to put it here." },
];

const DAY = 24 * 60 * 60000;

const scope = () => (shared("kanban.scope") === "space" ? "space" : "all");
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// A space's own color, the same on every card from it. No violets.
const HUES = ["#e5566f", "#f08c3c", "#e2b340", "#3fc07a", "#2bb5a5", "#4c9aff", "#d66bb3", "#a3a3a3"];
function hue(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

// The project a card belongs to: the git repo its agent is in (a worktree names its repo, not its
// own folder), else the space's name. The folder rides along for the tooltip.
function project(space, lead) {
  const g = gitInfo(lead?.cwd);
  const name = g?.repo ?? (space.name === "~" ? "Home" : space.name);
  return { name, folder: tilde(g?.top ?? lead?.cwd ?? space.folder ?? ""), worktree: g?.linked ? g : null };
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

// Why a card is on your turn, most urgent first: it asked you something (or opened a riff), it
// finished while you were away, it's waiting for a prompt, or it's a plain terminal.
const RANK = { ask: 0, new: 1, ready: 2, shell: 3 };

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
      // An agent waiting on your answer to a riff needs you, whatever its own status says.
      const riff = riffs().find((r) => agentTerms.includes(r.terminal)) ?? null;
      const turn = riff || tab.status === "blocked" ? "ask" : tab.status === "done" ? "new" : agentTerms.length ? "ready" : "shell";
      list.push({
        space: s,
        tab,
        lead,
        title,
        subtitle: tab.named && telling ? live : null,
        agents: agentTerms,
        subs: terms.filter((t) => t.state === "live" && t.parent && agentTerms.includes(t.parent)),
        folders: [...new Set(mine.map((p) => p.cwd).filter(Boolean))],
        column: tab.settled ? "done" : tab.status === "working" && !riff ? "working" : "you",
        turn,
        riff,
        current: s.active && tab.active,
      });
    }
  }
  return list;
}

const SORT = {
  you: (a, b) => RANK[a.turn] - RANK[b.turn] || (b.tab.changed_at ?? 0) - (a.tab.changed_at ?? 0) || a.space.index - b.space.index || a.tab.index - b.tab.index,
  working: (a, b) => (a.tab.working_since ?? 0) - (b.tab.working_since ?? 0) || a.tab.index - b.tab.index,
  done: (a, b) => (b.tab.settled_at ?? 0) - (a.tab.settled_at ?? 0),
};
const columnCards = (list, id) => list.filter((c) => c.column === id).sort(SORT[id]);
const urgent = (list) => list.filter((c) => c.column === "you" && c.turn === "ask");
// Waiting for a prompt or a plain terminal, untouched for a day: folded under "quiet".
// No change time means nothing changed since Herdr started: unknown, so not folded.
const quiet = (c) => c.turn !== "ask" && c.turn !== "new" && !!c.tab.changed_at && Date.now() - c.tab.changed_at > DAY;

export function openPrompts(targets, title) {
  openOverlay({ mod: "kanban", props: { role: "prompts", targets, title }, kind: "popup", width: 300, height: 340 });
}

export function openNew() {
  openOverlay({ mod: "kanban", props: { role: "newmenu" }, kind: "popup", at: "pointer", width: 300, height: 400 });
}

// Opens a card's tab (and its riff, if it has one waiting).
function openCard(c) {
  if (c.demo) return;
  if (c.riff) return goToRiff(c.riff.terminal);
  run("space.select", { id: c.space.id });
  run("tab.select", { id: c.tab.id });
}

// A quiet icon button with a tooltip: the bar's controls are icons, their names on hover.
function tool(p, id, icon, tip, onPress, on = false) {
  return div()
    .id(id)
    .flex_none()
    .w(30)
    .h(30)
    .flex()
    .items_center()
    .justify_center()
    .rounded(9)
    .text_color(on ? p.ink : p.muted)
    .when(on, (el) => el.bg(p.raised))
    .cursor_pointer()
    .hover((s) => s.bg(p.hover).text_color(p.ink))
    .active((s) => s.opacity(0.8))
    .tooltip(tip)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      onPress();
    })
    .child(svg(ICON(icon)).size(16));
}

function segment(p, id, label, on, onPress) {
  return div()
    .id(id)
    .h(24)
    .px(10)
    .flex()
    .items_center()
    .rounded(8)
    .text_size(12)
    .cursor_pointer()
    .text_color(on ? p.ink : p.faint)
    .when(on, (el) => el.bg(p.raised))
    .hover((s) => s.text_color(p.ink))
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      onPress();
    })
    .child(label);
}

const findNode = (node, id) => (node?.id === id ? node : (node?.children ?? []).map((c) => findNode(c, id)).find(Boolean) ?? null);

// The top-left switch: the kanban board, or the projects sidebar, never both.
export function setMode(mode) {
  const hidden = (id) => !!findNode(layout(), id)?.hidden;
  const want = { board: mode === "board", side: mode === "sidebar" };
  for (const id of ["board", "side"]) if (hidden(id) === want[id]) run("layout.toggle", { id });
}
export const toggleMode = () => setMode(findNode(layout(), "side")?.hidden === false ? "board" : "sidebar");

export function bar() {
  const p = pal();
  const list = cards();
  const asks = urgent(list);
  const live = agents().map((a) => a.address);
  const win = window();
  // macOS draws its window buttons over the bar (traffic_lights at x 14); leave them room
  // only while they show. Full screen hides them.
  const lights = win.buttons && !win.fullscreen;
  const sideShown = findNode(layout(), "side")?.hidden === false;
  const railShown = !findNode(layout(), "rail")?.hidden;
  return h_flex()
    .size_full()
    .pl(lights ? 84 : 14)
    .pr(10)
    .gap(4)
    .items_center()
    .bg(p.col)
    .text_color(p.ink)
    .child(image("mods/kanban/herdr.png").w(22).h(22).flex_none().mr(6))
    .child(
      h_flex().gap(2).p(2).rounded(10).bg(p.ground).mr(6)
        .tooltip("Kanban board or projects sidebar  ⌘B")
        .child(segment(p, "mode-board", "Board", !sideShown, () => setMode("board")))
        .child(segment(p, "mode-side", "Sidebar", sideShown, () => setMode("sidebar"))))
    // Which spaces the board shows: a segmented control, the space's own name when it's one.
    .when(!sideShown, (el) => el.child(
      h_flex().gap(2).p(2).rounded(10).bg(p.ground)
        .child(segment(p, "scope-all", "All", scope() === "all", () => setShared("kanban.scope", "all")))
        .child(segment(p, "scope-space", demo() ? "Acme Store" : spaces().find((s) => s.active)?.name ?? "This space", scope() === "space", () => setShared("kanban.scope", "space")))))
    // Questions waiting: the one thing worth reading from across the room. Click: the oldest.
    .when(asks.length > 0, (el) =>
      el.child(
        h_flex().id("asks").ml(8).h(24).px(9).gap(6).items_center().rounded(9).bg("#e5566f26").text_color("#f2a0ae").text_size(12).font_medium()
          .cursor_pointer().hover((s) => s.bg("#e5566f40"))
          .tooltip("Agents waiting on your answer. Click to open the oldest.")
          .on_mouse_down("left", (_e, cx) => {
            cx.stop_propagation();
            openCard([...asks].sort((a, b) => (a.tab.changed_at ?? 0) - (b.tab.changed_at ?? 0))[0]);
          })
          .child(dot(STATUS.blocked, 6))
          .child(`${asks.length} waiting on you`)))
    .child(div().flex_1())
    .when(live.length > 0, (el) => el.child(tool(p, "prompt-all", "message", `Send a saved prompt to all ${live.length} agents`, () => openPrompts(live, `All agents (${live.length})`))))
    .child(tool(p, "toggle-rail", "panel", "Side panel: Dev ⌘⇧E · Tasks ⌘⇧J · Riff ⌘⇧Y", () => run("layout.toggle", { id: "rail" }), railShown))
    .child(tool(p, "to-classic", "classic", "Herdr's classic layout  ⌘⇧K", () => run("layout.switch", { name: "main" })))
    .child(div().w(1).h(18).mx(6).bg(p.line))
    .child(
      h_flex()
        .id("new")
        .flex_none()
        .h(30)
        .pl(10)
        .pr(8)
        .gap(6)
        .items_center()
        .rounded(10)
        .bg(p.ink)
        .text_color(p.ground)
        .text_size(12.5)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.opacity(0.9))
        .active((s) => s.opacity(0.75))
        .tooltip("New agent, terminal, worktree, pane or project")
        .on_mouse_down("left", (_e, cx) => {
          cx.stop_propagation();
          openNew();
        })
        .child(svg(ICON("plus")).size(14))
        .child("New")
        .child(svg(ICON("chevron-down")).size(13).opacity(0.7)));
}

export function board() {
  const p = pal();
  const list = cards();
  // agent.next / agent.prev walk the board left to right, top to bottom.
  setAgentOrder(COLUMNS.flatMap((col) => columnCards(list, col.id).flatMap((c) => c.agents)));
  return h_flex()
    .size_full()
    .bg(p.ground)
    .p(8)
    .gap(8)
    .items_start()
    .children(COLUMNS.map((col) => column(p, col, columnCards(list, col.id))));
}

function showQuiet() {
  try { return localStorage.getItem("show-quiet") === "1"; } catch { return false; }
}

function column(p, col, items) {
  const folded = col.id === "you" && !showQuiet() ? items.filter(quiet) : [];
  const shown = folded.length ? items.filter((c) => !quiet(c)) : items;
  const asks = col.id === "you" ? items.filter((c) => c.turn === "ask").length : 0;
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
        .child(dot(col.id === "you" && !asks ? STATUS.idle : col.color))
        .child(div().text_size(13).font_semibold().text_color(p.ink).child(col.label))
        .child(div().text_size(12).text_color(p.faint).child(String(items.length))))
    .child(
      v_flex()
        .id(`col-${col.id}`)
        .flex_1()
        .min_h(0)
        .px(8)
        .pb(8)
        .gap(col.id === "done" ? 4 : 8)
        .overflow_y_scrollbar()
        .when(items.length === 0, (el) => el.child(div().px(4).py(6).text_size(12).text_color(p.faint).child(col.empty)))
        .children(shown.map((c) => (col.id === "done" ? doneCard(p, c) : card(p, c))))
        .when(col.id === "you" && (folded.length > 0 || (showQuiet() && items.some(quiet))), (el) =>
          el.child(
            div().id("quiet").px(4).py(4).text_size(12).text_color(p.faint).cursor_pointer().hover((s) => s.text_color(p.ink))
              .on_mouse_down("left", (_e, cx) => {
                try { localStorage.setItem("show-quiet", showQuiet() ? "0" : "1"); } catch {}
                cx.notify();
              })
              .child(folded.length ? `${folded.length} quiet for over a day` : "Hide the quiet ones"))));
}

// A small rounded label on a card: what kind of "your turn" it is.
function badge(text, fg, bg) {
  return h_flex().flex_none().h(20).px(7).gap(5).items_center().rounded(8).bg(bg).text_color(fg).text_size(11.5).font_medium().child(dot(fg, 5)).child(text);
}

function card(p, c) {
  const { tab, space, lead } = c;
  const now = Date.now();
  const last = tab.demo_worked ? { ms: tab.demo_worked } : lastRuns()[tab.id];
  const since = tab.changed_at ? (now - tab.changed_at < 60000 ? "just now" : `${ago(now - tab.changed_at)} ago`) : null;
  const when = c.column === "working" ? null
    : c.turn === "ready" && !last?.ms ? "waiting for a prompt"
    : last?.ms && since ? `worked ${dur(last.ms)} · ${since}`
    : since;
  const branch = lead?.branch ?? space.branch; // the tab's own agent, not the space's first terminal
  const proj = c.demo_project ?? project(space, lead);
  const wt = proj.worktree;
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
    .on_click(() => openCard(c))
    // Project, and the card's two actions
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .text_size(12)
        .child(dot(hue(space.id), 6))
        .child(div().id(`proj-${tab.id}`).min_w(0).truncate().text_color(p.muted).tooltip(proj.folder || proj.name).child(proj.name))
        .when(!!wt, (el) => el.child(
          h_flex().id(`wt-${tab.id}`).flex_none().h(18).px(6).gap(4).items_center().rounded(6).border_1().border_color(p.line).text_size(11).text_color(p.muted)
            .tooltip(`A worktree: a second checkout of ${proj.name} on its own branch, in ${tilde(wt.top)}. Changes here don't touch your main checkout until you merge.`)
            .child(svg(ICON("branch")).size(11))
            .child("worktree")))
        .child(div().flex_1())
        .when(c.agents.length > 0, (el) => el.child(iconBtn(`prompt-${tab.id}`, "message", () => openPrompts(c.agents, c.title), p)))
        .when(c.column === "you" && !c.demo, (el) => el.child(doneBtn(p, tab))))
    // Title
    .child(
      h_flex()
        .gap(8)
        .items_start()
        .child(div().pt(2).child(progIcon(lead?.program, 14, p.muted)))
        .child(div().flex_1().min_w(0).text_size(14).font_medium().text_color(p.ink).child(c.title))
        // The timer only where the card is: an agent that stopped to ask you isn't working.
        .when(!!tab.working_since && c.column === "working", (el) =>
          el.child(
            h_flex().flex_none().h(20).px(7).gap(5).items_center().rounded(9).bg("#e2b3401f").text_color(STATUS.working).text_size(12).font_medium()
              .child(svg(ICON("spinner")).size(11).spin(900))
              .child(dur(now - tab.working_since)))))
    .when(!!c.subtitle, (el) => el.child(div().truncate().text_size(12.5).text_color(p.muted).child(c.subtitle)))
    // What kind of "your turn": a riff says what it's asking; a question or a finish gets a badge.
    .when(!!c.riff, (el) =>
      el.child(
        h_flex()
          .id(`riff-${tab.id}`)
          .h(24)
          .px(8)
          .gap(6)
          .items_center()
          .rounded(9)
          .bg("#e5566f1f")
          .text_size(12)
          .text_color("#f2a0ae")
          .cursor_pointer()
          .hover((s) => s.bg("#e5566f33"))
          .on_mouse_down("left", (_e, cx) => {
            cx.stop_propagation();
            if (!c.riff.demo) goToRiff(c.riff.terminal);
          })
          .child(dot(STATUS.blocked, 6))
          .child(div().flex_none().font_medium().child("Your call"))
          .child(div().min_w(0).truncate().child(c.riff.question))))
    .when(!c.riff && c.column === "you" && c.turn === "ask", (el) => el.child(h_flex().child(badge("Needs your answer", "#f2a0ae", "#e5566f1f"))))
    .when(c.column === "you" && c.turn === "new", (el) => el.child(h_flex().child(badge("Finished · not seen yet", "#7fd9a6", "#3fc07a1f"))))
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
    // Meta: branch, panes, time
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .text_size(12)
        .text_color(p.faint)
        .when(!!branch, (el) => el.child(svg(ICON("branch")).size(12).flex_none()).child(div().min_w(0).truncate().child(branch)))
        .child(div().flex_1())
        .when(c.turn === "shell" && c.column === "you", (el) => el.child(div().flex_none().child("terminal")))
        .when(tab.panes > 1, (el) => el.child(div().flex_none().child(`${tab.panes} panes`)))
        .when(!!when, (el) => el.child(div().flex_none().child(when))));
}

function doneBtn(p, tab) {
  return div().id(`done-${tab.id}`).flex_none().tooltip("Mark done: puts it away; it keeps running and comes back if it needs you")
    .child(iconBtn(`donebtn-${tab.id}`, "check", () => run("tab.settle", { id: tab.id }), p));
}

// Done: one compact row each. Opening it brings it back to the board's other columns.
function doneCard(p, c) {
  const { tab, space } = c;
  const proj = c.demo_project ?? project(space, c.lead);
  const at = tab.settled_at ? ago(Date.now() - tab.settled_at) : null;
  return h_flex()
    .id(`done-card-${tab.id}`)
    .flex_none()
    .w_full()
    .h(36)
    .pl(10)
    .pr(4)
    .gap(8)
    .items_center()
    .rounded(10)
    .cursor_pointer()
    .hover((s) => s.bg(p.hover))
    .tooltip("Open it: it comes back from Done")
    .on_click(() => openCard(c))
    .child(dot(hue(space.id), 6))
    .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(p.muted).child(c.title))
    .child(div().flex_none().max_w(110).truncate().text_size(11.5).text_color(p.faint).child(proj.name))
    .when(!!at, (el) => el.child(div().flex_none().text_size(11.5).text_color(p.faint).child(at)))
    .when(!c.demo, (el) => el.child(div().id(`undo-${tab.id}`).flex_none().tooltip("Back to the board, without opening it")
      .child(iconBtn(`undobtn-${tab.id}`, "undo", () => run("tab.unsettle", { id: tab.id }), p))));
}
