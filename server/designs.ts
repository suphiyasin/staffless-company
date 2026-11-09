import fs from "node:fs";
import path from "node:path";
import { config, ROOT } from "./config.ts";
import type { DesignMeta } from "./types.ts";

/**
 * The design library: ready-made visual styles the owner can pick for a project.
 *
 * A design is a folder with two plain files every model understands:
 *   DESIGN.md   frontmatter (name, tags, best_for, fonts) + principles, layout,
 *               typography, colour, components, do/don't
 *   tokens.css  a fixed set of CSS variables (--color-primary, --font-heading…)
 *
 * Starter designs live in ./designs (versioned, community PRs welcome). Your own
 * go in DATA_DIR/designs. When a project uses a design, both files are copied
 * into its design/ folder, so the context graph treats them like any other file.
 */

export const REQUIRED_TOKENS = [
  "--color-bg", "--color-surface", "--color-text", "--color-muted", "--color-border",
  "--color-primary", "--color-primary-contrast", "--color-accent",
  "--font-heading", "--font-body", "--heading-weight", "--heading-transform", "--heading-tracking",
  "--radius", "--radius-lg", "--border-width", "--shadow", "--space", "--max-width",
];

interface Design {
  meta: DesignMeta;
  markdown: string;
  tokens: string;
}

let cache: Map<string, Design> | null = null;
const dirs = () => [
  { dir: path.join(ROOT, "designs"), source: "library" as const },
  { dir: path.join(config.paths.data, "designs"), source: "custom" as const },
];

function frontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out: Record<string, string> = {};
  for (const line of m?.[1].split(/\r?\n/) ?? []) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const list = (v = "") =>
  v
    .replace(/^\[|\]$/g, "")
    .split(/,\s*(?=[^\d\s])/) // "Oswald:500,700, Inter:400" → ["Oswald:500,700", "Inter:400"]
    .map((x) => x.trim())
    .filter(Boolean);

const tokenValue = (css: string, name: string) => css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1].trim() ?? "";

const missingTokens = (tokens: string) => REQUIRED_TOKENS.filter((t) => !new RegExp(`${t}\\s*:`).test(tokens));

function load(dir: string, source: DesignMeta["source"], id: string): Design | null {
  try {
    const d = read(path.join(dir, id), id, source);
    const missing = missingTokens(d.tokens);
    if (missing.length) {
      console.warn(`  🎨 Design "${id}" skipped: tokens.css is missing ${missing.join(", ")}`);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

/** Reads DESIGN.md + tokens.css from one folder (throws if either is missing). */
function read(folder: string, id: string, source: DesignMeta["source"]): Design {
  const markdown = fs.readFileSync(path.join(folder, "DESIGN.md"), "utf8");
  const tokens = fs.readFileSync(path.join(folder, "tokens.css"), "utf8");
  const fm = frontmatter(markdown);
  return {
    markdown,
    tokens,
    meta: {
      id,
      name: fm.name || id,
      description: fm.description || "",
      tags: list(fm.tags),
      bestFor: list(fm.best_for),
      fonts: list(fm.fonts),
      colors: {
        bg: tokenValue(tokens, "--color-bg"),
        surface: tokenValue(tokens, "--color-surface"),
        text: tokenValue(tokens, "--color-text"),
        primary: tokenValue(tokens, "--color-primary"),
        accent: tokenValue(tokens, "--color-accent"),
      },
      source,
    },
  };
}

function all(): Map<string, Design> {
  if (cache) return cache;
  cache = new Map();
  for (const { dir, source } of dirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const id of fs.readdirSync(dir).sort()) {
      if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(id)) continue;
      const d = load(dir, source, id);
      if (d) cache.set(id, d); // custom designs with the same id override the library
    }
  }
  return cache;
}

export const reloadDesigns = () => {
  cache = null;
  return all().size;
};
export const listDesigns = (): DesignMeta[] => [...all().values()].map((d) => d.meta);
export const getDesign = (id: string) => all().get(id);

export function fontsHref(fonts: string[]): string {
  if (!fonts.length) return "";
  const fam = fonts.map((f) => {
    const [name, weights] = f.split(":");
    return `family=${encodeURIComponent(name.trim()).replace(/%20/g, "+")}${weights ? `:wght@${weights.split(",").map((w) => w.trim()).join(";")}` : ""}`;
  });
  return `https://fonts.googleapis.com/css2?${fam.join("&")}&display=swap`;
}

/** Copies the chosen design into the project so every agent (and the context graph) sees it. */
export function copyDesignInto(projectDir: string, id: string): string[] {
  const d = getDesign(id);
  if (!d) throw new Error(`Unknown design: ${id}`);
  fs.mkdirSync(path.join(projectDir, "design"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "design", "DESIGN.md"), d.markdown);
  fs.writeFileSync(path.join(projectDir, "design", "tokens.css"), d.tokens);
  return ["design/DESIGN.md", "design/tokens.css"];
}

/** The same sample page rendered with any design's tokens: what the gallery shows. */
export function previewHtml(id: string): string | null {
  const d = getDesign(id);
  return d ? renderPreview(d) : null;
}

// ───────────────────────────── designs written by the team ─────────────────────────────

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50) || "project-style";

