import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { config } from "../config.ts";
import { syncGraph } from "./context-graph.ts";
import { projectDir } from "./workspace.ts";

/**
 * Free, deterministic syntax checks using interpreters already on this machine.
 * None of them execute the code:
 *   PHP    → php -l            (lint only)
 *   Python → ast.parse()       (parse only; no __pycache__ written into the project)
 *   JS     → node --check      (parse only)
 * Results are cached by file hash, so unchanged files are never re-checked.
 */

interface Tool {
  command: string;
  args: (file: string) => string[];
}

const isWin = process.platform === "win32";
let php: string | null = null;
let python: string | null = null;
const cache = new Map<string, string | null>(); // `${tool}:${hash}` → error message or null

function which(names: string[]): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const n of names) {
      const p = path.join(dir, n);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

export function detectTools() {
  php =
    (config.phpBin && fs.existsSync(config.phpBin) ? config.phpBin : null) ??
    which(isWin ? ["php.exe"] : ["php"]) ??
    (isWin && fs.existsSync("C:\\xampp\\php\\php.exe") ? "C:\\xampp\\php\\php.exe" : null);
  // Skip the Windows Store "python.exe" alias in WindowsApps, which only opens the Store.
  python =
    (config.pythonBin && fs.existsSync(config.pythonBin) ? config.pythonBin : null) ??
    (() => {
      const found = which(isWin ? ["python.exe", "py.exe"] : ["python3", "python"]);
      return found && !/WindowsApps/i.test(found) ? found : null;
    })();
}

export const toolStatus = () => ({ php: Boolean(php), python: Boolean(python) });

const PY_PARSE = "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf-8').read(),sys.argv[1])";

function toolFor(file: string): [string, Tool] | null {
  const ext = path.extname(file).toLowerCase();
  if ((ext === ".php" || ext === ".phtml") && php) return ["php", { command: php, args: (f) => ["-l", "-d", "display_errors=1", f] }];
  if (ext === ".py" && python) return ["py", { command: python, args: (f) => ["-c", PY_PARSE, f] }];
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return ["js", { command: process.execPath, args: (f) => ["--check", f] }];
  return null;
}

function runTool(tool: Tool, abs: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(tool.command, tool.args(abs), { windowsHide: true, cwd: path.dirname(abs) });
    let out = "";
    const timer = setTimeout(() => child.kill(), 10_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 0, out: String(err) }); // a missing tool is not the author's fault
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** Turns raw interpreter output into one short line without absolute paths. */
function tidy(out: string, abs: string, rel: string): string {
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.split(abs).join(rel).split(abs.replace(/\\/g, "/")).join(rel).trim())
    .filter((l) => l && !/^(No syntax errors|Errors parsing|Traceback|\s*\^+\s*$)/.test(l) && !/^File "<string>"/.test(l));
  const key = lines.find((l) => /error/i.test(l)) ?? lines.at(-1) ?? "syntax error";
  // Point at the author's file, never at the interpreter's own frames (e.g. Python's ast.py).
  const line = lines.map((l) => l.match(new RegExp(`${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?,? (?:on )?line (\\d+)`, "i"))?.[1]).find(Boolean);
  return `${rel}: ${key.replace(/ in \S+ on line \d+$/, "")}${line ? ` (line ${line})` : ""}`.slice(0, 300);
}

export async function syntaxCheck(projectId: string, onlyFiles?: string[]): Promise<string[]> {
  const { graph } = syncGraph(projectId);
  const root = projectDir(projectId);
  const targets = Object.values(graph.files).filter((f) => (!onlyFiles || onlyFiles.includes(f.path)) && toolFor(f.path));
  const issues: string[] = [];
  const queue = [...targets];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const [name, tool] = toolFor(f.path)!;
      const key = `${name}:${f.hash}`;
      if (!cache.has(key)) {
        const abs = path.join(root, f.path);
        const res = await runTool(tool, abs);
        cache.set(key, res.code === 0 ? null : tidy(res.out, abs, f.path));
      }
      const err = cache.get(key);
      if (err) issues.push(err);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
  return issues.sort();
}

// ───────────────────────────── PHP preview server ─────────────────────────────

interface Running {
  proc: ChildProcess;
  port: number;
  timer: NodeJS.Timeout;
}
const servers = new Map<string, Running>();

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Serves a project with PHP's built-in web server on 127.0.0.1. This RUNS
 * AI-written code on your machine, so the panel asks for confirmation first;
 * it stops automatically after 30 minutes.
 */
export async function startPhp(projectId: string): Promise<{ url: string }> {
  if (!php) throw new Error("PHP was not found. Install PHP (XAMPP works) or set PHP_BIN in .env.");
  const existing = servers.get(projectId);
  if (existing) return { url: `http://127.0.0.1:${existing.port}/` };
  const port = await freePort();
  const proc = spawn(php, ["-S", `127.0.0.1:${port}`, "-t", projectDir(projectId)], {
    cwd: projectDir(projectId),
    windowsHide: true,
    stdio: "ignore",
  });
  const timer = setTimeout(() => stopPhp(projectId), 30 * 60_000);
  servers.set(projectId, { proc, port, timer });
  proc.on("exit", () => {
    clearTimeout(timer);
    if (servers.get(projectId)?.proc === proc) servers.delete(projectId);
  });
  await new Promise((r) => setTimeout(r, 400));
  return { url: `http://127.0.0.1:${port}/` };
}

export function stopPhp(projectId: string) {
  const s = servers.get(projectId);
  if (!s) return;
  clearTimeout(s.timer);
  s.proc.kill();
  servers.delete(projectId);
}

export const phpUrl = (projectId: string) => {
  const s = servers.get(projectId);
  return s ? `http://127.0.0.1:${s.port}/` : null;
};

process.on("exit", () => {
  for (const s of servers.values()) s.proc.kill();
});
