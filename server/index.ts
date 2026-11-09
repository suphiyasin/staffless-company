import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZipArchive } from "archiver";
import { config, ROOT } from "./config.ts";
import { bus } from "./events.ts";
import { store } from "./store.ts";
import {
  availableModels,
  getCatalog,
  getModel,
  isDemoMode,
  isModelAvailable,
  providerStatuses,
  refreshCatalog,
} from "./providers/index.ts";
import { estCostPerTask, fire, hire, rankModels, reassign, rebalance, reconcileStaff, setEffort } from "./company/ai-resources.ts";
import {
  cancelProject,
  createProject,
  decideHire,
  deleteProject,
  kickAll,
  phaseOf,
  requestRevision,
  resumeProject,
} from "./company/orchestrator.ts";
import { contextReport } from "./company/context-graph.ts";
import { detectTools, phpUrl, startPhp, stopPhp, syntaxCheck, toolStatus } from "./company/checks.ts";
import { browserAvailable, detectBrowser, shotPath } from "./company/browser.ts";
import { netEvents, networkStatus } from "./net.ts";
import { sendTest, setTelegramNotify, setTelegramToken, startTelegram, telegramStatus, unpairChat } from "./telegram.ts";
import { getDesign, listDesigns, previewHtml, projectDesign, projectPreviewHtml, reloadDesigns, saveProjectDesign } from "./designs.ts";
import { ROLES, role } from "./company/org.ts";
import { projectDir, readFile } from "./company/workspace.ts";
import type { CompanySnapshot, RoleId, ServerEvent, Settings } from "./types.ts";

const snapshot = (): CompanySnapshot => ({
  settings: store.settings,
  employees: store.employees,
  staffing: store.staffing,
  providers: providerStatuses(),
  catalog: getCatalog().map((m) => ({ ...m })),
  demoMode: isDemoMode(),
  totalUsage: store.totalUsage(),
  tools: { ...toolStatus(), browser: browserAvailable() },
  network: networkStatus(),
  telegram: telegramStatus(),
});

