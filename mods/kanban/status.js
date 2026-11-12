// The bottom bar: where the pane you're in is working, how many agents need you or are working,
// and today's Claude cost. Short words, details on hover.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, focused, keys, window, run } from "herdr";
import { ICON, STATUS, KIND, pal, dot, tilde } from "./ui.js";
import { riffs } from "./riffs.js";
import { gitInfo, refreshGit } from "./git.js";
import { cards } from "./board.js";
import { UsageWidget } from "./usage.js";
import { demo } from "./demo.js";

// The palette's key as actually bound ("⌘⇧P"), or null.
function paletteKey() {
  const mac = window()?.platform === "macos";
  const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
  const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
  return b ? b.keys.split("-").map((x) => mod[x.toLowerCase()] ?? x.toUpperCase()).join("") : null;
}

export class StatusBar {
  start(cx) {
    this.usage = new UsageWidget();
    this.usage.start(cx);
    const look = (cx) => cx.spawn(async (cx) => { if (await refreshGit([focused()?.cwd])) cx.notify(); });
    look(cx);
    cx.timer.every(3000, look);
  }

  render() {
    const p = pal();
    const f = focused();
    const space = spaces().find((s) => s.active);
    const pane = f?.pane ? panes().find((x) => x.pane === f.pane) : null;
    const cwd = demo() ? null : f?.cwd ?? pane?.cwd ?? null;
    const g = gitInfo(cwd);
    const where = demo() ? "acme-store" : g?.repo ?? (cwd ? tilde(cwd) : space?.name ?? "");
    const branch = demo() ? "feat/gallery" : pane?.branch ?? space?.branch ?? null;
    const list = cards();
    const yours = list.filter((c) => c.column === "you" && c.turn === "ask").length;
    const working = list.filter((c) => c.column === "working").length;
    const key = paletteKey();
    const item = (id, tip, ...kids) => h_flex().id(id).flex_none().h(22).px(6).gap(6).items_center().rounded(7).tooltip(tip).children(kids);
    return h_flex()
      .size_full()
      .px(8)
      .gap(2)
      .items_center()
      .bg(p.col)
      .border_t(1)
      .border_color(p.line)
      .text_size(11.8)
      .text_color(p.muted)
      // Where the focused pane is: machine (only when it's another one), project, branch, worktree.
      .when(!!space?.machine, (el) => el.child(item("machine", `On ${space.machine}`, svg(ICON("server")).size(13), div().child(space.machine))))
      .when(!!where, (el) => el.child(item("where", cwd ? `The pane you're in: ${tilde(g?.top ?? cwd)}` : "The space you're in", div().text_color(p.ink).child(where))))
      .when(!!branch, (el) => el.child(item("branch", g?.linked ? `Branch ${branch}, in a worktree (its own checkout of ${g.repo})` : `Branch ${branch}`,
        svg(ICON("branch")).size(12), div().child(branch), ...(g?.linked ? [div().px(5).rounded(5).border_1().border_color(p.line).text_size(10.5).child("worktree")] : []))))
      .child(div().flex_1())
      // How many agents need you / are working: the counts, with the words on hover.
      .when(yours > 0, (el) => el.child(item("yours", `${yours} waiting on your answer`, dot(STATUS.blocked, 6), div().text_color(p.ink).child(String(yours)))))
      .when(riffs().length > 0, (el) => el.child(item("riffs", `${riffs().length} riff${riffs().length === 1 ? "" : "s"} open`, dot(KIND.riff.color, 6), div().text_color(p.ink).child(String(riffs().length)))))
      .when(working > 0, (el) => el.child(item("working", `${working} working`, dot(STATUS.working, 6), div().child(String(working)))))
      .child(div().w(1).h(14).mx(6).bg(p.line))
      .child(this.usage.compact(p))
      .child(div().id("palette").flex_none().w(26).h(22).flex().items_center().justify_center().rounded(7).cursor_pointer()
        .hover((s) => s.bg(p.hover).text_color(p.ink))
        .tooltip(key ? `Commands  ${key}` : "Commands")
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); run("app.palette"); })
        .child(svg(ICON("command")).size(13)));
  }
}
