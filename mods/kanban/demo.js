// Demo mode: every panel shows made-up data, for screenshots and trying the board out.
// Toggle with the kanban.demo command (herdr-app do kanban.demo). Nothing here is real.

import { shared, panes } from "herdr";

export const demo = () => !!shared("kanban.demo");

const M = 60000, H = 60 * M, D = 24 * H;

function program(key) {
  const p = panes().find((x) => x.program?.key === key) ?? panes().find((x) => x.program?.agent);
  return p?.program ?? { name: key };
}

const SPACES = {
  web: { id: "demo-web", name: "Acme Store", repo: "acme-store", folder: "~/code/acme-store", index: 0, active: true },
  app: { id: "demo-app", name: "Acme Mobile", repo: "acme-mobile", folder: "~/code/acme-mobile", index: 1, active: false },
  ds: { id: "demo-ds", name: "Design System", repo: "acme-ui", folder: "~/code/acme-ui", index: 2, active: false },
};

let base = null;

// The projects sidebar's sessions in demo mode: the same made-up Acme work as the board.
export function demoSessions() {
  const now = Date.now();
  base = base ?? now;
  const claude = program("claude");
  const none = { servers: [], others: [], sims: [], android: [] };
  const mk = (sp, i, title, status, o = {}) => {
    const space = SPACES[sp];
    const top = o.worktree ?? space.folder;
    const id = `demo-${sp}-${i}`;
    const pane = { pane: `${id}-p`, terminal: id, status, program: claude, cwd: top, branch: o.branch, title, focused: true };
    return {
      space, tab: { id, name: title, named: true, status, changed_at: now - (o.ago ?? 0), working_since: status === "working" ? base - (o.working ?? 5 * M) : null },
      lead: pane, panes: [pane], turn: o.turn, riff: o.riff ? { question: o.riff, terminal: id, demo: true } : null,
      branch: o.branch, title, repo: space.repo, top, linked: !!o.worktree,
      dev: { ...none, ...(o.dev ?? {}) }, subs: o.subs ?? 0, task: o.task ?? null, current: !!o.current, quiet: false,
    };
  };
  const web = { servers: [{ id: "w", name: "Web", port: 3000 }] };
  return [
    mk("web", 0, "Checkout: save card for later", "blocked", { turn: "ask", branch: "feat/saved-cards", ago: 2 * M, riff: "How much space between saved cards?", dev: web }),
    mk("web", 1, "Product page: new image gallery", "working", { turn: "working", branch: "feat/gallery", working: 14 * M, subs: 2, current: true, task: { key: "DES-412", summary: "Gallery: zoom and swipe interactions", source: "jira" }, dev: web }),
    mk("web", 2, "Search results empty state", "done", { turn: "new", branch: "feat/search-empty", worktree: "~/code/acme-store-wt", ago: 25 * M }),
    mk("app", 0, "Fix Android back gesture on cart sheet", "blocked", { turn: "ask", branch: "fix/cart-back", ago: 9 * M }),
    mk("app", 1, "Onboarding: three-step welcome", "working", { turn: "working", branch: "feat/welcome", working: 37 * M, dev: { ...none, servers: [{ id: "m", name: "Metro", port: 8081 }], sims: [{ name: "iPhone 17 Pro" }] } }),
    mk("ds", 0, "Tokens: dark theme surfaces", "idle", { turn: "ready", branch: "tokens-dark", ago: 2 * H }),
  ];
}

