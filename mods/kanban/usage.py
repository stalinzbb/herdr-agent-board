#!/usr/bin/env python3
"""Long-term Claude usage, from Claude Code's own logs (~/.claude/projects/**/*.jsonl).

Every assistant reply goes into a SQLite database that is kept for good, even after Claude Code
deletes old logs: ~/.local/share/herdr-kanban/usage.db. Each file is read from where the last run
stopped; each reply is stored once (by message id), however many log lines or files repeat it.

Then it writes the summaries the Herdr panels show: ~/.cache/herdr-kanban/usage.json
(today, 7 days, 30 days, all time: by model, day, project, session, hour of day, subagents).

  usage.py            import new lines, write summaries
  usage.py --rebuild  forget read positions and re-read every log (stored replies are kept)
"""

import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timedelta

ROOT = os.path.expanduser("~/.claude/projects")
DATA = os.path.expanduser("~/.local/share/herdr-kanban")
DB = os.path.join(DATA, "usage.db")
OUT = os.path.expanduser("~/.cache/herdr-kanban")

SCHEMA = """
CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, offset INTEGER, size INTEGER, mtime REAL);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, session TEXT, project TEXT, cwd TEXT, branch TEXT, model TEXT,
  ts INTEGER, day TEXT, hour INTEGER,
  input INTEGER, output INTEGER, cache_read INTEGER, cache_5m INTEGER, cache_1h INTEGER,
  subagent INTEGER, agent_type TEXT, service_tier TEXT, version TEXT
);
CREATE INDEX IF NOT EXISTS messages_day ON messages(day);
CREATE INDEX IF NOT EXISTS messages_session ON messages(session);
CREATE INDEX IF NOT EXISTS messages_model ON messages(model);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, project TEXT, cwd TEXT, title TEXT, first_ts INTEGER, last_ts INTEGER
);
"""


def ts_ms(s):
    try:
        return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None


def project_of(path):
    rel = os.path.relpath(path, ROOT).split(os.sep)
    return rel[0] if rel else ""


def user_text(msg):
    c = msg.get("content")
    if isinstance(c, str):
        t = c
    elif isinstance(c, list):
        t = " ".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")
    else:
        return None
    t = " ".join(t.split())
    if not t or t.startswith("<") or t.startswith("Caveat:"):
        return None
    return t[:120]


