// Open riffs, for the whole board. A riff is an agent asking you a UI question with live
// controls (riff.py writes it, the Riff tab shows it, your answer goes back and it closes).
// The bar copy is always shown, so it watches the folder and publishes shared "kanban.riffs"
// ([{ stem, terminal, question }]): the rail tab's count, the cards' chip and column, and it opens
// the Riff tab when the agent you're on asks (or notifies when another one does).

import { exec, home, readTextFile, watchFolder, terminals, agents, focused, notify, run, shared, setShared } from "herdr";
import { railTo, railShows } from "./railtabs.js";

export const RIFF_DIR = () => `${home()}/.cache/herdr-kanban/riff`;
export const isSpec = (path) => path.endsWith(".json") && !/\.(values|answer)\.json$/.test(path);
export const stemOf = (path) => path.split("/").pop().replace(/\.json$/, "");
export const riffs = () => shared("kanban.riffs") ?? [];

// The tab name if someone named it, else the space's.
export function agentLabel(a) {
  if (!a) return "An agent";
  return a.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : a.space_name;
}

// Takes you to the agent's pane with its riff open.
export function goToRiff(terminal) {
  const a = agents().find((x) => x.address === terminal);
  if (a) {
    run("space.select", { id: a.space });
    run("tab.select", { id: a.tab });
  }
  run("pane.focus", { terminal });
  if (railShows() !== "riff") railTo("riff");
}

async function readAll() {
  const ls = await exec("/bin/ls", ["-1", RIFF_DIR()]).catch(() => ({ stdout: "" }));
  const out = [];
  for (const name of ls.stdout.split("\n").filter(isSpec)) {
    const stem = stemOf(name);
    try {
      const spec = JSON.parse((await readTextFile(`${RIFF_DIR()}/${name}`)) ?? "null");
      if (spec?.terminal) out.push({ stem, terminal: spec.terminal, question: String(spec.question ?? spec.title ?? stem) });
    } catch {}
  }
  return out;
}

export function watchRiffs(cx) {
  cx.spawn(async (cx) => {
    await exec("mkdir", ["-p", RIFF_DIR()]).catch(() => null);
    let known = null;
    for (;;) {
      let list = await readAll();
      // An agent that's gone can't hear the answer: its riffs go too. (Not before the core has
      // listed any terminals, or a cold start would sweep everything.)
      const terms = terminals();
      if (terms.length) {
        const live = new Set(terms.filter((t) => t.state === "live").map((t) => t.address));
        const dead = list.filter((r) => !live.has(r.terminal));
        if (dead.length) {
          await exec("rm", ["-f", ...dead.flatMap((r) => [".json", ".values.json", ".answer.json"].map((s) => `${RIFF_DIR()}/${r.stem}${s}`))]).catch(() => null);
          list = list.filter((r) => live.has(r.terminal));
        }
      }
      if (known) {
        for (const r of list.filter((r) => !known.has(r.stem))) {
          const a = agents().find((x) => x.address === r.terminal);
          if (a && a.tab === focused()?.tab) {
            if (railShows() !== "riff") railTo("riff");
          } else {
            notify({ title: `${agentLabel(a)} needs your call`, body: r.question, level: "info", action: { name: `kanban.riff_${r.terminal}` } });
          }
        }
      }
      known = new Set(list.map((r) => r.stem));
      if (JSON.stringify(list) !== JSON.stringify(riffs())) setShared("kanban.riffs", list);
      // Values change on every drag; only a spec appearing, changing or going matters here.
      for (;;) {
        const changed = await watchFolder(RIFF_DIR()).catch(() => null);
        if (!changed) { await new Promise((r) => cx.timer.after(5000, r)); break; }
        if (changed.some(isSpec)) break;
      }
    }
  });
}