export function demoCards() {
  const now = Date.now();
  base = base ?? now;
  const claude = program("claude");
  const card = (sp, i, title, status, o = {}) => ({
    space: SPACES[sp],
    tab: { id: `demo-${sp}-${i}`, name: title, named: true, status, index: i, panes: o.panes ?? 1,
      changed_at: now - (o.ago ?? 0), working_since: status === "working" ? base - (o.working ?? 5 * M) : null,
      settled: !!o.settled, settled_at: o.settled ? now - o.settled : null, demo_worked: o.worked ?? null },
    lead: { program: claude, cwd: SPACES[sp].folder, branch: o.branch },
    title, subtitle: o.subtitle ?? null,
    agents: [`demo-${sp}-${i}`],
    subs: (o.subs ?? []).map((name, n) => ({ address: `demo-sub-${sp}-${i}-${n}`, name, status: "working" })),
    folders: [SPACES[sp].folder],
    // The board's columns: whose turn it is (see board.js).
    column: o.settled ? "done" : status === "working" && !o.riff ? "working" : "you",
    turn: o.riff || status === "blocked" ? "ask" : status === "done" ? "new" : "ready",
    demo: true,
    demo_project: o.worktree ? { name: SPACES[sp].repo, folder: o.worktree, worktree: { top: o.worktree, repo: SPACES[sp].repo } } : null,
    current: !!o.current,
    demo_dev: o.dev ?? null,
    riff: o.riff ?? null,
  });
  return [
    card("web", 0, "Checkout: save card for later", "blocked", { branch: "feat/saved-cards", subtitle: "Wants to run the payment migrations", ago: 2 * M }),
    card("app", 1, "Fix Android back gesture on cart sheet", "blocked", { branch: "fix/cart-back", ago: 9 * M }),
    card("web", 2, "Product page: new image gallery", "blocked", { branch: "feat/gallery", ago: 1 * M, current: true, subs: ["Explore", "Plan"],
      riff: { demo: true, question: "Which thumbnail spacing feels right?" },
      dev: { servers: [{ id: "web", name: "Web", port: 3000, url: "http://localhost:3000" }], others: [], devices: false, sims: [], android: [] } }),
    card("app", 3, "Onboarding: three-step welcome", "working", { branch: "feat/welcome", working: 37 * M,
      dev: { servers: [{ id: "metro", name: "Metro", port: 8081, devices: true }], others: [], devices: true, sims: [{ name: "iPhone 17 Pro" }], android: [] } }),
    card("ds", 4, "Button: add loading state", "working", { branch: "button-loading", working: 3 * M, subs: ["code-reviewer"], worktree: "~/.herdr/worktrees/acme-ui/button-loading" }),
    card("web", 5, "Search results empty state", "done", { branch: "feat/search-empty", ago: 25 * M, worked: 18 * M }),
    card("ds", 6, "Tokens: dark theme surfaces", "done", { branch: "tokens-dark", ago: 2 * H, worked: 41 * M, panes: 2 }),
    card("app", 7, "Spike: offline cart", "idle", { branch: "spike/offline-cart", ago: 3 * H, worked: 1 * H + 12 * M }),
    card("web", 8, "Footer links audit", "idle", { ago: 3 * D, worked: 6 * M, settled: 2 * D }),
    card("web", 9, "Header: sticky on scroll", "idle", { ago: 5 * H, worked: 22 * M, settled: 4 * H }),
    card("ds", 10, "Icon set: 1.75 stroke pass", "idle", { ago: 1 * D, worked: 35 * M, settled: 20 * H }),
  ];
}

