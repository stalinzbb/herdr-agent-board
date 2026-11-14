#!/usr/bin/env python3
"""The Tasks panel's sources: which ones you use, and the ones that aren't Jira.

  tasks-sync.py config                  the merged config for the panel (every enabled source's
                                        views and tabs), as JSON
  tasks-sync.py sync                    refresh GitHub and Linear into ~/.cache/herdr-kanban/
  tasks-sync.py states linear <id> <key>         where a Linear issue can go -> transitions-<key>.json
  tasks-sync.py move linear <id> <key> <state>   move it there -> action-<key>.json
  tasks-sync.py add "<title>"           add one of your own tasks (agents can use this)
  tasks-sync.py connect <source> on|off turn a source on or off in your tasks.json

Settings: ~/.config/herdr-board/tasks.json (else defaults/tasks.json):
  {"name": "Tasks", "sources": {"jira": {...}, "github": {...}, "linear": {...}, "local": {...}}}
Each source has "enabled" and "label". Jira's own settings stay in jira.json (jira-sync.py syncs
it). GitHub uses the gh CLI you're signed in to. Linear reads a personal API key from the macOS
Keychain (service "herdr-board-linear") or $LINEAR_API_KEY. Your own tasks live in
~/.config/herdr-board/tasks.local.json.

Every source's rows have the Jira rows' shape: key, summary, status, category (new /
indeterminate / done), type, project, updated (ms), plus source, url and id.
"""

import importlib.util
import json
import os
import shlex
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

HOME = os.path.expanduser("~")
HERE = os.path.dirname(os.path.abspath(__file__))
USER_CFG = os.environ.get("HERDR_BOARD_CONFIG") or os.path.join(HOME, ".config/herdr-board")
OUT = os.path.join(HOME, ".cache/herdr-kanban")
LOCAL = os.path.join(USER_CFG, "tasks.local.json")
NOW_MS = int(time.time() * 1000)


def write(name, data):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path + ".tmp", "w") as f:
        json.dump(data, f)
    os.replace(path + ".tmp", path)


def ms(ts):
    try:
        return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None


