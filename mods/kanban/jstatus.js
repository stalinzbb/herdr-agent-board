// The status menu: click a row's status pill, pick where it goes. Each source moves its own way:
//   Jira   - the moves its workflow allows, through Claude's connector (jira-sync.py)
//   Linear - its team's workflow states (tasks-sync.py)
//   GitHub - close or reopen an issue (gh); a pull request only opens
//   Mine   - To do / Doing / Done, or delete, in tasks.local.json

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, props, closeOverlay, notify, home, appHome, readTextFile, writeTextFile, watchFolder } from "herdr";
import { ICON, pal, USER_CONFIG } from "./ui.js";
import { pill } from "./pill.js";

const CACHE = () => `${home()}/.cache/herdr-kanban`;
const FRESH_MS = 30 * 60000;

async function readJson(name) {
  try {
    const t = await readTextFile(`${CACHE()}/${name}`);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

const LOCAL_STEPS = [["To do", "new"], ["Doing", "indeterminate"], ["Done", "done"]];

function sync(args, script = `${appHome()}/mods/kanban/jira-sync.py`) {
  const name = `kj-${args.join("-")}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 32);
  return exec("hc", ["run", "--bg", "--no-parent", "--rm", "--name", name, "--", "/bin/zsh", "-lc", `python3 -I '${script}' ${args.join(" ")}`]);
}

export class JStatus {
  constructor() {
    this.list = null;
    this.error = null;
    this.moving = null;
    this.sentAt = 0;
  }

  start(cx) {
    const { key, source, status, type } = props();
    // Moves known without asking anyone.
    if (source === "local") {
      this.list = [...LOCAL_STEPS.filter(([s]) => s !== status).map(([s, c]) => ({ id: s, to: s, category: c })), { id: "delete", to: "Delete", category: "hide" }];
      return;
    }
    if (source === "github") {
      this.list = type === "Issue" ? [status === "Closed" ? { id: "reopen", to: "Open", category: "new" } : { id: "close", to: "Closed", category: "done" }] : [];
      return;
    }
    cx.spawn(async (cx) => {
      const cached = await readJson(`transitions-${key}.json`);
      if (cached?.transitions && Date.now() - cached.at < FRESH_MS) this.list = cached.transitions;
      else {
        this.since = Date.now();
        const asked = source === "linear"
          ? sync(["states", "linear", props().id, key], `${appHome()}/mods/kanban/tasks-sync.py`)
          : sync(["transitions", key]);
        await asked.catch((e) => { this.error = String(e); });
      }
      cx.notify();
      for (;;) {
        await watchFolder(CACHE());
        await this.reload(cx);
        cx.notify();
      }
    });
  }

  async reload(cx) {
    const { key, overlay } = props();
    if (!this.list) {
      const t = await readJson(`transitions-${key}.json`);
      if (t && t.at >= (this.since ?? 0)) {
        if (t.error) this.error = t.error;
        else this.list = t.transitions;
      }
    }
    if (this.moving) {
      const a = await readJson(`action-${key}.json`);
      if (a && a.at >= this.sentAt) {
        if (a.ok) {
          notify({ title: `${key} → ${a.to}`, level: "success", timeout: 2500 });
          closeOverlay(overlay);
        } else {
          this.error = a.error ?? "Jira didn't accept the change";
          this.moving = null;
        }
      }
    }
  }

  move(t, cx) {
    const { key, source, id, url, overlay, summary } = props();
    this.moving = t;
    this.error = null;
    this.sentAt = Date.now() - 1000;
    if (source === "local") return this.moveLocal(t, cx);
    if (source === "github") {
      cx.spawn(async (cx) => {
        const r = await exec("gh", ["issue", t.id, url]).catch((e) => ({ code: 1, stderr: String(e) }));
        if (r.code !== 0) { this.error = (r.stderr || r.stdout || "gh failed").trim().slice(0, 200); this.moving = null; cx.notify(); return; }
        notify({ title: `${key} → ${t.to}`, level: "success", timeout: 2500 });
        sync(["sync"], `${appHome()}/mods/kanban/tasks-sync.py`).catch(() => null);
        closeOverlay(overlay);
      });
      return;
    }
    if (source === "linear") {
      sync(["move", "linear", id, key, t.id], `${appHome()}/mods/kanban/tasks-sync.py`).catch((e) => { this.error = String(e); this.moving = null; });
      return;
    }
    sync(["move", key, t.id]).catch((e) => { this.error = String(e); this.moving = null; });
  }

  // Your own tasks: the file, read fresh so an agent's additions aren't lost.
  moveLocal(t, cx) {
    const { id, overlay, summary } = props();
    const path = `${USER_CONFIG()}/tasks.local.json`;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(path);
        const data = JSON.parse(text ?? '{"tasks": []}');
        if (t.id === "delete") data.tasks = data.tasks.filter((x) => x.id !== id);
        else for (const x of data.tasks) if (x.id === id) { x.status = t.to; x.updated = Date.now(); }
        await writeTextFile(path, JSON.stringify(data, null, 2) + "\n", text ?? null);
        notify({ title: t.id === "delete" ? `Deleted "${summary}"` : `${summary} → ${t.to}`, level: "success", timeout: 2000 });
        closeOverlay(overlay);
      } catch (e) {
        this.error = String(e).slice(0, 200);
        this.moving = null;
        cx.notify();
      }
    });
  }

  render() {
    const p = pal();
    const { key, summary, status, category, source, type, url } = props();
    return v_flex()
      .size_full()
      .bg(p.popover)
      .text_color(p.ink)
      .p(4)
      .child(
        v_flex().px(8).pt(6).pb(8).gap(4)
          .child(h_flex().gap(6).items_center().text_size(11.5)
            .when(source !== "local", (el) => el.child(div().text_color(p.faint).child(key)))
            .child(pill(status, category)))
          .child(div().truncate().text_size(12.5).text_color(p.muted).child(summary ?? "")))
      .child(div().h(1).mx(8).bg(p.line))
      .when(!!this.error, (el) => el.child(div().px(8).py(6).text_size(12).text_color("#e5566f").child(String(this.error).slice(0, 200))))
      .when(!!this.moving, (el) =>
        el.child(h_flex().px(8).py(10).gap(8).items_center().text_size(12.5).text_color(p.muted)
          .child(svg(ICON("spinner")).size(13).spin(900))
          .child(`Moving to ${this.moving.to}…`)))
      .when(!this.moving && !this.list && !this.error, (el) =>
        el.child(h_flex().px(8).py(10).gap(8).items_center().text_size(12.5).text_color(p.faint)
          .child(svg(ICON("spinner")).size(13).spin(900))
          .child(source === "linear" ? "Asking Linear where it can go…" : "Asking Jira where it can go…")))
      .when(!this.moving && !!this.list, (el) =>
        el.child(div().px(8).pt(8).pb(4).text_size(11.5).text_color(p.faint).child("Move to"))
          .children(this.list.map((t) =>
            h_flex()
              .id(`tr-${t.id}`)
              .h(32)
              .px(8)
              .gap(8)
              .items_center()
              .rounded(9)
              .cursor_pointer()
              .hover((s) => s.bg(p.hover))
              .on_click((_e, cx) => this.move(t, cx))
              .child(pill(t.to, t.category))
              .when(t.name && t.name !== t.to, (el) => el.child(div().truncate().text_size(12).text_color(p.faint).child(t.name)))))
          .when(this.list.length === 0, (el) => el.child(div().px(8).py(6).text_size(12).text_color(p.faint)
            .child(source === "github" && type !== "Issue" ? "A pull request moves on GitHub: merge, close or review it there." : "No moves available")))
          .when(!!url, (el) => el.child(div().h(1).mx(8).my(4).bg(p.line)).child(
            h_flex().id("open-link").h(32).px(8).gap(8).items_center().rounded(9).cursor_pointer().text_size(12.5).text_color(p.muted)
              .hover((s) => s.bg(p.hover).text_color(p.ink))
              .on_click(() => { exec("open", [url]); closeOverlay(props().overlay); })
              .child(svg(ICON("external")).size(13))
              .child(`Open in ${source === "github" ? "GitHub" : source === "linear" ? "Linear" : "Jira"}`))));
  }
}