export const DEMO_JIRA_CONFIG = {"refresh_minutes": 30, "work_hours": [8, 19], "digest_at": 8, "stale_days": 5, "old_days": 60, "views": [{"id": "design", "label": "Design", "jql": "project = DES AND (assignee = currentUser() OR reporter = currentUser()) AND (statusCategory != Done OR updated >= -14d) ORDER BY updated DESC"}, {"id": "features", "label": "Features", "jql": "project = WEB AND assignee = currentUser() AND issuetype not in (\"Technical Spike\", \"Sub-bug\", \"General Subtask\", \"UI sub-task\") AND (statusCategory != Done OR updated >= -14d) ORDER BY updated DESC"}, {"id": "proto", "label": "Prototypes", "jql": "project = WEB AND issuetype = \"Technical Spike\" AND (assignee = currentUser() OR reporter = currentUser()) AND (statusCategory != Done OR updated >= -30d) ORDER BY updated DESC"}, {"id": "qa", "label": "Design QA", "max": 50, "jql": "project = WEB AND (issuetype in (\"Sub-bug\", \"UI sub-task\") OR summary ~ \"Design Review\") AND (reporter = currentUser() OR assignee = currentUser()) AND updated >= -45d ORDER BY updated DESC"}, {"id": "recent", "label": "Recent", "jql": "issue in issueHistory() ORDER BY lastViewed DESC"}], "tabs": [{"id": "today", "label": "Today"}, {"id": "design", "label": "Design", "sections": [{"view": "design", "group": "status", "pair_migrate": true, "status_map": {"Ready for Dev": "done", "Ready for Design": "new", "Backlog": "new"}}]}, {"id": "dev", "label": "Dev", "sections": [{"view": "features", "label": "Features", "group": "status"}, {"view": "proto", "label": "Prototypes", "group": "status"}]}, {"id": "qa", "label": "Design QA", "sections": [{"view": "qa", "group": "parent", "title_from_parent": "Design Review"}]}, {"id": "recent", "label": "Recent", "sections": [{"view": "recent"}]}], "today_tabs": ["design", "qa", "dev"], "site": "https://acme.atlassian.net", "cloudId": "demo", "preset": "designer", "tools": {"search": ["mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql", "mcp__claude_ai_Atlassian_MCP__searchJiraIssuesUsingJql"], "transitions": "mcp__claude_ai_Atlassian__getTransitionsForJiraIssue", "move": "mcp__claude_ai_Atlassian__transitionJiraIssue"}};

export function demoJira() {
  const now = Date.now();
  const i = (key, summary, status, category, type, o = {}) => ({
    key, summary, status, category, type, project: key.split("-")[0], assignee: "You", assigneeId: "demo",
    parent: o.parent ?? null, parentSummary: o.parentSummary ?? null, parentStatus: o.parentStatus ?? null,
    updated: now - (o.ago ?? D),
  });
  const story = { parent: "WEB-1180", parentSummary: "Product page: new image gallery", parentStatus: "In Progress" };
  const story2 = { parent: "WEB-1164", parentSummary: "Checkout: save card for later", parentStatus: "In Review" };
  const data = {
    at: now - 6 * M, account: "demo", site: DEMO_JIRA_CONFIG.site,
    views: {
      design: { issues: [
        i("DES-412", "Gallery: zoom and swipe interactions", "In Progress", "indeterminate", "Task", { ago: 3 * H }),
        i("DES-405", "Saved cards: manage cards screen", "In Progress", "indeterminate", "Task", { ago: 1 * D }),
        i("DES-418", "Empty states for search and filters", "Ready for Design", "new", "Task", { ago: 2 * D }),
        i("DES-420", "Holiday banner variants", "To Do", "new", "Task", { ago: 4 * D }),
        i("DES-398", "Onboarding welcome flow", "Ready for Dev", "indeterminate", "Task", { ago: 3 * D }),
        i("DES-391", "Order tracking timeline", "Ready for Dev", "indeterminate", "Task", { ago: 6 * D }),
      ] },
      features: { issues: [
        i("WEB-1180", "Product page: new image gallery", "In Progress", "indeterminate", "Story", { ago: 1 * H }),
        i("WEB-1191", "Search results empty state", "In Review", "indeterminate", "Story", { ago: 30 * M }),
        i("WEB-1202", "Footer links audit", "To Do", "new", "Story", { ago: 3 * D }),
      ] },
      proto: { issues: [
        i("WEB-1175", "Spike: offline cart on mobile", "In Progress", "indeterminate", "Technical Spike", { ago: 1 * D }),
        i("WEB-1188", "Spike: AR product preview", "To Do", "new", "Technical Spike", { ago: 5 * D }),
      ] },
      qa: { issues: [
        i("WEB-1196", "Design Review", "To Do", "new", "UI sub-task", { ago: 2 * H, ...story }),
        i("WEB-1199", "Thumbnail spacing is 12px, should be 16px", "In Progress", "indeterminate", "Sub-bug", { ago: 4 * H, ...story }),
        i("WEB-1170", "Design Review", "In Progress", "indeterminate", "UI sub-task", { ago: 1 * D, ...story2 }),
      ] },
      recent: { issues: [
        i("WEB-1180", "Product page: new image gallery", "In Progress", "indeterminate", "Story", { ago: 1 * H }),
        i("DES-412", "Gallery: zoom and swipe interactions", "In Progress", "indeterminate", "Task", { ago: 3 * H }),
        i("WEB-1196", "Design Review", "To Do", "new", "UI sub-task", { ago: 2 * H, ...story }),
      ] },
    },
  };
  const digest = {
    at: now - 2 * H, since: now - 26 * H,
    mentions: [{ key: "WEB-1164", summary: "Checkout: save card for later", author: "Priya N.", at: now - 3 * H,
      text: "@You can you check the card list on small screens before we ship? The delete button wraps." }],
    comments: [{ key: "DES-405", summary: "Saved cards: manage cards screen", author: "Marco R.", at: now - 5 * H,
      text: "Looks good. One question about the default card badge on dark mode." }],
    moved: [{ key: "DES-398", summary: "Onboarding welcome flow", from: "In Design", to: "Ready for Dev", category: "indeterminate" }],
    stale: [], snapshot: {},
  };
  return { data, digest, status: { state: "ok", mode: "digest", at: now - 6 * M } };
}

