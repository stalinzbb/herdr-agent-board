// The tree: project > checkout (main or a worktree, with its branch) > agent > subagents.
// One model, two looks: a narrow sidebar (role "sidebar") and a wide view that takes the board's
// place (role "treeview", switched with Board | Tree in the bar).
//
// Subagents come from two places: terminals an agent started (Herdr's `parent`), and Claude's own
// subagents, which it records in <session>/subagents/*.meta.json (read every few seconds).

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, run, exec, home, readTextFile } from "herdr";
import { ICON, STATUS, pal, dot, progIcon, tilde, ago } from "./ui.js";
import { gitInfo, refreshGit } from "./git.js";

const SESSIONS = () => `${home()}/.cache/herdr-kanban/sessions`;

// terminal id -> [{ type, text, finished }]: Claude's subagents for each agent terminal.
let claudeSubs = new Map();

async function scanSubagents(agentPanes) {
  const next = new Map();
  for (const p of agentPanes) {
    if (!p.terminal) continue;
    try {
      const t = await readTextFile(`${SESSIONS()}/${p.terminal.replace("/", "_")}.json`);
      const path = t && JSON.parse(t).transcript_path;
      if (!path) continue;
      const dir = path.replace(/\.jsonl$/, "");
      const r = await exec("sh", ["-c", `for f in "${dir}"/subagents/*.meta.json; do [ -f "$f" ] && cat "$f" && echo; done`]);
      const subs = r.stdout.split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (subs.length) next.set(p.terminal, subs.map((s) => ({ type: s.agentType ?? "agent", text: s.description ?? s.agentType ?? "subagent", finished: !!s.finished })));
    } catch {}
  }
  const changed = JSON.stringify([...next]) !== JSON.stringify([...claudeSubs]);
  claudeSubs = next;
  return changed;
}

const isAgent = (p) => !!(p.status && p.terminal);
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const COLOR = (s) => STATUS[s === "error" ? "blocked" : s] ?? STATUS.idle;

// What to show for an agent: the tab's name, else what its pane says it's doing.
function agentName(tab, p, count) {
  if (tab.named) return count > 1 ? `${tab.name} · ${p.program?.name ?? "agent"}` : tab.name;
  const live = clean(p.title);
  if (live && live !== p.program?.name && !/^[~/]/.test(live) && !/^t\d+$/.test(live) && !live.includes("@")) return live;
  return p.program?.name ?? `Tab ${tab.name}`;
}

// Projects by git repo (a worktree belongs to its repo), each with its checkouts by folder.
export function model() {
  const all = panes();
  const terms = terminals();
  const projects = new Map();
  for (const s of spaces()) {
    for (const tab of s.tabs) {
      const mine = all.filter((p) => p.tab === tab.id);
      const agents = mine.filter(isAgent);
      const lead = agents[0] ?? mine.find((p) => p.focused) ?? mine[0];
      if (!lead) continue;
      const g = gitInfo(lead.cwd);
      const name = g?.repo ?? (s.name === "~" ? "Home" : s.name);
      const top = g?.top ?? lead.cwd ?? s.folder ?? "";
      const proj = projects.get(name) ?? { name, checkouts: new Map(), needs: 0, working: 0 };
      projects.set(name, proj);
      const co = proj.checkouts.get(top) ?? { top, branch: lead.branch ?? null, linked: !!g?.linked, agents: [] };
      proj.checkouts.set(top, co);
      if (!co.branch && lead.branch) co.branch = lead.branch;
      // A plain terminal tab is still listed, as a quiet row, so every tab is findable here.
      for (const p of agents.length ? agents : [lead]) {
        const status = isAgent(p) ? p.status : null;
        const subs = [
          ...(claudeSubs.get(p.terminal) ?? []).map((x) => ({ kind: "claude", ...x })),
          ...terms.filter((t) => t.state === "live" && t.parent && t.parent === p.terminal).map((t) => ({ kind: "term", type: "terminal", text: t.name || t.program?.name || t.address, finished: false, status: t.status, address: t.address })),
        ];
        co.agents.push({ space: s, tab, pane: p, name: isAgent(p) ? agentName(tab, p, agents.length) : p.program?.name ?? "terminal", status, subs, current: s.active && tab.active, agent: isAgent(p) });
        if (status === "blocked") proj.needs++;
        if (status === "working") proj.working++;
      }
    }
  }
  return [...projects.values()]
    .map((p) => ({
      ...p,
      // Most urgent first, in every level: needs you, working, finished, idle.
      checkouts: [...p.checkouts.values()]
        .map((c) => ({ ...c, agents: [...c.agents].sort((a, b) => urgency(a.status) - urgency(b.status)) }))
        .sort((a, b) => Math.min(...a.agents.map((x) => urgency(x.status))) - Math.min(...b.agents.map((x) => urgency(x.status))) || Number(a.linked) - Number(b.linked) || a.top.localeCompare(b.top)),
    }))
    .sort((a, b) => b.needs - a.needs || b.working - a.working || a.name.localeCompare(b.name));
}

