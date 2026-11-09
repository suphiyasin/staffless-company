import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import type { ContextFile, ContextLink, RoleId } from "../types.ts";
import { listFiles, projectDir, safeRelPath } from "./workspace.ts";

/**
 * Context Graph: a graphify-style knowledge graph of each project, built for speed.
 *
 *  - Deterministic: regex extractors per file type, no LLM, zero tokens.
 *  - Incremental: files are re-parsed only when mtime/size and then hash change.
 *  - In-process: ~1ms per file, no Python, no subprocess.
 *
 * Nodes are files plus the symbols they define or use:
 *   .class   #id   --css-var   fn:name
 * Edges are derived on demand:
 *   links: A references B (href, src, import, url())
 *   uses:  A uses a symbol that B defines (class styled in CSS, #id queried in JS...)
 *
 * The graph powers three things: picking the minimum relevant context for an
 * agent (with a token budget), a one-line-per-file project map, and free
 * automated checks (broken references, unstyled classes, missing ids).
 */

interface FileNode extends ContextFile {
  hash: string;
  mtimeMs: number;
  size: number;
}

interface Graph {
  version: 2;
  files: Record<string, FileNode>;
  /** Every file in the workspace, including binaries, for reference checks. */
  all: string[];
}

const VERSION = 2 as const;
/** Everything the team writes is text; only skip obvious binary assets. */
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|pdf|zip|gz|tar|7z|woff2?|ttf|otf|eot|mp3|mp4|wav|ogg|webm|mov|exe|dll|so|dylib|class|pyc)$/i;
const isText = (p: string) => !BINARY_EXT.test(p);
const graphs = new Map<string, Graph>();

