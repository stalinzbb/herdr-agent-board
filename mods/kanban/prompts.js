// The saved-prompts popup: pick one and it's typed into the chosen agents.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, props, closeOverlay, notify, appHome } from "herdr";
import { pal, readConfig, editConfig, iconBtn } from "./ui.js";

export class Prompts {
  constructor() {
    this.list = null;
  }

  start(cx) {
    cx.spawn(async (cx) => {
      const cfg = await readConfig("prompts", { prompts: [] });
      this.list = cfg.prompts ?? [];
      this.error = cfg.error;
      cx.notify();
    });
  }

  send(prompt, cx) {
    const { targets = [], overlay } = props();
    closeOverlay(overlay);
    cx.spawn(async () => {
      // hc send pastes and presses Enter; it won't type into an agent that's asking you something.
      const results = await Promise.all(targets.map((t) => exec("hc", ["send", t, prompt.text]).catch((e) => ({ code: 1, stderr: String(e) }))));
      const failed = results.filter((r) => r.code !== 0);
      if (failed.length)
        notify({ title: `"${prompt.label}" didn't reach ${failed.length} of ${targets.length}`, body: (failed[0].stderr || failed[0].stdout || "").trim().slice(0, 160), level: "warning" });
      else notify({ title: `Sent "${prompt.label}"`, body: targets.length > 1 ? `to ${targets.length} agents` : undefined, level: "success", timeout: 2500 });
    });
  }

  render() {
    const p = pal();
    const { title } = props();
    return v_flex()
      .size_full()
      .bg(p.popover)
      .text_color(p.ink)
      .p(4)
      .child(
        h_flex()
          .h(32)
          .px(8)
          .items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(p.faint).child(`Send to ${title ?? "agent"}`))
          .child(iconBtn("edit-prompts", "logs", () => {
            closeOverlay(props().overlay);
            editConfig("prompts");
          }, p, { label: "Edit" })))
      .when(!!this.error, (el) => el.child(div().px(8).py(4).text_size(12).text_color("#e5566f").child(`prompts.json: ${this.error}`)))
      .child(
        v_flex()
          .id("prompt-list")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .children((this.list ?? []).map((pr, i) =>
            v_flex()
              .id(`pr-${i}`)
              .px(8)
              .py(6)
              .rounded(9)
              .cursor_pointer()
              .hover((s) => s.bg(p.hover))
              .on_click((_e, cx) => this.send(pr, cx))
              .child(div().text_size(13).child(pr.label))
              .child(div().truncate().text_size(11.5).text_color(p.faint).child(pr.text)))));
  }
}