def jira_module():
    spec = importlib.util.spec_from_file_location("jira_sync", os.path.join(HERE, "jira-sync.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def settings():
    for path in (os.path.join(USER_CFG, "tasks.json"), os.path.join(HERE, "defaults", "tasks.json")):
        if os.path.exists(path):
            with open(path) as f:
                cfg = json.load(f)
            cfg["path"] = path
            return cfg
    return {"sources": {}}


def enabled(cfg, name):
    src = cfg.get("sources", {}).get(name)
    return bool(src and src.get("enabled", True))


# ---- what this machine can connect to

def keychain_has_linear():
    p = subprocess.run(["security", "find-generic-password", "-s", "herdr-board-linear", "-w"], capture_output=True, text=True)
    return p.returncode == 0


def have(cmd):
    """Is this command installed? Herdr runs us with a bare PATH, so ask a login shell too, the way
    the Jira refresh finds claude."""
    if shutil.which(cmd):
        return True
    try:
        return subprocess.run(["/bin/zsh", "-lc", f"command -v {cmd}"], capture_output=True, timeout=10).returncode == 0
    except Exception:
        return False


def availability():
    """{source: {"ok": bool, "why": str}}: whether each outside source can work here. A source that
    can't is left out of the panel (and the Tasks tab hides if nothing is left); the panel says why."""
    return {
        "jira": {"ok": have("claude"), "why": "Needs Claude Code (the claude command) with the Atlassian connector"},
        "github": {"ok": have("gh"), "why": "Needs the GitHub CLI (gh), signed in"},
        "linear": {"ok": bool(os.environ.get("LINEAR_API_KEY")) or keychain_has_linear(), "why": "Needs a Linear API key ($LINEAR_API_KEY, or the Keychain item herdr-board-linear)"},
    }


def connect(source, state):
    """Turn a source on or off in your tasks.json (made from the default the first time)."""
    if source not in ("jira", "github", "linear", "local") or state not in ("on", "off"):
        sys.exit("Usage: tasks-sync.py connect <jira|github|linear|local> <on|off>")
    cfg = settings()
    cfg.pop("path", None)
    cfg.setdefault("sources", {}).setdefault(source, {})["enabled"] = state == "on"
    os.makedirs(USER_CFG, exist_ok=True)
    with open(os.path.join(USER_CFG, "tasks.json"), "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")


# ---- config: one panel config from every enabled source

def config():
    cfg = settings()
    src = cfg.get("sources", {})
    out = {"name": cfg.get("name") or "Tasks", "sources": [], "views": [], "tabs": [{"id": "today", "label": "Today"}], "errors": {}}
    today = []
    avail = availability()
    out["available"] = avail
    # A source you turned on that can't run here is skipped, not an error: the panel shows why.
    for name in ("jira", "github", "linear"):
        if enabled(cfg, name) and not avail[name]["ok"]:
            src = {**src, name: {**src[name], "enabled": False}}
            cfg = {**cfg, "sources": src}
            out.setdefault("unavailable", {})[name] = avail[name]["why"]

    if enabled(cfg, "jira"):
        try:
            j = jira_module().load_config()
            if not j.get("cloudId"):
                raise LookupError("not set up")
            out["sources"].append("jira")
            for k in ("site", "cloudId", "digest_at", "refresh_minutes", "work_hours", "old_days", "stale_days", "preset", "tools"):
                if k in j:
                    out[k] = j[k]
            out["jira_name"] = j.get("name")
            out["views"] += [{**v, "source": "jira"} for v in j.get("views", [])]
            jtabs = j.get("tabs") or [{"id": v["id"], "label": v["label"], "sections": [{"view": v["id"]}]} for v in j.get("views", [])]
            out["tabs"] += [t for t in jtabs if t["id"] != "today"]
            today += j.get("today_tabs") or [t["id"] for t in jtabs if t["id"] not in ("today", "recent")]
            if j.get("default_tab"):
                out["default_tab"] = j["default_tab"]
        except LookupError:
            pass  # Jira isn't connected: no Jira tabs, and setup offers it.
        except BaseException as e:
            out["errors"]["jira"] = str(e)[:240]

    if enabled(cfg, "github"):
        g = src["github"]
        out["sources"].append("github")
        out["views"] += [
            {"id": "gh-issues", "label": "Issues", "source": "github"},
            {"id": "gh-prs", "label": "Pull requests", "source": "github"},
        ]
        out["tabs"].append({"id": "github", "label": g.get("label") or "GitHub", "sections": [
            {"view": "gh-issues", "label": "Issues", "group": "status"},
            {"view": "gh-prs", "label": "Pull requests", "group": "status"},
        ]})
        today.append("github")

    if enabled(cfg, "linear"):
        lcfg = src["linear"]
        out["sources"].append("linear")
        out["views"].append({"id": "linear", "label": lcfg.get("label") or "Linear", "source": "linear"})
        out["tabs"].append({"id": "linear", "label": lcfg.get("label") or "Linear", "sections": [{"view": "linear", "group": "status"}]})
        today.append("linear")

    if enabled(cfg, "local"):
        lo = src["local"]
        out["sources"].append("local")
        out["views"].append({"id": "local", "label": lo.get("label") or "Mine", "source": "local"})
        out["tabs"].append({"id": "mine", "label": lo.get("label") or "Mine", "sections": [{"view": "local", "group": "status"}], "local": True})
        today.append("mine")

    out["today_tabs"] = cfg.get("today_tabs") or today
    for k in ("default_tab", "fast_minutes"):
        if k in cfg:
            out[k] = cfg[k]
    out["path"] = cfg.get("path")
    return out


# ---- GitHub, through the gh CLI

def gh(args):
    p = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=60)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout or "gh failed").strip()[:240])
    return json.loads(p.stdout or "[]")


IN_PROGRESS = ("in progress", "in-progress", "doing", "wip", "started")