// The Riff panel's demo: an agent asking which gallery spacing feels right.
export const DEMO_RIFF = {
  terminal: "demo",
  question: "Which thumbnail spacing feels right?",
  about: "src/components/Gallery.tsx",
  controls: {
    gap: [12, 0, 32, 2],
    thumbnail: [72, 48, 120, 4],
    radius: [8, 0, 24],
    columns: { type: "select", options: ["4", "5", "6"] },
    captions: false,
    hover: { type: "spring", visualDuration: 0.25, bounce: 0.1 },
  },
};

export const DEMO_USAGE = {
  at: Date.now(),
  models: {
    "claude-opus-5-5": { input: 2100, output: 412000, cache_read: 21400000, cache_write: 780000, messages: 240, cost: 9.84 },
    "claude-sonnet-5-5": { input: 900, output: 160000, cache_read: 6200000, cache_write: 310000, messages: 120, cost: 2.31 },
  },
};

// ---- Dev panel in demo mode: made-up servers, simulators and devices, so a screenshot never shows the
// ports, folders or phones on your machine. (rail.js)
export const DEMO_DEV_SERVERS = [
  { id: "web", name: "Web", project: "acme-store", port: 3000 },
  { id: "storybook", name: "Storybook", project: "acme-ui", port: 6006 },
  { id: "metro", name: "Metro", project: "acme-mobile", port: 8081 },
  { id: "api", name: "API", project: "acme-api", port: 4000 },
];
export const DEMO_LISTEN = [
  { port: 3000, pid: "1", cmd: "node", cwd: "~/code/acme-store" },
  { port: 5173, pid: "2", cmd: "node", cwd: "~/code/acme-docs" },
  { port: 6006, pid: "3", cmd: "node", cwd: "~/code/acme-ui" },
  { port: 8081, pid: "4", cmd: "node", cwd: "~/code/acme-mobile" },
];
export const DEMO_SIMS = [
  { udid: "demo-1", name: "iPhone 17 Pro", os: "iOS 27.0", v: 2700, booted: true, iphone: true },
  { udid: "demo-2", name: "iPhone 17", os: "iOS 27.0", v: 2700, booted: false, iphone: true },
  { udid: "demo-3", name: "iPhone Air", os: "iOS 27.0", v: 2700, booted: false, iphone: true },
];
export const DEMO_PHONES = [{ name: "Demo iPhone", os: "iOS 27.0", online: true }];
export const DEMO_AVDS = ["Pixel_9_API_35"];

