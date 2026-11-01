#!/bin/sh
# Installs the Herdr board into ~/.config/herdr-app.
#
#   ./install.sh          copy the layout and mods in (run again after a git pull to update)
#   ./install.sh --pull   the other way: copy what you changed in Herdr back into this repo
#
# Herdr only runs code that sits inside its own folder, so this copies; links don't load.
# It never deletes your work: an installed copy that differs from this repo is first
# moved to ~/.config/herdr-board/backup/<time>/. Your settings in ~/.config/herdr-board/
# are never touched. It merges keys.json, adding keys you don't use yet and leaving yours.
# It does not change Claude Code's settings: see the end of this script's output.
set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
APP="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
CFG="${HERDR_BOARD_CONFIG:-$HOME/.config/herdr-board}"
BACKUP="$CFG/backup/$(date +%Y%m%d-%H%M%S)"
# Files Herdr writes into a mod folder for editors; never copied either way.
SKIP="--exclude=gpui-kit.d.ts --exclude=herdr.d.ts --exclude=jsconfig.json --exclude=__pycache__ --exclude=.DS_Store"

[ -d "$APP" ] || { echo "No Herdr app folder at $APP. Install and open Herdr first: https://herdr.dev"; exit 1; }

if [ "${1:-}" = "--pull" ]; then
  echo "Herdr -> $SRC"
  rsync -a --delete $SKIP "$APP/mods/kanban/" "$SRC/mods/kanban/"
  rsync -a --delete $SKIP "$APP/mods/kanban-pane/" "$SRC/mods/kanban-pane/"
  cp "$APP/layouts/kanban.json" "$SRC/layouts/kanban.json"
  (cd "$SRC" && git status --short 2>/dev/null) || true
  exit 0
fi

mkdir -p "$CFG" "$APP/mods" "$APP/layouts"

place() { # place <source> <target>: a folder or a file
  src=$1 dst=$2 name=${2#$APP/}
  if [ -L "$dst" ]; then rm "$dst"; fi
  if [ -e "$dst" ] && ! diff -rq -x gpui-kit.d.ts -x herdr.d.ts -x jsconfig.json -x __pycache__ -x .DS_Store "$src" "$dst" >/dev/null 2>&1; then
    mkdir -p "$BACKUP"; cp -R "$dst" "$BACKUP/"
    echo "  backup  $name -> $BACKUP/"
  fi
  if [ -d "$src" ]; then rsync -a --delete $SKIP "$src/" "$dst/"; else cp "$src" "$dst"; fi
  echo "  copied  $name"
}

echo "Herdr board -> $APP"
place "$SRC/layouts/kanban.json" "$APP/layouts/kanban.json"
place "$SRC/mods/kanban" "$APP/mods/kanban"
place "$SRC/mods/kanban-pane" "$APP/mods/kanban-pane"

# Keys: add what's missing, keep what's there.
python3 -I - "$SRC/keys.json" "$APP/keys.json" "$CFG" <<'PY'
import json, os, shutil, sys, time
src, dst, cfg = sys.argv[1:4]
new = json.load(open(src))
cur = json.load(open(dst)) if os.path.exists(dst) else {}
added, kept = [], []
for section, keys in new.items():
    have = cur.setdefault(section, {})
    for k, v in keys.items():
        if k not in have:
            have[k] = v; added.append(f"{section} {k}")
        elif have[k] != v:
            kept.append(f"{section} {k} (yours: {have[k]}, board wanted: {v})")
if added:
    if os.path.exists(dst):
        os.makedirs(os.path.join(cfg, "backup"), exist_ok=True)
        shutil.copy(dst, os.path.join(cfg, "backup", f"keys-{time.strftime('%Y%m%d-%H%M%S')}.json"))
    json.dump(cur, open(dst, "w"), indent=2)
print(f"  keys    {len(added)} added" + "".join(f"\n          kept yours: {k}" for k in kept))
PY

if command -v herdr-app >/dev/null 2>&1; then
  if herdr-app check "$APP/mods/kanban" >/dev/null 2>&1 && herdr-app check "$APP/mods/kanban-pane" >/dev/null 2>&1; then
    echo "  check   both mods load"
  else
    echo "  check   FAILED: run herdr-app check $APP/mods/kanban (and kanban-pane) to see why"
  fi
fi

cat <<MSG

Done. Switch to it in Herdr with cmd-shift-k (or ctrl-shift-l).

Next, in Claude Code: /herdr-agent-board:setup
It connects Jira through your Atlassian connector, picks a preset from your
tickets, finds your dev servers, and offers to add the Claude session hook.

Or add the hook yourself, in ~/.claude/settings.json under "hooks" (it lets the
pane header find each terminal's Claude session; without it, it guesses):

  "SessionStart": [{ "hooks": [{ "type": "command",
    "command": "python3 -I ~/.config/herdr-app/mods/kanban/claude-session-hook.py" }] }]
MSG