/** The project's own design (design/DESIGN.md + design/tokens.css), if both exist. */
export function projectDesign(projectDir: string): Design | null {
  try {
    const d = read(path.join(projectDir, "design"), "", "custom");
    const fm = frontmatter(d.markdown);
    d.meta.id = slugify(fm.id || fm.name || "project-style");
    return d;
  } catch {
    return null;
  }
}

/** Problems that keep the project's design files from being a valid library design. */
export function validateProjectDesign(projectDir: string): string[] {
  const folder = path.join(projectDir, "design");
  const md = path.join(folder, "DESIGN.md");
  const css = path.join(folder, "tokens.css");
  if (!fs.existsSync(md) && !fs.existsSync(css)) return [];
  const problems: string[] = [];
  if (!fs.existsSync(md)) problems.push("design/DESIGN.md is missing (the design system needs both DESIGN.md and tokens.css)");
  if (!fs.existsSync(css)) problems.push("design/tokens.css is missing (the design system needs both DESIGN.md and tokens.css)");
  if (problems.length) return problems;
  const fm = frontmatter(fs.readFileSync(md, "utf8"));
  const needFm = ["name", "description", "tags", "fonts"].filter((k) => !fm[k]);
  if (needFm.length) problems.push(`design/DESIGN.md: the frontmatter at the top (between --- lines) needs ${needFm.join(", ")}`);
  const missing = missingTokens(fs.readFileSync(css, "utf8"));
  if (missing.length) problems.push(`design/tokens.css must define every shared variable; missing: ${missing.join(", ")}`);
  return problems;
}

/** Saves the project's design to DATA_DIR/designs so it shows up in the library. */
export function saveProjectDesign(projectDir: string, wantedId?: string): DesignMeta {
  const problems = validateProjectDesign(projectDir);
  const d = projectDesign(projectDir);
  if (!d) throw new Error("This project has no design/DESIGN.md + design/tokens.css to save.");
  if (problems.length) throw new Error(problems.join("; "));
  let id = slugify(wantedId || d.meta.id);
  const taken = (x: string) => all().has(x);
  for (let n = 2; taken(id); n++) id = `${slugify(wantedId || d.meta.id).slice(0, 46)}-${n}`;
  const dest = path.join(config.paths.data, "designs", id);
  fs.mkdirSync(dest, { recursive: true });
  // Rewrite the frontmatter id so the saved copy matches its folder.
  const markdown = d.markdown.replace(
    /^---\r?\n([\s\S]*?)\r?\n---/,
    (_m, body: string) => `---\nid: ${id}\n${body.split(/\r?\n/).filter((l) => !/^id\s*:/.test(l)).join("\n")}\n---`,
  );
  fs.writeFileSync(path.join(dest, "DESIGN.md"), markdown);
  fs.writeFileSync(path.join(dest, "tokens.css"), d.tokens);
  reloadDesigns();
  const saved = getDesign(id);
  if (!saved) throw new Error("Saved, but the design could not be loaded back.");
  return saved.meta;
}

