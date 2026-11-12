// Kanban: the board layout's parts, one mod with a role per copy.
//   bar      - the title strip above the board (also takes kanban.* key commands)
//   board    - columns of cards (one card per tab, by its agents' status)
//   railtabs - the right panel's Dev | Tasks switcher
//   rail     - the dev panel: servers, simulators, devices
//   jira     - the Tasks panel (Jira): saved views and the morning digest
//   riff     - the Riff panel: an agent's UI question with live controls, for the focused pane
//   prompts  - the saved-prompts popup (opened by the board)

import { View } from "gpui-kit";
import { props, nextCommand, openOverlay, shared, setShared, pickFolder, run, spaces, panes } from "herdr";
import { bar, board, toggleMode } from "./board.js";
import { Rail } from "./rail.js";
import { Jira } from "./jira.js";
import { Riff } from "./riff.js";
import { NewMenu } from "./newmenu.js";
import { StatusBar } from "./status.js";
import { refreshGit } from "./git.js";
import { watchRiffs, goToRiff } from "./riffs.js";
import { Prompts } from "./prompts.js";
import { JStatus } from "./jstatus.js";
import { UsageWidget, UsageStats } from "./usage.js";
import { Tree } from "./tree.js";
import { railtabs, railTo, railShows } from "./railtabs.js";

class Sidebar extends Tree { constructor() { super(false); } }
const PARTS = { sidebar: Sidebar, rail: Rail, jira: Jira, riff: Riff, newmenu: NewMenu, status: StatusBar, prompts: Prompts, jstatus: JStatus, usage: UsageWidget, usagestats: UsageStats };

export default class Kanban extends View {
  init(_props, cx) {
    const role = props()?.role ?? "board";
    if (PARTS[role]) {
      this.part = new PARTS[role]();
      this.part.start(cx);
      return;
    }
    if (role === "bar") {
      // The bar is always shown: it watches for agents' riffs (questions for you) for the whole board.
      watchRiffs(cx);
      // keys.json: "kanban.jira" (or "kanban.tasks") / "kanban.dev" / "kanban.riff" open (or close) that side panel.
      // "kanban.tasks_<tab id>" opens the Tasks panel on that tab, e.g. kanban.tasks_dev.
      cx.spawn(async (cx) => {
        for (;;) {
          const c = await nextCommand();
          if (c === "jira" || c === "tasks") railTo("jira");
          if (c === "mode") toggleMode();
          if (c === "dev") railTo("dev");
          if (c === "riff" || c === "tune" || c === "dials") railTo("riff");
          if (c === "riff_open" && railShows() !== "riff") railTo("riff");
          // From a "needs your call" notification: go to that agent with its riff open.
          if (c.startsWith("riff_t")) goToRiff(c.slice("riff_".length));
          // The New menu's "New project…": a folder, then a space there with your first agent.
          if (c === "new_project") {
            cx.spawn(async () => {
              const folder = await pickFolder({ prompt: "Open" });
              if (!folder) return;
              const where = spaces().find((s) => s.active)?.machine ?? "";
              const first = (shared("kanban.agents")?.[where] ?? []).find((a) => a.installed);
              run("space.new", { folder, ...(first ? { argv: first.run, tab: first.name } : {}) });
            });
          }
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
    if (role === "board") {
      // Each card's repo and whether it's a worktree: asked of git once per folder, again every
      // two minutes; checked for new folders every few seconds (cheap when nothing's new).
      const look = (cx) => cx.spawn(async (cx) => { if (await refreshGit(panes().map((x) => x.cwd))) cx.notify(); });
      look(cx);
      cx.timer.every(5000, look);
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