function urgency(status) {
  return { blocked: 0, working: 1, done: 2, idle: 3 }[status] ?? 4;
}

// Subagents fold by default once an agent has more than this many; fewer just show.
const FOLD_AT = 2;
const expanded = new Set();

const collapsed = (() => {
  try { return new Set(JSON.parse(localStorage.getItem("tree-collapsed") ?? "[]")); } catch { return new Set(); }
})();
function toggle(key) {
  collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
  try { localStorage.setItem("tree-collapsed", JSON.stringify([...collapsed])); } catch {}
}

function openAgent(a) {
  run("space.select", { id: a.space.id });
  run("tab.select", { id: a.tab.id });
}

const row = (p, id, depth, onPress) =>
  h_flex().id(id).w_full().min_h(26).pl(8 + depth * 14).pr(8).gap(6).items_center().rounded(8)
    .when(!!onPress, (el) => el.cursor_pointer().hover((s) => s.bg(p.hover)).on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); onPress(cx); }));

function subRow(p, a, s, i) {
  const who = a.pane.pane ?? a.tab.id;
  return row(p, `sub-${who}-${i}`, 3, s.address ? () => run("terminal.peek", { terminal: s.address }) : null)
    .opacity(s.finished ? 0.5 : 1)
    .child(dot(s.finished ? STATUS.done : s.kind === "claude" ? STATUS.working : COLOR(s.status), 5))
    .child(div().min_w(0).truncate().text_size(11.5).text_color(p.faint).child(s.text))
    .child(div().flex_1())
    .child(div().flex_none().text_size(10.5).text_color(p.faint).child(s.kind === "claude" ? s.type : "terminal"));
}

function agentRows(p, a, depth, wide, branch) {
  const key = `a:${a.pane.pane ?? a.tab.id}`;
  const many = a.subs.length > FOLD_AT;
  const fold = many ? !expanded.has(key) : collapsed.has(key);
  const flip = () => (many ? (expanded.has(key) ? expanded.delete(key) : expanded.add(key)) : toggle(key));
  const running = a.subs.filter((s) => !s.finished).length;
  // Running subagents first, finished ones (dimmed) at the bottom.
  const subs = [...a.subs].sort((x, y) => Number(x.finished) - Number(y.finished));
  return [
    row(p, `ag-${a.pane.pane ?? a.tab.id}`, depth, () => openAgent(a))
      .when(a.current, (el) => el.bg(p.raised))
      .child(
        div().id(`agf-${a.pane.pane ?? a.tab.id}`).flex_none().w(12).h(12).flex().items_center().justify_center()
          .when(a.subs.length > 0, (el) => el.child(svg(ICON("chevron-down")).size(11).text_color(p.faint).when(fold, (x) => x.opacity(0.6)))
            .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); flip(); cx.notify(); })))
      .child(a.agent ? dot(COLOR(a.status), 7) : div().w(7).h(7).flex_none())
      .child(progIcon(a.pane.program, 13, p.muted))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(a.agent ? p.ink : p.faint).child(a.name))
      .when(!!branch, (el) => el.child(div().flex_none().max_w(110).truncate().text_size(11).text_color(p.faint).child(branch)))
      .when(a.subs.length > 0, (el) => el.child(div().flex_none().px(6).h(16).flex().items_center().rounded(8).bg(p.ground).text_size(10.5).text_color(p.muted).child(running > 0 ? `${running} running` : `${a.subs.length} done`)))
      .when(wide && a.tab.changed_at, (el) => el.child(div().flex_none().text_size(11).text_color(p.faint).child(ago(Date.now() - a.tab.changed_at)))),
    ...(fold ? [] : subs.map((s, i) => subRow(p, a, s, i))),
  ];
}

