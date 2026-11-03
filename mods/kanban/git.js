// Where a folder's work really lives: its repo's name and whether it's a linked worktree (a second
// checkout of the same repo on another branch: Herdr's ~/.herdr/worktrees, Claude's
// .claude/worktrees, or `git worktree add`). A worktree's own folder is often named after the
// branch, so the repo name comes from git's shared folder, as Herdr's spaces sidebar does.

import { exec, home } from "herdr";

const cache = new Map(); // folder -> { info: { repo, top, linked } | null (not a repo), at }
const STALE = 2 * 60000;

export const gitInfo = (folder) => cache.get(folder)?.info ?? null;

const base = (p) => p.replace(/\/+$/, "").split("/").pop();

async function ask(folder) {
  try {
    const r = await exec("git", ["-C", folder, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"]);
    if (r.code !== 0) return null;
    const [top, common] = r.stdout.trim().split("\n");
    const repo = common.endsWith("/.git") ? base(common.slice(0, -5)) : base(common).replace(/\.git$/, "");
    return { repo, top, linked: common !== `${top}/.git` };
  } catch {
    return null;
  }
}

// Looks up the folders it hasn't seen (or not lately). True when anything changed.
export async function refreshGit(folders) {
  let changed = false;
  const now = Date.now();
  for (const f of new Set(folders.filter(Boolean))) {
    if (f === home()) continue;
    const had = cache.get(f);
    if (had && now - had.at < STALE) continue;
    const info = await ask(f);
    if (JSON.stringify(had?.info ?? null) !== JSON.stringify(info)) changed = true;
    cache.set(f, { info, at: now });
  }
  return changed;
}
