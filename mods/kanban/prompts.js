// The saved-prompts popup: pick one and it's typed into the chosen agents.
//
// Sending to several agents lists them first, all ticked: untick the ones that shouldn't get it (an
// agent busy on something, or waiting on you, won't take typed input), then pick the prompt. The
// heading says how many it goes to.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, props, closeOverlay, notify } from "herdr";
import { ICON, STATUS, KIND, pal, tint, readConfig, editConfig, iconBtn, button, dot } from "./ui.js";

const STATE = {
  blocked: { word: "waiting on you", color: STATUS.blocked },
  working: { word: "working", color: STATUS.working },
  done: { word: "finished", color: STATUS.done },
  idle: { word: "idle", color: STATUS.idle },
};

export class Prompts {
  constructor() {
    this.list = null;
    this.off = new Set(); // addresses you've unticked
  }

  start(cx) {
    cx.spawn(async (cx) => {
      const cfg = await readConfig("prompts", { prompts: [] });
      this.list = cfg.prompts ?? [];
      this.error = cfg.error;
      cx.notify();
    });
  }

  // Who it goes to: everyone in the list, less the ones you unticked.
  chosen() {
    return (props().targets ?? []).filter((t) => !this.off.has(t));
  }

  send(prompt, cx) {
    const targets = this.chosen();
    const { overlay } = props();
    if (!targets.length) return notify({ title: "Pick at least one agent", level: "info", timeout: 2000 });
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

  // The checklist of agents (only when sending to several).
  who(p, cx) {
    const all = props().who ?? [];
    const on = all.filter((a) => !this.off.has(a.address)).length;
    const set = (pred) => { this.off = new Set(all.filter((a) => !pred(a)).map((a) => a.address)); cx.notify(); };
    return v_flex().flex_none().gap(2).px(4).pb(6)
      .child(h_flex().h(28).px(4).gap(4).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(p.faint).child(`Send to ${on} of ${all.length} agents`))
        .child(button(p, "pk-idle", "Idle only", () => set((a) => a.status !== "working" && a.status !== "blocked"), { variant: "ghost" }))
        .child(button(p, "pk-all", on === all.length ? "None" : "All", () => set(() => on !== all.length), { variant: "ghost" })))
      .children(all.map((a) => {
        const ticked = !this.off.has(a.address);
        const st = STATE[a.status] ?? STATE.idle;
        return h_flex().id(`pk-${a.address}`).flex_none().h(32).px(8).gap(8).items_center().rounded(8).cursor_pointer()
          .hover((s) => s.bg(p.hover))
          .on_mouse_down("left", (_e, c) => { c.stop_propagation(); ticked ? this.off.add(a.address) : this.off.delete(a.address); c.notify(); })
          // A checkbox: filled with a tick when it will get the prompt.
          .child(h_flex().flex_none().w(16).h(16).items_center().justify_center().rounded(5).border_1()
            .border_color(ticked ? p.accent : p.line).bg(ticked ? p.accent : p.ground)
            .when(ticked, (el) => el.child(svg(ICON("check")).size(11).text_color("#ffffff"))))
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(ticked ? p.ink : p.faint).child(a.label))
          .child(h_flex().flex_none().h(18).px(6).gap(4).items_center().rounded(9).bg(tint(st.color)).text_size(10.5).text_color(st.color)
            .tooltip(a.status === "blocked" ? "Waiting on your answer: it won't take typed input" : st.word)
            .child(dot(st.color, 5))
            .child(st.word));
      }));
  }

  render(cx) {
    const p = pal();
    const { title, pick } = props();
    const many = pick && (props().who ?? []).length > 1;
    const count = this.chosen().length;
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
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(p.faint).child(many ? "Send a saved prompt" : `Send to ${title ?? "agent"}`))
          .child(iconBtn("edit-prompts", "logs", () => {
            closeOverlay(props().overlay);
            editConfig("prompts");
          }, p, { label: "Edit" })))
      .when(many, (el) => el.child(this.who(p, cx)))
      .when(many, (el) => el.child(div().h(1).mx(4).mb(4).bg(p.line)))
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
              .on_click((_e, c) => this.send(pr, c))
              .child(div().text_size(13).child(pr.label))
              .child(div().truncate().text_size(11.5).text_color(p.faint).child(pr.text)))))
      // The count again, where the choice is made: what the click you're about to do will do.
      .when(many, (el) => el.child(div().flex_none().px(12).py(6).text_size(11.5).text_color(p.faint).child(count ? `Picking one sends it to ${count} agent${count === 1 ? "" : "s"}` : "Tick an agent to send")));
  }
}