def gh_row(i, kind):
    repo = (i.get("repository") or {}).get("name") or ""
    labels = [l.get("name", "") for l in i.get("labels") or []]
    closed = i.get("state") == "closed"
    if kind == "review":
        status, cat = "Review requested", "new"
    elif kind == "pr":
        status, cat = ("Draft" if i.get("isDraft") else "Open"), "indeterminate"
    elif closed:
        status, cat = "Closed", "done"
    elif any(l.lower() in IN_PROGRESS for l in labels):
        status, cat = "In progress", "indeterminate"
    else:
        status, cat = "Open", "new"
    return {
        "key": f"{repo}#{i.get('number')}", "summary": i.get("title"), "status": status, "category": cat,
        "type": "Pull request" if kind in ("pr", "review") else "Issue", "project": repo,
        "updated": ms(i.get("updatedAt") or ""), "url": i.get("url"), "source": "github",
        "id": i.get("url"), "labels": labels,
    }


def sync_github(g):
    fields = "number,title,state,url,repository,updatedAt,labels"
    q = lambda key, default: shlex.split(g.get(key) or default)
    since = (datetime.now(timezone.utc) - timedelta(days=g.get("recent_days", 14))).strftime("%Y-%m-%d")
    out = {}
    try:
        issues = gh(["search", "issues", *q("issues", "is:open assignee:@me archived:false"), "--json", fields, "--limit", "50"])
        closed = gh(["search", "issues", *q("closed", f"is:closed assignee:@me closed:>={since}"), "--json", fields, "--limit", "15"])
        out["gh-issues"] = {"issues": [gh_row(i, "issue") for i in issues + closed]}
    except Exception as e:
        out["gh-issues"] = {"error": f"GitHub: {e}"}
    try:
        mine = gh(["search", "prs", *q("prs", "is:open author:@me archived:false"), "--json", fields + ",isDraft", "--limit", "30"])
        review = gh(["search", "prs", *q("reviews", "is:open review-requested:@me archived:false"), "--json", fields, "--limit", "30"])
        out["gh-prs"] = {"issues": [gh_row(i, "review") for i in review] + [gh_row(i, "pr") for i in mine]}
    except Exception as e:
        out["gh-prs"] = {"error": f"GitHub: {e}"}
    write("github.json", {"at": NOW_MS, "views": out})


# ---- Linear, through its GraphQL API