// ---- Saved prompts in demo mode (prompts.js): generic, not yours.
export const DEMO_PROMPTS = [
  { label: "Run tests and fix", text: "Run the tests for what you changed and fix any failures." },
  { label: "Typecheck and lint", text: "Run typecheck and lint, then fix what fails." },
  { label: "Status update", text: "In a few lines: what have you changed so far, what's left, and is anything blocking you?" },
  { label: "Review the diff", text: "Review the current uncommitted diff for bugs, before I commit." },
];

// ---- The usage window in demo mode (usage.js): a made-up history in the shape of usage.json, so the stats
// window never shows your real projects, sessions or spend. Everything is computed from a fixed formula;
// the prices are illustrative, not Anthropic's.
const U_MODELS = [
  { id: "claude-opus-5-5", share: 0.7, rate: { input: 5, output: 25, cache_5m: 6.25, cache_1h: 10, cache_read: 0.5 } },
  { id: "claude-sonnet-5-5", share: 0.25, rate: { input: 3, output: 15, cache_5m: 3.75, cache_1h: 6, cache_read: 0.3 } },
  { id: "claude-haiku-5-5", share: 0.05, rate: { input: 1, output: 5, cache_5m: 1.25, cache_1h: 2, cache_read: 0.1 } },
];
const U_PROJECTS = [["acme-store", 0.38], ["acme-mobile", 0.27], ["acme-ui", 0.17], ["acme-docs", 0.1], ["acme-api", 0.08]];
const U_TITLES = ["Checkout: save card for later", "Product page: new image gallery", "Fix Android back gesture on cart sheet", "Onboarding: three-step welcome", "Tokens: dark theme surfaces", "Search results empty state", "Button: add loading state", "Header: sticky on scroll", "Order history filters", "Settings: notification toggles", "Icon set: 1.75 stroke pass", "Footer links audit"];
const U_AGENTS = [["code-reviewer", 0.4], ["test-writer", 0.3], ["planner", 0.2], ["explorer", 0.1]];
const pr = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }; // fixed pseudo-random in [0, 1)
const iso = (t) => new Date(t).toISOString().slice(0, 10);

