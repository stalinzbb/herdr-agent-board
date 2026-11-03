---
name: riff
description: Ask the person a UI question with live controls instead of guessing or asking in prose, inside Herdr. A riff shows in the board's rail next to your pane, with sliders, colors, toggles, selects, springs and easings. They drag, maybe add a note, and answer; you get the values back and it closes. Use it whenever you need their call on something visual or felt: spacing, sizes, radius, colors, which variant, how an animation feels, a layout choice, copy options. Use it before you'd write "what spacing would you like?", when you'd otherwise pick a number by taste, or when they say "riff me X", "riff the animation", "let me try values", "give me knobs/sliders/dials for X". "Riff" here always means this tool, never "improvise some variations in prose". Also use when a message starting "Riff · " arrives: that is their answer, typed in because you'd stopped waiting.
---

# Riff: ask a UI question, get the values back

A riff is a short form you open for one question. It appears in the Herdr board's rail (the **Riff**
tab, ⌘⇧Y) while your tab is focused; if they're looking at another tab, they get a notification
and your card on the board moves to "Your turn" with the question on it. They drag, answer, and the
riff closes. It's yours: you open it, you get the answer, you close it if you no longer need it.

It only works inside Herdr: `$HC_TERMINAL_ID` must be set. If it's empty, ask in plain text instead,
and say that's why.

