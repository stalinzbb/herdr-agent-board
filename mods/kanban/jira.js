// The Tasks panel: your work from every source you connected (tasks.json, chosen during setup).
//   Jira   - saved views and the morning digest, through Claude's Atlassian connector (jira-sync.py),
//            every refresh_minutes in work hours, the digest once a day.
//   GitHub - issues assigned to you, your PRs and review requests (gh), every few minutes.
//   Linear - issues assigned to you (its API), every few minutes.
//   Mine   - your own tasks, in ~/.config/herdr-board/tasks.local.json: add them here, or an agent
//            can (tasks-sync.py add "…").
// tasks-sync.py merges every source's views and tabs into one config, and fetches GitHub and Linear.
// Every row has the same shape, so grouping, folding and Today work the same for all of them.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, run, notify, home, appHome, readTextFile, writeTextFile, watchFolder, shared, setShared, openOverlay, spaces, knownAgents } from "herdr";
import { ICON, STATUS, pal, ago, dot, iconBtn, editConfig, USER_CONFIG } from "./ui.js";
import { demo, demoJira, DEMO_JIRA_CONFIG } from "./demo.js";
import { CAT, pill } from "./pill.js";

const CACHE = () => `${home()}/.cache/herdr-kanban`;
const LOCAL = () => `${USER_CONFIG()}/tasks.local.json`;
const LOCAL_CAT = { "To do": "new", Doing: "indeterminate", Done: "done" };
const SOURCE = { jira: "Jira", github: "GitHub", linear: "Linear", local: "Mine" };

// Where a row opens: its own link, else Jira's.
export function issueUrl(i, site) {
  return i.url ?? (i.source === "local" ? null : site ? `${site}/browse/${i.key}` : null);
}

// Your own tasks as rows.
const localRows = (data) => (data?.tasks ?? []).map((t) => ({
  key: t.id, id: t.id, summary: t.title, status: t.status, category: LOCAL_CAT[t.status] ?? "new",
  updated: t.updated, source: "local", type: "Task",
}));

