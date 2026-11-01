# Herdr agent board

![Herdr agent board](preview.png)

A layout for [Herdr](https://herdr.dev): your agent tabs as a kanban board, a Dev panel for servers and
simulators, a Jira panel fed through Claude's Atlassian connector, Claude stats in each pane header, and
long-term Claude usage and cost stats.

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

## Jira presets

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

A list var becomes a quoted JQL list. Any other top-level key you set (`views`, `tabs`, `today_tabs`,
`digest_at`, `work_hours`, …) replaces the preset's. To see the result:
`python3 -I ~/.config/herdr-app/mods/kanban/jira-sync.py config`.

Jira calls go through `claude -p --model haiku` with only the connector's Jira tools allowed. The
results are read from the tool calls as Jira returned them, so nothing in the panel is written by the
model. If your Atlassian tools have another name, list them under `"tools"` in `jira.json` (see the skill).

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

⌘⇧K board ⇄ classic · ⌘B hide the board · ⌘⇧E Dev · ⌘⇧J Jira · ⌘⇧U usage stats