The idea and the control format come from [DialKit](https://github.com/joshpuckett/dialkit) by Josh
Puckett.

## When to riff (and when not)

Riff when the answer is a value or a choice the person judges by eye or feel, and seeing it beats
describing it: "how much gap between thumbnails", "which accent", "snappier or softer spring",
"stacked or grid". One riff per question, 2 to 8 controls, all about that question.

Don't riff for yes/no or plain-text questions (just ask), for logic, or to show off settings nobody
asked about. Don't open a standing panel for a whole feature: ask, use the answer, move on. And don't
answer "riff me X" with a table of alternatives in prose: that's the thing a riff replaces.

## 1. Plan the questions

A request like "riff me the taste values in what you just built" usually covers more than 8 values.
Before opening anything:

1. **Find what you built.** If it isn't in your context (a cleared conversation, a new session), read
   `git log` / `git diff` for the recent work and the files it touched.
2. **List the matter-of-taste values** with their current values from the code: spacing, sizes,
   radii, colors, durations, springs, easings, delays, copy. Leave out values a rule forces (a
   clearance, a platform minimum): those aren't taste.
3. **Group them by what's judged together**: layout, color, entrance motion, gesture feel. Each group
   is one riff of 2 to 8 controls. Merge or drop until there are at most 3 or 4 riffs.
4. **Order by impact**: the one that changes the feel most goes first.
5. **Say the plan in one or two lines** ("Three riffs: canvas spacing, pan feel, entrance. Opening the
   first."), then ask them one at a time. Put the position in the question: "Pan feel (2 of 3): how
   heavy should the canvas be?"
6. **Apply each answer to the code before opening the next**, so later defaults include it and any
   rules (overlaps, limits) are checked against the real values. Then stop when they skip or say it's
   good.

### Hand the drafting to a subagent

Steps 1 to 4 are mostly reading, so start a small subagent for them unless the values are already in
your context and fit in one riff. That keeps your context for the work, and it drafts riffs the same
way every time. Brief it with:

- what to look at: the commit, branch or files of the recent work, and the feature in one line;
- this skill's path, to read for the rules and the control shapes (or `riff.py --help`);
- what to return: the plan in one or two lines, then one `riff.py ask` spec per riff, as JSON, in
  order, with defaults read from the code and the file and line each value lives on.

It drafts only. You open each riff, wait for the answer and apply it, because the answer comes back to
your pane and the code is yours. Before opening a spec, check a value or two against the code.

## 2. Ask

```sh
python3 -I ~/.config/herdr-app/mods/kanban/riff.py ask <<'EOF'
{
  "id": "gallery-spacing",
  "question": "Which thumbnail spacing feels right?",
  "about": "src/components/Gallery.tsx",
  "output": "/abs/path/to/project/src/riff/gallery.json",
  "controls": {
    "gap": [12, 0, 32, 2],
    "thumbnail": [72, 48, 120, 4],
    "columns": { "type": "select", "options": ["4", "5", "6"] },
    "captions": false
  }
}
EOF
```

- `question` (required): one sentence, what you need them to decide.
- `controls` (required): defaults are **the values in the code right now** (read them; don't invent).
- `about`: the file or component, shown under the question.
- `output`: optional live preview (see 4).
- `id`: names the riff (default `riff`); asking again with the same id replaces it. Give each question
  in a series its own id.

It waits up to 100 seconds (under the default 2-minute command limit) and prints the answer. For a
longer wait, give the command a longer timeout and pass `--timeout 570`. `--no-wait` returns at once.

### Controls (DialKit's shapes)

| Control | Definition | Value |
|---|---|---|
| Slider | `[default, min, max]` or `[default, min, max, step]` | number |
| Inferred slider | `1.2` (0–1 → 0..1; else 0..3×) | number |
| Toggle | `true` / `false` | boolean |
| Text | `"Hello"`, or `{ "type": "text", "default": "", "placeholder": "…" }` | string |
| Color | `"#a78bfa"` (hex, rgb(), hsl(), oklch()), or `{ "type": "color", "default": … }` | string |
| Select | `{ "type": "select", "options": ["a", "b"] }`, options may be `{ "value", "label" }` | string |
| Spring | `{ "type": "spring", "visualDuration": 0.3, "bounce": 0.2 }` or `stiffness`/`damping`/`mass` | `{ type, … }` |
| Easing | `{ "type": "easing", "duration": 0.3, "ease": [0.25, 0.1, 0.25, 1] }` | `{ type, duration, ease }` |
| XY pad | `{ "type": "pad", "x": [0, -1, 1], "y": [0, -1, 1] }` | `{ x, y }` |
| Action | `{ "type": "action", "label": "Use this one" }` | answers at once, `action` = its path |
| Folder | `{ "blur": [12, 0, 40], "_collapsed": true }` | nested object |

Keys become labels ("showBadge" → "Show badge"). Ranges should stay sensible at both ends; a step
should match the unit (2px, 0.01 opacity, 10ms). Use the units the code uses, and say them in the key
when they aren't obvious (`durationMs`, `gapPt`).

## 3. The answer

```json
{ "status": "answered", "values": { "gap": 16, "thumbnail": 80, "columns": "5", "captions": false },
  "changed": { "gap": { "from": 12, "to": 16 }, "thumbnail": { "from": 72, "to": 80 }, "columns": { "from": "4", "to": "5" } },
  "note": "captions later", "action": null }
```

- `answered`: apply `values` (an empty `changed` means your values were right). Follow the `note`.
- `skipped`: they passed. Don't ask again; use your judgment and say so.
- `closed`: the riff went away without an answer (closed with `riff.py close`, or the pane ended).
- `open` with exit code 3: still waiting. Run `riff.py wait gallery-spacing` to keep waiting, or carry
  on with other work: when they answer, it's typed into your terminal as
  `Riff · <question>: … - gap: 12 → 16 … All values: {…}`. Treat that exactly like an answer.

Peek at what they've set so far, without waiting: `riff.py values gallery-spacing`. Close a riff you
no longer need: `riff.py close gallery-spacing` (or `riff.py close` for all of yours).

## 4. Letting them see it while they drag

Every change they make is written to `output` (an absolute path) as JSON shaped like `controls`. A
riff is much better when the running app shows those values live, so set that up when the stack
allows it, and tell them in the question when it doesn't ("applies after you answer").

Write the file with the current values first, so it exists before the app reads it. Mark every line
you add for the preview `// TEMP: Herdr riff` (or the language's comment), and after the answer put
the chosen values in the code as literals, remove every TEMP line and delete the JSON file.

| Stack | How the app picks up the file |
|---|---|
| Web with hot reload (Vite, Next, webpack, Astro, SvelteKit, Remix) | Import the JSON: `import riff from "@/riff/gallery.json"`. The dev server reloads it on every change. |
| React Native / Expo | `require` / import the JSON inside the app's source tree; Metro reloads it like any module. Values read once (a Reanimated shared value set at mount, `useMemo`, a module-level cache, a worklet's captured constant) won't follow: read them in render, or key the component on the values so it remounts. |
| iOS simulator (SwiftUI, UIKit) | The simulator can read the Mac's files: in a `#if DEBUG` block, read the absolute path on a timer (0.2 s) and publish it to the view. Not on a real device. |
| Flutter | Hot reload doesn't re-read files. In debug on the simulator or desktop, read it with `dart:io` and `File(path).watch()`. |
| Desktop apps, games, CLIs, TUIs, servers that render | Read the file at runtime in dev and re-read it when it changes (a watcher or a short poll). |
| Android (emulator or device), real iOS devices, anything else | It can't see the file: see below. |

**No live preview?** Make each round cheap instead:
- Fewer controls per riff, each with a range you'd be happy shipping at either end.
- For motion, offer 2 to 4 named presets as a `select` (and build them into the app's debug switcher
  if it has one) rather than raw spring numbers nobody can feel without seeing them.
- After the answer, apply it, reload or rebuild, and open a short follow-up with the applied values as
  the new defaults ("Pan feel, round 2: closer?"). Stop when they answer with no changes.

## 5. Several panes, several agents

- **A riff belongs to the pane that ran `riff.py`** (its `$HC_TERMINAL_ID`). It shows in the Riff tab
  whenever that pane's tab is focused, and the answer goes back only to that pane. Run it from your own
  pane; never open a riff on another agent's behalf.
- **Agents in the same tab** each get their own riffs. The rail shows all of them, yours labelled
  `<tab> · <branch>` so the person can tell the panes apart, and clicking the label takes them to the
  pane. Ids only need to be unique within your pane, but make them specific to the question
  (`canvas-pan`, not `riff`) so a second riff doesn't replace your first.
- **A subagent you start shares your pane.** Its riff shows as yours, and if it stops waiting, the
  answer is typed into your pane as a `Riff · …` message, so you handle it. Give it a distinct id.
- **The app usually runs in another pane** (a dev server, a simulator, Metro). That's fine: `output`
  is a file path, so any process can read it. Use an absolute path.
