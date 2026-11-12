#!/usr/bin/env python3
"""Refresh the Jira panel's cache through Claude's Atlassian connector.

  jira-sync.py sync    the saved views
  jira-sync.py digest  the views, plus the morning digest (mentions, new comments,
                       status changes since the last digest, stale work)
  jira-sync.py config  print the resolved config (preset + your settings) as JSON

Your settings: ~/.config/herdr-board/jira.json (or $HERDR_BOARD_CONFIG/jira.json).
Without it, defaults/jira.json. A config can name a preset from presets/jira/ and
fill its {{vars}}; anything else it sets replaces the preset's value.

Claude (Haiku) only makes the Jira calls. The results are read from its tool calls
as Jira returned them, so nothing in the cache is written by the model.
Writes ~/.cache/herdr-kanban/{jira,digest,status}.json.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
HERE = os.path.dirname(os.path.abspath(__file__))
USER_CFG = os.environ.get("HERDR_BOARD_CONFIG") or os.path.join(HOME, ".config/herdr-board")
OUT = os.path.join(HOME, ".cache/herdr-kanban")
# The Atlassian connector's tools, as Claude Code names them. A config can list its own
# ("tools": {"search": [...], "transitions": "...", "move": "..."}) for another connector name.
DEFAULT_TOOLS = {
    "search": [
        "mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql",
        "mcp__claude_ai_Atlassian_MCP__searchJiraIssuesUsingJql",
    ],
    "transitions": "mcp__claude_ai_Atlassian__getTransitionsForJiraIssue",
    "move": "mcp__claude_ai_Atlassian__transitionJiraIssue",
}


def fill(node, vars):
    """Puts {{name}} values in. A list value becomes a quoted JQL list: "a", "b"."""
    def one(s):
        def sub(m):
            v = vars.get(m.group(1))
            if v is None:
                raise KeyError(m.group(1))
            return ", ".join(json.dumps(x) for x in v) if isinstance(v, list) else str(v)
        return re.sub(r"\{\{(\w+)\}\}", sub, s)
    if isinstance(node, str):
        return one(node)
    if isinstance(node, list):
        return [fill(x, vars) for x in node]
    if isinstance(node, dict):
        return {one(k): fill(v, vars) for k, v in node.items()}
    return node


def load_config():
    path = os.path.join(USER_CFG, "jira.json")
    if not os.path.exists(path):
        path = os.path.join(HERE, "defaults", "jira.json")
    with open(path) as f:
        cfg = json.load(f)
    preset = cfg.get("preset")
    if preset:
        with open(os.path.join(HERE, "presets", "jira", f"{preset}.json")) as f:
            base = json.load(f)
        vars = {**base.get("vars", {}), **cfg.get("vars", {})}
        merged = {k: v for k, v in base.items() if k not in ("vars", "about")}
        merged.update({k: v for k, v in cfg.items() if k not in ("preset", "vars")})
        try:
            cfg = fill(merged, vars)
        except KeyError as e:
            raise SystemExit(f"{path}: preset {preset!r} needs vars.{e.args[0]}")
        cfg["preset"] = preset
    cfg["path"] = path
    cfg["tools"] = {**DEFAULT_TOOLS, **cfg.get("tools", {})}
    return cfg


CFG = None


def config():
    global CFG
    if CFG is None:
        CFG = load_config()
    return CFG
FIELDS = ["summary", "status", "issuetype", "updated", "assignee", "project", "parent"]
NOW_MS = int(time.time() * 1000)


def write(name, data):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def read(name, default):
    try:
        with open(os.path.join(OUT, name)) as f:
            return json.load(f)
    except Exception:
        return default


def ms(ts):
    try:
        return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None


def row(issue):
    f = issue.get("fields", {})
    st = f.get("status") or {}
    return {
        "key": issue.get("key"),
        "summary": f.get("summary"),
        "status": st.get("name"),
        "category": (st.get("statusCategory") or {}).get("key"),
        "type": (f.get("issuetype") or {}).get("name"),
        "project": (f.get("project") or {}).get("key"),
        "assignee": (f.get("assignee") or {}).get("displayName"),
        "parent": (f.get("parent") or {}).get("key"),
        "parentSummary": ((f.get("parent") or {}).get("fields") or {}).get("summary"),
        "parentStatus": (((f.get("parent") or {}).get("fields") or {}).get("status") or {}).get("name"),
        "assigneeId": (f.get("assignee") or {}).get("accountId"),
        "updated": ms(f.get("updated") or ""),
    }


def need_claude():
    """Jira goes through Claude Code's Atlassian connector; say so plainly when it isn't there."""
    if not shutil.which("claude"):
        raise RuntimeError("Jira needs Claude Code (the claude command) with the Atlassian connector. "
                           "Install it, or turn Jira off in tasks.json and use GitHub, Linear or your own tasks.")


def call_tools(prompt, tools):
    """Has Claude make the tool calls the prompt asks for; returns [(name, input, result_text)]."""
    need_claude()
    proc = subprocess.run(
        ["claude", "-p", prompt, "--model", "haiku", "--allowedTools", *tools,
         "--output-format", "stream-json", "--verbose"],
        capture_output=True, text=True, timeout=180,
    )
    uses, out = {}, []
    for line in proc.stdout.splitlines():
        try:
            m = json.loads(line)
        except Exception:
            continue
        for c in m.get("message", {}).get("content", []) if m.get("type") in ("assistant", "user") else []:
            if c.get("type") == "tool_use" and c.get("name") in tools:
                uses[c["id"]] = (c["name"], c.get("input", {}))
            elif c.get("type") == "tool_result" and c.get("tool_use_id") in uses:
                body = c.get("content")
                text = body if isinstance(body, str) else "".join(x.get("text", "") for x in body or [])
                spilled = re.search(r"saved to (/\S+?\.(?:txt|json))", text)
                if spilled:
                    try:
                        text = open(spilled.group(1)).read()
                    except Exception:
                        pass
                out.append((*uses[c["tool_use_id"]], text, bool(c.get("is_error"))))
    if not uses:
        raise RuntimeError((proc.stderr or proc.stdout or "Claude made no Jira calls").strip()[-300:])
    return out


def transitions(key):
    cloud = config()["cloudId"]
    try:
        res = call_tools(f"Call the get-transitions tool once with cloudId {cloud} and issueIdOrKey {key}. Call nothing else. Then reply only: done", [config()["tools"]["transitions"]])
        name, _inp, text, err = res[0]
        d = json.loads(text)
        items = [
            {"id": t.get("id"), "name": t.get("name"),
             "to": (t.get("to") or {}).get("name"),
             "category": ((t.get("to") or {}).get("statusCategory") or {}).get("key")}
            for t in d.get("transitions", [])
        ]
        write(f"transitions-{key}.json", {"key": key, "at": NOW_MS, "transitions": items})
    except Exception as e:
        write(f"transitions-{key}.json", {"key": key, "at": NOW_MS, "error": str(e)[:240]})


def move(key, tid):
    cloud = config()["cloudId"]
    cached = read(f"transitions-{key}.json", {}).get("transitions", [])
    target = next((t for t in cached if t["id"] == tid), None)
    if not target:
        write(f"action-{key}.json", {"key": key, "at": NOW_MS, "ok": False, "error": "Unknown transition; reopen the menu"})
        return
    try:
        res = call_tools(
            f'Call the transition tool exactly once with cloudId {cloud}, issueIdOrKey {key} and transition {{"id": "{tid}"}}. '
            "Do not call anything else and do not retry. Then reply only: done", [config()["tools"]["move"]])
        _n, inp, text, err = res[0]
        sent = str((inp.get("transition") or {}).get("id"))
        bad = err or text.strip().lower().startswith("error") or sent != tid
        if bad:
            raise RuntimeError(text.strip()[:240] if text.strip() else f"sent transition {sent}")
        # Show it at once; the next refresh confirms it.
        data = read("jira.json", None)
        if data:
            for v in data.get("views", {}).values():
                for i in v.get("issues", []):
                    if i.get("key") == key:
                        i["status"], i["category"], i["updated"] = target["to"], target["category"], NOW_MS
            write("jira.json", data)
        write(f"action-{key}.json", {"key": key, "at": NOW_MS, "ok": True, "to": target["to"]})
    except Exception as e:
        write(f"action-{key}.json", {"key": key, "at": NOW_MS, "ok": False, "error": str(e)[:240]})


def run_claude(searches):
    """searches: [(jql, fields, maxResults, format)]. Returns ({jql: issues | error}, accountId)."""
    lines = "\n".join(
        f'{i + 1}. jql: {json.dumps(jql)}  maxResults: {mx}  fields: {json.dumps(fields)}' + (f'  responseContentFormat: "{fmt}"' if fmt else "")
        for i, (jql, fields, mx, fmt) in enumerate(searches)
    )
    need_claude()
    cloud = config()["cloudId"]
    TOOLS = config()["tools"]["search"]
    prompt = (
        f"Run each Jira search below with the Jira JQL search tool, cloudId {cloud}. "
        "Use each jql exactly as written (do not change it), one call per search, all calls in parallel. "
        "Do not retry a search that fails. Do not summarize anything; when the calls are done reply only: done\n\n"
        + lines
    )
    proc = subprocess.run(
        ["claude", "-p", prompt, "--model", "haiku", "--allowedTools", *TOOLS,
         "--output-format", "stream-json", "--verbose"],
        capture_output=True, text=True, timeout=240,
    )
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "last-run.jsonl"), "w") as f:
        f.write(proc.stdout)
    uses, results, account = {}, {}, None
    for line in proc.stdout.splitlines():
        try:
            m = json.loads(line)
        except Exception:
            continue
        if m.get("type") not in ("assistant", "user"):
            continue
        for c in m.get("message", {}).get("content", []):
            if c.get("type") == "tool_use" and c.get("name") in TOOLS:
                uses[c["id"]] = c.get("input", {}).get("jql")
            elif c.get("type") == "tool_result" and c.get("tool_use_id") in uses:
                jql = uses[c["tool_use_id"]]
                body = c.get("content")
                text = body if isinstance(body, str) else "".join(x.get("text", "") for x in body or [])
                # A big result is saved to a file and only its path comes through.
                spilled = re.search(r"saved to (/\S+?\.(?:txt|json))", text)
                if spilled:
                    try:
                        with open(spilled.group(1)) as f:
                            text = f.read()
                    except Exception:
                        pass
                try:
                    d = json.loads(text)
                    results[jql] = d["issues"]["nodes"]
                    account = account or d.get("context", {}).get("atlassianAccountId")
                except Exception:
                    results[jql] = {"error": text.strip()[:200] or "no result"}
    if not uses:
        err = (proc.stderr or proc.stdout or "Claude made no Jira calls").strip()[-300:]
        raise RuntimeError(err)
    return results, account


def mentions_me(body, account, name):
    if isinstance(body, (dict, list)):
        return adf_mentions(body, account)
    text = str(body or "")
    return bool(account and account in text) or bool(name and f"@{name}" in text)


def body_text(body):
    if isinstance(body, (dict, list)):
        return adf_text(body)
    return re.sub(r"<[^>]+>", "", str(body or "")).replace("&nbsp;", " ")


def adf_mentions(node, account):
    if isinstance(node, dict):
        if node.get("type") == "mention" and (node.get("attrs") or {}).get("id") == account:
            return True
        return any(adf_mentions(v, account) for v in node.get("content", []) or [])
    if isinstance(node, list):
        return any(adf_mentions(v, account) for v in node)
    return False


def adf_text(node):
    if isinstance(node, dict):
        if node.get("type") == "text":
            return node.get("text", "")
        if node.get("type") == "mention":
            return (node.get("attrs") or {}).get("text", "@someone")
        sep = " " if node.get("type") in ("paragraph", "listItem", "heading") else ""
        return sep.join(adf_text(c) for c in node.get("content", []) or [])
    if isinstance(node, list):
        return " ".join(adf_text(c) for c in node)
    return ""


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "sync"
    if mode == "transitions":
        return transitions(sys.argv[2])
    if mode == "move":
        return move(sys.argv[2], sys.argv[3])
    if mode == "config":
        try:
            print(json.dumps(config()))
        except BaseException as e:
            print(json.dumps({"error": str(e)}))
        return
    cfg = config()
    if not cfg.get("cloudId"):
        write("status.json", {"state": "error", "mode": mode, "at": NOW_MS, "error": "Jira isn't set up yet: run /herdr-agent-board:setup in Claude Code"})
        sys.exit(1)
    views = cfg["views"]
    write("status.json", {"state": "running", "mode": mode, "at": NOW_MS})

    prev_digest = read("digest.json", {})
    since = prev_digest.get("at") or NOW_MS - 86400000
    if "--since-hours" in sys.argv:
        since = NOW_MS - int(sys.argv[sys.argv.index("--since-hours") + 1]) * 3600000
    days = max(1, -(-(NOW_MS - since) // 86400000))
    mention_jql = (
        f"updated >= -{days}d AND (watcher = currentUser() OR assignee = currentUser() "
        f"OR reporter = currentUser()) ORDER BY updated DESC"
    )
    searches = [(v["jql"], FIELDS, v.get("max", 25), "markdown") for v in views]
    if mode == "digest":
        searches.append((mention_jql, ["summary", "status", "comment", "assignee", "reporter"], 15, None))

    try:
        results, account = run_claude(searches)
    except Exception as e:
        write("status.json", {"state": "error", "mode": mode, "at": NOW_MS, "error": str(e)[:300]})
        sys.exit(1)

    out = {"at": NOW_MS, "account": account, "site": cfg["site"], "views": {}}
    for v in views:
        r = results.get(v["jql"])
        if r is None:
            out["views"][v["id"]] = {"error": "Claude didn't run this search"}
        elif isinstance(r, dict):
            out["views"][v["id"]] = r
        else:
            out["views"][v["id"]] = {"issues": [row(i) for i in r]}
    write("jira.json", out)

    if mode == "digest":
        mentions, comments = [], []
        cand = results.get(mention_jql)
        me_name = next((i["assignee"] for v in out["views"].values() for i in v.get("issues", []) if i.get("assigneeId") == account), None)
        if isinstance(cand, list) and account:
            for issue in cand:
                f = issue.get("fields", {})
                mine = account in ((f.get("assignee") or {}).get("accountId"), (f.get("reporter") or {}).get("accountId"))
                for c in (f.get("comment") or {}).get("comments", []):
                    at = ms(c.get("created") or "")
                    who = c.get("author") or {}
                    if not at or at <= since or who.get("accountId") == account:
                        continue
                    item = {"key": issue.get("key"), "summary": f.get("summary"), "author": who.get("displayName"),
                            "at": at, "text": " ".join(body_text(c.get("body")).split())[:240]}
                    if mentions_me(c.get("body"), account, me_name):
                        mentions.append(item)
                    elif mine:
                        comments.append(item)

        # Status changes since the last digest, from the snapshot it left.
        seen = {}
        for v in out["views"].values():
            for i in v.get("issues", []):
                seen[i["key"]] = i
        before = prev_digest.get("snapshot", {})
        moved = [
            {"key": k, "summary": i["summary"], "from": before[k], "to": i["status"], "category": i["category"]}
            for k, i in seen.items() if k in before and before[k] != i["status"]
        ]
        stale_ms = cfg.get("stale_days", 5) * 86400000
        stale = [
            i for i in seen.values()
            if i.get("assigneeId") == account and i.get("category") == "indeterminate"
            and i.get("updated") and NOW_MS - i["updated"] > stale_ms
        ]
        write("digest.json", {
            "at": NOW_MS, "since": since,
            "mentions": sorted(mentions, key=lambda x: -x["at"]),
            "comments": sorted(comments, key=lambda x: -x["at"]),
            "moved": moved, "stale": stale,
            "mentions_error": cand.get("error") if isinstance(cand, dict) else None,
            "snapshot": {k: i["status"] for k, i in seen.items()},
        })

    write("status.json", {"state": "ok", "mode": mode, "at": NOW_MS, "done": int(time.time() * 1000)})


if __name__ == "__main__":
    main()
