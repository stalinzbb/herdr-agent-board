---
name: workflow
description: Shape the board's Tasks panel around how this person actually works — which kinds of work get a tab, which tickets each tab pulls from Jira, what each status means for them (to do, in progress, done, or hidden), what Today shows, the panel's name and the tab it opens on. Use when someone says "my steps are different", "add a tab for X", "Ready for Dev should count as done", "hide Won't Do", "rename the Tasks panel", "the presets don't fit how I work", or runs /herdr-agent-board:workflow. Also used by /herdr-agent-board:setup when no preset fits.
---

# Shape the Tasks panel to your workflow

This shapes the Tasks panel's **Jira** tabs, driven by `~/.config/herdr-board/jira.json` (GitHub, Linear
and the person's own tasks are turned on in `tasks.json` by `/herdr-agent-board:setup`). A preset gives a
starting point, but teams name their steps differently, and one person's "done" is another's
"waiting on me". This skill asks how the person works, checks it against their real tickets, and writes
the result as plain config. It never edits the mod's code or presets, and never moves a ticket.

Needs Jira connected first (`site` and `cloudId` in `jira.json`). If they're missing, run
`/herdr-agent-board:setup` step 1 first, then come back.

## What can be shaped

Everything below is a top-level key in `jira.json`. A key there replaces the preset's version of it;
anything left out keeps coming from the preset.

| Key | What it does |
|---|---|
| `name` | The panel's name on the rail switch and board button. Default `"Tasks"`. |
| `default_tab` | The tab it opens on the first time (after that it remembers). Default `"today"`. |
| `views` | Jira searches: `{id, label, jql, max?}`. `max` defaults to 25. |
| `tabs` | What you see: `{id, label, sections: [section…]}`. `today` is a built-in tab with no sections. |
| section | `{view, label?, group?, status_map?, title_from_parent?, pair_migrate?}` |
| `group` | `"status"`: cards for In progress / To do / Done (Done folded, old to-dos behind "Show older"). `"parent"`: one card per parent story (good for subtasks and reviews). Leave it out for a flat list. |
| `status_map` | `{ "<status name>": "new" \| "indeterminate" \| "done" \| "hide" }`. Overrides Jira's own category for that status, in this section only. `new` = To do, `indeterminate` = In progress, `hide` = never shown. |
| `title_from_parent` | Regex. A subtask whose title matches (like `Design Review`) shows its parent's title instead. |
| `today_tabs` | Which tabs feed Today, in order. Today only shows their In progress and recent To do. |
| `digest_at`, `work_hours`, `refresh_minutes`, `stale_days`, `old_days` | Morning digest hour, hours it refreshes in, how often, when a ticket counts as quiet, when a to-do counts as old. |

Read the active preset (`mods/kanban/presets/jira/<preset>.json`) and the person's `jira.json` before
starting, so you know what they already have.

## 1. Look at their real tickets

One search through the Atlassian connector, max 100:
`(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND updated >= -90d ORDER BY updated DESC`,
fields `project, issuetype, status, summary, parent, labels`.

Tally: projects, issue types per project, every status per project with Jira's category, labels, and
repeated words in subtask titles. Everything you propose later has to come from this tally — never invent a
project key, issue type, status or label.

## 2. Ask how they work

Use AskUserQuestion, in their words, a few questions at a time. Offer options built from the tally
(and say what each would show), with "Other" for anything else.

1. **The kinds of work.** "What are the different kinds of work you track?" Each becomes a tab.
   Suggest from the tally (for example: design tickets in one project, stories you build, bugs you review).
2. **What belongs in each.** For each kind: which project(s), which issue types, and their role
   (assigned, reported, watching, or a label). This is the tab's search.
3. **What the steps mean to them.** For each kind, list the statuses that actually appeared and ask which
   are To do, In progress, Done, or not worth showing. Point out the ones where their meaning differs from
   Jira's category — a hand-off status ("Ready for Dev", "In QA") is often done *for them*; a waiting
   status ("Blocked", "On Hold") might be to-do; "Won't Do" or "Duplicate" might be hidden.
4. **How to group.** Status cards (the usual), by parent story (for reviews and subtasks), or a flat list.
5. **Today.** Which tabs should Today pull from, and in what order.
6. **The rest, only if they care:** the panel's name, the tab it opens on, digest time, work hours.

Skip questions their answers already settled. Don't ask about every key in the table.

## 3. Propose, then write

Write views and tabs from the answers. JQL rules:
- Quote issue types and statuses with spaces: `issuetype in ("Technical Spike", Bug)`.
- Keep finished work from piling up: `AND (statusCategory != Done OR updated >= -14d)`.
- End with `ORDER BY updated DESC`.
- One view can feed several tabs. A tab can have several sections (like Features and Prototypes).

Show the person the change before writing: each tab as "Tab — what it shows — how it's grouped — what
counts as done", then the JSON. If `jira.json` exists, back it up to
`~/.config/herdr-board/backup/<yyyymmdd-hhmmss>/jira.json` and show only what changes. Keep `site`, `cloudId`,
`tools`, `preset` and `vars` unless they asked otherwise.

Example (a designer whose hand-off status counts as done and who hides "Won't Do"):

```json
{
  "site": "https://example.atlassian.net", "cloudId": "…", "preset": "designer",
  "vars": { "design": "UXD", "dev": "ECOM" },
  "name": "Tasks",
  "default_tab": "dev",
  "tabs": [
    { "id": "today", "label": "Today" },
    { "id": "design", "label": "Design", "sections": [
      { "view": "design", "group": "status",
        "status_map": { "Ready for Dev": "done", "Ready for Design": "new", "Won't Do": "hide" } } ] },
    { "id": "dev", "label": "Dev", "sections": [
      { "view": "features", "label": "Features", "group": "status" },
      { "view": "proto", "label": "Prototypes", "group": "status" } ] }
  ],
  "today_tabs": ["design", "dev"]
}
```

## 4. Check it

1. `python3 -I ~/.config/herdr-app/mods/kanban/jira-sync.py config` must print the config, not `{"error": …}`.
2. Every tab's `sections[].view` must exist in `views`, every `today_tabs` entry and `default_tab` in `tabs`.
3. Run each new or changed view's JQL once through the connector with maxResults 5, and tell them the counts.
   A JQL error means a wrong project, type or status name: fix it from the tally.
4. `python3 -I ~/.config/herdr-app/mods/kanban/jira-sync.py sync` (about a minute; it only reads), then check
   `~/.cache/herdr-kanban/status.json` says `"state": "ok"`.
5. Show it: `herdr-app do kanban.tasks_<default tab>` opens the panel on that tab. The panel reloads its
   config when the sync finishes.

Never test the panel's status menu on a real ticket: moving a ticket writes to Jira.

## Small changes

For "add a tab for bugs", "rename Dev to Build", "In QA should be done" and the like: skip the interview,
read `jira.json`, make that one change, show the diff, back up, write, and run step 4 for the touched view.
If the change touches a key that came from the preset (like `tabs`), copy the preset's full value into
`jira.json` first and change it there — the key replaces the preset's, it doesn't merge with it.