function projectBlock(p, proj, wide) {
  const key = `p:${proj.name}`;
  const fold = collapsed.has(key);
  const n = proj.checkouts.reduce((t, c) => t + c.agents.length, 0);
  const rows = [
    row(p, `pr-${proj.name}`, 0, (cx) => { toggle(key); cx.notify(); }).h(30)
      .child(svg(ICON("chevron-down")).size(12).text_color(p.faint).when(fold, (x) => x.opacity(0.5)))
      .child(svg(ICON("folder")).size(14).flex_none().text_color(p.muted))
      .child(div().min_w(0).truncate().text_size(13).font_semibold().text_color(p.ink).child(proj.name))
      .child(div().flex_1())
      .when(proj.needs > 0, (el) => el.child(div().px(6).h(16).flex().items_center().rounded(8).bg("#e5566f26").text_size(10.5).text_color("#f2a0ae").child(String(proj.needs))))
      .when(proj.needs === 0 && proj.working > 0, (el) => el.child(dot(STATUS.working, 6)))
      .child(div().flex_none().text_size(11).text_color(p.faint).child(String(n))),
  ];
  if (!fold) {
    // One checkout with one agent: no branch row, the branch rides on the agent's row.
    const solo = proj.checkouts.length === 1 && proj.checkouts[0].agents.length === 1;
    if (solo) {
      const co = proj.checkouts[0];
      rows.push(...agentRows(p, co.agents[0], 1, wide, co.branch && co.branch !== "HEAD" ? co.branch : null));
    }
    for (const co of solo ? [] : proj.checkouts) {
      rows.push(
        row(p, `co-${co.top}`, 1, null).tooltip(tilde(co.top))
          .child(svg(ICON(co.linked ? "layers" : "branch")).size(12).flex_none().text_color(p.faint))
          .child(div().min_w(0).truncate().text_size(12).text_color(p.muted).child(co.branch && co.branch !== "HEAD" ? co.branch : tilde(co.top).split("/").pop() || "—"))
          .child(div().flex_1())
          .child(div().flex_none().px(6).h(16).flex().items_center().rounded(8).bg(p.ground).text_size(10.5).text_color(p.faint).child(co.linked ? "worktree" : "main")),
        ...(wide ? [row(p, `cof-${co.top}`, 1, null).child(div().min_w(0).truncate().text_size(11).text_color(p.faint).pl(18).child(tilde(co.top)))] : []),
        ...co.agents.flatMap((a) => agentRows(p, a, 2, wide)));
    }
  }
  return v_flex().w_full().gap(1).children(rows);
}

export class Tree {
  constructor(wide) { this.wide = wide; }

  start(cx) {
    const look = (cx) => cx.spawn(async (cx) => {
      const ps = panes();
      const a = await refreshGit(ps.map((x) => x.cwd));
      const b = await scanSubagents(ps.filter(isAgent));
      if (a || b) cx.notify();
    });
    look(cx);
    cx.timer.every(5000, look);
    cx.timer.every(60000, (cx) => cx.notify());
  }

  render() {
    const p = pal();
    const projects = model();
    const empty = div().p(16).text_size(12.5).text_color(p.faint).child("No agents yet. New ▾ starts one.");
    if (this.wide)
      return div().size_full().bg(p.ground).p(8).overflow_y_scroll().child(
        h_flex().w_full().gap(8).flex_wrap().items_start()
          .children(projects.map((proj) => div().w(340).flex_none().p(6).rounded(14).bg(p.card).child(projectBlock(p, proj, true))))
          .when(projects.length === 0, (el) => el.child(empty)));
    return v_flex().size_full().bg(p.col).p(6).gap(8).overflow_y_scroll()
      .children(projects.map((proj) => projectBlock(p, proj, false)))
      .when(projects.length === 0, (el) => el.child(empty));
  }
}
