import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES_PER_RESULT = 40;

export const projectDir = (projectId: string) => path.join(config.paths.workspace, projectId);

/** Normalizes an AI-supplied path and rejects anything that escapes the project folder. */
export function safeRelPath(p: string): string | null {
  const cleaned = p.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
  if (!cleaned || cleaned.startsWith("/") || /^[a-zA-Z]:/.test(cleaned)) return null;
  const norm = path.posix.normalize(cleaned);
  if (norm.startsWith("..") || norm.split("/").some((s) => s === ".." || s === "node_modules" || s === ".git")) {
    return null;
  }
  return norm;
}

export function writeFiles(
  projectId: string,
  files: { path: string; content: string }[],
): { written: string[]; skipped: string[] } {
  const root = projectDir(projectId);
  const written: string[] = [];
  const skipped: string[] = [];
  for (const f of files.slice(0, MAX_FILES_PER_RESULT)) {
    const rel = safeRelPath(f.path);
    if (!rel || typeof f.content !== "string" || Buffer.byteLength(f.content) > MAX_FILE_BYTES) {
      skipped.push(f.path);
      continue;
    }
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
    written.push(rel);
  }
  skipped.push(...files.slice(MAX_FILES_PER_RESULT).map((f) => f.path));
  return { written, skipped };
}

/**
 * Applies find/replace edits. Each `find` must occur exactly once in the file
 * as it stands (after earlier edits to the same file). Files are all-or-nothing:
 * if any edit for a file misses, that file is left untouched and reported.
 * Returns how many output tokens the edits saved versus rewriting the files.
 */
export function applyEdits(
  projectId: string,
  edits: { path: string; find: string; replace: string }[],
): { written: string[]; failed: { path: string; reason: string }[]; savedTokens: number } {
  const root = projectDir(projectId);
  const byFile = new Map<string, { find: string; replace: string }[]>();
  for (const e of edits) {
    const rel = safeRelPath(e.path);
    if (!rel) continue;
    byFile.set(rel, [...(byFile.get(rel) ?? []), e]);
  }
  const written: string[] = [];
  const failed: { path: string; reason: string }[] = [];
  let savedTokens = 0;
  for (const [rel, list] of byFile) {
    const abs = path.join(root, rel);
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      failed.push({ path: rel, reason: "file does not exist (send it in `files` instead)" });
      continue;
    }
    let ok = true;
    for (const [i, e] of list.entries()) {
      if (!e.find) {
        failed.push({ path: rel, reason: `edit ${i + 1}: empty find` });
        ok = false;
        break;
      }
      const count = text.split(e.find).length - 1;
      if (count !== 1) {
        failed.push({ path: rel, reason: `edit ${i + 1}: find text ${count === 0 ? "not found" : `found ${count} times`}: ${JSON.stringify(e.find.slice(0, 80))}` });
        ok = false;
        break;
      }
      text = text.replace(e.find, () => e.replace);
    }
    if (!ok) continue;
    fs.writeFileSync(abs, text);
    written.push(rel);
    const editChars = list.reduce((n, e) => n + e.find.length + e.replace.length, 0);
    savedTokens += Math.max(0, Math.ceil((text.length - editChars) / 4));
  }
  return { written, failed, savedTokens };
}

export function listFiles(projectId: string): string[] {
  const root = projectDir(projectId);
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

export function readFile(projectId: string, rel: string): string | null {
  const safe = safeRelPath(rel);
  if (!safe) return null;
  const abs = path.join(projectDir(projectId), safe);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/** Files rendered as a prompt section: "=== path ===\ncontent". */
export function filesForPrompt(projectId: string, paths: string[]): string {
  return paths
    .map((p) => {
      const c = readFile(projectId, p);
      return c === null ? "" : `=== ${p} ===\n${c}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function removeProjectFiles(projectId: string) {
  fs.rmSync(projectDir(projectId), { recursive: true, force: true });
}
