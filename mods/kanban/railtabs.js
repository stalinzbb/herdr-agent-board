// The right panel's switcher: Dev | Tasks | Riff (the Jira panel; its name comes from jira.json). Also what ⌘⇧J / ⌘⇧E-style commands use.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, shared } from "herdr";
import { pal, KIND, tint } from "./ui.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) {
    const f = find(c, id);
    if (f) return f;
  }
  return null;
}

export const railShows = () => {
  const rail = find(layout(), "rail");
  return rail && !rail.hidden ? find(layout(), "rail-body")?.active ?? "dev" : null;
};

// Shows the panel on that tab; again on the same tab hides it.
export function railTo(child) {
  if (railShows() === child) return run("layout.hide", { id: "rail" });
  run("layout.show", { id: "rail" });
  run("layout.select", { stack: "rail-body", child });
}

export function railtabs() {
  const p = pal();
  const cur = find(layout(), "rail-body")?.active ?? "dev";
  const count = shared("kanban.jira.count") ?? 0;
  const tab = (id, label, badge, kind = "ask") =>
    h_flex()
      .id(`rt-${id}`)
      .flex_1()
      .h(28)
      .gap(6)
      .justify_center()
      .items_center()
      .rounded(10)
      .text_size(12.5)
      .cursor_pointer()
      .text_color(cur === id ? p.ink : p.muted)
      .when(cur === id, (el) => el.bg(p.raised))
      .hover((s) => s.text_color(p.ink))
      .on_mouse_down("left", () => run("layout.select", { stack: "rail-body", child: id }))
      .child(label)
      .when(badge > 0, (el) => el.child(div().px(5).rounded(9).bg(tint(KIND[kind].color)).text_color(KIND[kind].color).text_size(11).font_medium().child(String(badge))));
  return h_flex()
    .size_full()
    .px(8)
    .items_center()
    .bg(p.col)
    .child(h_flex().w_full().p(2).gap(2).rounded(16).bg(p.ground)
      .child(tab("dev", "Dev"))
      // Hidden until something feeds it (a connected source or a task of yours); ⌘⇧J still opens it.
      .when(shared("kanban.tasks.shown") !== false || cur === "jira", (el) => el.child(tab("jira", shared("kanban.tasks.name") || "Tasks", count, "task")))
      .child(tab("riff", "Riff", (shared("kanban.riffs") ?? []).length, "riff")));
}