function usageRange(rows, now) {
  const mods = U_MODELS.map((m) => ({ model: m.id, replies: 0, input: 0, output: 0, cache_read: 0, cache_5m: 0, cache_1h: 0, sessions: 0, cost: 0, unc: 0 }));
  const series = rows.map((row) => {
    const s = { key: row.key, tokens: 0, fresh: 0, cost: 0, models: {}, costs: {} };
    const fresh = row.a * 9e6 * row.n;
    U_MODELS.forEach((m, i) => {
      const f = fresh * m.share;
      const u = { input: f * 0.04, output: f * 0.3, cache_5m: f * 0.56, cache_1h: f * 0.1, cache_read: f * 45 };
      const cost = (u.input * m.rate.input + u.output * m.rate.output + u.cache_5m * m.rate.cache_5m + u.cache_1h * m.rate.cache_1h + u.cache_read * m.rate.cache_read) / 1e6;
      const tokens = f + u.cache_read;
      s.tokens += tokens; s.fresh += f; s.cost += cost; s.models[m.id] = Math.round(tokens); s.costs[m.id] = cost;
      const t = mods[i];
      for (const k of ["input", "output", "cache_5m", "cache_1h", "cache_read"]) t[k] += u[k];
      t.cost += cost; t.replies += f / 9000; t.sessions += Math.max(1, row.a * 6 * row.n * m.share);
      t.unc += ((u.input + u.cache_5m + u.cache_1h + u.cache_read) * m.rate.input + u.output * m.rate.output) / 1e6;
    });
    return s;
  });
  const sum = (k) => mods.reduce((n, m) => n + m[k], 0);
  const tot = { replies: Math.round(sum("replies")), input: Math.round(sum("input")), output: Math.round(sum("output")), cache_read: Math.round(sum("cache_read")), cache_5m: Math.round(sum("cache_5m")), cache_1h: Math.round(sum("cache_1h")), sessions: Math.round(sum("sessions")), first_day: rows[0].first, last_day: rows[rows.length - 1].last, cost: sum("cost"), cost_uncached: sum("unc"), cache_saved: sum("unc") - sum("cost") };
  const tokens = series.reduce((n, s) => n + s.tokens, 0), freshAll = series.reduce((n, s) => n + s.fresh, 0), cost = tot.cost;
  const sessions = Array.from({ length: 12 }, (_, i) => {
    const [proj] = U_PROJECTS[i % U_PROJECTS.length];
    const c = (cost / 14) * (1 - i * 0.06);
    return { id: `demo${String(i).padStart(4, "0")}`, tokens: Math.round((tokens / 14) * (1 - i * 0.06)), fresh: Math.round((freshAll / 14) * (1 - i * 0.06)), replies: Math.round(tot.replies / 18) + i, model: i % 4 === 3 ? "claude-sonnet-5-5" : "claude-opus-5-5", last: now - (i * 7 + 2) * 3600e3, subagent_tokens: i % 3 === 0 ? Math.round(freshAll / 90) : 0, title: U_TITLES[i % U_TITLES.length], project: `~/code/${proj}`, cwd: `~/code/${proj}`, cost: c };
  });
  return {
    totals: tot,
    models: mods.map(({ unc, ...m }) => ({ ...m, replies: Math.round(m.replies), input: Math.round(m.input), output: Math.round(m.output), cache_read: Math.round(m.cache_read), cache_5m: Math.round(m.cache_5m), cache_1h: Math.round(m.cache_1h), sessions: Math.round(m.sessions) })).sort((a, b) => b.cost - a.cost),
    series: series.map((s) => ({ ...s, tokens: Math.round(s.tokens), fresh: Math.round(s.fresh) })),
    projects: U_PROJECTS.map(([p, w], i) => ({ project: `~/code/${p}`, cwd: `~/code/${p}`, tokens: Math.round(tokens * w), fresh: Math.round(freshAll * w), replies: Math.round(tot.replies * w), sessions: Math.max(1, Math.round(tot.sessions * w)), cost: cost * w })),
    sessions,
    hours: Array.from({ length: 24 }, (_, h) => Math.round(freshAll * Math.max(0, Math.exp(-(((h - 14) / 4.5) ** 2)) * (0.8 + 0.4 * pr(h + 3))) / 40)),
    agents: U_AGENTS.map(([a, w], i) => ({ agent: a, tokens: Math.round(freshAll * w * 0.3), replies: Math.round(tot.replies * w * 0.25), cost: cost * w * 0.12 })),
  };
}

let usageCache = null;
export function demoUsageStats() {
  const now = Date.now(), day = iso(now);
  if (usageCache?.day === day) return usageCache.v;
  const days = (n) => Array.from({ length: n }, (_, i) => {
    const t = now - (n - 1 - i) * 864e5, dow = new Date(t).getUTCDay();
    const a = (0.25 + 0.75 * pr(i + n)) * (dow === 0 || dow === 6 ? 0.25 : 1);
    return { key: iso(t), first: iso(t), last: iso(t), a, n: 1 };
  });
  const months = Array.from({ length: 6 }, (_, i) => {
    const t = new Date(now); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() - (5 - i));
    return { key: iso(t.getTime()).slice(0, 7), first: iso(t.getTime()), last: iso(t.getTime()), a: 0.3 + 0.12 * i, n: 22 };
  });
  const d7 = days(7), d30 = days(30);
  const range = (rows, first) => { const r = usageRange(rows, now); r.totals.first_day = first ?? rows[0].first; r.totals.last_day = day; return r; };
  const v = { at: now, today: day, imported: 0, seconds: 0, db: "", unpriced: [], models: DEMO_USAGE.models, ranges: { today: range([{ ...d7[6], a: 0.45 }]), "7d": range(d7), "30d": range(d30), all: range(months, months[0].first) } };
  usageCache = { day, v };
  return v;
}