def ingest(db, rebuild=False):
    if rebuild:
        db.execute("DELETE FROM files")
    known = {r[0]: r for r in db.execute("SELECT path, offset, size, mtime FROM files")}
    meta_cache = {}
    new = 0
    for dirpath, _dirs, names in os.walk(ROOT):
        for name in names:
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(dirpath, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            _p, offset, size, mtime = known.get(path, (path, 0, 0, 0))
            if st.st_size < offset:
                offset = 0  # rewritten file: read again (stored replies are deduplicated)
            if st.st_size == offset:
                continue
            subagent = "/subagents/" in path
            agent_type = None
            if subagent:
                meta = path[:-6] + ".meta.json"
                if meta not in meta_cache:
                    try:
                        meta_cache[meta] = json.load(open(meta)).get("agentType")
                    except Exception:
                        meta_cache[meta] = None
                agent_type = meta_cache[meta]
            project = project_of(path)
            with open(path, "rb") as f:
                f.seek(offset)
                chunk = f.read()
            end = chunk.rfind(b"\n") + 1
            rows, sessions = [], {}
            for raw in chunk[:end].splitlines():
                try:
                    m = json.loads(raw)
                except Exception:
                    continue
                kind = m.get("type")
                sid = m.get("sessionId")
                ts = ts_ms(m.get("timestamp") or "")
                if sid and not subagent:
                    s = sessions.setdefault(sid, {"cwd": m.get("cwd"), "title": None, "first": ts, "last": ts})
                    if ts:
                        s["first"] = min(x for x in (s["first"], ts) if x)
                        s["last"] = max(x for x in (s["last"], ts) if x)
                    if kind == "summary" and m.get("summary"):
                        s["title"] = m["summary"][:120]
                    elif kind == "user" and not s["title"] and not m.get("isMeta"):
                        s["title"] = user_text(m.get("message") or {})
                if kind != "assistant":
                    continue
                msg = m.get("message") or {}
                model = msg.get("model")
                u = msg.get("usage")
                if not u or not model or model == "<synthetic>" or not ts:
                    continue
                mid = msg.get("id") or m.get("requestId") or m.get("uuid")
                cc = u.get("cache_creation") or {}
                c5 = cc.get("ephemeral_5m_input_tokens")
                c1 = cc.get("ephemeral_1h_input_tokens")
                if c5 is None and c1 is None:
                    c5, c1 = u.get("cache_creation_input_tokens") or 0, 0
                local = datetime.fromtimestamp(ts / 1000)
                rows.append((
                    mid, sid, project, m.get("cwd"), m.get("gitBranch"), model, ts,
                    local.strftime("%Y-%m-%d"), local.hour,
                    u.get("input_tokens") or 0, u.get("output_tokens") or 0, u.get("cache_read_input_tokens") or 0,
                    c5 or 0, c1 or 0, 1 if subagent else 0, agent_type, u.get("service_tier"), m.get("version"),
                ))
            # A reply's usage is final on its last log line: keep the last one per id.
            if rows:
                before = db.total_changes
                db.executemany("INSERT OR REPLACE INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
                new += db.total_changes - before
            for sid, s in sessions.items():
                db.execute(
                    """INSERT INTO sessions VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                         title = COALESCE(sessions.title, excluded.title),
                         first_ts = MIN(COALESCE(sessions.first_ts, excluded.first_ts), COALESCE(excluded.first_ts, sessions.first_ts)),
                         last_ts = MAX(COALESCE(sessions.last_ts, 0), COALESCE(excluded.last_ts, 0)),
                         cwd = COALESCE(sessions.cwd, excluded.cwd)""",
                    (sid, project, s["cwd"], s["title"], s["first"], s["last"]),
                )
            db.execute("INSERT OR REPLACE INTO files VALUES (?,?,?,?)", (path, offset + end, st.st_size, st.st_mtime))
            db.commit()
    return new


# Your prices (~/.config/herdr-board/prices.json) win over the shipped defaults.
_USER_PRICES = os.path.join(os.environ.get("HERDR_BOARD_CONFIG") or os.path.expanduser("~/.config/herdr-board"), "prices.json")
PRICES = _USER_PRICES if os.path.exists(_USER_PRICES) else os.path.join(os.path.dirname(os.path.abspath(__file__)), "defaults", "prices.json")


def load_prices(db):
    """A temp table model -> price per token, matched to every model id seen (by longest prefix)."""
    try:
        table = json.load(open(PRICES)).get("models", {})
    except Exception:
        table = {}
    db.execute("DROP TABLE IF EXISTS temp.price")
    db.execute("CREATE TEMP TABLE price (model TEXT PRIMARY KEY, i REAL, o REAL, c5 REAL, c1 REAL, cr REAL)")
    for (model,) in db.execute("SELECT DISTINCT model FROM messages").fetchall():
        key = max((k for k in table if model.startswith(k)), key=len, default=None)
        if key:
            pr = table[key]
            db.execute("INSERT INTO temp.price VALUES (?,?,?,?,?,?)", (model, *(pr.get(f, 0) / 1e6 for f in ("input", "output", "cache_5m", "cache_1h", "cache_read"))))
    return sorted({m for (m,) in db.execute("SELECT DISTINCT model FROM messages") } - {m for (m,) in db.execute("SELECT model FROM temp.price")})


# Cost of a messages row, in USD (0 for models without a price).
COST = "COALESCE((SELECT input * p.i + output * p.o + cache_5m * p.c5 + cache_1h * p.c1 + cache_read * p.cr FROM temp.price p WHERE p.model = messages.model), 0)"
TOK = "input + output + cache_read + cache_5m + cache_1h"
FRESH = "input + output + cache_5m + cache_1h"


def summary(db, since_day):
    where, args = ("WHERE day >= ?", (since_day,)) if since_day else ("", ())
    q = lambda sql, a=(): db.execute(sql, args + a).fetchall()
    t = q(f"SELECT COUNT(*), SUM(input), SUM(output), SUM(cache_read), SUM(cache_5m), SUM(cache_1h), COUNT(DISTINCT session), MIN(day), MAX(day), SUM({COST}), SUM(input * COALESCE((SELECT p.i FROM temp.price p WHERE p.model = messages.model), 0) + cache_read * COALESCE((SELECT p.i FROM temp.price p WHERE p.model = messages.model), 0)) FROM messages {where}")[0]
    totals = dict(zip(["replies", "input", "output", "cache_read", "cache_5m", "cache_1h", "sessions", "first_day", "last_day", "cost", "cost_uncached"], [x or 0 for x in t]))
    # What cache reads saved: those tokens at full input price, minus what they cost.
    totals["cache_saved"] = q(f"SELECT SUM(cache_read * (p.i - p.cr)) FROM messages JOIN temp.price p ON p.model = messages.model {where}")[0][0] or 0
    models = [
        dict(zip(["model", "replies", "input", "output", "cache_read", "cache_5m", "cache_1h", "sessions", "cost"], r))
        for r in q(f"SELECT model, COUNT(*), SUM(input), SUM(output), SUM(cache_read), SUM(cache_5m), SUM(cache_1h), COUNT(DISTINCT session), SUM({COST}) FROM messages {where} GROUP BY model ORDER BY SUM({COST}) DESC, SUM({TOK}) DESC")
    ]
    bucket = "day" if since_day else "substr(day, 1, 7)"
    series = {}
    for b, model, tok, fresh, cost in q(f"SELECT {bucket}, model, SUM({TOK}), SUM({FRESH}), SUM({COST}) FROM messages {where} GROUP BY 1, 2 ORDER BY 1"):
        e = series.setdefault(b, {"key": b, "tokens": 0, "fresh": 0, "cost": 0, "models": {}, "costs": {}})
        e["tokens"] += tok
        e["fresh"] += fresh
        e["cost"] += cost
        e["models"][model] = tok
        e["costs"][model] = cost
    projects = [
        dict(zip(["project", "tokens", "fresh", "replies", "sessions", "cwd", "cost"], r))
        for r in q(f"""SELECT project, SUM({TOK}), SUM({FRESH}), COUNT(*), COUNT(DISTINCT session),
                              (SELECT cwd FROM messages x WHERE x.project = messages.project AND x.cwd IS NOT NULL GROUP BY cwd ORDER BY COUNT(*) DESC LIMIT 1),
                              SUM({COST})
                       FROM messages {where} GROUP BY project ORDER BY SUM({COST}) DESC LIMIT 12""")
    ]
    sessions = [
        dict(zip(["id", "tokens", "fresh", "replies", "model", "last", "subagent_tokens", "title", "project", "cwd", "cost"], r))
        for r in db.execute(
            f"""SELECT m.session, SUM({TOK.replace('input', 'm.input')}), SUM({FRESH.replace('input', 'm.input')}), COUNT(*),
                       (SELECT model FROM messages x WHERE x.session = m.session GROUP BY model ORDER BY COUNT(*) DESC LIMIT 1),
                       MAX(m.ts), SUM(CASE WHEN m.subagent THEN {TOK.replace('input', 'm.input')} ELSE 0 END), s.title, s.project, s.cwd,
                       SUM(COALESCE(m.input * p.i + m.output * p.o + m.cache_5m * p.c5 + m.cache_1h * p.c1 + m.cache_read * p.cr, 0))
                FROM messages m LEFT JOIN sessions s ON s.id = m.session LEFT JOIN temp.price p ON p.model = m.model
                {where.replace('day', 'm.day')} GROUP BY m.session ORDER BY 11 DESC LIMIT 12""",
            args,
        ).fetchall()
    ]
    hours = [0] * 24
    for h, tok in q(f"SELECT hour, SUM({FRESH}) FROM messages {where} GROUP BY hour"):
        hours[h] = tok
    agents = [
        dict(zip(["agent", "tokens", "replies", "cost"], r))
        for r in q(f"SELECT COALESCE(agent_type, 'subagent'), SUM({TOK}), COUNT(*), SUM({COST}) FROM messages {where} {'AND' if where else 'WHERE'} subagent = 1 GROUP BY 1 ORDER BY 4 DESC LIMIT 8")
    ]
    return {"totals": totals, "models": models, "series": list(series.values()), "projects": projects, "sessions": sessions, "hours": hours, "agents": agents}


def main():
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    db = sqlite3.connect(DB)
    db.executescript(SCHEMA)
    t0 = time.time()
    new = ingest(db, rebuild="--rebuild" in sys.argv)
    unpriced = load_prices(db)
    today = datetime.now()
    day = lambda n: (today - timedelta(days=n)).strftime("%Y-%m-%d")
    out = {
        "at": int(time.time() * 1000),
        "today": day(0),
        "imported": new,
        "seconds": round(time.time() - t0, 2),
        "db": DB,
        "unpriced": unpriced,
        "ranges": {
            "today": summary(db, day(0)),
            "7d": summary(db, day(6)),
            "30d": summary(db, day(29)),
            "all": summary(db, None),
        },
    }
    # The status-bar widget's old shape: today's per-model totals.
    out["models"] = {
        m["model"]: {"input": m["input"], "output": m["output"], "cache_read": m["cache_read"],
                     "cache_write": m["cache_5m"] + m["cache_1h"], "messages": m["replies"], "cost": m["cost"]}
        for m in out["ranges"]["today"]["models"]
    }
    tmp = os.path.join(OUT, "usage.json.tmp")
    with open(tmp, "w") as f:
        json.dump(out, f)
    os.replace(tmp, os.path.join(OUT, "usage.json"))
    db.close()


if __name__ == "__main__":
    main()
