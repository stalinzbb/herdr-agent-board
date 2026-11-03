# Board

A flat, dark kanban window for running many coding agents: every tab is a card, sorted into columns by
what its agent is doing, with the focused tab's terminal below and a side rail for dev servers, tasks (Jira) and riffs (UI questions agents ask with live controls, after DialKit).

![Board](preview.png)

## What you see

- **Bar** (48px, window drag area): the Herdr logo (`mods/kanban/herdr.png`, from the app icon) and "Board / <space>" on the left; a red "Needs you" count; an
  All spaces / This space switch; text buttons Prompt all, Board ⌘B, Dev ⌘⇧E, Tasks ⌘⇧J, Riff ⌘⇧Y, Classic ⌘⇧K;
  a white "+ New card" button.
- **Board** (weight 2): four rounded columns (radius 16, chrome color): Needs you (red dot), In progress
  (amber), Review (green), Backlog (grey), each with a count. Cards (radius 12, surface color) show a
  project line (hue dot + space name), a wrapping title with the agent's icon, a working timer pill while
  the agent works, sub-agent chips, dev-server/simulator chips, and a meta line (branch, panes,
  "worked Xm · Ym ago").
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
- **Status bar**: Herdr's `workspace-status`, plus a 440px usage widget: "Today ≈ $X · model tokens · cache %".
  Clicking it opens a 900×680 frameless stats window: Today / 7 days / 30 days / All time, KPIs, a
  tokens|cost chart by model, by model, by project, most expensive sessions, hours, subagents.

Theme: graphite with background #111111, canvas #0c0c0c, chrome #141414, surface #1a1a1a,
raised #212121, border #232323, text #ededed / #b4b4b4 / #8a8a8a, accent #4c9aff; status colors
working #e2b340, blocked #e5566f, done #3fc07a, idle #6b6b6b. Sentence case, 4px grid, borders or
shadows never both, color only for status and data.

## How it behaves

- Columns: blocked → Needs you; working → In progress; done → Review; idle → Backlog. Clicking a card
  selects its tab. The timer counts from when the agent started working.
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
  [workspace-status, usage block (role usage)]].
- `mods/kanban` routes by `props().role`: `board.js`, `rail.js`, `railtabs.js`, `jira.js`, `riff.js` (panel), `riffs.js` (bar watcher, shared), `riff.py` (agents' helper), `jstatus.js`
  (status popup), `prompts.js` (popup), `usage.js` (widget + stats window), `ui.js`, `pill.js`.
- Herdr API: spaces, panes, terminals, agents, run, exec, readTextFile, writeTextFile, watchFolder,
  focused, openOverlay, closeOverlay, shared/setShared, notify, theme; gpui-base `SliderState`/`Slider*` and `InputState`/`Input`
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