/** Preview of the project's own design on the shared sample page. */
export function projectPreviewHtml(projectDir: string): string | null {
  const d = projectDesign(projectDir);
  return d && !missingTokens(d.tokens).length ? renderPreview(d) : null;
}

function renderPreview(d: Design): string {
  const href = fontsHref(d.meta.fonts);
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${href ? `<link rel="stylesheet" href="${href}">` : ""}
<style>${d.tokens}
*{box-sizing:border-box}body{margin:0;background:var(--color-bg);color:var(--color-text);font:16px/1.6 var(--font-body)}
h1,h2,h3{font-family:var(--font-heading);font-weight:var(--heading-weight);text-transform:var(--heading-transform);letter-spacing:var(--heading-tracking);margin:0}
.wrap{max-width:var(--max-width);margin:0 auto;padding:0 calc(var(--space)*4)}
nav{display:flex;justify-content:space-between;align-items:center;padding:calc(var(--space)*2.5) 0;border-bottom:var(--border-width) solid var(--color-border)}
nav b{font-family:var(--font-heading);font-size:20px;text-transform:var(--heading-transform)}nav span{color:var(--color-muted);margin-left:24px;font-size:14px}
.hero{padding:calc(var(--space)*12) 0 calc(var(--space)*10)}.hero h1{font-size:64px;line-height:1.05;max-width:12ch}
.hero p{color:var(--color-muted);font-size:19px;max-width:46ch;margin:20px 0 32px}
.btn{display:inline-block;padding:14px 26px;border-radius:var(--radius);background:var(--color-primary);color:var(--color-primary-contrast);font-weight:700;text-decoration:none;border:var(--border-width) solid var(--color-primary);box-shadow:var(--shadow);margin-right:12px}
.btn.alt{background:transparent;color:var(--color-text);border-color:var(--color-border);box-shadow:none}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding-bottom:calc(var(--space)*10)}
.card{background:var(--color-surface);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-lg);padding:28px;box-shadow:var(--shadow)}
.card i{display:block;width:40px;height:40px;border-radius:var(--radius);background:var(--color-accent);margin-bottom:18px}
.card h3{font-size:22px;margin-bottom:8px}.card p{color:var(--color-muted);margin:0}
.band{background:var(--color-surface);border-top:var(--border-width) solid var(--color-border);padding:calc(var(--space)*8) 0}
.band .wrap{display:flex;gap:16px;align-items:center}.band h2{font-size:34px;flex:1}
input{padding:14px;border-radius:var(--radius);border:var(--border-width) solid var(--color-border);background:var(--color-bg);color:var(--color-text);font:inherit;width:260px}
</style></head><body>
<div class="wrap"><nav><b>${esc(d.meta.name)}</b><div><span>Work</span><span>About</span><span>Contact</span></div></nav>
<section class="hero"><h1>Bold ideas, beautifully made</h1><p>${esc(d.meta.description)}</p><a class="btn" href="#">Get started</a><a class="btn alt" href="#">Learn more</a></section>
<section class="grid"><div class="card"><i></i><h3>Thoughtful</h3><p>Every detail follows one clear system.</p></div><div class="card"><i></i><h3>Consistent</h3><p>Tokens keep colours and type in line.</p></div><div class="card"><i></i><h3>Yours</h3><p>The team adapts it to your content.</p></div></section></div>
<section class="band"><div class="wrap"><h2>Stay in the loop</h2><input placeholder="you@example.com"><a class="btn" href="#">Subscribe</a></div></section>
</body></html>`;
}
