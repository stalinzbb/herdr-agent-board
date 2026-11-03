# Board

A flat, dark kanban window for running many coding agents: every tab is a card, sorted into columns by
what its agent is doing, with the focused tab's terminal below and a side rail for dev servers, tasks (Jira) and riffs (UI questions agents ask with live controls, after DialKit).

![Board](preview.png)

## What you see

- **Bar** (48px, window drag area), icons over words: the Herdr logo (`mods/kanban/herdr.png`, 22px) and
  "Board"; a segmented scope switch "All | <active space's name>"; a red "N waiting on you" pill only while
  agents wait on an answer (click: the oldest). Right: 30px icon buttons with tooltips (Prompt all agents,
  Board ⌘B, Side panel ⌘⇧E/⌘⇧J/⌘⇧Y, Classic ⌘⇧K; Board and Side panel look pressed while shown), a 1px
  divider, and a white "+ New ▾" button that opens the New menu at the pointer.
- **New menu** (popup, 300×400): "New card in <space>": your installed agents (1–4 start them), Terminal,
  "<agent> in a new worktree…" and "Open a worktree…" (Herdr's worktree dialog, the agent passed as
  `argv`); "Split the pane you're in" Right / Down; "New project…" (folder picker, then a space there with
  your first agent). Each row says what it makes in one line.
- **Board** (weight 2): three rounded columns (radius 16, chrome color), each with a dot, label and
  count: **Your turn** (red dot while anything asks you, grey otherwise), **Working** (amber), **Done**
  (green). Cards (radius 12, surface color): project line (hue dot + the git repo's name, folder on hover;
  a "⎇ worktree" tag when the folder is a linked worktree, explained on hover; prompt and ✓ mark-done
  buttons), a wrapping title with the agent's icon, a working timer pill only in Working, a riff chip or a
  badge ("Needs your answer" red, "Finished · not seen yet" green), sub-agent and dev chips, and a meta
  line (⎇ branch, panes, "worked Xm · Ym ago" / "waiting for a prompt"). Done cards are 36px rows: hue
  dot, title, project, age, ↺ (back to the board). Empty columns say what would put a card there.
- **Main tab** below the board: the focused tab's panes, radius 16, with a 34px pane header (mod
  `kanban-pane`) that, for Claude, adds repo · branch · worktree, running subagents, prompt-cache
  countdown, a context bar ("165k / 1M", amber at 70%, red at 90%) and the model name.
- **Rail** (364px, right): a Dev | Tasks | Riff switch (40px; the name comes from `name` in jira.json), then:
  - Dev: running servers and simulators/devices first; everything else folded under "Not running".
  - Tasks (Jira): tabs from the config (Today plus the preset's or your own tabs; opens on `default_tab`), "Updated Xm ago", ⟳ and ✎. Today shows
    the digest (mentions, comments, status changes, quiet tickets) and one card per kind of work with
    in-progress and fresh to-dos. Other tabs group by status (In progress, To do with "Show N older",
    Done folded, 5 at a time; `status_map` decides what each status counts as, or hides it) or by parent story. Rows are two lines: title, then a status pill (click to
    move the ticket), key, platform tag.
  - Riff (red count of agents waiting on you): the focused tab's riffs, the focused pane's first. Each:
    a red dot + "<tab> asks", the question (14px medium, wraps), `about`; a surface card, radius 16,
    padding 8, gap 4, where every control is a 28px bar, radius 8, canvas color, label inside at 10px:
    sliders are DialKit-style (the fill is the value, `selected` white or accent at 20% once changed; a
    2px end line on the fill's edge that hides while it's under the label; an invisible thumb as the
    grab handle; a 52px mono number field, borderless until focused, typing may pass the range),
    toggles (28×16 switch), colors (16px swatch with a white 10% edge + hex field), text, selects as a
    segmented control on the bar (≤3 short options, 22px segments radius 6) or wrapping below, folders
    and spring/easing/pad groups (28px header, children indented 12), action buttons. Changed labels
    turn ink with a 5px accent dot. Then a composer (note + Answer, radius 12 around an 8 button at 4px
    inset) and a line: status ("N changes · Enter answers", "Live → <output>", "Sent"), Reset, Skip.
    Nothing here: a card saying what riffs are, "riff me the card spacing", and "after DialKit, by Josh
    Puckett". Below: "Waiting on you elsewhere · N", one row per other agent's riff; click to go there.
  - Cards: an agent with an open riff goes to Needs you and shows a red "Your call <question>" chip.
- **Status bar** (28px, role status): left, where the pane you're in works: machine (only if another
  one), the repo, ⎇ branch and a "worktree" tag. Right: a red dot + count waiting on you, an amber dot +
  count working (words on hover), a divider, "Today $X" with a 48×4 bar of each model's share (models,
  tokens and cache % on hover), and a ⌘ button for the command palette. Clicking the usage opens a 900×680 frameless stats window: Today / 7 days / 30 days / All time, KPIs, a
  tokens|cost chart by model, by model, by project, most expensive sessions, hours, subagents.

Theme: graphite with background #111111, canvas #0c0c0c, chrome #141414, surface #1a1a1a,
raised #212121, border #232323, text #ededed / #b4b4b4 / #8a8a8a, accent #4c9aff; status colors
working #e2b340, blocked #e5566f, done #3fc07a, idle #6b6b6b. Sentence case, 4px grid, borders or
shadows never both, color only for status and data.

