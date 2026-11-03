// The bar's New menu: every way to start something, each with what it actually makes.
//
// Herdr's words, as the board uses them: a project is a Herdr space (a folder, usually a repo); a
// card is a tab in it; a tab holds panes (terminals side by side). A worktree is a second checkout
// of the same repo on its own branch and folder, opened as its own project.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, knownAgents, run, openOverlay, closeOverlay, props, shared, setShared } from "herdr";
import { ICON, pal } from "./ui.js";

// The agents each machine reported last, shown at once while they're checked again.
const KNOWN = "kanban.agents";

export class NewMenu {
  start(cx) {
    const machine = spaces().find((s) => s.active)?.machine ?? null;
    const where = machine ?? "";
    this.agents = shared(KNOWN)?.[where] ?? shared("new-menu.agents")?.[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      } catch {
        this.failed = true;
      }
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  render() {
    const p = pal();
    const space = spaces().find((s) => s.active);
    const pane = focused()?.pane ? panes().find((x) => x.pane === focused().pane) : null;
    const installed = this.agents.filter((a) => a.installed);
    const first = installed[0];
    const name = space ? (space.name === "~" ? "Home" : space.name) : null;

    const row = (id, icon, label, hint, key, action, enabled = true) =>
      h_flex().id(id).flex_none().min_h(40).px(8).py(5).gap(10).items_center().rounded(8)
        .text_color(enabled ? p.ink : p.faint)
        .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(p.hover)).active((s) => s.opacity(0.8)))
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); if (enabled) { this.close(); action(); } })
        .child(div().w(16).flex_none().flex().justify_center().child(icon))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(12.8).child(label))
          .when(!!hint, (el) => el.child(div().truncate().text_size(11.5).text_color(p.faint).child(hint))))
        .when(!!key, (el) => el.child(div().flex_none().text_size(11).text_color(p.faint).child(key)));
    const glyph = (name) => svg(ICON(name)).size(14).text_color(p.muted);
    const agentIcon = (a) => (a.icon ? (a.tint ? svg(a.icon).size(14).text_color(p.ink) : image(a.icon).w(14).h(14)) : glyph("terminal"));
    const header = (text) => div().px(8).pt(8).pb(2).text_size(11.5).text_color(p.faint).child(text);
    const rule = () => div().h(1).mx(4).my(4).bg(p.line);
    const worktree = (action, argv) => openOverlay({ mod: "worktree", kind: "dialog", width: action === "open" ? 560 : 460, height: action === "open" ? 480 : 280,
      props: { space: space?.id, folder: pane?.cwd ?? undefined, action, argv } });

    return v_flex()
      .id("newmenu")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (!agent) return;
        cx.stop_propagation();
        this.close();
        run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
      })
      .size_full()
      .p(4)
      .bg(p.popover)
      .text_color(p.ink)
      .overflow_y_scrollbar()
      .when(!!name, (el) => el.child(header(`New card in ${name}`)))
      .children(installed.slice(0, 4).map((a, i) => row(`agent-${a.key}`, agentIcon(a), a.name, i === 0 ? "An agent in a new tab" : null, String(i + 1),
        () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }))))
      .when(!installed.length, (el) => el.child(div().px(8).py(6).text_size(12).text_color(p.faint).child(this.failed ? "Couldn't list your agents" : "Looking for agents…")))
      .child(row("terminal", glyph("terminal"), "Terminal", "A shell in a new tab", null, () => run("tab.new", { space: space?.id })))
      .child(row("worktree", glyph("branch"), `${first?.name ?? "Agent"} in a new worktree…`, "Same repo, its own branch and folder", null,
        () => worktree("new", first?.run), !!space))
      .child(row("worktree-open", glyph("branch"), "Open a worktree…", "One that exists, as its own project", null, () => worktree("open"), !!space))
      .when(!!pane, (el) => el
        .child(rule())
        .child(header("Split the pane you're in"))
        .child(h_flex().gap(4).px(4).pb(2)
          .child(split(p, "split-right", "split-right", "Right", () => { this.close(); run("pane.split", { direction: "right", pane: pane.pane }); }))
          .child(split(p, "split-down", "split-down", "Down", () => { this.close(); run("pane.split", { direction: "down", pane: pane.pane }); }))))
      .child(rule())
      // The bar asks for the folder: this popup's tasks end when it closes.
      .child(row("project", glyph("folder-plus"), "New project…", `Pick a folder${first ? `; starts ${first.name} there` : ""}`, null, () => run("kanban.new_project")));
  }
}

function split(p, id, icon, label, onPress) {
  return h_flex().id(id).flex_1().h(32).gap(6).items_center().justify_center().rounded(8).bg(p.raised).text_size(12.5).text_color(p.muted)
    .cursor_pointer().hover((s) => s.text_color(p.ink)).active((s) => s.opacity(0.8))
    .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); onPress(); })
    .child(svg(ICON(icon)).size(14))
    .child(label);
}
