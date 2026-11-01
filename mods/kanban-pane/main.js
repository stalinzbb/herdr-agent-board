// A pane header (Herdr's `pane` header, plus Claude session stats).
// For a Claude pane it shows, on the right: model, context window used, prompt-cache
// countdown, running subagents, and repo · branch · worktree.
// Which Claude session a terminal runs comes from ~/.cache/herdr-kanban/sessions/<terminal>.json,
// written by the SessionStart hook (mods/kanban/claude-session-hook.py). Without it, the newest
// transcript in the pane's folder is used and marked as a guess.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, appHome, exec, readTextFile } from "herdr";

const C = { amber: "#e2b340", red: "#e5566f", green: "#3fc07a" };

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

const fmtK = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

function modelName(id) {
  const m = (id ?? "").match(/claude-([a-z]+)-(\d+)-(\d+)/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id ?? "";
}

function mins(ms) {
  const m = Math.ceil(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

const isClaude = (p) => p && (/claude/i.test(p.app ?? "") || p.program?.key === "claude");

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.stats = null;
    this.size = null;
    cx.spawn(async (cx) => {
      // Context window sizes: yours in ~/.config/herdr-board/models.json, else the kanban mod's default.
      this.models = {};
      for (const path of [`${home()}/.config/herdr-board/models.json`, `${appHome()}/mods/kanban/defaults/models.json`]) {
        try { const t = await readTextFile(path); if (t) { this.models = JSON.parse(t); break; } } catch {}
      }
      await this.refresh();
      cx.notify();
    });
    // Cheap check every 5 s: only re-reads the transcript when it grew. The countdown needs a minute tick anyway.
    cx.timer.every(5000, (cx) => cx.spawn(async (cx) => { if (await this.refresh()) cx.notify(); }));
    cx.timer.every(60000, (cx) => cx.notify());
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  async transcript(p) {
    const term = props()?.terminal;
    if (term) {
      try {
        const t = await readTextFile(`${home()}/.cache/herdr-kanban/sessions/${term.replace("/", "_")}.json`);
        const m = t && JSON.parse(t);
        if (m?.transcript_path) return { path: m.transcript_path, guess: false };
      } catch {}
    }
    // No hook record: the newest transcript in Claude's folder for this cwd.
    if (!p.cwd) return null;
    const dir = `${home()}/.claude/projects/${p.cwd.replace(/[^A-Za-z0-9]/g, "-")}`;
    const r = await exec("sh", ["-c", `ls -t "${dir}"/*.jsonl 2>/dev/null | head -1`]).catch(() => null);
    const path = r?.stdout.trim();
    return path ? { path, guess: true } : null;
  }

  // Returns true when something changed.
  async refresh() {
    const p = this.me();
    if (!isClaude(p)) {
      const had = !!this.stats;
      this.stats = null;
      return had;
    }
    const tr = await this.transcript(p);
    if (!tr) return false;
    const st = await exec("stat", ["-f", "%z", tr.path]).catch(() => null);
    const size = st?.stdout.trim();
    if (size && size === this.size && tr.path === this.stats?.path) return false;
    this.size = size;

    const tail = await exec("tail", ["-c", "400000", tr.path]).catch(() => null);
    const lines = (tail?.stdout ?? "").split("\n").slice(1);
    let last = null, cwd = null, branch = null;
    for (let i = lines.length - 1; i >= 0 && (!last || !cwd); i--) {
      let m;
      try { m = JSON.parse(lines[i]); } catch { continue; }
      if (!cwd && m.cwd) { cwd = m.cwd; branch = m.gitBranch ?? null; }
      if (!last && m.type === "assistant" && m.message?.usage && m.message.model !== "<synthetic>") last = m;
    }
    const u = last?.message?.usage ?? {};
    const used = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    const model = last?.message?.model;
    const cw = this.models?.context_window ?? {};
    let window = cw[model] ?? cw.default ?? 200000;
    if (used > window) window = 1000000;
    const cc = u.cache_creation ?? {};
    const ttl = (cc.ephemeral_1h_input_tokens ?? 0) > 0 ? 3600000 : (cc.ephemeral_5m_input_tokens ?? 0) > 0 ? 300000 : this.stats?.ttl ?? 300000;

    // Subagents: Claude records each in <session>/subagents/*.meta.json with `finished`.
    const dir = tr.path.replace(/\.jsonl$/, "");
    const metas = await exec("sh", ["-c", `for f in "${dir}"/subagents/*.meta.json; do [ -f "$f" ] && cat "$f" && echo; done`]).catch(() => null);
    const subs = (metas?.stdout ?? "").split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

    // Repo, branch, worktree, from where Claude itself is.
    let repo = null, worktree = false;
    if (cwd) {
      const g = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"]).catch(() => null);
      if (g?.code === 0) {
        const [top, gitDir, common] = g.stdout.trim().split("\n");
        const commonAbs = common?.startsWith("/") ? common : `${top}/${common}`;
        worktree = !!gitDir && !!common && gitDir.replace(/\/$/, "") !== commonAbs.replace(/\/\.?$/, "").replace(/\/$/, "");
        repo = worktree ? commonAbs.replace(/\/\.git\/?$/, "").split("/").pop() : top.split("/").pop();
      }
    }

    this.stats = {
      path: tr.path, guess: tr.guess, model, used, window, ttl,
      lastAt: last?.timestamp ? Date.parse(last.timestamp) : null,
      running: subs.filter((s) => !s.finished), subs: subs.length,
      cwd, branch, repo, worktree,
    };
    return true;
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(4)
      .rounded(8)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/kanban-pane/${icon}.svg`).size(14));
  }

  statsView(t) {
    const s = this.stats;
    if (!s || !s.model) return [];
    const share = Math.min(1, s.used / s.window);
    const color = share >= (this.models?.alert_at ?? 0.9) ? C.red : share >= (this.models?.warn_at ?? 0.7) ? C.amber : t.muted;
    const left = s.lastAt ? s.lastAt + s.ttl - Date.now() : -1;
    const sep = () => div().w(1).h(12).bg(t.border).flex_none();
    const out = [];
    // Repo · branch · worktree
    if (s.repo || s.branch) {
      out.push(h_flex().flex_none().gap(5).items_center().text_color(t.dim)
        .when(!!s.repo, (el) => el.child(div().text_color(t.muted).child(s.repo)))
        .when(!!s.branch && s.branch !== "HEAD", (el) => el.child(div().child(`⎇ ${s.branch}`)))
        .when(s.worktree, (el) => el.child(div().px(6).h(18).flex().items_center().rounded(9).bg(t.raised).text_size(10.5).text_color(t.muted).child("worktree"))));
      out.push(sep());
    }
    // Subagents
    if (s.running.length)
      out.push(h_flex().flex_none().gap(5).items_center().text_color(t.muted)
        .child(svg("mods/kanban-pane/spinner.svg").size(11).text_color(C.amber).spin(900))
        .child(`${s.running.length} subagent${s.running.length > 1 ? "s" : ""}`), sep());
    // Cache
    out.push(div().flex_none().text_color(left > 0 ? (left < 5 * 60000 ? C.amber : t.dim) : t.dim)
      .child(left > 0 ? `cache ${mins(left)}` : "cache cold"), sep());
    // Context window
    out.push(h_flex().flex_none().gap(7).items_center()
      .child(div().w(64).h(6).rounded(3).bg(t.raised).child(div().h_full().rounded(3).bg(color).w(Math.max(2, Math.round(share * 64)))))
      .child(div().text_color(color === t.muted ? t.muted : color).child(`${fmtK(s.used)} / ${fmtK(s.window)}`)), sep());
    // Model
    out.push(div().flex_none().text_color(t.muted).child(modelName(s.model) + (s.guess ? " ?" : "")));
    return out;
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(12)
      .gap(10)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(folder(p.cwd)))
      .children(this.statsView(t))
      .when(st === "working", (el) => el.child(svg("mods/kanban-pane/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", (el) => el.child(div().flex_none().px(8).h(18).flex().items_center().rounded(9).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", (el) => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, (el) => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
