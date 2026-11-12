# Sharing the Herdr agent board on Twitter/X

Images here are cropped to demo data only ("Acme Store"); the raw full-window frames showed real
projects and terminal text and are not in the repo.

## Before you post
- The repo is **private**. Make it public (or publish a landing page / gist) before linking, and read
  the README once as a stranger: it mentions Jira/Atlassian setup, which is fine, but check for any
  company names. Demo data is fictional.
- Credit DialKit (Josh Puckett, github.com/joshpuckett/dialkit): Riff's control shapes come from it.
  Tagging them is both right and good reach.
- Record with demo mode on (`herdr-app do kanban.demo`) so no real session text is on screen. Crop out
  the terminal panes below the board or run a space with nothing private in it.

## The one-line pitch
"A board for your coding agents: who's waiting on you, what's running where, and a way for an agent to
ask you a visual question with live sliders instead of guessing."

## Assets (in this folder)
| File | Use |
|---|---|
| `board.png` | Hero image: columns by whose turn it is, a violet riff chip, cyan port chips, pink device chip, the Riff panel at the right |
| `riff-panel.png` | The riff itself: project + chips, question, sliders, toggle, card section, Answer |
| `sidebar.png` | The projects sidebar: repos, branches, sessions, colored markers |
| `tasks-panel.png` | Tasks with the + and agent picker |

## Thread (5 posts)

**1 (hook, attach a 15 s video of the riff, or board.png)**
Your coding agent is about to guess your spacing again.

Mine now stops and asks: a panel opens next to its terminal with live sliders. I drag, it sees the
numbers, and the answer goes back to the agent. No "make it a bit bigger".

**2 (attach riff-panel.png)**
How it works: the agent runs one command with a question and controls (sliders, colors, toggles,
springs). Herdr shows them in a sidebar and writes each value to a file as you drag, so your dev
server updates live. Controls and shapes are from @joshpuckett's DialKit; rebuilt natively.

**3 (attach board.png)**
The board shows whose turn it is, not what's running. Each card is a session: red = waiting on you,
violet = a riff is open, cyan = a dev server (hover lists the ports), pink = a simulator, amber =
working. At a glance you know which of eight agents needs you.

**4 (attach tasks-panel.png)**
Tasks from Jira, GitHub, Linear or your own list in one panel. + adds one; ▶ starts the agent on it in
a new tab; the arrow starts it with a different agent (Claude, Codex, whatever you have installed).

**5 (CTA)**
A projects sidebar lists every repo, branch and session with the same colors, and ⌘⇧M mutes the sounds
when it gets noisy. Built on Herdr [link]. Repo: [link once public]. What would you want an agent to
ask you with sliders?

## More post ideas
- **Before/after GIF (best performer for this kind of tool):** left, an agent iterating on a card's
  padding through 6 chat messages; right, one riff, 3 drags, done. Caption: "6 messages vs 3 drags."
- **Quote-tweet bait:** "Prompting 'a bit more padding' is the new 'make the logo bigger'."
- **Color-code post:** a single image of the board with the five marker colors labeled. Short, saveable.
- **Narrow sidebar bug fix:** a "this was broken, now it isn't" clip of a long title wrapping. People
  like small honest polish.
- **Behind the scenes:** "I built this with Claude Code in a worktree; here's the PR" with the PR diff
  stat. Fits the build-in-public crowd.
- **Poll:** "When an agent needs a visual decision, do you want: (a) a chat question (b) live sliders
  (c) three preview options."

## 30-second demo script (screen recording)
Use `herdr-app do kanban.demo`, a clean space, 1440 px wide, system sound off.

| Time | On screen |
|---|---|
| 0-4 s | Board with three cards; one has the violet "Your call" chip. Cursor lands on it |
| 4-12 s | Riff panel: drag Gap and Thumbnail, flip Captions, fold the Hover card |
| 12-16 s | Type "tighter on mobile" in the note, press Answer: "Sent to the agent" |
| 16-21 s | Board: the card moves from Your turn to Working; port chip :3000 visible, hover shows ports |
| 21-26 s | Tasks: + a task, click the arrow next to ▶, pick a different agent |
| 26-30 s | ⌘B to the sidebar: projects, branches, colored markers; tap the speaker to mute |

Tip: lead the tweet with the video (native upload, not a link), keep it under 30 s, add captions, and
put the repo link in a reply, not the first post.

## Alt text
- board.png: "Dark kanban board of coding-agent sessions in three columns (Your turn, Working, Done),
  with colored chips for a riff, dev server ports and a simulator, and a panel of sliders on the right."
- riff-panel.png: "A panel titled acme-store asking which thumbnail spacing feels right, with sliders for gap,
  thumbnail and radius, a columns selector, a toggle, and an Answer button."
- tasks-panel.png: "A tasks panel with Jira-style tickets grouped by project and a plus button in the header."
