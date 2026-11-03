---
name: setup
description: Set up or re-tune the Herdr board for this person — choose where the Tasks panel's work comes from (Jira through their Atlassian connector, GitHub issues and PRs through gh, Linear through an API key, their own task list, or several at once, one tab each), find their dev servers, set where their repos live, and offer the Claude session hook. Use when someone says "set up the herdr board", "add GitHub/Linear/Jira to my tasks", "configure the Tasks panel", "my Tasks panel is empty", "add my dev servers to Herdr", or runs /herdr-agent-board:setup.
---

# Set up the Herdr board

The board's code lives in this plugin's repo, installed into `~/.config/herdr-app` by `install.sh`.
Everything personal lives in `~/.config/herdr-board/` — that folder is the only thing this skill writes,
apart from the optional hook in `~/.claude/settings.json`. Each file there is optional: whatever is
missing falls back to `mods/kanban/defaults/<name>.json`.

| File | What it sets |
|---|---|
| `tasks.json` | Which sources the Tasks panel shows (`jira`, `github`, `linear`, `local`), their labels and queries, the panel's `name` |
| `jira.json` | Jira's Atlassian site and cloudId, the preset and its vars, any overrides |
| `tasks.local.json` | The person's own tasks (the panel and agents write it; never edit it during setup) |
| `dev.json` | Dev servers the Dev panel can start, and the Android SDK path |
| `prompts.json` | Saved prompts (the board's "Prompt all" popup) |
| `usage.json` | `code_roots`: folders your repos live in, trimmed from project names in the stats |
| `prices.json`, `models.json` | Only to override the shipped API prices or context window sizes |

Work through the steps in order. Show each file before writing it and write only after the person agrees.
If a file already exists, show what changes rather than replacing it silently.

## 0. Is the board installed?

- `~/.config/herdr-app` must exist (Herdr installed and opened once). If not, stop: point to https://herdr.dev.
- `~/.config/herdr-app/mods/kanban/jira-sync.py` must exist. If not, give the person the install command to run
  themselves — `<this repo>/install.sh` — and wait. Don't run it for them unless they ask.
- Find the repo folder from `readlink ~/.config/herdr-app/mods/kanban` (a link install) for later steps.

## 1. Task sources

The Tasks panel shows work from any mix of sources, each as its own tab(s); Today gathers the open work
from all of them. `~/.config/herdr-board/tasks.json` turns them on:

```json
{ "name": "Tasks",
  "sources": {
    "jira":   { "enabled": true },
    "github": { "enabled": true, "label": "GitHub" },
    "linear": { "enabled": false },
    "local":  { "enabled": true, "label": "Mine" } } }
```

1. **Look first.** What each needs, and how to tell it's there:
   - Jira: an Atlassian connector in your tools (`mcp__claude_ai_Atlassian__*` or another prefix).
   - GitHub: `gh auth status` says logged in.
   - Linear: a personal API key (they make one at linear.app → Settings → Security & access → Personal API keys).
   - Their own tasks: nothing; always available.
2. **Ask** which to show (AskUserQuestion, multiSelect), saying for each whether it's connected now. Don't
   enable a source you can't reach; offer to connect it instead.
3. Set each chosen source up below, then **write `tasks.json`** with the chosen ones `enabled: true`.
4. **Check:** `python3 -I ~/.config/herdr-app/mods/kanban/tasks-sync.py config` lists the `sources` and
   `tabs`; `errors` says what's wrong. Then `tasks-sync.py sync` (GitHub and Linear, seconds) and read
   `~/.cache/herdr-kanban/github.json` / `linear.json`: each view has `issues` or an `error`.

### GitHub

Uses the `gh` CLI they're signed in to; nothing to store. Not signed in: they run `! gh auth login`.
The tab has two sections: **Issues** (assigned to them, open, plus ones closed in the last `recent_days`,
default 14) and **Pull requests** (review requests, then their own open PRs). The searches are GitHub
search qualifiers and can be narrowed, for example to an org:
`"issues": "is:open assignee:@me org:acme archived:false"`, likewise `"closed"`, `"prs"`, `"reviews"`.
Run `gh search issues <query words> --limit 5` once to show them what they'd see. An issue labelled
"in progress" / "doing" / "wip" counts as in progress. From the panel: close or reopen an issue.

### Linear

Uses Linear's API with a personal key kept in the macOS Keychain. **Never ask for the key in chat.**
Have them run, with their key in place of `lin_api_…`:
```
! security add-generic-password -U -s herdr-board-linear -a linear -w lin_api_…
```
(or set `LINEAR_API_KEY` in their shell). Then `tasks-sync.py sync` and read `linear.json`. The tab shows
issues assigned to them, open ones plus completed in the last `recent_days`; status changes use their
team's workflow states.

### Their own tasks

`local` is a plain list in `tasks.local.json`: added from the Mine tab, or by any agent with
`python3 -I ~/.config/herdr-app/mods/kanban/tasks-sync.py add "<title>"`. Statuses: To do, Doing, Done.
Offer it to everyone; it's how they track what isn't in a tracker.

### Jira

The panel reaches Jira only through a Claude connector (no API token). `jira-sync.py` runs
`claude -p --model haiku` with the connector's tools allowed and reads the raw tool results.

1. **Which connector.** Look at the Atlassian tools you have. The defaults expect
   `mcp__claude_ai_Atlassian__*` (the claude.ai Atlassian connector). If the person's tools have another
   prefix (for example `mcp__plugin_<name>_atlassian__*`), they go in `jira.json` as
   `"tools": {"search": ["<prefix>searchJiraIssuesUsingJql"], "transitions": "<prefix>getTransitionsForJiraIssue", "move": "<prefix>transitionJiraIssue"}`.
   No Atlassian tools at all: tell them to connect Atlassian in claude.ai → Settings → Connectors, then rerun.
2. **Site.** `getAccessibleAtlassianResources` → `site` (the `url`) and `cloudId` (the `id`). If there are
   several, ask which one.
3. **What their work looks like.** Run one search:
   `(assignee = currentUser() OR reporter = currentUser()) AND updated >= -90d ORDER BY updated DESC`,
   max 100, fields `project, issuetype, status, summary, parent`. Tally projects, issue types per project,
   statuses per project, and common summary words of sub-tasks (like "Design Review").
4. **Pick a preset** from `mods/kanban/presets/jira/` — read each file's `about` and `vars`:
   - `designer` — design tickets in one project (`design`), dev work, prototypes (`spike_type`) and design QA
     (`qa_types`, `qa_title`) in another (`dev`). `design_done` is the status that means "handed off" (it
     counts as done), `design_todo` one that means "not started".
   - `engineer` — `projects` (a list), `review_statuses`, `bug_type`.
   - `mine` — no vars; assigned and reported, every project. The safe fallback.
   Recommend one from the tally, with the vars filled from what you saw — only use project keys, issue types
   and statuses that actually appeared. Ask the person to confirm (AskUserQuestion), naming what each tab
   would show in their words. If no preset fits how they work, or their steps mean something different
   (a hand-off status that is "done" for them, statuses to hide), write the site, cloudId and closest
   preset first, then follow the `workflow` skill (`/herdr-agent-board:workflow`) to shape the tabs.
5. **Write** `~/.config/herdr-board/jira.json`, smallest form that works:
   ```json
   { "site": "https://example.atlassian.net", "cloudId": "…", "preset": "designer",
     "vars": { "design": "UXD", "dev": "ECOM" } }
   ```
   Any top-level key (`name`, `default_tab`, `views`, `tabs`, `today_tabs`, `digest_at`, `work_hours`,
   `refresh_minutes`, `stale_days`, `old_days`) replaces the preset's — the `workflow` skill documents each. A view is `{id, label, jql, max?}`; a tab is
   `{id, label, sections: [{view, label?, group: "status" | "parent", status_map?, pair_migrate?, title_from_parent?}]}`;
   `status_map` values are `new`, `indeterminate`, `done` or `hide`.
6. **Check every search.** `python3 -I ~/.config/herdr-app/mods/kanban/jira-sync.py config` prints the
   resolved config (or `{"error": …}` for a missing var). Run each view's `jql` once yourself with maxResults 1.
   A JQL error (an issue type or status that doesn't exist on their site) means fix the var, not the preset.
7. **First sync.** Run `python3 -I ~/.config/herdr-app/mods/kanban/jira-sync.py sync` (about a minute), then
   read `~/.cache/herdr-kanban/status.json`: `"state": "ok"` is done; `"error"` says why.
   It only reads. Moving a ticket's status from the panel writes to Jira — never test that on a real ticket.

## 2. Dev servers

1. Ask where their repos live (look first: `~/code`, `~/projects`, `~/src`, `~/dev`, or folders under `~`
   holding several git repos). That's `code_roots` for `usage.json`.
2. In each repo, read `package.json` scripts. Propose servers for `dev`/`start`/`serve` scripts with:
   `id`, `name`, `project` (repo folder name), `folder` (with `~`), `argv` (the package manager they use —
   `yarn.lock` → yarn, `pnpm-lock.yaml` → pnpm, `bun.lockb` → bun, else npm), `port` (from the script, the
   framework's config, or its default: Next 3000, Vite 5173, Metro 8081), `url` for web apps.
   React Native (Metro): add `"reload": true, "devices": true` so the panel shows simulators and devices.
3. Keep it to the servers they actually run. Write `dev.json` and `usage.json`.

## 3. Saved prompts

Show the defaults (`mods/kanban/defaults/prompts.json`). Offer to keep them, or copy them to
`~/.config/herdr-board/prompts.json` to edit. Don't invent repo rules in prompt text.

## 4. Claude session hook (optional)

The pane header shows the Claude session's context use, cache timer and subagents. Without the hook it
guesses the session from the folder (marked "?"); with it, it knows. The hook writes one small file per
Herdr terminal to `~/.cache/herdr-kanban/sessions/` and always exits 0.

Show the exact change, ask, back up `~/.claude/settings.json`, then add under `hooks`:
```json
"SessionStart": [{ "hooks": [{ "type": "command",
  "command": "python3 -I ~/.config/herdr-app/mods/kanban/claude-session-hook.py" }] }]
```
Keep any SessionStart hooks already there. Skip if this exact command is already present.

## 5. Check

- `herdr-app check ~/.config/herdr-app/mods/kanban` and `herdr-app check ~/.config/herdr-app/mods/kanban-pane` (it takes a folder) — both must pass.
- `herdr-app do layout.switch --name kanban`, then `herdr-app do kanban.tasks` to open the Tasks panel.
- Tell them the keys: ⌘⇧K board ⇄ classic, ⌘B hide the board, ⌘⇧E Dev, ⌘⇧J Tasks, ⌘⇧Y Riff, ⌘⇧U usage stats.
- The panel reloads `tasks.json` and `jira.json` when they change; ⟳ refreshes every source now. Every row
  has ▶ to start an agent on it.
