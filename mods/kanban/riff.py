#!/usr/bin/env python3
"""Riff: ask the person a UI question with live controls, in the Herdr board's rail.

  riff.py ask [--timeout S] [--no-wait] < spec.json   open a riff, wait up to 20 s for the answer (prints JSON)
  riff.py wait [ID] [--timeout S]                      wait on an open riff again (20 s)
  riff.py values [ID]                                  what the person has set so far (prints JSON)
  riff.py close [ID]                                   close this agent's riff (all of them without ID)

spec.json: {"question": "Which gallery spacing feels right?", "about": "src/Gallery.tsx",
            "controls": {"gap": [16, 0, 48, 2], "columns": {"type": "select", "options": ["3", "4"]}},
            "output": "/abs/path/live.json", "id": "gallery"}
Controls use DialKit's config shapes (github.com/joshpuckett/dialkit). Defaults are the values in
the code right now (read them, don't invent them). Keys become labels ("showBadge" -> "Show badge").
  slider  [default, min, max] or [default, min, max, step]      toggle  true / false
  color   "#a78bfa" (or rgb()/hsl()/oklch())                      text    "Hello"
  select  {"type": "select", "options": ["a", "b"]}               folder  {"blur": [12, 0, 40]}
  spring  {"type": "spring", "visualDuration": 0.3, "bounce": 0.2} (or stiffness/damping/mass)
  easing  {"type": "easing", "duration": 0.3, "ease": [0.25, 0.1, 0.25, 1]}
  action  {"type": "action", "label": "Use this one"}  (answers at once)
`output` is optional: every change is written there as JSON, so an app that reads it shows each value
live. `id` names the riff (default "riff"); give each question its own id.

How to ask well: one question per riff, 2-8 controls, all about that question. With more taste values
than that, plan a short series first: group them by what is judged together (layout, color, motion),
put the one that changes the feel most first, then ask them one at a time, applying each answer to the
code before the next (so later defaults include it). Say where they are in it ("Card motion (2 of 3)").
The planning is mostly reading: a small subagent can draft the specs; you open them and apply answers.
A skip means use your judgment; don't ask it again. The riff opens next to the pane this runs in, and
the answer comes back to it, so run it from your own pane (a subagent of yours shares it).

Answer: {"status": "answered" | "skipped" | "closed", "values": {...}, "changed": {"path": {"from", "to"}},
         "note": "...", "action": "path of a pressed action button" | null}
Exit 0 with an answer. Exit 3 when --timeout passes first: the riff stays open. Then end your turn
(say the riff is open in the rail); the answer is typed into this terminal as a "Riff · ..." message,
and that is your next turn. Don't sit in a long wait: the pane looks busy while the person is the one
who has to act, and they can't talk to you. Exit 1 on a mistake.
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
    print(json.dumps({"status": "open", "id": rid, "hint": f"Still open in the Riff tab. End your turn now (say it's open in the rail): the answer will be typed into this terminal as a \"Riff · ...\" message. Don't wait longer."}))
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
    # Short: answers right away when they're looking; otherwise the agent ends its turn and the
    # answer arrives as a typed "Riff · ..." message, so its pane isn't stuck looking busy.
    timeout = float(flag(args, "--timeout", 20))
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
