---
name: riff
description: Ask the person a UI question with live controls instead of guessing or asking in prose, inside Herdr. A riff shows in the board's rail next to your pane, with sliders, colors, toggles, selects, springs and easings. They drag, maybe add a note, and answer; you get the values back and it closes. Use it whenever you need their call on something visual or felt: spacing, sizes, radius, colors, which variant, how an animation feels, a layout choice, copy options. Use it before you'd write "what spacing would you like?", when you'd otherwise pick a number by taste, or when they say "riff me X", "let me try values", "give me knobs/sliders/dials for X". Also use when a message starting "Riff · " arrives: that is their answer, typed in because you'd stopped waiting.
---

# Riff: ask a UI question, get the values back

A riff is a short form you open for one question. It appears in the Herdr board's rail (the **Riff**
tab, ⌘⇧Y) while your pane is focused; if they're looking at another agent, they get a notification
and your card on the board moves to "Needs you" with the question on it. They drag, answer, and the
riff closes. It's yours: you open it, you get the answer, you close it if you no longer need it.

It only works inside Herdr: `$HC_TERMINAL_ID` must be set. If it's empty, ask in plain text instead.

The idea and the control format come from [DialKit](https://github.com/joshpuckett/dialkit) by Josh
Puckett.

## When to riff (and when not)

Riff when the answer is a value or a choice the person judges by eye or feel, and seeing it beats
describing it: "how much gap between thumbnails", "which accent", "snappier or softer spring",
"stacked or grid". One riff per question, 2 to 8 controls, all about that question.

Don't riff for yes/no or plain-text questions (just ask), for logic, or to show off settings nobody
asked about. Don't open a standing panel for a whole feature: ask, use the answer, move on.

## 1. Ask

```sh
python3 -I ~/.config/herdr-app/mods/kanban/riff.py ask <<'EOF'
{
  "id": "gallery",
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
- `output`: optional live preview (see 3).
- `id`: names the riff (default `riff`); asking again with the same id replaces it.

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
should match the unit (2px, 0.01 opacity).

## 2. The answer

```json
{ "status": "answered", "values": { "gap": 16, "thumbnail": 80, "columns": "5", "captions": false },
  "changed": { "gap": { "from": 12, "to": 16 }, "thumbnail": { "from": 72, "to": 80 }, "columns": { "from": "4", "to": "5" } },
  "note": "captions later", "action": null }
```

- `answered`: apply `values` (an empty `changed` means your values were right). Follow the `note`.
- `skipped`: they passed. Don't ask again; use your judgment and say so.
- `closed`: the riff went away without an answer (closed with `riff.py close`, or the pane ended).
- `open` with exit code 3: still waiting. Run `riff.py wait gallery` to keep waiting, or carry on with
  other work: when they answer, it's typed into your terminal as
  `Riff · <question>: … - gap: 12 → 16 … All values: {…}`. Treat that exactly like an answer.

Peek at what they've set so far, without waiting: `riff.py values gallery`. Close a riff you no
longer need: `riff.py close gallery` (or `riff.py close` for all of yours).

## 3. Live preview (optional, web apps with hot reload)

Point `output` at a JSON file in the project and read it in the component while the riff is open:
every change they make is written there and the dev server reloads it. Write the file with the
current values first, so the import resolves.

```tsx
import riff from "@/riff/gallery.json"; // TEMP: Herdr riff
<div style={{ gap: riff.gap }} />
```

After the answer, put the chosen values in the code as literals, remove every `// TEMP: Herdr riff`
import and delete the JSON file. For React Native or anything without JSON hot reload, skip `output`.