## How it behaves

- Columns are whose turn it is. Herdr's statuses: working; blocked (asked you something); done (finished
  while you weren't looking, idle once you look); idle. Your turn = blocked or an open riff (first), then
  done, then idle agents, then tabs without an agent; cards untouched for a day fold under "N quiet for
  over a day". Working = working (oldest first, so cards don't move). Done = tabs you marked done with ✓
  (`tab.settle`, newest first); opening one, or its agent needing you, brings it back (Herdr unsettles);
  ↺ is `tab.unsettle`. Clicking a card selects its space and tab (with a riff, opens Riff too).
- Worktrees: `git rev-parse --show-toplevel --git-common-dir` per folder (git.js, every 5 s for new folders,
  2 min cache); a common dir that isn't `<top>/.git` is a linked worktree, and the repo is named from it.
- ⌘B toggles the board, ⌘⇧K switches to Herdr's classic layout and back, ⌘⇧E/⌘⇧J open the rail on
  Dev/Tasks, ⌘⇧Y on Riff (`kanban.riff_open` only opens; `kanban.riff_<terminal>` goes to that agent's riff), `kanban.tasks_<tab>` opens Tasks on a tab, ⌘⇧U opens usage stats. Esc or × closes the stats window.
- Dev: start/stop a configured server (runs in a background Herdr terminal named `dev-<id>`), reload
  Metro, boot simulators; a crashed server notifies.
- `kanban.demo` toggles demo mode (shared `kanban.demo`): `demo.js` supplies made-up cards, Jira
  data and usage (the Tasks panel shows Today, then returns to your tab), and the pane header shows a placeholder folder. `preview.png` is taken in it.
- Riff: an agent runs `riff.py ask` with a spec on stdin; it writes `~/.cache/herdr-kanban/riff/<terminal>-<id>.json`
  and polls for `<stem>.answer.json` (100 s by default, then exit 3 and the riff stays open). The bar copy
  watches the folder, publishes shared `kanban.riffs`, sweeps riffs whose terminal is gone, and for a new
  riff opens the Riff tab if it's from the focused tab, else notifies (click: `kanban.riff_<terminal>`
  selects the space and tab, focuses the pane, opens Riff). The panel reloads a spec when it changes
  (controls whose default moved take it; others keep your edit; a broken spec keeps the last good one).
  Every change writes `<stem>.values.json` and the spec's `output`, coalesced. Answer/Skip writes the
  answer file; riff.py prints it and deletes the riff. If the file is still there 3 s later, nobody's
  waiting: the panel types a `Riff · <question>: …` message with `hc send` (none for a silent skip) and
  deletes the riff itself.
- Tasks: refreshes from Jira every 30 minutes in weekday work hours; the digest runs once a day after `digest_at`
  and notifies.

## Built from

- `layouts/kanban.json`: column [bar block (role bar) · row [column [board block (role board), main tab
  block] · column [rail-tabs (role railtabs) · stack dev (role rail) / jira (role jira) / riff (role riff)]] · status row
  [status block (role status)]].
- `mods/kanban` routes by `props().role`: `board.js`, `rail.js`, `railtabs.js`, `jira.js`, `riff.js` (panel), `riffs.js` (bar watcher, shared), `riff.py` (agents' helper), `newmenu.js`
  (the New menu popup), `status.js` (status bar), `git.js` (repo and worktree per folder), `jstatus.js`
  (status popup), `prompts.js` (popup), `usage.js` (usage data, its compact view, stats window), `ui.js`, `pill.js`.
- Herdr API: spaces, panes, terminals, agents, run, exec, readTextFile, writeTextFile, watchFolder,
  focused, layout, keys, knownAgents, pickFolder, openOverlay, closeOverlay, shared/setShared, notify, theme; gpui-base `SliderState`/`Slider*` and `InputState`/`Input`
  (made in `start` or a spawned task, never in render). No `scale`: press feedback is `.active` opacity.
- Programs: `hc run/send/ls`, `lsof`, `xcrun simctl`, `xctrace`, `adb`, `emulator`, `git`, `curl`
  (Metro reload), `python3` (`jira-sync.py`, `usage.py`), `claude -p --model haiku` with only the
  Atlassian connector's Jira tools allowed.
- Settings: `~/.config/herdr-board/*.json` over `mods/kanban/defaults/*.json`; Jira presets in
  `mods/kanban/presets/jira/` with `{{var}}` placeholders, resolved by `jira-sync.py config`.
- Claude Code `SessionStart` hook (`claude-session-hook.py`) maps `HC_TERMINAL_ID` → session transcript.

## Watch out

- Rounded corners don't clip children in GPUI: give cards inner padding and round the rows, or hover
  backgrounds bleed past the corners.
- `line_height(n)` is a multiplier, not px. Scroll containers need an `id`.
- Herdr won't load mod code through symlinks; install by copying.
- Big Jira results come back as "saved to <path>": read that file.
- The two Atlassian connectors take different `responseContentFormat` values; ask for markdown and
  detect mentions by accountId or "@Name".
- Costs are estimates at API list prices from `prices.json`, not your bill.
- A popup's tasks end when it closes: anything that outlives it (the folder picker for New project) runs
  in the bar copy through a `kanban.<command>`.
- `herdr-app shot` returns the last frame drawn; while Herdr's window is in the background it may not redraw,
  so compare two shots before trusting one.
