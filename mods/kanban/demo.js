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
