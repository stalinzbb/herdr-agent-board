// Jira status pills: grey to do, blue in progress, green done.
import { div } from "gpui-kit";

export const CAT = {
  new: { color: "#8a8a8a", bg: "#ffffff12" },
  indeterminate: { color: "#7fb4ff", bg: "#4c9aff1f" },
  done: { color: "#5fd394", bg: "#3fc07a1f" },
};

export function pill(status, category) {
  const c = CAT[category] ?? CAT.new;
  return div().flex_none().h(18).px(6).flex().items_center().rounded(9).bg(c.bg).text_color(c.color).text_size(11).font_medium().child(status ?? "");
}
