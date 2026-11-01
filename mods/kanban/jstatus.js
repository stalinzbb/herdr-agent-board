// The status menu: click a ticket's status pill, pick where it goes.
// Moves come from Jira (only the ones its workflow allows), through Claude's connector.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, props, closeOverlay, notify, home, appHome, readTextFile, watchFolder } from "herdr";
import { ICON, pal } from "./ui.js";
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

function sync(args) {
  const script = `${appHome()}/mods/kanban/jira-sync.py`;
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
    const { key } = props();
    cx.spawn(async (cx) => {
      const cached = await readJson(`transitions-${key}.json`);
      if (cached?.transitions && Date.now() - cached.at < FRESH_MS) this.list = cached.transitions;
      else {
        this.since = Date.now();
        await sync(["transitions", key]).catch((e) => { this.error = String(e); });
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

  move(t) {
    const { key } = props();
    this.moving = t;
    this.error = null;
    this.sentAt = Date.now() - 1000;
    sync(["move", key, t.id]).catch((e) => { this.error = String(e); this.moving = null; });
  }

  render() {
    const p = pal();
    const { key, summary, status, category } = props();
    return v_flex()
      .size_full()
      .bg(p.popover)
      .text_color(p.ink)
      .p(4)
      .child(
        v_flex().px(8).pt(6).pb(8).gap(4)
          .child(h_flex().gap(6).items_center().text_size(11.5)
            .child(div().text_color(p.faint).child(key))
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
          .child("Asking Jira where it can go…")))
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
              .on_click(() => this.move(t))
              .child(pill(t.to, t.category))
              .when(t.name && t.name !== t.to, (el) => el.child(div().truncate().text_size(12).text_color(p.faint).child(t.name)))))
          .when(this.list.length === 0, (el) => el.child(div().px(8).py(6).text_size(12).text_color(p.faint).child("No moves available"))));
  }
}
