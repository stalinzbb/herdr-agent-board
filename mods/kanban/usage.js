// Model usage: a status-bar widget (today's tokens by model, cache share) and its popup.
// Data: usage.py, run every 5 minutes, reading Claude Code's own logs on this Mac.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, home, appHome, readTextFile, watchFolder, openOverlay, closeOverlay, props } from "herdr";
import { pal, ago, ICON, readConfig } from "./ui.js";

const CACHE = () => `${home()}/.cache/herdr-kanban`;
const fmt = (n) => (n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
function modelName(id) {
  const m = (id ?? "").match(/claude-([a-z]+)-(\d+)-(\d+)/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
}
const HUE = { opus: "#e2b340", sonnet: "#4c9aff", haiku: "#3fc07a", fable: "#d66bb3" };
const hue = (id) => HUE[Object.keys(HUE).find((k) => (id ?? "").includes(k))] ?? "#8a8a8a";
const total = (a) => a.input + a.output + a.cache_read + a.cache_write;
const usd = (n) => (n == null ? "—" : n >= 1000 ? `$${Math.round(n).toLocaleString()}` : n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(2)}` : "$0");

async function load() {
  try {
    const t = await readTextFile(`${CACHE()}/usage.json`);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

function scan() {
  const script = `${appHome()}/mods/kanban/usage.py`;
  return exec("hc", ["run", "--bg", "--no-parent", "--rm", "--name", "kj-usage", "--", "/bin/zsh", "-lc", `python3 -I '${script}'`]).catch(() => null);
}

export class UsageWidget {
  start(cx) {
    cx.spawn(async (cx) => {
      this.data = await load();
      if (!this.data || Date.now() - this.data.at > 5 * 60000) scan();
      cx.notify();
      for (;;) {
        const changed = await watchFolder(CACHE());
        if (changed.some((p) => p.endsWith("usage.json"))) { this.data = await load(); cx.notify(); }
      }
    });
    cx.timer.every(5 * 60000, () => scan());
  }

  render() {
    const p = pal();
    const d = this.data;
    const models = Object.entries(d?.models ?? {}).sort((a, b) => total(b[1]) - total(a[1]));
    const all = models.reduce((s, [, a]) => ({ in: s.in + a.input + a.cache_write, cr: s.cr + a.cache_read }), { in: 0, cr: 0 });
    const share = all.in + all.cr ? Math.round((all.cr / (all.in + all.cr)) * 100) : null;
    return h_flex()
      .id("usage-widget")
      .size_full()
      .px(14)
      .gap(12)
      .justify_end()
      .items_center()
      .bg(p.col)
      .border_t(1)
      .border_color(p.line)
      .text_size(11.8)
      .text_color(p.muted)
      .cursor_pointer()
      .hover((s) => s.text_color(p.ink))
      .on_click(() => openOverlay({ mod: "kanban", props: { role: "usagestats" }, kind: "window", key: "usage-stats", width: 900, height: 680, frame: "none" }))
      .child(div().text_color(p.faint).child("Today"))
      .when(models.length > 0, (el) => el.child(div().font_medium().text_color(p.ink).child(`≈ ${usd(models.reduce((n, [, a]) => n + (a.cost ?? 0), 0))}`)))
      .children(models.length ? models.slice(0, 3).map(([m, a]) =>
        h_flex().gap(6).items_center().child(div().w(6).h(6).rounded(3).bg(hue(m))).child(`${modelName(m)} ${fmt(total(a))}`)) : [div().text_color(p.faint).child(d ? "no Claude use yet" : "reading usage…")])
      .when(share != null, (el) => el.child(div().text_color(p.faint).child(`cache ${share}%`)));
  }
}

// The full stats window: today / 7 days / 30 days / all time, from the long-term database.
const RANGES = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All time"]];
const fresh = (a) => a.input + a.output + (a.cache_5m ?? 0) + (a.cache_1h ?? 0);
const all = (a) => fresh(a) + a.cache_read;

// Folders your repos live in (usage.json "code_roots"), left off project names: ~/code/app → app.
let ROOTS = [];

function place(cwd, project) {
  const h = home();
  let p = cwd ?? project ?? "";
  const wt = p.match(/^(.*)\/\.claude\/worktrees\/([^/]+)/);
  if (wt) p = wt[1];
  if (h && p.startsWith(h)) p = "~" + p.slice(h.length);
  const root = ROOTS.map((r) => r.replace(/\/?$/, "/")).find((r) => p.startsWith(r));
  return { path: root ? p.slice(root.length) : p, worktree: wt ? wt[2] : null };
}

export class UsageStats {
  start(cx) {
    cx.spawn(async (cx) => { ROOTS = (await readConfig("usage", {})).code_roots ?? []; cx.notify(); });
    this.range = "7d";
    try { this.focus = cx.focus_handle(); this.focus.focus(); } catch {}
    cx.spawn(async (cx) => {
      this.data = await load();
      cx.notify();
      for (;;) {
        const changed = await watchFolder(CACHE());
        if (changed.some((p) => p.endsWith("usage.json"))) { this.data = await load(); cx.notify(); }
      }
    });
  }

  close() {
    const id = props()?.overlay;
    if (!id) return;
    try { closeOverlay(id); } catch {}
    run("overlay.close", { id });
  }

  render() {
    const p = pal();
    const d = this.data;
    const shell = v_flex().id("usage-stats")
      .when(!!this.focus, (el) => el.track_focus(this.focus).on_key_down((e, cx) => { if (e?.keystroke === "escape") this.close(); })).size_full().bg(p.popover).text_color(p.ink).rounded(16).border_1().border_color(p.line);
    if (!d?.ranges) return shell.p(20).text_size(13).text_color(p.faint).child("Reading Claude's logs… the first import takes about 15 seconds.");
    const r = d.ranges[this.range];
    const t = r.totals;
    const stop = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());
    const kpi = (label, value, note) =>
      v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(12).text_color(p.faint).child(label))
        .child(div().text_size(22).font_semibold().child(value))
        .when(!!note, (el) => el.child(div().text_size(11.5).text_color(p.faint).child(note)));
    const box = (title, body) =>
      v_flex().flex_1().min_w(0).p(14).gap(8).rounded(14).bg(p.card).border_1().border_color(p.line)
        .child(div().text_size(12.5).font_semibold().text_color(p.muted).child(title))
        .children(body);
    const bar = (share, color) => div().h(6).w_full().rounded(3).bg(p.raised).child(div().h_full().rounded(3).bg(color).w(Math.max(2, Math.round(share * 140))));
    const allTok = all(t);
    const cacheShare = allTok ? t.cache_read / (t.cache_read + t.input + t.cache_5m + t.cache_1h || 1) : 0;
    const maxModel = Math.max(1, ...r.models.map(all));
    const maxCost = Math.max(1e-9, ...r.models.map((m) => m.cost ?? 0));
    const maxProjCost = Math.max(1e-9, ...r.projects.map((x) => x.cost ?? 0));
    const byCost = this.metric === "cost";
    const val = (x) => (byCost ? x.cost : x.tokens);
    const part = (x) => (byCost ? x.costs ?? {} : x.models);
    const maxSeries = Math.max(1e-9, ...r.series.map(val));
    const maxHour = Math.max(1, ...r.hours);
    const maxProj = Math.max(1, ...r.projects.map((x) => x.tokens));
    const label = (key) => (this.range === "all" ? new Date(key + "-01T12:00").toLocaleString(undefined, { month: "short" }) : key.slice(8));

    return shell
      // Title bar (drag the window by it) and range tabs
      .child(
        h_flex().flex_none().h(52).px(18).gap(10).items_center()
          .child(div().text_size(15).font_semibold().child("Claude usage"))
          .child(div().text_size(12).text_color(p.faint).child(`since ${d.ranges.all.totals.first_day} · updated ${ago(Date.now() - d.at)}${ago(Date.now() - d.at) === "just now" ? "" : " ago"}`))
          .child(div().flex_1())
          .child(stop(h_flex().p(3).gap(2).rounded(12).bg(p.ground).children(RANGES.map(([id, name]) =>
            div().id(`ur-${id}`).h(26).px(12).flex().items_center().rounded(9).text_size(12.5).cursor_pointer()
              .text_color(this.range === id ? p.ink : p.muted).when(this.range === id, (el) => el.bg(p.raised))
              .hover((s) => s.text_color(p.ink))
              .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.range = id; cx.notify(); })
              .child(name)))))
          .child(div().id("ustats-close").w(32).h(32).flex().items_center().justify_center().rounded(10).cursor_pointer().text_color(p.muted)
            .hover((s) => s.bg(p.hover).text_color(p.ink))
            .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.close(); })
            .on_click((_e, cx) => { cx.stop_propagation(); this.close(); })
            .child(svg(ICON("x")).size(16))))
      .child(div().h(1).bg(p.line))
      .child(
        stop(v_flex().id("ustats-body").flex_1().min_h(0).overflow_y_scrollbar().p(18).gap(14)
          // Headline numbers
          .child(h_flex().gap(16)
            .child(kpi("Estimated cost", usd(t.cost), `cache saved ≈ ${usd(t.cache_saved)}`))
            .child(kpi("All tokens", fmt(allTok), "including cache reads"))
            .child(kpi("Fresh tokens", fmt(fresh(t)), "input + output + cache writes"))
            .child(kpi("Served from cache", `${Math.round(cacheShare * 100)}%`, `${fmt(t.cache_read)} read`))
            .child(kpi("Output", fmt(t.output), `${t.replies.toLocaleString()} replies`))
            .child(kpi("Sessions", String(t.sessions), t.sessions ? `≈ ${usd(t.cost / t.sessions)} each` : "")))
          // Over time, by model
          .child(box(this.range === "all" ? "By month" : this.range === "today" ? "Today" : "By day", [
            h_flex().gap(2).p(2).rounded(10).bg(p.ground).children([["tokens", "Tokens"], ["cost", "Cost"]].map(([id, name]) =>
              div().id(`um-${id}`).h(22).px(10).flex().items_center().rounded(8).text_size(11.5).cursor_pointer()
                .text_color((this.metric ?? "tokens") === id ? p.ink : p.muted).when((this.metric ?? "tokens") === id, (el) => el.bg(p.raised))
                .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.metric = id; cx.notify(); })
                .child(name))),
            h_flex().h(130).gap(4).items_end().children(r.series.map((x) =>
              v_flex().flex_1().min_w(0).gap(4).items_center()
                .child(div().text_size(10).text_color(p.faint).child(byCost ? usd(x.cost) : fmt(x.tokens)))
                .child(v_flex().w_full().justify_end().h(Math.max(2, Math.round((val(x) / maxSeries) * 90))).rounded(5).overflow_hidden()
                  .children(Object.entries(part(x)).sort((a, b) => a[1] - b[1]).map(([m, v]) => div().w_full().flex_none().bg(hue(m)).h(Math.max(1, Math.round((v / maxSeries) * 90))))))
                .child(div().text_size(10.5).text_color(p.faint).child(label(x.key))))),
            h_flex().gap(12).flex_wrap().children(r.models.slice(0, 6).map((m) => h_flex().gap(5).items_center().text_size(11.5).text_color(p.muted).child(div().w(7).h(7).rounded(4).bg(hue(m.model))).child(modelName(m.model)))),
          ]))
          // Models | Projects
          .child(h_flex().gap(14).items_start()
            .child(box("By model", r.models.map((m) =>
              v_flex().gap(4).py(2)
                .child(h_flex().gap(7).items_center().text_size(12.5)
                  .child(div().w(7).h(7).rounded(4).bg(hue(m.model)))
                  .child(div().flex_1().child(modelName(m.model)))
                  .child(div().text_color(p.ink).child(usd(m.cost)))
                  .child(div().w(52).flex_none().text_color(p.faint).child(fmt(all(m)))))
                .child(bar((m.cost ?? 0) / maxCost, hue(m.model)))
                .child(div().text_size(11).text_color(p.faint).child(`${fmt(m.output)} out · ${fmt(m.input + m.cache_5m + m.cache_1h)} in · ${fmt(m.cache_read)} cached · ${m.replies.toLocaleString()} replies`)))))
            .child(box("By project", r.projects.slice(0, 8).map((x) => {
              const pl = place(x.cwd, x.project);
              return v_flex().gap(4).py(2)
                .child(h_flex().gap(6).items_center().text_size(12.5)
                  .child(div().flex_1().min_w(0).truncate().child(pl.path))
                  .when(!!pl.worktree, (el) => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(9).bg(p.raised).text_size(10.5).text_color(p.muted).child("worktree")))
                  .child(div().flex_none().text_color(p.ink).child(usd(x.cost))))
                .child(bar((x.cost ?? 0) / maxProjCost, p.accent))
                .child(div().text_size(11).text_color(p.faint).child(`${x.sessions} sessions · ${fmt(x.tokens)} tokens · ${fmt(x.fresh)} fresh`));
            }))))
          // Sessions
          .child(box("Most expensive sessions", r.sessions.slice(0, 8).map((x) => {
            const pl = place(x.cwd, x.project);
            return h_flex().gap(10).items_center().py(4).text_size(12.5)
              .child(div().w(7).h(7).rounded(4).flex_none().bg(hue(x.model)))
              .child(v_flex().flex_1().min_w(0)
                .child(div().truncate().child(x.title || x.id.slice(0, 8)))
                .child(div().truncate().text_size(11).text_color(p.faint).child(`${pl.path} · ${modelName(x.model)} · ${x.replies} replies${x.subagent_tokens ? ` · ${fmt(x.subagent_tokens)} in subagents` : ""} · ${ago(Date.now() - x.last)} ago`)))
              .child(v_flex().flex_none().items_end()
                .child(div().text_color(p.ink).child(usd(x.cost)))
                .child(div().text_size(11).text_color(p.faint).child(fmt(x.tokens))));
          })))
          // Hours | Subagents
          .child(h_flex().gap(14).items_start()
            .child(box("When you work (fresh tokens by hour)", [
              h_flex().h(70).gap(2).items_end().children(r.hours.map((v, h) =>
                v_flex().flex_1().gap(3).items_center()
                  .child(div().w_full().rounded(3).bg(v ? p.accent : p.raised).h(Math.max(2, Math.round((v / maxHour) * 52))))
                  .child(div().text_size(9.5).text_color(p.faint).child(h % 6 === 0 ? String(h) : "")))),
            ]))
            .child(box("Subagents", r.agents.length ? r.agents.map((a) =>
              h_flex().gap(8).text_size(12.5).py(2)
                .child(div().flex_1().min_w(0).truncate().child(a.agent))
                .child(div().text_color(p.faint).child(`${a.replies.toLocaleString()} replies · ${fmt(a.tokens)}`))
                .child(div().w(64).flex_none().text_color(p.ink).child(usd(a.cost)))) : [div().text_size(12).text_color(p.faint).child("None in this range")])))
          .child(div().text_size(11).text_color(p.faint).child(`Costs are estimates at Anthropic's API list prices (mods/kanban/prices.json), not your plan's billing. "Cache saved" is cache-read tokens at full input price minus what they cost.${d.unpriced?.length ? ` No price for: ${d.unpriced.join(", ")}.` : ""} Stored for good in ${d.db.replace(home(), "~")}, read from Claude Code's logs every 5 minutes.`))));
  }
}
