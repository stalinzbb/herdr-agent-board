#!/usr/bin/env python3
"""Claude Code SessionStart hook: records which Herdr terminal runs which Claude session.

Writes ~/.cache/herdr-kanban/sessions/<HC_TERMINAL_ID>.json = {session_id, transcript_path, cwd, at}.
Herdr sets HC_TERMINAL_ID in every terminal it runs. Outside Herdr it does nothing.
It never blocks or fails the session: any error is swallowed.
"""

import json
import os
import sys
import time

try:
    term = os.environ.get("HC_TERMINAL_ID")
    if term:
        data = json.load(sys.stdin)
        out = os.path.expanduser("~/.cache/herdr-kanban/sessions")
        os.makedirs(out, exist_ok=True)
        path = os.path.join(out, f"{term.replace('/', '_')}.json")
        with open(path + ".tmp", "w") as f:
            json.dump({
                "session_id": data.get("session_id"),
                "transcript_path": data.get("transcript_path"),
                "cwd": data.get("cwd"),
                "source": data.get("source"),
                "at": int(time.time() * 1000),
            }, f)
        os.replace(path + ".tmp", path)
except Exception:
    pass
sys.exit(0)
