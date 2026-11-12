// Which markers a session has: a riff open, a dev server or device in use, an unanswered question.
// One place decides, so the sidebar and the board agree.

import { shared, home } from "herdr";
import { riffs } from "./riffs.js";

// The running servers (and, through them, simulators) whose folder one of these folders is in.
export function devFor(folders) {
  const dev = shared("kanban.dev");
  if (!dev) return { servers: [], others: [], devices: false, sims: [], android: [] };
  const h = home();
  const near = (a, b) => a && b && a !== h && b !== h && (a === b || a.startsWith(b + "/") || b.startsWith(a + "/"));
  const hits = (folder) => folders.some((f) => near(f, folder));
  const servers = (dev.servers ?? []).filter((s) => hits(s.folder));
  const others = (dev.others ?? []).filter((o) => hits(o.cwd));
  return { servers, others, devices: servers.some((s) => s.devices), sims: dev.sims ?? [], android: dev.android ?? [] };
}

// [{ kind, text }] for one session: its agent's terminal, its status, and the folders it works in.
export function marksFor({ terminal, status, folders }) {
  const out = [];
  // `tip` is the hover text: what it is, and the specifics (which question, which ports, which devices).
  const mine = !!terminal ? riffs().filter((r) => r.terminal === terminal) : [];
  if (mine.length) out.push({ kind: "riff", text: "riff", tip: `${mine.length > 1 ? `${mine.length} riffs open` : "Riff open"}: ${mine.map((r) => r.question).join(" · ")}` });
  else if (status === "blocked") out.push({ kind: "ask", text: "ask", tip: "Waiting on your answer" });
  const u = devFor(folders);
  const servers = [...u.servers.map((s) => ({ port: s.port, name: s.name })), ...u.others.map((o) => ({ port: o.port, name: o.cmd }))];
  const ports = servers.filter((s) => s.port);
  if (servers.length) {
    out.push({
      kind: "port",
      text: ports.length > 1 ? `:${ports[0].port} +${ports.length - 1}` : ports.length ? `:${ports[0].port}` : "server",
      tip: `Dev server running: ${servers.map((s) => (s.port ? `${s.name ?? "server"} :${s.port}` : s.name ?? "server")).join(", ")}`,
    });
  }
  const devices = u.devices ? [...u.sims.map((s) => s.name), ...u.android.map((a) => a.replace(/^emulator-/, "Android "))] : [];
  if (devices.length) out.push({ kind: "device", text: devices.length > 1 ? `${devices.length} devices` : "device", tip: `In use: ${devices.join(", ")}` });
  return out;
}
