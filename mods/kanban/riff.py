#!/usr/bin/env python3
"""Riff: ask the person a UI question with live controls, in the Herdr board's rail.

  riff.py ask [--timeout S] [--no-wait] < spec.json   open a riff and wait for the answer (prints JSON)
  riff.py wait [ID] [--timeout S]                      keep waiting on an open riff
  riff.py values [ID]                                  what the person has set so far (prints JSON)
  riff.py close [ID]                                   close this agent's riff (all of them without ID)

spec.json: {"question": "Which gallery spacing feels right?", "about": "src/Gallery.tsx",
            "controls": {"gap": [16, 0, 48, 2], "columns": {"type": "select", "options": ["3", "4"]}},
            "output": "/abs/path/live.json", "id": "gallery"}
Controls use DialKit's config shapes (github.com/joshpuckett/dialkit). `output` is optional: every
change is written there, so a dev server can show it live. `id` names the riff (default "riff").

Answer: {"status": "answered" | "skipped" | "closed", "values": {...}, "changed": {"path": {"from", "to"}},
         "note": "...", "action": "path of a pressed action button" | null}
Exit 0 with an answer. Exit 3 when --timeout passes first: the riff stays open; run `wait` again, or
carry on and the answer is typed into this terminal as a "Riff · ..." message. Exit 1 on a mistake.
Only works inside Herdr ($HC_TERMINAL_ID).
"""
import json
import os
import re
import sys
import time

DIR = os.path.expanduser("~/.cache/herdr-kanban/riff")
SUFFIXES = (".json", ".values.json", ".answer.json")


def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def terminal():
    t = os.environ.get("HC_TERMINAL_ID")
    if not t:
        die("Not inside Herdr ($HC_TERMINAL_ID is empty): riffs show in the Herdr board's rail.")
    return t


def slug(s):
    return re.sub(r"[^a-z0-9-]+", "-", str(s or "riff").lower()).strip("-")[:32] or "riff"


def path(stem, suffix):
    return os.path.join(DIR, stem + suffix)


def mine(rid=None):
    t = terminal()
    if rid:
        return [f"{t}-{slug(rid)}"]
    try:
        names = os.listdir(DIR)
    except FileNotFoundError:
        return []
    return sorted(n[:-5] for n in names if n.startswith(t + "-") and n.endswith(".json") and not re.search(r"\.(values|answer)\.json$", n))


def close(stem):
    for s in SUFFIXES:
        try:
            os.remove(path(stem, s))
        except FileNotFoundError:
            pass


def read_json(p):
    # The panel writes atomically; still, retry a torn read once.
    for _ in range(2):
        try:
            with open(p) as f:
                return json.load(f)
        except FileNotFoundError:
            return None
        except json.JSONDecodeError:
            time.sleep(0.2)
    return None


def wait(stem, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        ans = read_json(path(stem, ".answer.json"))
        if ans is not None:
            close(stem)
            print(json.dumps(ans, indent=2))
            return 0
        if not os.path.exists(path(stem, ".json")):
            print(json.dumps({"status": "closed", "values": None, "changed": {}, "note": ""}))
            return 0
        time.sleep(0.4)
    rid = stem.split("-", 1)[1]
    print(json.dumps({"status": "open", "id": rid, "hint": f"Still open. Run `riff.py wait {rid}` to keep waiting, or carry on: the answer will be typed into this terminal as a \"Riff · ...\" message."}))
    return 3


def flag(args, name, default=None):
    if name in args:
        i = args.index(name)
        val = args[i + 1] if i + 1 < len(args) else None
        del args[i:i + 2]
        return val
    return default


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    cmd, args = argv[0], argv[1:]
    no_wait = "--no-wait" in args
    if no_wait:
        args.remove("--no-wait")
    # Under Claude Code's default 2-minute command limit; pass more with a longer Bash timeout.
    timeout = float(flag(args, "--timeout", 100))
    rid = args[0] if args else None

    if cmd == "ask":
        t = terminal()
        try:
            spec = json.load(sys.stdin)
        except json.JSONDecodeError as e:
            die(f"The spec on stdin isn't JSON: {e}")
        if not isinstance(spec, dict) or not spec.get("question") or not isinstance(spec.get("controls"), dict):
            die('The spec needs "question" (a string) and "controls" (an object of DialKit-shaped controls).')
        stem = f"{t}-{slug(spec.get('id'))}"
        spec.update(terminal=t, cwd=os.getcwd())
        os.makedirs(DIR, exist_ok=True)
        try:
            os.remove(path(stem, ".answer.json"))  # an old answer for this id
        except FileNotFoundError:
            pass
        tmp = path(stem, ".json.tmp")
        with open(tmp, "w") as f:
            json.dump(spec, f, indent=2)
        os.replace(tmp, path(stem, ".json"))
        if no_wait:
            print(json.dumps({"status": "open", "id": stem.split("-", 1)[1]}))
            return 0
        return wait(stem, timeout)

    if cmd == "wait":
        stems = mine(rid)
        if not stems or not os.path.exists(path(stems[0], ".json")):
            print(json.dumps({"status": "closed", "values": None, "changed": {}, "note": ""}))
            return 0
        return wait(stems[0], timeout)

    if cmd == "values":
        stems = mine(rid)
        v = read_json(path(stems[0], ".values.json")) if stems else None
        print(json.dumps({"values": v.get("values"), "changed": v.get("changed", {})} if v else {"values": None}, indent=2))
        return 0

    if cmd == "close":
        for stem in mine(rid):
            close(stem)
        return 0

    die(f"Unknown command {cmd!r}. Try: riff.py --help")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
