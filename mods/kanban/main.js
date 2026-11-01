// Kanban: the board layout's parts, one mod with a role per copy.
//   bar      - the title strip above the board (also takes kanban.* key commands)
//   board    - columns of cards (one card per tab, by its agents' status)
//   railtabs - the right panel's Dev | Tasks switcher
//   rail     - the dev panel: servers, simulators, devices
//   jira     - the Tasks panel (Jira): saved views and the morning digest
//   prompts  - the saved-prompts popup (opened by the board)

import { View } from "gpui-kit";
import { props, nextCommand, openOverlay, shared, setShared } from "herdr";
import { bar, board } from "./board.js";
import { Rail } from "./rail.js";
import { Jira } from "./jira.js";
import { Prompts } from "./prompts.js";
import { JStatus } from "./jstatus.js";
import { UsageWidget, UsageStats } from "./usage.js";
import { railtabs, railTo, railShows } from "./railtabs.js";

const PARTS = { rail: Rail, jira: Jira, prompts: Prompts, jstatus: JStatus, usage: UsageWidget, usagestats: UsageStats };

export default class Kanban extends View {
  init(_props, cx) {
    const role = props()?.role ?? "board";
    if (PARTS[role]) {
      this.part = new PARTS[role]();
      this.part.start(cx);
      return;
    }
    if (role === "bar") {
      // keys.json: "kanban.jira" (or "kanban.tasks") / "kanban.dev" open (or close) that side panel.
      // "kanban.tasks_<tab id>" opens the Tasks panel on that tab, e.g. kanban.tasks_dev.
      cx.spawn(async (cx) => {
        for (;;) {
          const c = await nextCommand();
          if (c === "jira" || c === "tasks") railTo("jira");
          if (c === "dev") railTo("dev");
          if (c.startsWith("tasks_")) {
            setShared("kanban.jira.view", c.slice("tasks_".length));
            if (railShows() !== "jira") railTo("jira");
          }
          // Made-up data in every panel, for screenshots: herdr-app do kanban.demo (again to leave).
          // The Tasks panel goes to Today for the demo and back to your tab after.
          if (c === "demo") {
            const on = !shared("kanban.demo");
            if (on) setShared("kanban.jira.before-demo", shared("kanban.jira.view") ?? null);
            setShared("kanban.jira.view", on ? "today" : shared("kanban.jira.before-demo") ?? null);
            setShared("kanban.demo", on);
          }
          if (c === "usage") openOverlay({ mod: "kanban", props: { role: "usagestats" }, kind: "window", key: "usage-stats", width: 900, height: 680, frame: "none" });
          cx.notify();
        }
      });
    }
    // Ages and timers on cards are minutes: once a minute is enough.
    cx.timer.every(60000, (cx) => cx.notify());
  }

  render(cx) {
    if (this.part) return this.part.render(cx);
    const role = props()?.role ?? "board";
    return role === "bar" ? bar() : role === "railtabs" ? railtabs() : board();
  }
}