async function main() {
  store.load();
  await refreshCatalog();
  detectTools();
  detectBrowser();
  store.setSnapshotBuilder(snapshot);
  netEvents.on("change", (s) => {
    console.log(s.online ? "  🌐 Connection is back; resuming work." : `  📴 Can't reach ${s.waitingFor}; waiting for the connection…`);
    store.touchCompany();
  });
  const changes = reconcileStaff();

  const app = express();
  const server = http.createServer(app);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  // Basic CSRF guard: mutations must be JSON and come from this origin.
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET") return next();
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "Bad origin" });
    // Check the header itself: req.is() is false for requests without a body (e.g. DELETE).
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return res.status(415).json({ error: "Content-Type must be application/json" });
    }
    next();
  });

  const wrap =
    (fn: (req: Request, res: Response) => unknown) =>
    async (req: Request, res: Response) => {
      try {
        const out = await fn(req, res);
        if (!res.headersSent) res.json(out ?? { ok: true });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    };

  const param = (req: Request, k: string) => String(req.params[k]);
  const projectOr404 = (id: string) => {
    const p = store.projects.get(id);
    if (!p) throw new Error("Project not found");
    return p;
  };

  // ── state & live updates ──
  app.get("/api/state", wrap(() => ({ company: snapshot(), projects: store.projectSummaries() })));

  app.get("/api/events", (req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (e: ServerEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ type: "company", data: snapshot() });
    send({ type: "projects", data: store.projectSummaries() });
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    bus.on("event", send);
    req.on("close", () => {
      clearInterval(ping);
      bus.off("event", send);
    });
  });

  // ── projects ──
  app.post(
    "/api/projects",
    wrap((req) => {
      const brief = String(req.body?.brief ?? "").trim();
      if (brief.length < 5) throw new Error("Please describe what you need in a bit more detail.");
      const designId = req.body?.designId ? String(req.body.designId) : undefined;
      return createProject(brief.slice(0, 8000), designId);
    }),
  );
  app.get("/api/projects/:id", wrap((req) => projectOr404(param(req, "id"))));
  app.post(
    "/api/projects/:id/revision",
    wrap((req) => {
      const text = String(req.body?.text ?? "").trim();
      if (text.length < 3) throw new Error("The change request can't be empty.");
      return requestRevision(param(req, "id"), text.slice(0, 4000));
    }),
  );
  app.get(
    "/api/projects/:id/context",
    wrap(async (req) => {
      const p = projectOr404(param(req, "id"));
      const report = contextReport(p.id);
      const syntax = await syntaxCheck(p.id);
      return { ...report, issues: [...report.issues, ...syntax], stats: p.context, phpUrl: phpUrl(p.id) };
    }),
  );
  // Runs the project with PHP's built-in server. This executes AI-written code; the panel asks first.
  app.post("/api/projects/:id/run", wrap((req) => startPhp(projectOr404(param(req, "id")).id)));
  app.delete("/api/projects/:id/run", wrap((req) => stopPhp(projectOr404(param(req, "id")).id)));
  app.get("/api/projects/:id/run", wrap((req) => ({ url: phpUrl(projectOr404(param(req, "id")).id) })));
  app.post("/api/projects/:id/cancel", wrap((req) => cancelProject(param(req, "id"))));
  app.post("/api/projects/:id/resume", wrap((req) => resumeProject(param(req, "id"))));
  app.delete("/api/projects/:id", wrap((req) => deleteProject(param(req, "id"))));

  app.get(
    "/api/projects/:id/file",
    wrap((req, res) => {
      projectOr404(param(req, "id"));
      const content = readFile(param(req, "id"), String(req.query.path ?? ""));
      if (content === null) throw new Error("File not found");
      res.type("text/plain; charset=utf-8").send(content);
    }),
  );

  app.get("/api/projects/:id/zip", (req, res) => {
    const p = store.projects.get(param(req, "id"));
    const dir = p && projectDir(p.id);
    if (!p || !dir || !fs.existsSync(dir)) return res.status(404).json({ error: "No files yet" });
    const name = `${p.title.replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-|-$/g, "") || p.id}.zip`;
    res.attachment(name);
    const zip = new ZipArchive({ zlib: { level: 9 } });
    zip.on("error", (err) => res.destroy(err));
    zip.pipe(res);
    zip.directory(dir, false);
    void zip.finalize();
  });

  // ── staffing (YZK) ──
  app.post(
    "/api/staffing/:id",
    wrap((req) => {
      const decision = req.body?.decision === "reject" ? "reject" : "approve";
      const request = store.staffing.find((s) => s.id === param(req, "id"));
      if (request?.deliberating) throw new Error("The manager is already deciding on this hire.");
      decideHire(param(req, "id"), decision, req.body?.modelKey, "Decided by the client");
    }),
  );

  app.get(
    "/api/roles/:roleId/candidates",
    wrap((req) => {
      const r = role(param(req, "roleId") as RoleId);
      return rankModels(r.id, store.settings.hirePriority).map((m) => ({
        modelKey: m.key,
        label: m.label,
        provider: m.provider,
        estCostPerTask: estCostPerTask(m, r),
      }));
    }),
  );

  app.post(
    "/api/employees",
    wrap((req) => {
      const roleId = String(req.body?.roleId) as RoleId;
      const r = ROLES.find((x) => x.id === roleId);
      if (!r || r.isManager) throw new Error("Only team members can be hired manually.");
      const m = getModel(String(req.body?.modelKey));
      if (!m || !isModelAvailable(m)) throw new Error("Model is not available");
      return hire(roleId, m.key);
    }),
  );
  app.post("/api/employees/rebalance", wrap(() => ({ changes: rebalance() })));
  app.post("/api/employees/:id/effort", wrap((req) => setEffort(param(req, "id"), String(req.body?.effort))));
  app.post("/api/employees/:id/model", wrap((req) => reassign(param(req, "id"), String(req.body?.modelKey))));
  app.delete("/api/employees/:id", wrap((req) => fire(param(req, "id"))));

  // ── design library ──
  app.get("/api/designs", wrap(() => listDesigns()));
  app.post("/api/designs/reload", wrap(() => ({ count: reloadDesigns() })));
  app.get(
    "/api/designs/:id",
    wrap((req) => {
      const d = getDesign(param(req, "id"));
      if (!d) throw new Error("Design not found");
      return { ...d.meta, markdown: d.markdown, tokens: d.tokens };
    }),
  );
  // Rendered in a sandboxed iframe, like project previews.
  app.get("/api/designs/:id/preview", (req, res) => {
    const html = previewHtml(param(req, "id"));
    if (!html) return res.status(404).end();
    res.setHeader("Content-Security-Policy", "sandbox");
    res.type("html").send(html);
  });

  // ── Telegram ──
  app.get("/api/telegram", wrap(() => telegramStatus()));
  app.post("/api/telegram/token", wrap(async (req) => {
    await setTelegramToken(String(req.body?.token ?? ""));
    return telegramStatus();
  }));
  app.put("/api/telegram/settings", wrap((req) => setTelegramNotify(String(req.body?.notify))));
  app.post("/api/telegram/test", wrap(() => sendTest()));
  app.delete("/api/telegram/chats/:id", wrap((req) => unpairChat(Number(param(req, "id")))));

  // ── settings & catalog ──
  app.put(
    "/api/settings",
    wrap((req) => {
      const b = req.body as Partial<Settings>;
      const s = store.settings;
      const clamp = (v: unknown, lo: number, hi: number, d: number) =>
        Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d;
      if (b.hireApproval && ["manager", "client", "auto"].includes(b.hireApproval)) s.hireApproval = b.hireApproval;
      if (b.contextBudget !== undefined) s.contextBudget = clamp(b.contextBudget, 2_000, 200_000, s.contextBudget);
      if (b.hirePriority && ["quality", "balanced", "economy"].includes(b.hirePriority)) s.hirePriority = b.hirePriority;
      if (b.language === "tr" || b.language === "en") s.language = b.language;
      if (b.maxPerRole !== undefined) s.maxPerRole = clamp(b.maxPerRole, 1, 5, s.maxPerRole);
      if (b.managerHandlesUpTo !== undefined) s.managerHandlesUpTo = clamp(b.managerHandlesUpTo, 0, 5, s.managerHandlesUpTo);
      if (b.maxParallel !== undefined) s.maxParallel = clamp(b.maxParallel, 1, 8, s.maxParallel);
      if (b.maxRevisions !== undefined) s.maxRevisions = clamp(b.maxRevisions, 0, 3, s.maxRevisions);
      if (b.maxFixRounds !== undefined) s.maxFixRounds = clamp(b.maxFixRounds, 0, 3, s.maxFixRounds);
      if (b.budgetUsd !== undefined) s.budgetUsd = clamp(b.budgetUsd, 0, 10_000, s.budgetUsd);
      store.touchCompany();
      kickAll();
      return s;
    }),
  );
  app.post(
    "/api/catalog/refresh",
    wrap(async () => {
      await refreshCatalog();
      detectTools();
      detectBrowser();
      const log = reconcileStaff();
      store.touchCompany();
      return { available: availableModels().length, changes: log };
    }),
  );

  // The design system the team wrote for a project: preview it, save it to the library.
  app.get(
    "/api/projects/:id/design",
    wrap((req) => {
      const d = projectDesign(projectDir(projectOr404(param(req, "id")).id));
      return d ? { ...d.meta, markdown: d.markdown, tokens: d.tokens } : null;
    }),
  );
  app.get("/api/projects/:id/design/preview", (req, res) => {
    const html = projectPreviewHtml(projectDir(param(req, "id")));
    if (!html) return res.status(404).end();
    res.setHeader("Content-Security-Policy", "sandbox");
    res.type("html").send(html);
  });
  app.post(
    "/api/projects/:id/design/save",
    wrap((req) => saveProjectDesign(projectDir(projectOr404(param(req, "id")).id), req.body?.id ? String(req.body.id) : undefined)),
  );

  // Browser-check screenshots (stored outside the project so they never ship in the ZIP).
  app.get("/api/projects/:id/shots/:file", (req, res) => {
    const file = shotPath(param(req, "id"), param(req, "file"));
    if (!file || !fs.existsSync(file)) return res.status(404).end();
    res.sendFile(file);
  });

  // ── preview of generated sites ──
  // AI-written HTML runs in a sandboxed, opaque origin so it can't call this API.
  app.use(
    "/preview",
    (_req, res, next) => {
      res.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups allow-modals");
      next();
    },
    express.static(config.paths.workspace, { index: "index.html", fallthrough: false }),
  );

  // ── web panel ──
  if (config.prod) {
    if (!fs.existsSync(config.paths.webDist)) {
      console.error('web/dist not found. Run "npm run build" first.');
      process.exit(1);
    }
    app.use(express.static(config.paths.webDist));
    app.use((_req, res) => res.sendFile(path.join(config.paths.webDist, "index.html")));
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      configFile: path.join(ROOT, "vite.config.ts"),
      // HMR rides on our own HTTP server, so no extra port is needed.
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  await startTelegram({ createProject, requestRevision, cancelProject, resumeProject, decideHire, phaseOf });

  server.listen(config.port, config.host, () => {
    const url = `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`;
    console.log(`\n  ▣ Staffless is open → ${url}`);
    console.log(
      isDemoMode()
        ? "  🧪 Demo mode: no API key found, using the simulated AI. (Add a key to .env)"
        : `  🤖 Active providers: ${providerStatuses()
            .filter((p) => p.configured)
            .map((p) => p.label)
            .join(", ")}`,
    );
    for (const c of changes) console.log(`  👔 AI Resources: ${c}`);
    console.log();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
