# Herdr agent board

![Herdr agent board](preview.png)

A layout for [Herdr](https://herdr.dev): your agent tabs as a board of whose turn it is, a Dev panel for servers and
simulators, a Tasks panel (Jira, fed through Claude's Atlassian connector), riffs (an agent asks you a UI question
with live controls, after [DialKit](https://github.com/joshpuckett/dialkit), and gets your answer back), Claude stats in each
pane header, and long-term Claude usage and cost stats.

## Install

```sh
git clone https://github.com/stalinzbb/herdr-agent-board ~/dg-labs/herdr-agent-board
~/dg-labs/herdr-agent-board/install.sh
```

Then, in Claude Code, add this repo as a plugin and run the setup skill:

```
/plugin marketplace add ~/dg-labs/herdr-agent-board
/plugin install herdr-agent-board@herdr-agent-board
/herdr-agent-board:setup
```

Setup finds your Atlassian site, looks at your recent tickets to pick a Jira preset, finds your dev
servers, and offers to add the Claude session hook. You can skip it and edit the files below yourself.

Everyone's steps are different, so the Tasks panel can be shaped to yours:

```
/herdr-agent-board:workflow
```

It looks at your recent tickets, asks what kinds of work you track and what each status means to you
(for example "Ready for Dev" is done for a designer, "Won't Do" is hidden), then writes the tabs.

## The board

Every tab is a card. The columns say whose turn it is:

- **Your turn**: the agent asked you something (a permission, a question, a riff), finished, or is waiting
  for a prompt. Questions come first, then work you haven't looked at. Plain terminals are here too.
- **Working**: an agent is working.
- **Done**: tabs you marked done with ✓. They keep running; opening one, or its agent needing you, brings it
  back. ↺ puts it back without opening it.

The project on a card is its git repo. A **worktree** tag means the card works in a second checkout of
that repo on its own branch (from **New → Agent in a new worktree…**, Claude's worktrees, or `git worktree`).
Its changes don't touch your main checkout until you merge.

**New** in the top bar starts everything: an agent or a terminal in a new tab, an agent in a new worktree,
a split of the pane you're in, or a new project from a folder. Herdr calls a project a *space*; a card is a
*tab*, and a tab holds *panes*.

## Where things live

| | |
|---|---|
| This repo | The code. `install.sh` copies it into `~/.config/herdr-app` (Herdr only runs code inside its own folder, so links don't work). |
| `~/.config/herdr-board/` | **Your settings.** Never touched by install or updates. Any file missing here falls back to `mods/kanban/defaults/`. |
| `~/.cache/herdr-kanban/` | Jira results, digest, session map, usage summaries. Safe to delete. |
| `~/.local/share/herdr-kanban/usage.db` | Long-term Claude usage history (SQLite). |

Settings files: `jira.json`, `dev.json`, `prompts.json`, `usage.json` (`code_roots`), and optionally
`prices.json` and `models.json` to override API prices and context window sizes. The ✎ button on
each panel opens yours, making it from the default the first time.

## Updating

- From the repo: `git pull && ./install.sh`. An installed copy that differs is backed up first, to
  `~/.config/herdr-board/backup/`.
- Changed something in Herdr directly (or had an agent do it)? `./install.sh --pull` copies it back
  into the repo so you can commit it.

## Tasks panel: Jira presets

`jira.json` names a preset from `mods/kanban/presets/jira/` and fills its vars:

```json
{
  "site": "https://example.atlassian.net",
  "cloudId": "…",
  "preset": "designer",
  "vars": { "design": "UXD", "dev": "ECOM" }
}
```

| Preset | Tabs | Vars |
|---|---|---|
| `designer` | Today · Design · Dev (features, prototypes) · Design QA · Recent | `design`, `dev` projects; optional `spike_type`, `subtask_types`, `qa_types`, `qa_title`, `design_done`, `design_todo` |
| `engineer` | Today · My work · Review · Bugs · Recent | `projects` (a list); optional `review_statuses`, `bug_type` |
| `mine` | Today · Assigned · Reported · Recent | none |

A list var becomes a quoted JQL list. Any other top-level key you set (`name`, `default_tab`, `views`,
`tabs`, `today_tabs`, `digest_at`, `work_hours`, …) replaces the preset's; `skills/workflow/SKILL.md`
explains each, including `status_map` (`new` / `indeterminate` / `done` / `hide` per status). To see the result:
`python3 -I ~/.config/herdr-app/mods/kanban/jira-sync.py config`.

Jira calls go through `claude -p --model haiku` with only the connector's Jira tools allowed. The
results are read from the tool calls as Jira returned them, so nothing in the panel is written by the
model. If your Atlassian tools have another name, list them under `"tools"` in `jira.json` (see the skill).

## Riff: agents ask you UI questions

When an agent needs your call on something visual (how much spacing, which color, which variant, how
a spring feels), it opens a **riff**: a question with live controls (sliders, colors, toggles,
selects, springs, easings) in the rail's **Riff** tab, next to its pane. You drag, add a note if you
like, and **Answer** (or **Skip**). The answer goes straight back to the agent and the riff closes.

- It's contextual: the Riff tab shows the question from the pane you're on. An agent elsewhere that's
  waiting on you moves to "Needs you" on the board with its question on the card, and you get a
  notification that takes you there.
- If the agent wrote a live `output` file, your dev server shows each value as you drag.
- If the agent stopped waiting, your answer is typed into it as a `Riff · …` message instead.

Agents learn how from the `riff` skill (`skills/riff/SKILL.md`, in the plugin): they run
`mods/kanban/riff.py ask` with a question and DialKit-shaped controls, and get JSON back. You can also
just say "riff me the card spacing".

## What it runs

The mods run programs: `hc` (start dev servers, send prompts), `lsof`, `xcrun simctl`, `adb`, `git`,
`python3` (Jira sync, usage import) and `claude` (Jira, through your connector). They read
`~/.claude/projects/**` for usage stats and pane stats. Changing a ticket's status from the panel
writes to Jira.

## Demo mode

`herdr-app do kanban.demo` fills every panel with made-up data (a fictional "Acme" with cards,
tickets and costs), for screenshots or to try the board before setting anything up. Run it again to
go back. It makes no Jira calls and changes nothing.

## Keys

⌘⇧K board ⇄ classic · ⌘B hide the board · ⌘⇧E Dev · ⌘⇧J Tasks · ⌘⇧Y Riff · ⌘⇧U usage stats

`herdr-app do kanban.tasks_<tab id>` opens the Tasks panel on a tab (for example `kanban.tasks_dev`),
and can be bound to a key in `keys.json`. `herdr-app do kanban.riff_open` opens Riff (and never closes it).

## Credits

Riff is modeled on [DialKit](https://github.com/joshpuckett/dialkit) by
[Josh Puckett](https://joshpuckett.me) (MIT): its idea of live tuning controls, its control config
format and its slider range rules. Riff is a native Herdr rebuild and contains no DialKit code.