async function readJson(name) {
  try {
    const t = await readTextFile(`${CACHE()}/${name}`);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

export class Jira {
  constructor() {
    this.cfg = { views: [] };
    this.data = null;
    this.digest = null;
    this.status = null;
    this.starting = false;
  }

  start(cx) {
    this.adding = InputState.new({ placeholder: "Add a task, then Enter" });
    this.adding.on("submit", (_e, cx) => this.addLocal(cx));
    // Your agents, for "start an agent on this": the New menu's list if it has one.
    cx.spawn(async () => { try { this.agents = await knownAgents({ on: spaces().find((s) => s.active)?.machine ?? null }); } catch {} });
    // Settings and your own tasks live in ~/.config/herdr-board: reload when they change.
    cx.spawn(async (cx) => {
      await exec("mkdir", ["-p", USER_CONFIG()]).catch(() => null);
      for (;;) {
        const changed = await watchFolder(USER_CONFIG()).catch(() => null);
        if (!changed) { await new Promise((r) => cx.timer.after(5000, r)); continue; }
        if (changed.some((f) => /tasks\.json$|jira\.json$/.test(f))) await this.loadConfig();
        if (changed.some((f) => f.endsWith("tasks.local.json"))) await this.loadLocal();
        cx.notify();
      }
    });
    cx.spawn(async (cx) => {
      await this.loadConfig();
      await this.load(true);
      this.tick();
      cx.notify();
      // The cache folder changes when a refresh writes: reload then.
      await exec("mkdir", ["-p", CACHE()]).catch(() => null);
      for (;;) {
        await watchFolder(CACHE());
        await this.load(false);
        cx.notify();
      }
    });
    cx.timer.every(60000, (cx) => { this.tick(); cx.notify(); });
  }

  // Every enabled source's views and tabs, merged by tasks-sync.py (Jira's preset and settings
  // through jira-sync.py), so the panel and the syncs agree.
  async loadConfig() {
    const r = await exec("/usr/bin/env", ["python3", "-I", `${appHome()}/mods/kanban/tasks-sync.py`, "config"]).catch((e) => ({ stdout: JSON.stringify({ error: String(e) }) }));
    let cfg;
    try { cfg = JSON.parse(r.stdout); } catch { cfg = { error: (r.stderr || r.stdout || "tasks-sync.py config failed").trim().slice(0, 200) }; }
    this.cfg = { views: [], sources: [], ...cfg };
    // The panel's name ("name" in tasks.json, else Jira's, else "Tasks"): the rail switch reads it.
    setShared("kanban.tasks.name", this.cfg.name || this.cfg.jira_name || "Tasks");
  }

  has(source) {
    return (this.cfg.sources ?? []).includes(source);
  }

  // Demo mode (kanban.demo): made-up tickets, no Jira calls.
  useDemo() {
    const d = demoJira();
    this.isDemo = true;
    // Jira and your own tasks, so the demo shows both kinds.
    this.cfg = {
      ...DEMO_JIRA_CONFIG,
      sources: ["jira", "local"],
      tabs: [...DEMO_JIRA_CONFIG.tabs, { id: "mine", label: "Mine", local: true, sections: [{ view: "local", group: "status" }] }],
      today_tabs: [...DEMO_JIRA_CONFIG.today_tabs, "mine"],
    };
    const t = Date.now();
    this.demoLocal = { tasks: [
      { id: "t3", title: "Write the release notes for the gallery", status: "Doing", updated: t - 3600000 },
      { id: "t2", title: "Ask Priya about the saved-cards copy", status: "To do", updated: t - 7200000 },
      { id: "t1", title: "Clean up old Figma branches", status: "Done", updated: t - 86400000 },
    ] };
    this.data = d.data;
    this.digest = d.digest;
    this.status = d.status;
  }

  async loadLocal() {
    if (this.isDemo) return;
    const text = await readTextFile(LOCAL()).catch(() => null);
    this.localText = text ?? null;
    try { this.local = text ? JSON.parse(text) : { tasks: [] }; } catch { this.local = { tasks: [] }; }
  }

  async load(first) {
    if (this.isDemo) return;
    const [jira, digest, status, github, linear] = await Promise.all([readJson("jira.json"), readJson("digest.json"), readJson("status.json"), readJson("github.json"), readJson("linear.json")]);
    if (first) await this.loadLocal();
    if (github?.at !== this.github?.at || linear?.at !== this.linear?.at) this.fastStarting = false;
    this.github = github;
    this.linear = linear;
    // One set of views from every source; only the enabled ones' tabs show them.
    const at = Math.max(...[this.has("jira") && jira?.at, this.has("github") && github?.at, this.has("linear") && linear?.at].filter(Boolean), 0) || null;
    const data = { at, site: jira?.site, views: { ...(this.has("jira") ? jira?.views : {}), ...(this.has("github") ? github?.views : {}), ...(this.has("linear") ? linear?.views : {}) } };
    if (!first && digest?.at && digest.at !== this.digest?.at) {
      const n = (digest.mentions?.length ?? 0) + (digest.comments?.length ?? 0);
      notify({
        title: `${shared("kanban.tasks.name") || "Tasks"}: your morning digest`,
        body: [`${digest.mentions?.length ?? 0} mentions`, `${digest.comments?.length ?? 0} new comments`, `${digest.moved?.length ?? 0} status changes`, `${digest.stale?.length ?? 0} quiet`].join(" · "),
        level: n > 0 ? "warning" : "info",
        action: { name: "layout.show", args: { id: "rail" } },
      });
    }
    this.data = data;
    this.digest = digest;
    this.status = status;
    this.starting = false;
    const count = (digest?.mentions?.length ?? 0) + (digest?.comments?.length ?? 0);
    if (shared("kanban.jira.count") !== count) setShared("kanban.jira.count", count);
  }

  // Jira refreshing through Claude (slow); GitHub and Linear are quick.
  jiraRunning() {
    return this.starting || (this.status?.state === "running" && Date.now() - this.status.at < 5 * 60000);
  }

  running() {
    return this.jiraRunning() || (this.fastStarting && Date.now() - this.fastStarting < 60000);
  }

  // Due: the digest once a day at digest_at (or the first chance after), else views every refresh_minutes in work hours.
  tick() {
    if (this.isDemo) return;
    // GitHub and Linear: every fast_minutes (5), quietly.
    const fastAt = Math.min(...[this.has("github") && (this.github?.at ?? 0), this.has("linear") && (this.linear?.at ?? 0)].filter((x) => x !== false));
    if (Number.isFinite(fastAt) && Date.now() - fastAt > (this.cfg.fast_minutes ?? 5) * 60000) this.refreshFast();
    if (this.jiraRunning() || !this.has("jira") || !this.cfg?.cloudId) return;
    const now = new Date();
    const at = new Date(now);
    at.setHours(this.cfg.digest_at ?? 8, 0, 0, 0);
    if (now >= at && (this.digest?.at ?? 0) < at.getTime()) return this.refresh("digest");
    const [from, to] = this.cfg.work_hours ?? [8, 19];
    const workday = now.getDay() > 0 && now.getDay() < 6;
    const stale = Date.now() - (this.data?.at ?? 0) > (this.cfg.refresh_minutes ?? 30) * 60000;
    if (!this.data || (workday && now.getHours() >= from && now.getHours() < to && stale)) this.refresh("sync");
  }

  refreshFast() {
    if (this.isDemo || this.fastStarting || !(this.has("github") || this.has("linear"))) return;
    this.fastStarting = Date.now();
    const script = `${appHome()}/mods/kanban/tasks-sync.py`;
    exec("hc", ["run", "--bg", "--no-parent", "--rm", "--name", "kanban-tasks", "--", "/bin/zsh", "-lc", `python3 -I '${script}' sync`])
      .then((r) => { if (r.code !== 0) this.fastStarting = false; })
      .catch(() => { this.fastStarting = false; });
  }

  refresh(mode) {
    if (this.isDemo) return;
    this.refreshFast();
    if (this.jiraRunning() || !this.has("jira")) return;
    this.starting = true;
    this.loadConfig();
    const script = `${appHome()}/mods/kanban/jira-sync.py`;
    // A login zsh: claude and python on your usual PATH. The name keeps two refreshes from overlapping.
    exec("hc", ["run", "--bg", "--no-parent", "--rm", "--name", "kanban-jira", "--", "/bin/zsh", "-lc", `python3 -I '${script}' ${mode}`])
      .then((r) => { if (r.code !== 0) this.starting = false; })
      .catch(() => { this.starting = false; });
  }

  tabs() {
    return this.cfg.tabs ?? [{ id: "today", label: "Today" }, ...this.cfg.views.map((v) => ({ id: v.id, label: v.label, sections: [{ view: v.id }] }))];
  }

  view() {
    const v = shared("kanban.jira.view");
    const tabs = this.tabs();
    if (tabs.some((t) => t.id === v)) return v;
    // First open, or the remembered tab is gone: "default_tab" in jira.json, else Today.
    return tabs.some((t) => t.id === this.cfg.default_tab) ? this.cfg.default_tab : "today";
  }

  // Folding: remembered per group; done groups start folded.
  isOpen(key, byDefault = true) {
    if (!this.fold) {
      try { this.fold = JSON.parse(localStorage.getItem("fold") ?? "{}"); } catch { this.fold = {}; }
    }
    return this.fold[key] ?? byDefault;
  }

  toggle(key, byDefault) {
    this.fold[key] = !this.isOpen(key, byDefault);
    try { localStorage.setItem("fold", JSON.stringify(this.fold)); } catch {}
  }

  issuesOf(viewId) {
    if (viewId === "local") return this.isDemo ? localRows(this.demoLocal) : localRows(this.local);
    return this.data?.views?.[viewId]?.issues ?? [];
  }

  // Your own tasks: written straight to the file (the watcher reloads it if an agent adds one).
  async saveLocal(change, cx) {
    if (this.isDemo) return;
    await this.loadLocal();
    const data = { tasks: [...(this.local?.tasks ?? [])] };
    change(data.tasks);
    const text = JSON.stringify(data, null, 2) + "\n";
    try {
      await writeTextFile(LOCAL(), text, this.localText);
      this.local = data;
      this.localText = text;
    } catch (e) {
      notify({ title: "Couldn't save your tasks", body: String(e).slice(0, 160), level: "warning" });
    }
    cx.notify();
  }

  addLocal(cx) {
    const title = this.adding.value().trim();
    if (!title) return;
    this.adding.set_value("");
    cx.spawn(async (cx) => this.saveLocal((tasks) => {
      const n = Math.max(0, ...tasks.map((t) => Number(String(t.id).replace(/^t/, "")) || 0)) + 1;
      tasks.unshift({ id: `t${n}`, title, status: "To do", created: Date.now(), updated: Date.now() });
    }, cx));
  }

  // Start an agent on a row: a new tab named after it, the task as its first message.
  startAgent(i) {
    const first = (this.agents ?? shared("kanban.agents")?.[""] ?? []).find((a) => a.installed);
    const url = issueUrl(i, this.data?.site ?? this.cfg.site);
    const name = `${i.source === "local" ? "" : `${i.key} `}${(i.summary ?? "").slice(0, 48)}`;
    if (!first) return run("tab.new", { name });
    run("tab.new", { name, argv: first.run, task: `Work on this ${i.source === "local" ? "task" : `${SOURCE[i.source] ?? "Jira"} ${i.type?.toLowerCase() ?? "ticket"}`}: ${i.summary}${url ? `\n${url}` : ""}` });
  }

  openCount(tab) {
    return (tab.sections ?? []).reduce((n, sec) => n + this.issuesOf(sec.view).filter((i) => !["done", "hide"].includes(sec.status_map?.[i.status] ?? i.category)).length, 0);
  }

  render(cx) {
    if (demo() && !this.isDemo) this.useDemo();
    else if (!demo() && this.isDemo) {
      this.isDemo = false;
      cx.spawn(async (cx) => { await this.loadConfig(); await this.load(true); cx.notify(); });
    }
    const p = pal();
    const cur = this.view();
    const count = (this.digest?.mentions?.length ?? 0) + (this.digest?.comments?.length ?? 0);
    const tabs = this.tabs().map((t) => ({ ...t, badge: t.id === "today" ? count : 0, n: t.id === "today" || t.id === "recent" || !this.data ? null : this.openCount(t) }));
    const busy = this.running();
    const err = this.cfg.error ?? (Object.values(this.cfg.errors ?? {})[0]) ?? (this.has("jira") && this.status?.state === "error" ? this.status.error : null);
    // Only your own tasks so far: say how to bring in the rest.
    const lonely = !this.isDemo && !this.cfg.error && !["jira", "github", "linear"].some((s) => this.has(s));

    return v_flex()
      .size_full()
      .bg(p.col)
      .text_color(p.ink)
      // Tabs
      .child(
        h_flex().flex_none().flex_wrap().gap(2).px(8).pt(8).pb(4).children(tabs.map((t) =>
          h_flex()
            .id(`jv-${t.id}`)
            .h(26)
            .px(7)
            .gap(4)
            .items_center()
            .rounded(9)
            .text_size(12.5)
            .cursor_pointer()
            .text_color(cur === t.id ? p.ink : p.muted)
            .when(cur === t.id, (el) => el.bg(p.raised))
            .hover((s) => s.text_color(p.ink))
            .on_mouse_down("left", (_e, cx) => { setShared("kanban.jira.view", t.id); cx.notify(); })
            .child(t.label)
            .when(t.badge > 0, (el) => el.child(div().px(5).rounded(9).bg("#e5566f26").text_color("#f2a0ae").text_size(11).font_medium().child(String(t.badge))))
            .when(!!t.n && !t.badge, (el) => el.child(div().text_size(11).text_color(p.faint).child(String(t.n)))))))
      // Freshness
      .child(
        h_flex().flex_none().h(28).px(12).gap(6).items_center().text_size(11.5).text_color(p.faint)
          .child(div().flex_1().min_w(0).truncate().child(
            busy ? (this.jiraRunning() ? "Refreshing Jira through Claude…" : "Refreshing…") : this.data?.at ? `Updated ${ago(Date.now() - this.data.at)}${ago(Date.now() - this.data.at) === "just now" ? "" : " ago"}` : lonely ? "Your own tasks" : "Not loaded yet"))
          .when(!lonely, (el) => el.child(iconBtn("jira-refresh", busy ? "spinner" : "reload", () => this.refresh(cur === "today" ? "digest" : "sync"), p)))
          .child(div().id("tasks-edit").tooltip("Sources: tasks.json (Jira's tabs: jira.json)").child(iconBtn("jira-edit", "logs", () => editConfig("tasks"), p))))
      .when(!!err, (el) => el.child(div().flex_none().px(12).pb(6).text_size(11.5).text_color(STATUS.blocked).child(String(err).slice(0, 220))))
      .when(lonely, (el) => el.child(div().flex_none().mx(12).mb(4).px(10).py(8).rounded(10).bg(p.card).text_size(12).text_color(p.muted)
        .child("Bring in GitHub issues, Linear or Jira: in Claude Code, run /herdr-agent-board:setup")))
      .child(
        v_flex().id(`jlist-${cur}`).flex_1().min_h(0).overflow_y_scrollbar().pb(12)
          .children(cur === "today" ? this.today(p) : this.tabBody(p, this.tabs().find((t) => t.id === cur))));
  }

  tabBody(p, tab) {
    const out = [];
    if (tab?.local) {
      out.push(h_flex().id("task-add").flex_none().mx(8).mt(8).h(34).px(10).items_center().rounded(10).border_1().border_color(p.line).bg(p.ground).cursor_text()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(this.adding).w_full().text_size(12.5).text_color(p.ink)));
    }
    const many = (tab.sections ?? []).length > 1;
    for (const sec of tab.sections ?? []) {
      const v = this.data?.views?.[sec.view];
      const label = sec.label ?? this.cfg.views.find((x) => x.id === sec.view)?.label ?? sec.view;
      if (many) {
        const open = this.issuesOf(sec.view).filter((i) => !["done", "hide"].includes(sec.status_map?.[i.status] ?? i.category)).length;
        out.push(h_flex().flex_none().h(30).mt(12).px(12).gap(8).items_center()
          .child(div().text_size(13).font_semibold().child(label))
          .child(div().text_size(12).text_color(p.faint).child(v?.issues ? `${open} open` : "")));
      }
      const local = sec.view === "local";
      if (!v && !local) { out.push(note(p, this.running() ? "Loading…" : "—")); continue; }
      if (v?.error) { out.push(note(p, v.error, STATUS.blocked)); continue; }
      const all = local ? this.issuesOf("local") : v.issues;
      if (!all?.length) { out.push(note(p, local ? "Nothing yet. Add one above, or have an agent run: tasks-sync.py add \"…\"" : "Nothing here")); continue; }
      const remap = (i) => ({ ...i, category: sec.status_map?.[i.status] ?? i.category });
      // status_map can send a status to "hide": a step you don't track here (e.g. Won't Do).
      let issues = all.map(remap).filter((i) => i.category !== "hide");
      if (sec.pair_migrate) issues = pairMigrate(issues);
      if (sec.group === "status") out.push(...this.byStatus(p, `${tab.id}.${sec.view}`, issues));
      else if (sec.group === "parent") out.push(...this.byParent(p, `${tab.id}.${sec.view}`, issues));
      else out.push(card(p, null, issues.map((i) => this.todayRow(p, i))));
    }
    return out;
  }

  // A fold header inside a card.
  foldHead(p, key, label, n, byDefault, extra) {
    const open = this.isOpen(key, byDefault);
    return h_flex()
      .id(`jg-${key}`)
      .flex_none()
      .h(32)
      .px(8)
      .gap(6)
      .items_center()
      .rounded(10)
      .cursor_pointer()
      .hover((s) => s.bg(p.hover))
      .on_mouse_down("left", (_e, cx) => { this.toggle(key, byDefault); cx.notify(); })
      .child(div().w(10).text_size(10).text_color(p.faint).child(open ? "▾" : "▸"))
      .child(div().text_size(13).font_semibold().text_color(p.ink).child(label))
      .child(div().text_size(12).text_color(p.faint).child(String(n)))
      .when(!!extra, (el) => el.child(div().flex_1()).child(extra));
  }

  moreLink(p, id, text, onPress) {
    return div().id(id).flex_none().h(28).px(8).flex().items_center().rounded(10).text_size(12).text_color(p.faint).cursor_pointer()
      .hover((s) => s.text_color(p.ink).bg(p.hover))
      .on_mouse_down("left", (_e, cx) => { onPress(); cx.notify(); })
      .child(text);
  }

  // In progress / To do / Done / Migrate to Master: one card each.
  byStatus(p, base, issues) {
    const out = [];
    const lone = issues.filter((i) => i.migrate && i.category !== "done");
    issues = issues.filter((i) => !(i.migrate && i.category !== "done"));
    const cutoff = Date.now() - (this.cfg.old_days ?? 60) * 86400000;
    for (const [cat, label] of [["indeterminate", "In progress"], ["new", "To do"], ["done", "Done"]]) {
      const group = issues.filter((i) => (i.category ?? "new") === cat);
      if (!group.length) continue;
      const key = `${base}.${cat}`;
      const byDefault = cat !== "done";
      const open = this.isOpen(key, byDefault);
      let rows = [], foot = null;
      if (open && cat === "indeterminate") rows = group.map((i) => this.todayRow(p, i));
      if (open && cat === "new") {
        const fresh = group.filter((i) => !i.updated || i.updated >= cutoff);
        const old = group.filter((i) => i.updated && i.updated < cutoff);
        const okey = `${key}.old`;
        const shown = this.more?.[okey];
        rows = fresh.map((i) => this.todayRow(p, i));
        if (shown) rows.push(...old.map((i) => this.compact(p, i)));
        if (!fresh.length && !shown) rows.push(div().px(8).py(6).text_size(12).text_color(p.faint).child("Nothing recent"));
        if (old.length) foot = this.moreLink(p, `jo-${key}`, shown ? "Hide older" : `Show ${old.length} older (no update in ${this.cfg.old_days ?? 60}+ days)`, () => { this.more = { ...this.more, [okey]: !shown }; });
      }
      if (open && cat === "done") {
        const all = this.more?.[key];
        rows = (all ? group : group.slice(0, 5)).map((i) => this.compact(p, i));
        if (group.length > 5) foot = this.moreLink(p, `jm-${key}`, all ? "Show fewer" : `Show ${group.length - 5} more`, () => { this.more = { ...this.more, [key]: !all }; });
      }
      out.push(card(p, this.foldHead(p, key, label, group.length, byDefault), rows, foot));
    }
    if (lone.length) {
      const key = `${base}.migrate`;
      const rows = this.isOpen(key, false) ? lone.map((i) => this.compact(p, { ...i, summary: i.summary.replace(/^Migrate to Master - /, "") })) : [];
      out.push(card(p, this.foldHead(p, key, "Migrate to Master", lone.length, false), rows));
    }
    return out;
  }

  // Design QA: a card per story, its review subtask and sub-bugs inside.
  byParent(p, base, issues) {
    const groups = new Map();
    for (const i of issues) {
      const k = i.parent ?? "—";
      if (!groups.has(k)) groups.set(k, { key: k, summary: i.parentSummary, status: i.parentStatus, items: [], latest: 0 });
      const g = groups.get(k);
      g.items.push(i);
      g.latest = Math.max(g.latest, i.updated ?? 0);
    }
    const list = [...groups.values()].map((g) => ({ ...g, open: g.items.filter((i) => i.category !== "done").length }));
    list.sort((a, b) => (b.open > 0) - (a.open > 0) || b.latest - a.latest);
    const site = this.data?.site ?? this.cfg.site;
    return list.map((g) => {
      const key = `${base}.${g.key}`;
      const done = g.items.length - g.open;
      const byDefault = g.open > 0;
      const open = this.isOpen(key, byDefault);
      const m = (g.summary ?? "").match(/^\[([^\]]+)\]\s*(.*)$/);
      const head = v_flex()
        .id(`jp-${g.key}`)
        .flex_none()
        .px(8)
        .py(7)
        .gap(5)
        .rounded(10)
        .cursor_pointer()
        .hover((s) => s.bg(p.hover))
        .on_mouse_down("left", (_e, cx) => { this.toggle(key, byDefault); cx.notify(); })
        .child(
          h_flex().gap(6).items_start()
            .child(div().w(10).pt(1).text_size(10).text_color(p.faint).child(open ? "▾" : "▸"))
            .child(div().flex_1().min_w(0).text_size(13).font_semibold().text_color(p.ink).child(m ? m[2] : g.summary ?? "No parent story")))
        .child(
          h_flex().pl(16).gap(6).items_center().text_size(11.5)
            .when(!!g.status, (el) => el.child(pill(g.status, /accepted|closed|done/i.test(g.status) ? "done" : "indeterminate")))
            .child(div().flex_none().text_color(p.faint).child(g.key))
            .when(!!m, (el) => el.child(div().flex_none().h(18).px(6).flex().items_center().rounded(9).bg(p.raised).text_color(p.muted).text_size(11).child(m[1])))
            .child(div().flex_1())
            .child(div().flex_none().text_color(g.open ? p.muted : CAT.done.color).child(`${done}/${g.items.length} accepted`))
            .when(g.key !== "—", (el) => el.child(iconBtn(`jpo-${g.key}`, "external", () => exec("open", [`${site}/browse/${g.key}`]), p))))
        .child(
          div().ml(16).h(3).rounded_full().bg(p.raised).child(
            div().h_full().rounded_full().bg(CAT.done.color).w(Math.round((done / g.items.length) * 260))));
      const rows = open ? g.items.sort((a, b) => (a.category === "done") - (b.category === "done") || (b.updated ?? 0) - (a.updated ?? 0)).map((i) => this.compact(p, i)) : [];
      return card(p, head, rows);
    });
  }

  // A row opens its link; your own tasks have none, so they open their status menu.
  openRow(i) {
    const url = issueUrl(i, this.data?.site ?? this.cfg.site);
    if (url) exec("open", [url]);
    else openStatus(i);
  }

  // Two-line row: the whole title, then status · key · tags.
  todayRow(p, i, flag) {
    const site = this.data?.site ?? this.cfg.site;
    const m = (i.summary ?? "").match(/^\[([^\]]+)\]\s*(.*)$/);
    const platform = m ? m[1] : null;
    const title = m ? m[2] : i.summary ?? "";
    const tag = (text, color, bg) => div().flex_none().h(18).px(6).flex().items_center().rounded(9).bg(bg).text_color(color).text_size(11).child(text);
    return v_flex()
      .id(`jt-${i.key}`)
      .flex_none()
      .px(8)
      .py(8)
      .gap(5)
      .rounded(10)
      .cursor_pointer()
      .hover((s) => s.bg(p.hover))
      .on_click(() => this.openRow(i))
      .child(div().text_size(13).text_color(p.ink).child(title))
      .child(
        h_flex().w_full().min_w(0).gap(6).items_center().text_size(11.5)
          .child(statusBtn(i))
          .when(i.source !== "local", (el) => el.child(div().flex_none().text_color(p.faint).child(i.key)))
          .when(!!i.kind, (el) => el.child(div().min_w(0).truncate().text_color(p.faint).child(`· ${i.kind}`)))
          .child(div().flex_1().min_w(0))
          .when(!!platform, (el) => el.child(tag(platform, p.muted, p.raised)))
          .when(!!flag, (el) => el.child(tag(flag, STATUS.working, "#e2b3401f")))
          .child(div().id(`jstart-${i.key}`).tooltip("Start an agent on this, in a new tab").child(iconBtn(`jcard-${i.key}`, "play", () => this.startAgent({ ...i, summary: title }), p))))
      .children((i.children ?? []).map((c) => this.compact(p, { ...c, summary: `Master: ${c.summary.replace(/^Migrate to Master - /, "")}` })));
  }

  // One-line row, inside a card.
  compact(p, i, flag = null) {
    const site = this.data?.site ?? this.cfg.site;
    return h_flex()
      .id(`jc-${i.key}`)
      .flex_none()
      .px(8)
      .h(30)
      .gap(6)
      .items_center()
      .rounded(10)
      .text_size(12)
      .cursor_pointer()
      .hover((s) => s.bg(p.hover))
      .on_click(() => this.openRow(i))
      .child(statusBtn(i))
      .when(i.source !== "local", (el) => el.child(div().flex_none().text_color(p.faint).child(i.key)))
      .child(div().flex_1().min_w(0).truncate().text_color(i.category === "done" ? p.muted : p.ink).child(i.summary ?? ""))
      .when(!!flag, (el) => el.child(div().flex_none().px(5).rounded(9).bg("#e2b3401f").text_color(STATUS.working).text_size(11).child(flag)));
  }

  issue(p, i) {
    const site = this.data?.site ?? this.cfg.site;
    return v_flex()
      .flex_none()
      .child(
        v_flex()
          .id(`ji-${i.key}`)
          .flex_none()
          .mx(4)
          .px(8)
          .py(7)
          .gap(3)
          .rounded(10)
          .cursor_pointer()
          .hover((s) => s.bg(p.hover))
          .on_click(() => this.openRow(i))
          .child(
            h_flex().gap(6).items_center().text_size(11.5)
              .child(div().flex_none().text_color(p.faint).child(i.key))
              .child(statusBtn(i))
              .child(div().flex_1())
              .when(!!i.updated, (el) => el.child(div().flex_none().text_color(p.faint).child(ago(Date.now() - i.updated))))
              .child(iconBtn(`jcard-${i.key}`, "play", () => this.startAgent(i), p)))
          .child(div().text_size(13).text_color(p.ink).child(i.summary ?? ""))
          .when(!!i.type, (el) => el.child(div().text_size(11.5).text_color(p.faint).child([i.type, i.parent ? `in ${i.parent}` : null].filter(Boolean).join(" · ")))))
      .children((i.children ?? []).map((c) => this.compact(p, { ...c, summary: `Master: ${c.summary.replace(/^Migrate to Master - /, "")}` }, 16)));
  }

  today(p) {
    const d = this.digest;
    const site = this.data?.site ?? this.cfg.site;
    const out = [];

    // What's new since the last digest: only the parts that have something.
    if (!this.has("jira") && !this.isDemo) {
      // No Jira, no digest: Today is your open work from every source.
    } else if (!d) out.push(note(p, this.running() ? "Building your digest…" : `Your digest runs each day at ${this.cfg.digest_at ?? 8}:00. Press ⟳ to run it now.`));
    else {
      const since = new Date(d.since);
      const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][since.getDay()];
      const h = since.getHours(), m = String(since.getMinutes()).padStart(2, "0");
      const when = `${day} ${since.getMonth() + 1}/${since.getDate()}, ${h % 12 || 12}:${m} ${h < 12 ? "am" : "pm"}`;
      const comment = (c, i, kind) =>
        v_flex().id(`jd-${kind}-${i}`).flex_none().mx(4).px(8).py(7).gap(3).rounded(10).cursor_pointer().hover((s) => s.bg(p.hover))
          .on_click(() => exec("open", [`${site}/browse/${c.key}`]))
          .child(h_flex().gap(6).text_size(11.5).text_color(p.faint)
            .child(div().flex_none().child(c.key))
            .child(div().flex_1().min_w(0).truncate().text_color(p.muted).child(c.author ?? ""))
            .child(div().flex_none().child(ago(Date.now() - c.at))))
          .child(div().text_size(13).child(c.summary ?? ""))
          .child(div().text_size(12).text_color(p.muted).child(c.text || "—"));
      if (d.mentions_error) out.push(note(p, d.mentions_error, STATUS.blocked));
      if (d.mentions.length) out.push(section(p, "Mentions you", d.mentions.length), ...d.mentions.map((c, i) => comment(c, i, "m")));
      if (d.comments.length) out.push(section(p, "New comments on your tickets", d.comments.length), ...d.comments.map((c, i) => comment(c, i, "c")));
      if (d.moved.length)
        out.push(section(p, "Status changes", d.moved.length), ...d.moved.map((m) =>
          h_flex().id(`jd-mv-${m.key}`).flex_none().mx(4).px(8).h(30).gap(6).items_center().rounded(9).text_size(12).cursor_pointer().hover((s) => s.bg(p.hover))
            .on_click(() => exec("open", [`${site}/browse/${m.key}`]))
            .child(div().flex_none().text_color(p.faint).child(m.key))
            .child(div().flex_none().text_color(p.muted).child(`${m.from} → ${m.to}`))
            .child(div().flex_1().min_w(0).truncate().child(m.summary ?? ""))));

    }

    // Your open work, by kind: in progress, then recent to-dos. Done never shows here.
    const quiet = new Set((d?.stale ?? []).map((i) => i.key));
    const cutoff = Date.now() - (this.cfg.old_days ?? 60) * 86400000;
    const todayTabs = this.cfg.today_tabs ?? this.tabs().map((t) => t.id).filter((id) => id !== "today" && id !== "recent");
    for (const tabId of todayTabs) {
      const tab = this.tabs().find((t) => t.id === tabId);
      if (!tab) continue;
      const rows = [];
      let older = 0, total = 0;
      const many = (tab.sections ?? []).length > 1;
      for (const sec of tab.sections ?? []) {
        let issues = this.issuesOf(sec.view).map((i) => ({ ...i, category: sec.status_map?.[i.status] ?? i.category }));
        if (sec.pair_migrate) issues = pairMigrate(issues).filter((i) => !i.migrate);
        const prog = issues.filter((i) => i.category === "indeterminate");
        const todo = issues.filter((i) => (i.category ?? "new") === "new");
        const fresh = todo.filter((i) => !i.updated || i.updated >= cutoff);
        older += todo.length - fresh.length;
        const list = [...prog, ...fresh];
        total += list.length;
        if (!list.length) continue;
        if (many) rows.push({ isLabel: true, el: div().px(8).pt(8).pb(2).text_size(11.5).font_medium().text_color(p.faint).child(sec.label ?? sec.view) });
        // Sub-tasks with a stock title ("Design Review"): name the story they belong to instead.
        const stock = sec.title_from_parent ? new RegExp(sec.title_from_parent, "i") : null;
        const label = (i) => (stock && i.parentSummary && stock.test(i.summary ?? "") ? { ...i, summary: i.parentSummary } : i);
        rows.push(...list.map((i) => this.todayRow(p, label(i), quiet.has(i.key) ? `quiet ${ago(Date.now() - i.updated)}` : null)));
      }
      // One card per kind of work.
      const head = h_flex().id(`jt-${tabId}`).flex_none().h(32).px(8).gap(8).items_center().rounded(10).cursor_pointer()
        .hover((s) => s.bg(p.hover))
        .on_mouse_down("left", (_e, cx) => { setShared("kanban.jira.view", tabId); cx.notify(); })
        .child(div().text_size(13).font_semibold().text_color(p.ink).child(tab.label))
        .child(div().text_size(12).text_color(p.faint).child(String(total)))
        .child(div().flex_1())
        .child(div().text_size(11.5).text_color(p.faint).child("Open ›"));
      out.push(card(p, head, rows.length ? rows : [div().px(8).py(8).text_size(12).text_color(p.faint).child("Nothing open")],
        older > 0 ? this.moreLink(p, `jto-${tabId}`, `+${older} older in ${tab.label}`, () => setShared("kanban.jira.view", tabId)) : null));
    }
    return out;
  }
}

