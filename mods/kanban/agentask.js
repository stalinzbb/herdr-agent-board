// Prompts you can hand to an agent, from the panels that need one: the Riff tab (ask for a riff) and the
// Tasks panel (set up where tasks come from). Each prompt has to stand on its own: the agent may have been
// cleared, may not have the board's skills (it isn't Claude Code, or it started before the plugin was
// installed), so every prompt points at the tool's own help and says what to do and what to ask.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, notify, focused, agents } from "herdr";
import { button } from "./ui.js";
import { demo } from "./demo.js";
import { askerLabel, paneLabel } from "./riffs.js";

const SYNC = "python3 -I ~/.config/herdr-app/mods/kanban/tasks-sync.py";
const JIRA = "python3 -I ~/.config/herdr-app/mods/kanban/jira-sync.py";

// The Tasks panel's setup prompts: [label, what it does, the prompt].
export const TASK_PROMPTS = [
  ["Set up my tasks", "It asks where your tasks come from, then connects them",
    `Set up the Tasks panel in my Herdr board. Run \`${SYNC} --help\` and \`${SYNC} config\` to see what is connected and what this machine can run. `
    + "Then ask me one short question: where do my tasks come from? The options are GitHub issues and pull requests (needs the `gh` CLI signed in), "
    + "Linear (needs a personal API key in the macOS Keychain under `herdr-board-linear`, or in $LINEAR_API_KEY), "
    + "Jira (needs Claude Code with the Atlassian connector), or just a list of my own. "
    + `Turn on what I pick with \`${SYNC} connect <source> on\`, run \`${SYNC} sync\`, and tell me what shows up in the panel. `
    + "Never ask me to paste an API key into this chat: tell me how to store it myself."],
  ["Connect Jira", "Site, preset and tabs, from your recent tickets",
    "Connect Jira to the Tasks panel in my Herdr board. It needs Claude Code signed in with the Atlassian connector. "
    + "If you have the `herdr-agent-board:setup` skill, run it. Otherwise: find my Atlassian site and cloudId, then pick a preset "
    + "(`designer`, `engineer` or `mine`; they are in ~/.config/herdr-app/mods/kanban/presets/jira/) by looking at my recent tickets and asking me what I track. "
    + "Write ~/.config/herdr-board/jira.json with `site`, `cloudId`, `preset` and its `vars`, "
    + `check it with \`${JIRA} config\`, then run \`${SYNC} connect jira on\`. Ask me before you change anything in Jira.`],
  ["Add my to-dos", "Turns what is left to do into tasks of your own",
    "Add what is left to do from this conversation to my Tasks panel as tasks of my own, one per item, short and in my words. "
    + `Use \`${SYNC} add "<title>"\` for each. They show up in Today. Then list what you added.`],
];

// Who "Ask" sends to: the focused pane's agent. If you're on a pane that isn't one (a dev server, a
// simulator log, a mod), every agent in the tab, so you can pick which pane to ask. Never in demo mode.
export function askTargets() {
  if (demo()) return [];
  const f = focused();
  const all = agents();
  const here = all.find((a) => a.address === f?.terminal || a.address === f?.agent);
  return here ? [here] : all.filter((a) => a.tab === f?.tab).slice(0, 3);
}

// Type a prompt into an agent, and say how it went.
export function askAgent(a, text, title) {
  return (cx) => cx.spawn(async () => {
    const r = await exec("hc", ["send", a.address, text]).catch((e) => ({ code: 1, stderr: String(e) }));
    notify(r.code === 0 ? { title, body: askerLabel(a), level: "success", timeout: 2000 } : { title: "Couldn't reach the agent", body: (r.stderr || "").trim().slice(0, 160), level: "warning" });
  });
}

// Copy a prompt, to paste into any agent.
export function copyPrompt(text) {
  return exec("/bin/sh", ["-c", 'printf %s "$1" | pbcopy', "sh", text])
    .then(() => notify({ title: "Copied", body: "Paste it into an agent", level: "success", timeout: 2000 }))
    .catch(() => notify({ title: "Couldn't copy", level: "warning" }));
}

export const askLabel = (targets, a) => (targets.length === 1 ? "Ask this agent" : `Ask ${paneLabel(a) ?? askerLabel(a)}`);

// One prompt as a row: what it does, then Copy and one Ask button per agent that can take it.
export function promptRow(p, id, label, about, text, title = "Sent to the agent") {
  const targets = askTargets();
  return v_flex().id(id).gap(4).py(4)
    .child(div().text_size(12.5).text_color(p.ink).child(label))
    .child(div().text_size(11).text_color(p.faint).child(about))
    .child(h_flex().gap(6).flex_wrap().pt(2)
      .child(button(p, `${id}-copy`, "Copy prompt", () => copyPrompt(text), { variant: "secondary" }))
      .children(targets.map((a, i) => button(p, `${id}-ask-${i}`, askLabel(targets, a), (_e, cx) => askAgent(a, text, title)(cx), { variant: "primary" }))));
}