export const estTokens = (s: string) => Math.ceil(s.length / 4);
const graphPath = (projectId: string) => path.join(config.paths.data, "context", `${projectId}.json`);
const uniq = <T>(a: T[]) => [...new Set(a)];
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function kindOf(p: string): ContextFile["kind"] {
  const lower = p.toLowerCase();
  const ext = path.extname(lower);
  if (/\.(blade\.php|twig|jinja2?|j2|hbs|handlebars|ejs|njk|mustache|vue|svelte|astro)$/.test(lower)) return "template";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".css" || ext === ".scss" || ext === ".sass" || ext === ".less") return "css";
  if ([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"].includes(ext)) return "js";
  if (ext === ".php" || ext === ".phtml") return "php";
  if (ext === ".py") return "py";
  if (ext === ".sql") return "sql";
  if ([".go", ".java", ".kt", ".cs", ".rb", ".rs", ".swift", ".c", ".h", ".cpp", ".hpp", ".dart", ".scala", ".lua", ".pl", ".sh", ".bat", ".ps1"].includes(ext)) return "code";
  if ([".yml", ".yaml", ".toml", ".ini", ".env", ".conf", ".cfg", ".xml", ".htaccess"].includes(ext) || /(^|\/)(dockerfile|makefile|requirements\.txt|composer\.json|package\.json|\.htaccess|\.env(\.\w+)?)$/.test(lower)) return "config";
  if (ext === ".md" || ext === ".markdown") return "md";
  if (ext === ".svg") return "svg";
  if (ext === ".json" || ext === ".webmanifest") return "json";
  return "other";
}

/** Files that render HTML and can therefore define ids and use CSS classes. */
const MARKUP: ContextFile["kind"][] = ["html", "php", "template"];
const CODE: ContextFile["kind"][] = ["html", "css", "js", "php", "py", "code", "sql", "template"];

// ───────────────────────────── extractors ─────────────────────────────

interface Parsed {
  summary: string;
  headings: string[];
  defines: string[];
  uses: string[];
  refs: string[];
}

const all = (re: RegExp, s: string, group = 1) => [...s.matchAll(re)].map((m) => m[group]).filter(Boolean);

function resolveRef(from: string, ref: string): string | null {
  const r = ref.trim();
  if (!r || /^(https?:|mailto:|tel:|data:|javascript:|#|\/\/|\{|\$)/i.test(r)) return null;
  const clean = r.split(/[?#]/)[0];
  if (!clean) return null;
  const joined = clean.startsWith("/") ? clean.slice(1) : path.posix.join(path.posix.dirname(from), clean);
  return safeRelPath(joined);
}

function selectorSymbols(sel: string): string[] {
  return [...all(/\.(-?[_a-zA-Z][\w-]*)/g, sel).map((c) => `.${c}`), ...all(/#(-?[_a-zA-Z][\w-]*)/g, sel).map((i) => `#${i}`)];
}

function parseCss(src: string, file: string): Parsed {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = all(/([^{}]+)\{/g, css)
    .map((s) => s.trim())
    .filter((s) => !s.startsWith("@") && !/^(from|to|\d+%)/.test(s));
  const defines: string[] = [];
  const uses: string[] = [];
  for (const sel of selectors) {
    for (const sym of selectorSymbols(sel)) (sym.startsWith(".") ? defines : uses).push(sym);
  }
  const vars = all(/(--[\w-]+)\s*:/g, css);
  defines.push(...vars);
  uses.push(...all(/var\(\s*(--[\w-]+)/g, css));
  const refs = [
    ...all(/url\(\s*["']?([^"')]+)["']?\s*\)/g, css),
    ...all(/@import\s+["']([^"']+)["']/g, css),
  ]
    .map((r) => resolveRef(file, r))
    .filter((r): r is string => Boolean(r));
  const tokenList = uniq(vars).slice(0, 6).join(", ");
  return {
    summary: `${selectors.length} rules${tokenList ? ` · tokens: ${tokenList}` : ""}`,
    headings: [],
    defines: uniq(defines),
    uses: uniq(uses),
    refs: uniq(refs),
  };
}

function parseJs(src: string, file: string): Parsed {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const fns = uniq([
    ...all(/\bfunction\s+([A-Za-z_$][\w$]*)/g, code),
    ...all(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g, code),
    ...all(/\bclass\s+([A-Z][\w$]*)/g, code),
  ]);
  const uses: string[] = [];
  for (const sel of all(/querySelector(?:All)?\(\s*["'`]([^"'`]+)["'`]/g, code)) uses.push(...selectorSymbols(sel));
  uses.push(...all(/getElementById\(\s*["'`]([\w-]+)["'`]/g, code).map((i) => `#${i}`));
  uses.push(...all(/getElementsByClassName\(\s*["'`]([\w-]+)["'`]/g, code).map((c) => `.${c}`));
  for (const args of all(/classList\.(?:add|remove|toggle|contains|replace)\(([^)]*)\)/g, code)) {
    uses.push(...all(/["'`]([\w-]+)["'`]/g, args).map((c) => `.${c}`));
  }
  const refs = [
    ...all(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g, code),
    ...all(/\bimport\(\s*["'](\.{1,2}\/[^"']+)["']/g, code),
    ...all(/\brequire\(\s*["'](\.{1,2}\/[^"']+)["']/g, code),
    ...all(/\bfetch\(\s*["'](\.{0,2}\/?[\w./-]+\.(?:json|txt|csv|php|py))["']/g, code),
  ]
    .map((r) => resolveRef(file, r))
    .filter((r): r is string => Boolean(r));
  return {
    summary: fns.length ? `functions: ${fns.slice(0, 8).join(", ")}${fns.length > 8 ? ` +${fns.length - 8}` : ""}` : "script",
    headings: [],
    defines: fns.map((f) => `fn:${f}`),
    uses: uniq(uses),
    refs: uniq(refs),
  };
}

function parseHtml(src: string, file: string): Parsed {
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const title = stripTags(src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const headings = all(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi, src, 2)
    .map((h) => clip(stripTags(h), 50))
    .filter(Boolean)
    .slice(0, 12);
  const ids = all(/\sid\s*=\s*["']([^"'\s]+)["']/gi, src).map((i) => `#${i}`);
  const classes = all(/\sclass\s*=\s*["']([^"']+)["']/gi, src)
    .flatMap((c) => c.split(/\s+/))
    .filter((c) => /^-?[_a-zA-Z][\w-]*$/.test(c))
    .map((c) => `.${c}`);
  const handlers = all(/\son[a-z]+\s*=\s*["']\s*([A-Za-z_$][\w$]*)\s*\(/gi, src).map((f) => `fn:${f}`);
  const refs = all(/\s(?:href|src|data-src|poster|action|formaction)\s*=\s*["']([^"'<]+)["']/gi, src)
    .map((r) => resolveRef(file, r))
    .filter((r): r is string => Boolean(r));

  // Inline <style> and <script> blocks contribute like separate files would.
  const parsed: Parsed = { summary: "", headings, defines: ids, uses: [...classes, ...handlers], refs };
  for (const block of all(/<style[^>]*>([\s\S]*?)<\/style>/gi, src)) {
    const c = parseCss(block, file);
    parsed.defines.push(...c.defines);
    parsed.uses.push(...c.uses);
  }
  for (const block of all(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi, src)) {
    const j = parseJs(block, file);
    parsed.defines.push(...j.defines);
    parsed.uses.push(...j.uses);
  }
  parsed.defines = uniq(parsed.defines);
  parsed.uses = uniq(parsed.uses);
  parsed.refs = uniq(parsed.refs);
  const sections = headings.slice(0, 5).join(", ");
  parsed.summary = `${title || "page"}${sections ? ` · sections: ${sections}` : ""}`;
  return parsed;
}

function parseMd(src: string, file: string): Parsed {
  const headings = all(/^#{1,3}\s+(.+)$/gm, src)
    .map((h) => clip(h.trim(), 50))
    .slice(0, 12);
  const refs = all(/\]\(([^)\s]+)\)/g, src)
    .map((r) => resolveRef(file, r))
    .filter((r): r is string => Boolean(r));
  return {
    summary: headings.length ? headings.slice(0, 5).join(" · ") : clip(src.trim().split("\n")[0] ?? "", 80),
    headings,
    defines: [],
    uses: [],
    refs: uniq(refs),
  };
}

function parseOther(src: string, kind: ContextFile["kind"]): Parsed {
  let summary = "text";
  if (kind === "svg") {
    const vb = src.match(/viewBox\s*=\s*["']([^"']+)["']/)?.[1];
    summary = `SVG graphic${vb ? ` (viewBox ${vb})` : ""}`;
  } else if (kind === "json") {
    try {
      const v = JSON.parse(src);
      summary = Array.isArray(v) ? `JSON array of ${v.length}` : `JSON keys: ${Object.keys(v).slice(0, 8).join(", ")}`;
    } catch {
      summary = "JSON (invalid)";
    }
  }
  return { summary, headings: [], defines: [], uses: [], refs: [] };
}

const list = (label: string, items: string[], n = 6) =>
  items.length ? `${label}: ${items.slice(0, n).join(", ")}${items.length > n ? ` +${items.length - n}` : ""}` : "";
const joinSummary = (...parts: string[]) => parts.filter(Boolean).join(" · ");
const resolveAll = (file: string, refs: string[]) => refs.map((r) => resolveRef(file, r)).filter((r): r is string => Boolean(r));

/** PHP: functions, classes, include/require, plus everything the embedded HTML defines or uses. */
function parsePhp(src: string, file: string): Parsed {
  const html = parseHtml(src.replace(/<\?(?:php|=)?[\s\S]*?(?:\?>|$)/g, " "), file);
  const code = all(/<\?(?:php|=)?([\s\S]*?)(?:\?>|$)/g, src).join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])(\/\/|#).*$/gm, "$1");
  const fns = uniq(all(/\bfunction\s+&?\s*([A-Za-z_]\w*)\s*\(/g, code));
  const classes = uniq(all(/\b(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/g, code));
  const uses = uniq([...all(/\bnew\s+\\?([A-Z]\w*)/g, code), ...all(/\b([A-Z]\w*)::/g, code)])
    .filter((c) => !["self", "static", "parent", "PDO"].includes(c))
    .map((c) => `cls:${c}`);
  const includes = [
    ...all(/\b(?:include|require)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?["']\/?([^"']+\.(?:php|phtml|inc|html))["']/g, code),
    ...all(/header\(\s*["']Location:\s*([^"'?#]+\.php)/gi, code),
  ];
  return {
    summary: joinSummary(html.summary !== "page" ? html.summary : "", list("functions", fns), list("classes", classes)) || "PHP script",
    headings: html.headings,
    defines: uniq([...html.defines, ...fns.map((f) => `fn:${f}`), ...classes.map((c) => `cls:${c}`)]),
    uses: uniq([...html.uses, ...uses]),
    refs: uniq([...html.refs, ...resolveAll(file, includes)]),
  };
}

/**
 * Python: functions, classes, Flask/FastAPI routes, project-local imports and
 * templates. Absolute imports are stored as optional refs ("?path") because
 * most of them are stdlib or pip packages, not missing files.
 */
function parsePython(src: string, file: string): Parsed {
  const code = src.replace(/("""|''')[\s\S]*?\1/g, "").replace(/#.*$/gm, "");
  const fns = uniq(all(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm, code));
  const classes = uniq(all(/^\s*class\s+([A-Za-z_]\w*)/gm, code));
  const routes = uniq(all(/@\w+\.(?:route|get|post|put|delete|patch)\(\s*["']([^"']+)["']/g, code));
  const dir = path.posix.dirname(file);
  const refs: string[] = [];
  for (const m of code.matchAll(/^\s*from\s+(\.+)([\w.]*)\s+import\s+([\w, ]+)/gm)) {
    let base = dir;
    for (let i = 1; i < m[1].length; i++) base = path.posix.dirname(base);
    const mod = m[2] ? path.posix.join(base, ...m[2].split(".")) : base;
    if (m[2]) refs.push(`${mod}.py`);
    else for (const name of m[3].split(",").map((s) => s.trim()).filter(Boolean)) refs.push(`?${path.posix.join(mod, name)}.py`);
  }
  for (const mod of [...all(/^\s*from\s+([A-Za-z_][\w.]*)\s+import/gm, code), ...all(/^\s*import\s+([A-Za-z_][\w.]*)/gm, code)]) {
    const p = mod.split(".").join("/");
    refs.push(`?${p}.py`, `?${p}/__init__.py`, `?${path.posix.join(dir, p)}.py`);
  }
  const templates = all(/render_template(?:_string)?\(\s*["']([^"']+)["']/g, code).map((t) => `?templates/${t}`);
  const statics = all(/url_for\(\s*["']static["']\s*,\s*filename\s*=\s*["']([^"']+)["']/g, code).map((s) => `?static/${s}`);
  return {
    summary: joinSummary(list("routes", routes), list("functions", fns), list("classes", classes)) || "Python module",
    headings: [],
    defines: [...fns.map((f) => `fn:${f}`), ...classes.map((c) => `cls:${c}`)],
    uses: uniq(all(/\b([A-Z]\w+)\(/g, code).filter((c) => !classes.includes(c)).map((c) => `cls:${c}`)),
    refs: uniq([...refs.map((r) => (r.startsWith("?") ? `?${safeRelPath(r.slice(1)) ?? ""}` : (safeRelPath(r) ?? ""))).filter((r) => r && r !== "?"), ...templates, ...statics]),
  };
}

function parseSql(src: string): Parsed {
  const tables = uniq(all(/create\s+table\s+(?:if\s+not\s+exists\s+)?[`"[]?(\w+)/gi, src));
  return { summary: list("tables", tables, 10) || "SQL", headings: [], defines: tables.map((t) => `table:${t}`), uses: [], refs: [] };
}

/** Go, Java, C#, Ruby, Rust, shell…: a light pass for named functions and types. */
function parseCode(src: string): Parsed {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const types = uniq(all(/\b(?:class|interface|struct|enum|trait|record|module)\s+([A-Za-z_]\w*)/g, code));
  const fns = uniq(all(/\b(?:func|def|fn|function|sub)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/g, code));
  return {
    summary: joinSummary(list("types", types), list("functions", fns)) || `${src.split("\n").length} lines`,
    headings: [],
    defines: [...fns.map((f) => `fn:${f}`), ...types.map((c) => `cls:${c}`)],
    uses: [],
    refs: [],
  };
}

function parseConfig(src: string, file: string): Parsed {
  const lower = file.toLowerCase();
  let summary = `${src.split("\n").filter((l) => l.trim()).length} lines`;
  if (lower.endsWith("requirements.txt")) summary = list("packages", src.split("\n").map((l) => l.split(/[=<>~ ]/)[0].trim()).filter(Boolean), 10);
  else if (/\.env/.test(lower)) summary = list("keys", all(/^\s*([A-Z_][A-Z0-9_]*)\s*=/gm, src), 10); // keys only, never values
  else if (/\.(ya?ml|toml|ini)$/.test(lower)) summary = list("keys", uniq(all(/^\[?([A-Za-z_][\w.-]*)\]?\s*[:=\]]/gm, src)), 10);
  return { summary, headings: [], defines: [], uses: [], refs: [] };
}

function parse(file: string, src: string): Parsed {
  const kind = kindOf(file);
  if (kind === "html" || kind === "template") return parseHtml(src, file);
  if (kind === "css") return parseCss(src, file);
  if (kind === "js") return parseJs(src, file);
  if (kind === "php") return parsePhp(src, file);
  if (kind === "py") return parsePython(src, file);
  if (kind === "sql") return parseSql(src);
  if (kind === "code") return parseCode(src);
  if (kind === "config") return parseConfig(src, file);
  if (kind === "md") return parseMd(src, file);
  return parseOther(src, kind);
}

/** Optional refs ("?path") only count when the file actually exists. */
const refTarget = (r: string) => (r.startsWith("?") ? r.slice(1) : r);

// ───────────────────────────── build & sync ─────────────────────────────

function load(projectId: string): Graph {
  const cached = graphs.get(projectId);
  if (cached) return cached;
  let g: Graph = { version: VERSION, files: {}, all: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(graphPath(projectId), "utf8")) as Graph;
    if (raw.version === VERSION) g = raw;
  } catch {
    /* not built yet */
  }
  graphs.set(projectId, g);
  return g;
}

/**
 * Brings the graph in line with the workspace. Unchanged files (same mtime and
 * size) are skipped without being read; touched files are re-hashed and only
 * re-parsed when their content actually changed.
 */
export function syncGraph(projectId: string): { graph: Graph; changed: string[] } {
  const g = load(projectId);
  const root = projectDir(projectId);
  const files = listFiles(projectId);
  const changed: string[] = [];

  for (const rel of files) {
    if (!isText(rel)) continue;
    const abs = path.join(root, rel);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    const prev = g.files[rel];
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) continue;
    const src = fs.readFileSync(abs, "utf8");
    const hash = crypto.createHash("sha1").update(src).digest("hex");
    if (prev && prev.hash === hash) {
      prev.mtimeMs = st.mtimeMs;
      prev.size = st.size;
      continue;
    }
    const p = parse(rel, src);
    g.files[rel] = { path: rel, kind: kindOf(rel), tokens: estTokens(src), hash, mtimeMs: st.mtimeMs, size: st.size, ...p };
    changed.push(rel);
  }
  for (const rel of Object.keys(g.files)) {
    if (!files.includes(rel)) {
      delete g.files[rel];
      changed.push(rel);
    }
  }
  const allChanged = g.all.length !== files.length || g.all.some((f, i) => f !== files[i]);
  g.all = files;

  if (changed.length || allChanged) {
    fs.mkdirSync(path.dirname(graphPath(projectId)), { recursive: true });
    fs.writeFileSync(graphPath(projectId), JSON.stringify(g));
  }
  return { graph: g, changed };
}

export function dropGraph(projectId: string) {
  graphs.delete(projectId);
  fs.rmSync(graphPath(projectId), { force: true });
}

// ───────────────────────────── edges & queries ─────────────────────────────

export function links(g: Graph): ContextLink[] {
  const definers = new Map<string, string[]>();
  for (const f of Object.values(g.files)) {
    for (const d of f.defines) definers.set(d, [...(definers.get(d) ?? []), f.path]);
  }
  const out = new Map<string, ContextLink>();
  const add = (from: string, to: string, rel: ContextLink["rel"], via?: string) => {
    const key = `${from}|${to}|${rel}`;
    const e = out.get(key) ?? { from, to, rel, weight: 0, via: [] };
    e.weight += 1;
    if (via && e.via.length < 6) e.via.push(via);
    out.set(key, e);
  };
  for (const f of Object.values(g.files)) {
    for (const r of f.refs.map(refTarget)) if (g.files[r] || g.all.includes(r)) add(f.path, r, "links");
    for (const u of f.uses) for (const d of definers.get(u) ?? []) if (d !== f.path) add(f.path, d, "uses", u);
  }
  return [...out.values()];
}

/**
 * One line per file, grouped under folder headers so paths are not repeated:
 * the cheapest possible overview of the whole project.
 */
export function projectMap(g: Graph, maxLines = 60, exclude?: Set<string>): string {
  const files = Object.values(g.files)
    .filter((f) => !exclude?.has(f.path))
    .sort((a, b) => {
      const da = path.posix.dirname(a.path);
      const db = path.posix.dirname(b.path);
      // Root files first, then one block per folder.
      return (da === "." ? "" : da).localeCompare(db === "." ? "" : db) || a.path.localeCompare(b.path);
    });
  const lines: string[] = [];
  let dir = ".";
  for (const f of files.slice(0, maxLines)) {
    const d = path.posix.dirname(f.path);
    if (d !== dir && d !== ".") lines.push(`${d}/`);
    dir = d;
    const real = f.refs.filter((r) => !r.startsWith("?") || g.all.includes(r.slice(1))).map(refTarget);
    const shown = real.slice(0, 5).map((r) => (path.posix.dirname(r) === d ? path.posix.basename(r) : r));
    const refs = shown.length ? ` → ${shown.join(", ")}` : "";
    lines.push(`${d === "." ? "" : "  "}${path.posix.basename(f.path)} [${f.kind}, ~${f.tokens} tok] ${f.summary}${refs}`);
  }
  const binaries = g.all.filter((f) => !g.files[f] && !exclude?.has(f));
  if (binaries.length) lines.push(`(binary assets: ${binaries.slice(0, 10).join(", ")})`);
  if (files.length > maxLines) lines.push(`(+${files.length - maxLines} more files)`);
  return lines.join("\n");
}

/** Files that depend on any of the given files: they link to them or use a symbol they define. */
export function dependentsOf(projectId: string, files: string[]): string[] {
  const { graph: g } = syncGraph(projectId);
  const set = new Set(files);
  return uniq(links(g).filter((e) => set.has(e.to) && !set.has(e.from)).map((e) => e.from));
}

// ───────────────────────────── excerpts ─────────────────────────────

/** Neighbour files above this size are cut down to the parts that matter for the task. */
const EXCERPT_MIN_TOKENS = 1200;

/** Splits CSS into verbatim top-level blocks (rules, @media groups…), keeping exact text for edits. */
function cssBlocks(css: string): { head: string; text: string }[] {
  const out: { head: string; text: string }[] = [];
  let depth = 0;
  let start = 0;
  let headEnd = -1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) headEnd = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        out.push({ head: css.slice(start, headEnd).replace(/\/\*[\s\S]*?\*\//g, "").trim(), text: css.slice(start, i + 1).trim() });
        start = i + 1;
      }
    }
  }
  return out;
}

function excerptCss(src: string, relevant: Set<string>): string | null {
  const blocks = cssBlocks(src);
  if (blocks.length < 4) return null;
  const hits = (selectorText: string) => selectorSymbols(selectorText).some((s) => relevant.has(s));
  const kept = blocks.filter((b) => {
    if (b.head.startsWith("@media") || b.head.startsWith("@supports") || b.head.startsWith("@container") || b.head.startsWith("@layer")) {
      return all(/([^{}]+)\{/g, b.text.slice(b.text.indexOf("{") + 1)).some(hits);
    }
    if (b.head.startsWith("@")) return false; // @keyframes, @font-face… rarely needed for an edit
    // Base rules (:root tokens, html/body, element selectors) always stay; class/id rules only when used.
    return selectorSymbols(b.head).length === 0 || hits(b.head);
  });
  if (!kept.length || kept.length === blocks.length) return null;
  return `/* … ${blocks.length - kept.length} of ${blocks.length} blocks omitted (not used by this task) … */\n${kept.map((b) => b.text).join("\n\n")}`;
}

function excerptMd(src: string, words: string[], relevant: Set<string>): string | null {
  const parts = src.split(/(?=^#{1,3}\s)/m);
  if (parts.length < 3) return null;
  const terms = [...words, ...[...relevant].map((s) => s.replace(/^(fn:|cls:|[.#])/, "").toLowerCase()).filter((s) => s.length >= 3)];
  const [intro, ...sections] = parts;
  const kept = sections.filter((s) => {
    const low = s.toLowerCase();
    return terms.some((t) => low.includes(t));
  });
  if (kept.length === sections.length) return null;
  const skipped = sections.filter((s) => !kept.includes(s)).map((s) => s.split("\n")[0].replace(/^#+\s*/, "").trim());
  return `${intro.trim()}\n\n${kept.map((s) => s.trim()).join("\n\n")}\n\n<!-- other sections, not included: ${skipped.join(" · ")} -->`;
}

export interface ContextSelection {
  text: string;
  included: string[];
  /** Files sent only as an excerpt; they must be changed with edits, never rewritten. */
  excerpted: string[];
  tokens: number;
  fullTokens: number;
}

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "file", "files", "make", "create", "page", "use", "all", "add"]);

/**
 * Picks what an agent should see for a task:
 *  1. seeds (files the task must touch or builds on) score highest and are always included in full,
 *  2. their graph neighbours (1 and 2 hops) come next,
 *  3. keyword hits on paths, headings and symbols break ties,
 * then files are packed in full until the token budget runs out. Everything
 * else is still visible through the one-line project map.
 */
export function selectContext(
  projectId: string,
  opts: { seeds: string[]; text: string; roleId: RoleId; budget: number; boost?: string[] },
): ContextSelection {
  const { graph: g } = syncGraph(projectId);
  const fullTokens = Object.values(g.files).reduce((n, f) => n + f.tokens, 0);
  if (!Object.keys(g.files).length) return { text: "", included: [], excerpted: [], tokens: 0, fullTokens };

  const score = new Map<string, number>();
  const bump = (p: string, n: number) => g.files[p] && score.set(p, (score.get(p) ?? 0) + n);
  const seeds = uniq(opts.seeds).filter((s) => g.files[s]);
  for (const s of seeds) bump(s, 100);
  // Impact analysis: files that depend on what the task touches get pulled closer.
  for (const b of opts.boost ?? []) if (!seeds.includes(b)) bump(b, 20);

  const adj = new Map<string, Map<string, number>>();
  for (const e of links(g)) {
    const w = e.rel === "links" ? 3 : Math.min(3, 1 + e.weight / 3);
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      const m = adj.get(a) ?? new Map<string, number>();
      m.set(b, (m.get(b) ?? 0) + w);
      adj.set(a, m);
    }
  }
  const hop1 = new Set<string>();
  for (const s of seeds) for (const [n, w] of adj.get(s) ?? []) (bump(n, 6 * w), hop1.add(n));
  for (const h of hop1) for (const [n, w] of adj.get(h) ?? []) if (!seeds.includes(n)) bump(n, w);

  const words = uniq(
    opts.text
      .toLowerCase()
      .split(/[^\p{L}\p{N}-]+/u)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
  for (const f of Object.values(g.files)) {
    const hay = `${f.path} ${f.headings.join(" ")} ${f.defines.join(" ")} ${f.summary}`.toLowerCase();
    const hits = words.filter((w) => hay.includes(w)).length;
    if (hits) bump(f.path, Math.min(4, hits));
  }

  const code = ["frontend-developer", "backend-developer", "qa-tester"].includes(opts.roleId);
  for (const f of Object.values(g.files)) {
    if (code && CODE.includes(f.kind)) bump(f.path, 1);
    if (!code && f.kind === "md") bump(f.path, 1);
  }

  // Symbols the task's own files define or use: what an excerpt of a neighbour must keep.
  const relevant = new Set(seeds.flatMap((s) => [...g.files[s].defines, ...g.files[s].uses]));
  const root = projectDir(projectId);
  const read = (p: string) => {
    try {
      return fs.readFileSync(path.join(root, p), "utf8");
    } catch {
      return null;
    }
  };

  const map = projectMap(g);
  let used = estTokens(map);
  const included: string[] = [];
  const excerpted: string[] = [];
  const bodies: string[] = [];
  const ranked = [...score.entries()].filter(([, s]) => s >= 2).sort((a, b) => b[1] - a[1] || g.files[a[0]].tokens - g.files[b[0]].tokens);
  for (const [p, s] of ranked) {
    const f = g.files[p];
    const src = read(p);
    if (src === null) continue;
    let body = src;
    let cut = false;
    // Seeds are always whole (the task edits them). Big neighbours are trimmed to what matters.
    if (s < 100 && f.tokens > EXCERPT_MIN_TOKENS && (f.kind === "css" || f.kind === "md")) {
      const ex = f.kind === "css" ? excerptCss(src, relevant) : excerptMd(src, words, relevant);
      if (ex && estTokens(ex) < f.tokens * 0.7) {
        body = ex;
        cut = true;
      }
    }
    const cost = estTokens(body);
    if (s < 100 && used + cost > opts.budget) continue;
    included.push(p);
    if (cut) excerpted.push(p);
    used += cost;
    bodies.push(
      cut
        ? `=== ${p} (EXCERPT: only the parts relevant to this task. Change it with "edits" only, never rewrite it in "files"; ask for it in "needFiles" if you need all of it) ===\n${body}`
        : `=== ${p} ===\n${body}`,
    );
  }

  // The map only lists what is NOT sent, so nothing is paid for twice.
  const rest = projectMap(g, 60, new Set(included));
  const text = `${rest ? `OTHER PROJECT FILES (not needed for this task; one line each, from the context graph):\n${rest}\n\n` : ""}CONTENT OF THE FILES RELEVANT TO THIS TASK:\n${bodies.join("\n\n") || "(none)"}`;
  return { text, included, excerpted, tokens: estTokens(text), fullTokens };
}

/** Free, deterministic quality checks over the graph. */
export function lintGraph(projectId: string, onlyFiles?: string[]): string[] {
  const { graph: g } = syncGraph(projectId);
  const files = Object.values(g.files);
  const defined = new Set(files.flatMap((f) => f.defines));
  const hasCss = files.some((f) => f.kind === "css" || (MARKUP.includes(f.kind) && f.defines.some((d) => d.startsWith("."))));
  const htmlIds = new Set(files.filter((f) => MARKUP.includes(f.kind)).flatMap((f) => f.defines.filter((d) => d.startsWith("#"))));
  const issues: string[] = [];

  for (const f of files) {
    if (onlyFiles && !onlyFiles.includes(f.path)) continue;
    // Optional refs (Python absolute imports, Flask templates by guess) never count as missing.
    const missing = f.refs.filter((r) => !r.startsWith("?") && !g.all.includes(r));
    if (missing.length) issues.push(`${f.path} references missing file(s): ${missing.slice(0, 6).join(", ")}`);

    if (MARKUP.includes(f.kind) && hasCss) {
      const unstyled = f.uses.filter((u) => u.startsWith(".") && !defined.has(u));
      if (unstyled.length > 2) {
        issues.push(`${f.path} uses ${unstyled.length} class(es) with no CSS rule: ${unstyled.slice(0, 8).join(" ")}`);
      }
    }
    if (f.kind === "js" || MARKUP.includes(f.kind)) {
      const ghostIds = f.uses.filter((u) => u.startsWith("#") && !htmlIds.has(u));
      if (ghostIds.length && htmlIds.size) {
        issues.push(`${f.path} targets id(s) that no HTML element has: ${ghostIds.slice(0, 6).join(" ")}`);
      }
      const ghostFns = f.uses.filter((u) => u.startsWith("fn:") && !defined.has(u));
      if (ghostFns.length) issues.push(`${f.path} calls undefined function(s): ${ghostFns.map((x) => x.slice(3)).join(", ")}`);
    }
    const ghostVars = f.uses.filter((u) => u.startsWith("--") && !defined.has(u));
    if (ghostVars.length) issues.push(`${f.path} uses undefined CSS variable(s): ${ghostVars.slice(0, 6).join(" ")}`);
    if (f.kind === "json" && f.summary === "JSON (invalid)") issues.push(`${f.path} is not valid JSON`);
  }
  return issues;
}

export function contextReport(projectId: string) {
  const { graph: g } = syncGraph(projectId);
  const files = Object.values(g.files).map(({ hash: _h, mtimeMs: _m, size: _s, ...rest }) => rest);
  return {
    files,
    links: links(g),
    binaries: g.all.filter((f) => !g.files[f]),
    map: projectMap(g, 200),
    issues: lintGraph(projectId),
    symbols: new Set(files.flatMap((f) => f.defines)).size,
  };
}
