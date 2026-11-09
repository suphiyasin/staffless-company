import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import type { Project, VisualReport, VisualShot } from "../types.ts";
import { phpUrl } from "./checks.ts";
import { projectDir } from "./workspace.ts";

/**
 * The browser check: QA opens the generated site in a real (headless) browser
 * instead of guessing from the code. It uses the Chrome or Edge already
 * installed on this machine through playwright-core (no browser download).
 *
 * Per page it records console errors, script errors, missing local files,
 * broken images, horizontal overflow on a phone screen and empty pages, and it
 * takes desktop and mobile screenshots of the entry page for the reviewers.
 *
 * Static sites are opened through the sandboxed /preview route (opaque origin,
 * so the generated code can't call this app's API). PHP projects are only
 * checked when you have started them yourself with "Run with PHP".
 */

const isWin = process.platform === "win32";
const CANDIDATES = isWin
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
    ]
  : process.platform === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge", "/snap/bin/chromium"];

let exe: string | null = null;

export function detectBrowser() {
  exe = config.browserPath === "off" ? null : (config.browserPath && fs.existsSync(config.browserPath) ? config.browserPath : null) ?? CANDIDATES.find((p) => p && fs.existsSync(p)) ?? null;
}
export const browserAvailable = () => Boolean(exe);

const shotsDir = (projectId: string) => path.join(config.paths.data, "shots", projectId);
export const removeShots = (projectId: string) => fs.rmSync(shotsDir(projectId), { recursive: true, force: true });
export const shotPath = (projectId: string, file: string) => (/^[\w.-]+\.jpg$/.test(file) ? path.join(shotsDir(projectId), file) : null);

const VIEWPORTS = {
  desktop: { width: 1280, height: 800, maxHeight: 2000 },
  mobile: { width: 390, height: 844, maxHeight: 2400 },
} as const;

/** Entry page first, then up to three more top-level pages. */
function pagesOf(p: Project): string[] {
  const top = p.files.filter((f) => !f.includes("/") && /\.(html?|php)$/i.test(f));
  const entry = ["index.html", "index.php", "index.htm"].find((f) => top.includes(f)) ?? top[0];
  if (!entry) return [];
  return [entry, ...top.filter((f) => f !== entry).sort().slice(0, 3)];
}

type Page = import("playwright-core").Page;

interface Target {
  /** URL prefix that maps to the project folder. */
  root: string;
  dir: string;
}

