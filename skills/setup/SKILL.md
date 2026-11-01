---
name: setup
description: Set up or re-tune the Herdr board for this person — connect the Jira panel through their Atlassian connector and pick a preset from their real tickets, find their dev servers, set where their repos live, and offer the Claude session hook. Use when someone says "set up the herdr board", "configure the Jira panel", "my Jira panel is empty", "add my dev servers to Herdr", or runs /herdr-agent-board:setup.
---

# Set up the Herdr board

The board's code lives in this plugin's repo, installed into `~/.config/herdr-app` by `install.sh`.
Everything personal lives in `~/.config/herdr-board/` — that folder is the only thing this skill writes,
apart from the optional hook in `~/.claude/settings.json`. Each file there is optional: whatever is
missing falls back to `mods/kanban/defaults/<name>.json`.

| File | What it sets |
|---|---|
| `jira.json` | Atlassian site and cloudId, the preset and its vars, any overrides |
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

## 1. Jira

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
   would show in their words.
5. **Write** `~/.config/herdr-board/jira.json`, smallest form that works:
   ```json
   { "site": "https://example.atlassian.net", "cloudId": "…", "preset": "designer",
     "vars": { "design": "UXD", "dev": "ECOM" } }
   ```
   Any top-level key (`views`, `tabs`, `today_tabs`, `digest_at`, `work_hours`, `refresh_minutes`,
   `stale_days`, `old_days`) replaces the preset's. A view is `{id, label, jql, max?}`; a tab is
   `{id, label, sections: [{view, label?, group: "status" | "parent", status_map?, pair_migrate?, title_from_parent?}]}`.
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
- `herdr-app do layout.switch --name kanban`, then `herdr-app do kanban.jira` to open the Jira panel.
- Tell them the keys: ⌘⇧K board ⇄ classic, ⌘B hide the board, ⌘⇧E dev, ⌘⇧J Jira, ⌘⇧U usage stats.
- Settings edits apply on the panel's next refresh (⟳ in the Jira panel) or a Herdr restart.
