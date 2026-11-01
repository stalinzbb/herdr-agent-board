// The Tasks panel (Jira underneath): saved views and the morning digest, read from the cache that
// jira-sync.py fills through Claude's Atlassian connector. This copy also decides
// when to refresh: every refresh_minutes in work hours, the digest once a day.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, notify, home, appHome, readTextFile, watchFolder, shared, setShared, openOverlay } from "herdr";
import { ICON, STATUS, pal, ago, dot, iconBtn, editConfig } from "./ui.js";
import { demo, demoJira, DEMO_JIRA_CONFIG } from "./demo.js";
import { CAT, pill } from "./pill.js";

const CACHE = () => `${home()}/.cache/herdr-kanban`;

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

  // The preset and your settings, merged by jira-sync.py so the panel and the sync agree.
  async loadConfig() {
    const r = await exec("/usr/bin/env", ["python3", "-I", `${appHome()}/mods/kanban/jira-sync.py`, "config"]).catch((e) => ({ stdout: JSON.stringify({ error: String(e) }) }));
    let cfg;
    try { cfg = JSON.parse(r.stdout); } catch { cfg = { error: (r.stderr || r.stdout || "jira-sync.py config failed").trim().slice(0, 200) }; }
    this.cfg = { views: [], ...cfg };
    // The panel's name ("name" in jira.json, else "Tasks"): the rail switch and board button read it.
    setShared("kanban.tasks.name", this.cfg.name || "Tasks");
  }

  // Demo mode (kanban.demo): made-up tickets, no Jira calls.
  useDemo() {
    const d = demoJira();
    this.isDemo = true;
    this.cfg = { ...DEMO_JIRA_CONFIG };
    this.data = d.data;
    this.digest = d.digest;
    this.status = d.status;
  }

  async load(first) {
    if (this.isDemo) return;
    const [data, digest, status] = await Promise.all([readJson("jira.json"), readJson("digest.json"), readJson("status.json")]);
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

  running() {
    return this.starting || (this.status?.state === "running" && Date.now() - this.status.at < 5 * 60000);
  }

  // Due: the digest once a day at digest_at (or the first chance after), else views every refresh_minutes in work hours.
  tick() {
    if (this.isDemo || this.running() || !this.cfg?.cloudId) return;
    const now = new Date();
    const at = new Date(now);
    at.setHours(this.cfg.digest_at ?? 8, 0, 0, 0);
    if (now >= at && (this.digest?.at ?? 0) < at.getTime()) return this.refresh("digest");
    const [from, to] = this.cfg.work_hours ?? [8, 19];
    const workday = now.getDay() > 0 && now.getDay() < 6;
    const stale = Date.now() - (this.data?.at ?? 0) > (this.cfg.refresh_minutes ?? 30) * 60000;
    if (!this.data || (workday && now.getHours() >= from && now.getHours() < to && stale)) this.refresh("sync");
  }

  refresh(mode) {
    if (this.isDemo || this.running()) return;
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
    return this.data?.views?.[viewId]?.issues ?? [];
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
    const err = this.cfg.error ?? (!this.cfg.cloudId ? "Jira isn't set up yet. In Claude Code, run /herdr-agent-board:setup." : this.status?.state === "error" ? this.status.error : null);

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
            busy ? "Refreshing through Claude…" : this.data?.at ? `Updated ${ago(Date.now() - this.data.at)}${ago(Date.now() - this.data.at) === "just now" ? "" : " ago"}` : "Not loaded yet"))
          .child(iconBtn("jira-refresh", busy ? "spinner" : "reload", () => this.refresh(cur === "today" ? "digest" : "sync"), p))
          .child(iconBtn("jira-edit", "logs", () => editConfig("jira"), p)))
      .when(!!err, (el) => el.child(div().flex_none().px(12).pb(6).text_size(11.5).text_color(STATUS.blocked).child(String(err).slice(0, 220))))
      .child(
        v_flex().id(`jlist-${cur}`).flex_1().min_h(0).overflow_y_scrollbar().pb(12)
          .children(cur === "today" ? this.today(p) : this.tabBody(p, this.tabs().find((t) => t.id === cur))));
  }

  tabBody(p, tab) {
    const out = [];
    const many = (tab.sections ?? []).length > 1;
    for (const sec of tab.sections ?? []) {
      const v = this.data?.views?.[sec.view];
      const label = sec.label ?? this.cfg.views.find((x) => x.id === sec.view)?.label ?? sec.view;
      if (many) {
        const open = (v?.issues ?? []).filter((i) => !["done", "hide"].includes(sec.status_map?.[i.status] ?? i.category)).length;
        out.push(h_flex().flex_none().h(30).mt(12).px(12).gap(8).items_center()
          .child(div().text_size(13).font_semibold().child(label))
          .child(div().text_size(12).text_color(p.faint).child(v?.issues ? `${open} open` : "")));
      }
      if (!v) { out.push(note(p, this.running() ? "Loading…" : "—")); continue; }
      if (v.error) { out.push(note(p, v.error, STATUS.blocked)); continue; }
      if (!v.issues?.length) { out.push(note(p, "No tickets")); continue; }
      const remap = (i) => ({ ...i, category: sec.status_map?.[i.status] ?? i.category });
      // status_map can send a status to "hide": a step you don't track here (e.g. Won't Do).
      let issues = v.issues.map(remap).filter((i) => i.category !== "hide");
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
      .on_click(() => exec("open", [`${site}/browse/${i.key}`]))
      .child(div().text_size(13).text_color(p.ink).child(title))
      .child(
        h_flex().w_full().min_w(0).gap(6).items_center().text_size(11.5)
          .child(statusBtn(i))
          .child(div().flex_none().text_color(p.faint).child(i.key))
          .when(!!i.kind, (el) => el.child(div().min_w(0).truncate().text_color(p.faint).child(`· ${i.kind}`)))
          .child(div().flex_1().min_w(0))
          .when(!!platform, (el) => el.child(tag(platform, p.muted, p.raised)))
          .when(!!flag, (el) => el.child(tag(flag, STATUS.working, "#e2b3401f")))
          .child(iconBtn(`jcard-${i.key}`, "plus", () => run("tab.new", { name: `${i.key} ${title.slice(0, 48)}` }), p)))
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
      .on_click(() => exec("open", [`${site}/browse/${i.key}`]))
      .child(statusBtn(i))
      .child(div().flex_none().text_color(p.faint).child(i.key))
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
          .on_click(() => exec("open", [`${site}/browse/${i.key}`]))
          .child(
            h_flex().gap(6).items_center().text_size(11.5)
              .child(div().flex_none().text_color(p.faint).child(i.key))
              .child(statusBtn(i))
              .child(div().flex_1())
              .when(!!i.updated, (el) => el.child(div().flex_none().text_color(p.faint).child(ago(Date.now() - i.updated))))
              .child(iconBtn(`jcard-${i.key}`, "plus", () => run("tab.new", { name: `${i.key} ${(i.summary ?? "").slice(0, 48)}` }), p)))
          .child(div().text_size(13).text_color(p.ink).child(i.summary ?? ""))
          .when(!!i.type, (el) => el.child(div().text_size(11.5).text_color(p.faint).child([i.type, i.parent ? `in ${i.parent}` : null].filter(Boolean).join(" · ")))))
      .children((i.children ?? []).map((c) => this.compact(p, { ...c, summary: `Master: ${c.summary.replace(/^Migrate to Master - /, "")}` }, 16)));
  }

  today(p) {
    const d = this.digest;
    const site = this.data?.site ?? this.cfg.site;
    const out = [];

    // What's new since the last digest: only the parts that have something.
    if (!d) out.push(note(p, this.running() ? "Building your digest…" : `Your digest runs each day at ${this.cfg.digest_at ?? 8}:00. Press ⟳ to run it now.`));
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
function statusBtn(i) {
  return div()
    .id(`js-${i.key}`)
    .flex_none()
    .cursor_pointer()
    .hover((s) => s.opacity(0.8))
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      openOverlay({ mod: "kanban", props: { role: "jstatus", key: i.key, summary: i.summary, status: i.status, category: i.category }, kind: "popup", width: 300, height: 260 });
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