def linear_key():
    if os.environ.get("LINEAR_API_KEY"):
        return os.environ["LINEAR_API_KEY"]
    p = subprocess.run(["security", "find-generic-password", "-s", "herdr-board-linear", "-w"], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError("No Linear key yet: run /herdr-agent-board:setup in Claude Code")
    return p.stdout.strip()


def linear(query, variables=None):
    req = urllib.request.Request("https://api.linear.app/graphql", method="POST",
                                 data=json.dumps({"query": query, "variables": variables or {}}).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": linear_key()})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    if d.get("errors"):
        raise RuntimeError(d["errors"][0].get("message", "Linear error"))
    return d["data"]


LINEAR_CAT = {"triage": "new", "backlog": "new", "unstarted": "new", "started": "indeterminate", "completed": "done", "canceled": "hide"}


def sync_linear(lcfg):
    since = (datetime.now(timezone.utc) - timedelta(days=lcfg.get("recent_days", 14))).isoformat()
    try:
        d = linear("""query($since: DateTimeOrDuration!) { viewer { assignedIssues(first: 100, orderBy: updatedAt,
            filter: { or: [{ completedAt: { null: true }, canceledAt: { null: true } }, { completedAt: { gt: $since } }] }) {
            nodes { id identifier title url updatedAt state { name type } team { key } } } } }""", {"since": since})
        rows = [{
            "key": n["identifier"], "summary": n["title"], "status": n["state"]["name"],
            "category": LINEAR_CAT.get(n["state"]["type"], "new"), "type": "Issue", "project": n["team"]["key"],
            "updated": ms(n.get("updatedAt") or ""), "url": n["url"], "source": "linear", "id": n["id"],
        } for n in d["viewer"]["assignedIssues"]["nodes"]]
        write("linear.json", {"at": NOW_MS, "views": {"linear": {"issues": rows}}})
    except Exception as e:
        write("linear.json", {"at": NOW_MS, "views": {"linear": {"error": f"Linear: {str(e)[:200]}"}}})


def linear_states(issue_id, key):
    try:
        d = linear("query($id: String!) { issue(id: $id) { state { id } team { states { nodes { id name type position } } } } }", {"id": issue_id})
        cur = d["issue"]["state"]["id"]
        nodes = sorted(d["issue"]["team"]["states"]["nodes"], key=lambda s: s["position"])
        items = [{"id": s["id"], "name": s["name"], "to": s["name"], "category": LINEAR_CAT.get(s["type"], "new")} for s in nodes if s["id"] != cur]
        write(f"transitions-{key}.json", {"key": key, "at": NOW_MS, "transitions": items})
    except Exception as e:
        write(f"transitions-{key}.json", {"key": key, "at": NOW_MS, "error": str(e)[:240]})


def linear_move(issue_id, key, state_id):
    try:
        d = linear("mutation($id: String!, $s: String!) { issueUpdate(id: $id, input: { stateId: $s }) { success issue { state { name type } } } }",
                   {"id": issue_id, "s": state_id})
        st = d["issueUpdate"]["issue"]["state"]
        try:
            with open(os.path.join(OUT, "linear.json")) as f:
                data = json.load(f)
            for i in data["views"]["linear"].get("issues", []):
                if i["id"] == issue_id:
                    i.update(status=st["name"], category=LINEAR_CAT.get(st["type"], "new"), updated=NOW_MS)
            write("linear.json", data)
        except Exception:
            pass
        write(f"action-{key}.json", {"key": key, "at": NOW_MS, "ok": True, "to": st["name"]})
    except Exception as e:
        write(f"action-{key}.json", {"key": key, "at": NOW_MS, "ok": False, "error": str(e)[:240]})


# ---- your own tasks

def add_local(title):
    try:
        with open(LOCAL) as f:
            data = json.load(f)
    except Exception:
        data = {"tasks": []}
    n = max([int(t["id"].lstrip("t")) for t in data["tasks"] if t.get("id", "").lstrip("t").isdigit()] + [0]) + 1
    data["tasks"].insert(0, {"id": f"t{n}", "title": title, "status": "To do", "created": NOW_MS, "updated": NOW_MS})
    os.makedirs(USER_CFG, exist_ok=True)
    with open(LOCAL + ".tmp", "w") as f:
        json.dump(data, f, indent=2)
    os.replace(LOCAL + ".tmp", LOCAL)
    print(f"Added t{n}: {title}")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "sync"
    if mode == "config":
        try:
            print(json.dumps(config()))
        except BaseException as e:
            print(json.dumps({"error": str(e)[:240], "views": [], "tabs": [{"id": "today", "label": "Today"}]}))
        return
    if mode == "connect" and len(sys.argv) > 3:
        return connect(sys.argv[2], sys.argv[3])
    if mode == "add":
        return add_local(" ".join(sys.argv[2:]).strip() or sys.exit("Usage: tasks-sync.py add <title>"))
    if mode == "states" and sys.argv[2] == "linear":
        return linear_states(sys.argv[3], sys.argv[4])
    if mode == "move" and sys.argv[2] == "linear":
        return linear_move(sys.argv[3], sys.argv[4], sys.argv[5])
    if mode == "sync":
        cfg = settings()
        if enabled(cfg, "github"):
            sync_github(cfg["sources"]["github"])
        if enabled(cfg, "linear"):
            sync_linear(cfg["sources"]["linear"])
        return
    sys.exit(f"Unknown: {' '.join(sys.argv[1:])}. See tasks-sync.py --help")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help"):
        print(__doc__)
    else:
        main()