// A card: a little inner padding so every hover highlight (rounded itself) stays inside
// the card's rounded corners. Rows are split by inset rules; {isLabel, el} rows aren't.
function card(p, head, rows = [], foot = null) {
  const rule = () => div().flex_none().h(1).mx(8).my(1).bg(p.line);
  const body = [];
  rows.forEach((r, n) => {
    if (n > 0 && !r.isLabel && !rows[n - 1].isLabel) body.push(rule());
    body.push(r.el ?? r);
  });
  return v_flex()
    .flex_none()
    .mx(8)
    .mt(8)
    .p(4)
    .rounded(14)
    .bg(p.card)
    .border_1()
    .border_color(p.line)
    .when(!!head, (el) => el.child(head))
    .when(!!head && body.length > 0, (el) => el.child(rule()))
    .children(body)
    .when(!!foot, (el) => el.child(rule()).child(foot));
}

// UXD pairs: "Migrate to Master - X" goes under its design ticket "X".
function pairMigrate(issues) {
  const PREFIX = "Migrate to Master - ";
  const designs = new Map(issues.filter((i) => !i.summary?.startsWith(PREFIX)).map((i) => [i.key, { ...i, children: [] }]));
  // Several tickets can share a title: a migration goes to the first design with that exact title.
  const byName = new Map();
  for (const d of designs.values()) if (!byName.has(d.summary)) byName.set(d.summary, d);
  const out = [];
  for (const i of issues) {
    if (i.summary?.startsWith(PREFIX)) {
      const design = byName.get(i.summary.slice(PREFIX.length));
      if (design) design.children.push(i);
      else out.push({ ...i, migrate: true });
    } else out.push(designs.get(i.key));
  }
  return out;
}

// The status pill as a button: opens the move menu. Stops the press so the row doesn't also open Jira.
function openStatus(i) {
  openOverlay({ mod: "kanban", props: { role: "jstatus", key: i.key, summary: i.summary, status: i.status, category: i.category, source: i.source ?? "jira", id: i.id ?? null, url: i.url ?? null, type: i.type ?? null }, kind: "popup", width: 300, height: 260 });
}

function statusBtn(i) {
  return div()
    .id(`js-${i.key}`)
    .flex_none()
    .cursor_pointer()
    .hover((s) => s.opacity(0.8))
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      openStatus(i);
    })
    .child(pill(`${i.status ?? ""} ▾`, i.category));
}

function section(p, label, n) {
  return h_flex().flex_none().h(32).mt(8).px(12).gap(8).items_center()
    .child(div().text_size(12.5).font_semibold().text_color(p.muted).child(label))
    .child(div().text_size(12).text_color(p.faint).child(String(n)));
}

function note(p, text, color) {
  return div().px(12).py(4).text_size(12).text_color(color ?? p.faint).child(text);
}