async function inspect(page: Page, url: string, label: string, viewport: keyof typeof VIEWPORTS, target: Target, issues: Set<string>) {
  const problems: string[] = [];
  const local = (u: string) => (u.startsWith(target.root) ? decodeURIComponent(u.slice(target.root.length).split(/[?#]/)[0]) || "/" : null);
  const missing = (u: string) => {
    const rel = local(u);
    if (rel === null) return;
    const exists = fs.existsSync(path.join(target.dir, rel));
    problems.push(exists ? `could not load ${rel}` : `missing file: ${rel}`);
  };
  const onConsole = (m: import("playwright-core").ConsoleMessage) => {
    // Failed loads are reported (with the file name) by the request handlers below.
    if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) problems.push(`console error: ${m.text().slice(0, 200)}`);
  };
  const onError = (e: Error) => problems.push(`script error: ${e.message.slice(0, 200)}`);
  const onResponse = (r: import("playwright-core").Response) => {
    if (r.status() >= 400) missing(r.url());
  };
  // In the sandboxed preview a 404 usually surfaces as a blocked request (ERR_BLOCKED_BY_ORB), not a response.
  const onFailed = (r: import("playwright-core").Request) => missing(r.url());
  page.on("console", onConsole);
  page.on("pageerror", onError);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  try {
    const res = await page.goto(url, { waitUntil: "load", timeout: 20_000 });
    if (res && res.status() >= 400) problems.push(`page returned HTTP ${res.status()}`);
    await page.waitForTimeout(700); // fonts, late scripts
    const facts = await page.evaluate(() => {
      // clientWidth is the layout viewport; on a phone innerWidth grows with content that is too wide.
      const w = document.documentElement.clientWidth;
      const brokenImages = [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src") ?? "");
      const wide: string[] = [];
      if (document.documentElement.scrollWidth > w + 2) {
        for (const el of document.body.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.right > w + 2 && r.width > 0 && getComputedStyle(el).position !== "fixed") {
            wide.push(el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + (el.classList[0] ? `.${el.classList[0]}` : ""));
            if (wide.length >= 3) break;
          }
        }
      }
      const text = (document.body?.innerText ?? "").trim().length;
      const media = document.querySelectorAll("img,svg,canvas,video").length;
      return { brokenImages, scrollWidth: document.documentElement.scrollWidth, width: w, wide, empty: text < 20 && media === 0 };
    });
    for (const src of facts.brokenImages) if (!problems.includes(`missing file: ${src}`)) problems.push(`broken image: ${src}`);
    if (viewport === "mobile" && facts.scrollWidth > facts.width + 2) {
      problems.push(`scrolls sideways on a ${facts.width}px phone (page is ${facts.scrollWidth}px wide${facts.wide.length ? `; too wide: ${facts.wide.join(", ")}` : ""})`);
    }
    if (facts.empty) problems.push("page looks empty (almost no text or images)");
  } catch (err) {
    problems.push(`could not load: ${(err as Error).message.split("\n")[0].slice(0, 160)}`);
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onError);
    page.off("response", onResponse);
    page.off("requestfailed", onFailed);
  }
  for (const x of new Set(problems)) {
    // The phone pass only adds what the desktop pass didn't already report.
    if (viewport === "mobile" && issues.has(`${label}: ${x}`)) continue;
    issues.add(`${label}${viewport === "mobile" ? " (phone)" : ""}: ${x}`);
  }
}

/**
 * Opens the project in a headless browser and returns what a person would see.
 * Returns a report with `skipped` set when the check can't run (no browser,
 * nothing to open, PHP not started) so QA knows why.
 */
export async function visualCheck(p: Project, signal?: AbortSignal): Promise<VisualReport> {
  const at = new Date().toISOString();
  const pages = pagesOf(p);
  const base: VisualReport = { at, url: "", pages, shots: [], issues: [] };
  if (!exe) return { ...base, skipped: "no Chrome or Edge found (set BROWSER_PATH)" };
  if (!pages.length) return { ...base, skipped: "no HTML or PHP page to open" };

  let root: string;
  if (/\.php$/i.test(pages[0])) {
    const running = phpUrl(p.id);
    if (!running) return { ...base, skipped: 'PHP project: press "Run with PHP" in Files to let QA open it' };
    root = running;
  } else {
    root = `http://127.0.0.1:${config.port}/preview/${p.id}/`;
  }
  const target: Target = { root, dir: projectDir(p.id) };

  let chromium: typeof import("playwright-core").chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    return { ...base, skipped: "playwright-core is not installed (npm install)" };
  }

  const dir = shotsDir(p.id);
  fs.mkdirSync(dir, { recursive: true });
  // Keep only the latest few screenshot sets.
  const old = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 4))) fs.rmSync(path.join(dir, f), { force: true });

  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const onAbort = () => void browser.close().catch(() => {});
  signal?.addEventListener("abort", onAbort);
  const issues = new Set<string>();
  const shots: VisualShot[] = [];
  const stamp = at.replace(/[-:T]/g, "").slice(0, 14);
  try {
    for (const vp of ["desktop", "mobile"] as const) {
      const v = VIEWPORTS[vp];
      const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: vp === "mobile", hasTouch: vp === "mobile", reducedMotion: "reduce" });
      const page = await ctx.newPage();
      // Every page on desktop; the entry page (plus a second one) on mobile.
      for (const [i, f] of pages.entries()) {
        if (vp === "mobile" && i > 1) break;
        if (signal?.aborted) break;
        await inspect(page, root + encodeURI(f), f, vp, target, issues);
        if (i === 0) {
          const file = `${stamp}-${vp}.jpg`;
          const height = Math.min(v.maxHeight, await page.evaluate(() => document.documentElement.scrollHeight).catch(() => v.height));
          await page
            .screenshot({ path: path.join(dir, file), type: "jpeg", quality: 70, fullPage: true, clip: { x: 0, y: 0, width: v.width, height: Math.max(height, v.height) } })
            .then(() => shots.push({ file, page: f, viewport: vp }))
            .catch(() => {});
        }
      }
      await ctx.close();
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await browser.close().catch(() => {});
  }
  return { ...base, url: root + pages[0], shots, issues: [...issues] };
}

/** Screenshots as base64 images for models that can see. */
export function shotImages(projectId: string, report: VisualReport | undefined) {
  if (!report) return [];
  return report.shots.flatMap((s) => {
    const file = shotPath(projectId, s.file);
    if (!file || !fs.existsSync(file)) return [];
    return [{ mediaType: "image/jpeg" as const, data: fs.readFileSync(file).toString("base64"), label: `${s.page}, ${s.viewport} (${VIEWPORTS[s.viewport].width}px wide)` }];
  });
}

/** One line per finding, for prompts. */
export function visualText(r: VisualReport | undefined): string {
  if (!r) return "";
  if (r.skipped) return `BROWSER CHECK: not run (${r.skipped}).`;
  return `BROWSER CHECK (the site was opened in a real headless browser at desktop 1280px and phone 390px; ${r.pages.length} page(s): ${r.pages.join(", ")}):\n${
    r.issues.length ? r.issues.map((i) => `- ${i}`).join("\n") : "- no console errors, missing files, broken images or sideways scrolling"
  }${r.shots.length ? "\nScreenshots of the entry page are attached when your model can see images." : ""}`;
}
