import { randomUUID } from "node:crypto";
import { getModel, seesImages } from "../providers/index.ts";
import { removeShots, shotImages, visualCheck, visualText } from "./browser.ts";
import { emptyUsage, store } from "../store.ts";
import type {
  Employee,
  FeedChannel,
  FeedMessage,
  Project,
  RoleId,
  Speaker,
  StaffingRequest,
  Task,
  WorkDepartmentId,
} from "../types.ts";
import { BudgetExceededError, callAgent } from "./agent.ts";
import { assessStaffing, employeesOf, pendingRequestsFor, resolveRequest, staffEvents } from "./ai-resources.ts";
import { dependentsOf, dropGraph, lintGraph, projectMap, selectContext, syncGraph } from "./context-graph.ts";
import { department, effortForRole, managerOf, role, WORK_DEPARTMENTS, workerRolesOf } from "./org.ts";
import {
  ceoPlanPrompt,
  deliveryPrompt,
  designReviewPrompt,
  hireDecisionPrompt,
  managerPlanPrompt,
  qaReviewPrompt,
  reviewPrompt,
  systemPrompt,
  workerPrompt,
} from "./prompts.ts";
import {
  ceoPlanSchema,
  deliverySchema,
  designReviewSchema,
  type DesignReview,
  hireDecisionSchema,
  managerPlanSchema,
  qaReviewSchema,
  reviewSchema,
  taskResultSchema,
  type CeoPlan,
  type Delivery,
  type HireDecision,
  type ManagerPlan,
  type QaReview,
  type Review,
  type TaskResult,
} from "./schemas.ts";
import { applyEdits, filesForPrompt, listFiles, projectDir, removeProjectFiles, writeFiles } from "./workspace.ts";
import { stopPhp, syntaxCheck } from "./checks.ts";
import { notify } from "../telegram.ts";
import { copyDesignInto, fontsHref, getDesign, projectDesign, validateProjectDesign } from "../designs.ts";

/*
 * Chain of command
 * ────────────────
 *   Owner (you) ⇄ CEO ⇄ department managers        → "boss" channel
 *   manager ⇄ their own team                         → department channel
 *   AI Resources ⇄ the manager who needs staff       → "ai-resources" channel
 *
 * Employees never report to the owner. Managers supervise and review their
 * team, report to management when their department is done, and the
 * Engineering Manager hands finished work to QA. If QA fails the product, the
 * Engineering Manager opens fix tasks and QA re-tests before the CEO delivers.
 */

// ───────────────────────────── helpers ─────────────────────────────

const t = (tr: string, en: string) => (store.settings.language === "en" ? en : tr);
const title = (roleId: RoleId) => role(roleId).title[store.settings.language];
const deptName = (d: WorkDepartmentId) => department(d).name[store.settings.language];
const mapOf = (p: Project) => projectMap(syncGraph(p.id).graph);
const now = () => new Date().toISOString();
const isSettled = (x: Task) => x.status === "done" || x.status === "failed";

interface Runner {
  abort: AbortController;
  running: Set<string>;
  delivering: boolean;
}
const runners = new Map<string, Runner>();

function runner(p: Project): Runner {
  let r = runners.get(p.id);
  if (!r) {
    r = { abort: new AbortController(), running: new Set(), delivering: false };
    runners.set(p.id, r);
  }
  return r;
}

function firstOf(roleId: RoleId): Employee {
  const e = employeesOf(roleId)[0];
  if (!e) throw new Error(`No ${roleId} on staff`);
  return e;
}

const speaker = (e: Employee): Speaker => ({ kind: "employee", name: e.name, roleId: e.roleId, employeeId: e.id });
const OWNER: Speaker = { kind: "client", name: "Owner" };
const SYSTEM: Speaker = { kind: "system", name: "System" };

function post(
  p: Project,
  channel: FeedChannel,
  from: Speaker,
  text: string,
  kind: FeedMessage["kind"] = "chat",
  extra: Partial<FeedMessage> = {},
) {
  p.feed.push({ id: randomUUID().slice(0, 8), at: now(), from, text, kind, channel, ...extra });
  store.touchProject(p);
  if (channel === "boss" && kind === "report" && from.kind === "employee") void notify({ type: "report", project: p, text, from: from.name });
}

/** One-line description of where a project stands (used by Telegram /status). */
export function phaseOf(p: Project): string {
  const roundTasks = p.tasks.filter((x) => x.round === p.round);
  if (p.status !== "in_progress") return ({ planning: "Planning", delivering: "Wrapping up", done: "Delivered", failed: "Failed", paused: "Paused", cancelled: "Stopped" } as Record<string, string>)[p.status] ?? p.status;
  if (roundTasks.some((x) => x.kind === "fix" && !isSettled(x))) return "Fixing QA findings";
  const active = [...new Set(roundTasks.filter((x) => x.status === "in_progress" || x.status === "review").map((x) => deptName(x.department)))];
  return active.length ? `${active.join(", ")} working` : "Waiting";
}

const isAbort = (err: unknown) => (err as Error)?.name === "AbortError";

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "task"
  );
}

function uniqueId(p: Project, base: string): string {
  const used = new Set(p.tasks.map((x) => x.id));
  let id = slug(base);
  for (let n = 2; used.has(id); n++) id = `${slug(base)}-${n}`;
  return id;
}

/** Drops dependency edges that would create a cycle so the scheduler can never deadlock. */
function breakCycles(tasks: Task[]) {
  const byId = new Map(tasks.map((x) => [x.id, x]));
  const state = new Map<string, 1 | 2>();
  const visit = (task: Task) => {
    state.set(task.id, 1);
    task.dependsOn = task.dependsOn.filter((d) => {
      const dep = byId.get(d);
      if (!dep) return true;
      if (state.get(d) === 1) return false; // back edge
      if (!state.has(d)) visit(dep);
      return true;
    });
    state.set(task.id, 2);
  };
  for (const task of tasks) if (!state.has(task.id)) visit(task);
}

const gateOf = (p: Project) => {
  if (p.gate?.round !== p.round) p.gate = { round: p.round, cycles: 0 };
  return p.gate;
};

// ───────────────────────────── public API ─────────────────────────────

export function createProject(brief: string, designId?: string): Project {
  const design = designId ? getDesign(designId) : undefined;
  if (designId && !design) throw new Error(`Unknown design: ${designId}`);
  const p: Project = {
    id: randomUUID().slice(0, 8),
    title: t("Yeni proje", "New project"),
    brief,
    round: 1,
    requests: [brief],
    status: "planning",
    createdAt: now(),
    updatedAt: now(),
    departments: [],
    tasks: [],
    feed: [],
    files: [],
    usage: emptyUsage(),
    context: { queries: 0, tokensSent: 0, tokensFull: 0 },
    announced: [],
    designId: design?.meta.id,
    designName: design?.meta.name,
  };
  if (design) p.files = copyDesignInto(projectDir(p.id), design.meta.id);
  store.projects.set(p.id, p);
  post(p, "boss", OWNER, brief);
  void plan(p);
  return p;
}

export function requestRevision(projectId: string, text: string): Project {
  const p = store.projects.get(projectId);
  if (!p) throw new Error("Project not found");
  if (!["done", "failed", "paused", "cancelled"].includes(p.status)) {
    throw new Error(t("Proje hâlâ devam ediyor.", "Project is still running."));
  }
  p.round += 1;
  p.requests.push(text);
  p.error = undefined;
  post(p, "boss", OWNER, text);
  runners.delete(p.id);
  void plan(p);
  return p;
}

export function cancelProject(projectId: string) {
  const p = store.projects.get(projectId);
  if (!p) throw new Error("Project not found");
  runners.get(p.id)?.abort.abort();
  runners.delete(p.id);
  for (const task of p.tasks) if (task.status === "in_progress" || task.status === "review") task.status = "pending";
  p.status = "cancelled";
  for (const s of store.staffing) if (s.projectId === p.id && s.status === "pending") s.status = "rejected";
  post(p, "boss", SYSTEM, t("Proje patron tarafından durduruldu.", "The owner stopped the project."), "error");
  store.touchCompany();
}

export function resumeProject(projectId: string) {
  const p = store.projects.get(projectId);
  if (!p) throw new Error("Project not found");
  if (p.status !== "paused" && p.status !== "cancelled" && p.status !== "failed") {
    throw new Error(t("Proje zaten çalışıyor.", "Project is already running."));
  }
  runners.delete(p.id);
  p.error = undefined;
  const roundTasks = p.tasks.filter((x) => x.round === p.round);
  if (!roundTasks.length) {
    void plan(p);
    return;
  }
  for (const task of roundTasks) {
    if (task.status === "failed") {
      task.status = "pending";
      task.error = undefined;
    }
  }
  p.status = "in_progress";
  post(p, "boss", SYSTEM, t("Proje kaldığı yerden devam ediyor.", "Resuming the project."));
  staff(p);
  schedule(p);
}

export function deleteProject(projectId: string) {
  runners.get(projectId)?.abort.abort();
  runners.delete(projectId);
  store.staffing = store.staffing.filter((s) => s.projectId !== projectId);
  stopPhp(projectId);
  store.deleteProject(projectId);
  removeProjectFiles(projectId);
  removeShots(projectId);
  dropGraph(projectId);
  store.touchCompany();
}

export function decideHire(requestId: string, decision: "approve" | "reject", modelKey?: string, note?: string) {
  const { request, employee } = resolveRequest(requestId, decision, modelKey, note);
  const p = store.projects.get(request.projectId);
  const air = employeesOf("air-manager")[0];
  if (p && air) {
    if (employee) {
      post(
        p,
        "ai-resources",
        speaker(air),
        t(`${employee.name}, ${title(request.roleId)} olarak işe alındı. Hoş geldin!`, `${employee.name} joined the team as ${title(request.roleId)}. Welcome aboard!`),
        "hire",
        { tone: "good" },
      );
    } else {
      const mgr = title(managerOf(role(request.roleId).department));
      post(
        p,
        "ai-resources",
        speaker(air),
        t(
          `${title(request.roleId)} alımı reddedildi. Bu işleri ${mgr} kendisi üstlenecek.`,
          `${title(request.roleId)} hire declined. The ${mgr} will handle those tasks personally.`,
        ),
        "hire",
        { tone: "bad" },
      );
    }
  }
  kickAll();
}

// Whenever headcount changes or someone frees up, every running project gets a chance to assign work.
export function kickAll() {
  for (const p of store.projects.values()) if (p.status === "in_progress") schedule(p);
}
staffEvents.on("change", () => setImmediate(kickAll));

// ───────────────────────────── planning ─────────────────────────────

async function plan(p: Project) {
  const r = runner(p);
  p.status = "planning";
  store.touchProject(p);
  try {
    const ceo = firstOf("ceo");
    const cp = await callAgent<CeoPlan>({
      employee: ceo,
      project: p,
      system: systemPrompt(ceo),
      user: ceoPlanPrompt(p, p.round > 1 ? mapOf(p) : ""),
      schemaName: "ceo_plan",
      schema: ceoPlanSchema(WORK_DEPARTMENTS),
      maxTokens: 8000,
      effort: "medium",
      hint: { stage: "ceo", brief: p.brief, round: p.round, latestRequest: p.requests.at(-1), title: p.round > 1 ? p.title : "" },
      signal: r.abort.signal,
    });

    if (p.round === 1) {
      p.title = cp.title.slice(0, 60) || p.title;
      p.summary = cp.summary;
    } else {
      p.summary = `${p.summary ?? ""}\n\n[Round ${p.round}] ${cp.summary}`.trim();
    }
    const seen = new Set<string>();
    p.departments = cp.departments.filter(
      (d) => WORK_DEPARTMENTS.includes(d.department) && !seen.has(d.department) && seen.add(d.department),
    );
    if (!p.departments.length) throw new Error(t("CEO hiçbir departman seçmedi.", "The CEO picked no departments."));
    post(p, "boss", speaker(ceo), cp.reply, "chat", { to: OWNER.name });
    void notify({ type: "accepted", project: p, text: cp.reply });

    const managers = p.departments.map((d) => `${title(managerOf(d.department))}: ${d.goal}`).join("\n");
    post(p, "boss", speaker(ceo), t(`Müdürler, görev dağılımı şöyle:\n${managers}`, `Managers, here's the split:\n${managers}`), "handoff");

    // Managers plan in parallel waves: design and content need nothing from anyone, engineering
    // builds on their tasks, QA plans last so it can test everything. Same plans, less waiting.
    const WAVES: WorkDepartmentId[][] = [["design", "content"], ["software"], ["qa"]];
    const goalOf = new Map(p.departments.map((d) => [d.department, d.goal]));
    const map = p.round > 1 ? mapOf(p) : "";

    const roundTasks: Task[] = [];
    for (const wave of WAVES) {
      const depts = wave.filter((d) => goalOf.has(d));
      const visible = [...roundTasks];
      const plans = await Promise.all(
        depts.map((dept) => {
          const mgr = firstOf(managerOf(dept));
          return callAgent<ManagerPlan>({
            employee: mgr,
            project: p,
            system: systemPrompt(mgr),
            user: managerPlanPrompt(p, dept, goalOf.get(dept)!, visible, map),
            schemaName: "manager_plan",
            schema: managerPlanSchema(workerRolesOf(dept).map((x) => x.id)),
            maxTokens: 8000,
            effort: "medium",
            hint: { stage: "manager", department: dept, round: p.round, availableKeys: visible.map((x) => x.id) },
            signal: r.abort.signal,
          });
        }),
      );
      // Materialise in a fixed order so task ids stay deterministic.
      for (const [i, dept] of depts.entries()) {
        const d = { department: dept, goal: goalOf.get(dept)! };
        const mgr = firstOf(managerOf(dept));
        const roles = workerRolesOf(dept).map((x) => x.id);
        const mp = plans[i];

      const usedIds = new Set(p.tasks.map((x) => x.id).concat(roundTasks.map((x) => x.id)));
      const keyMap = new Map<string, string>();
      const created: Task[] = [];
      for (const pt of mp.tasks.slice(0, 6)) {
        let id = slug(pt.key || `${d.department}-${created.length + 1}`);
        for (let n = 2; usedIds.has(id); n++) id = `${slug(pt.key)}-${n}`;
        usedIds.add(id);
        keyMap.set(pt.key, id);
        created.push({
          id,
          round: p.round,
          title: pt.title,
          description: pt.description,
          department: d.department,
          roleId: roles.includes(pt.role) ? pt.role : roles[0],
          dependsOn: pt.dependsOn,
          status: "pending",
          revisions: 0,
        });
      }
      const known = new Set(roundTasks.map((x) => x.id));
      for (const task of created) {
        task.dependsOn = [
          ...new Set(
            task.dependsOn
              .map((k) => keyMap.get(k) ?? (known.has(k) ? k : null))
              .filter((k): k is string => Boolean(k) && k !== task.id),
          ),
        ];
      }
      roundTasks.push(...created);
      const list = created.map((x) => `• ${x.title} → ${title(x.roleId)}`).join("\n");
      post(p, "boss", speaker(mgr), `${mp.reply}${list ? `\n${list}` : ""}`, "chat", { to: ceo.name });
      }
    }

    if (!roundTasks.length) throw new Error(t("Hiç görev planlanmadı.", "No tasks were planned."));
    breakCycles(roundTasks);
    p.tasks.push(...roundTasks);
    p.status = "in_progress";
    store.touchProject(p);
    {
      const byDept = WORK_DEPARTMENTS.map((d) => [d, roundTasks.filter((x) => x.department === d).length] as const).filter(([, n]) => n);
      void notify({
        type: "planned",
        project: p,
        text: `Plan ready: ${roundTasks.length} tasks (${byDept.map(([d, n]) => `${deptName(d)} ${n}`).join(", ")}).`,
      });
    }

    staff(p);
    schedule(p);
  } catch (err) {
    if (isAbort(err)) return;
    fail(p, err);
  }
}

function fail(p: Project, err: unknown) {
  const msg = (err as Error)?.message ?? String(err);
  p.status = err instanceof BudgetExceededError ? "paused" : "failed";
  p.error = msg;
  post(p, "boss", SYSTEM, msg, "error", { tone: "bad" });
  void notify({ type: "problem", project: p, text: msg });
  console.error(`[project ${p.id}]`, err);
}

// ───────────────────────────── staffing (AI Resources) ─────────────────────────────

function staff(p: Project) {
  const air = employeesOf("air-manager")[0];
  const { created, managerHandled } = assessStaffing(p);

  // Small departments: no hire, the manager does it. Said once per round, in the hiring channel.
  for (const { department: dept, tasks } of managerHandled) {
    const key = `${p.round}:manager-handles:${dept}`;
    p.announced ??= [];
    if (p.announced.includes(key) || !air) continue;
    p.announced.push(key);
    const mgr = employeesOf(managerOf(dept))[0];
    post(
      p,
      "ai-resources",
      speaker(air),
      t(
        `${deptName(dept)} departmanında sadece ${tasks} görev var; yeni eleman gerekmiyor, ${mgr?.name ?? "müdür"} kendisi yapacak.`,
        `${deptName(dept)} has only ${tasks} task${tasks > 1 ? "s" : ""}, so no hire is needed: ${mgr?.name ?? "the manager"} will do it personally.`,
      ),
      "hire",
      mgr ? { to: mgr.name } : {},
    );
  }

  if (!created.length) return;
  const mode = store.settings.hireApproval;

  for (const req of created) {
    const top = req.recommendations[0];
    const alts = req.recommendations.slice(1).map((x) => x.label).join(", ");
    const mgr = employeesOf(managerOf(role(req.roleId).department))[0];
    const ask = mode === "auto" ? "" : mode === "manager" ? t(" Onaylıyor musun?", " Do you approve?") : t(" Onaylıyor musunuz?", " Do you approve?");
    if (air) {
      const who = mode === "manager" && mgr ? t(`@${mgr.name}, ekibine`, `@${mgr.name}, your team`) : t(`${title(managerOf(role(req.roleId).department))} ekibine`, `The ${title(managerOf(role(req.roleId).department))}'s team`);
      post(
        p,
        // The owner only hears about hiring when the owner is the one who must decide.
        mode === "client" ? "boss" : "ai-resources",
        speaker(air),
        t(
          `${who} bir ${title(req.roleId)} lazım (${req.reason}) Önerim: ${top.label} (${top.reasons.slice(0, 2).join(", ")}).${alts ? ` Alternatifler: ${alts}.` : ""}${ask}`,
          `${who} needs a ${title(req.roleId)} (${req.reason}) My pick: ${top.label} (${top.reasons.slice(0, 2).join(", ")}).${alts ? ` Alternatives: ${alts}.` : ""}${ask}`,
        ),
        "hire",
        mode === "manager" && mgr ? { to: mgr.name } : mode === "client" ? { to: OWNER.name } : {},
      );
    }
    if (mode === "auto") decideHire(req.id, "approve");
  }
  if (mode === "client") void notify({ type: "hire", project: p, requests: created });

  if (mode === "manager") {
    // One decision call per manager, covering all of that team's open requests.
    const byManager = new Map<string, StaffingRequest[]>();
    for (const req of created) {
      const mgrRole = managerOf(role(req.roleId).department);
      byManager.set(mgrRole, [...(byManager.get(mgrRole) ?? []), req]);
    }
    for (const [mgrRole, reqs] of byManager) void managerDecides(p, mgrRole as RoleId, reqs);
  }
}

/** The manager who asked for staff reviews AI Resources' candidates and accepts or declines. */
async function managerDecides(p: Project, mgrRole: RoleId, reqs: StaffingRequest[]) {
  const r = runner(p);
  const mgr = employeesOf(mgrRole)[0];
  for (const req of reqs) req.deliberating = true;
  store.touchCompany();
  try {
    if (!mgr) throw new Error("no manager");
    const choices = [...new Set(reqs.flatMap((q) => q.recommendations.map((c) => c.modelKey)))];
    const out = await callAgent<HireDecision>({
      employee: mgr,
      project: p,
      system: systemPrompt(mgr),
      user: hireDecisionPrompt(p, reqs),
      schemaName: "hire_decision",
      schema: hireDecisionSchema(reqs.map((q) => q.id), choices),
      maxTokens: 2000,
      effort: "low",
      hint: {
        stage: "hire",
        requests: reqs.map((q) => ({ id: q.id, top: q.recommendations[0]?.modelKey, label: q.recommendations[0]?.label, role: title(q.roleId) })),
      },
      signal: r.abort.signal,
    });
    for (const req of reqs) {
      if (req.status !== "pending") continue;
      const d = out.decisions.find((x) => x.requestId === req.id);
      const air = employeesOf("air-manager")[0];
      const reject = d?.choice === "reject";
      const pick = d && !reject && req.recommendations.some((c) => c.modelKey === d.choice) ? d.choice : req.recommendations[0]?.modelKey;
      post(p, "ai-resources", speaker(mgr), d?.message ?? t("Önerini kabul ediyorum.", "I accept your recommendation."), "hire", {
        to: air?.name,
        tone: reject ? "bad" : "good",
      });
      decideHire(req.id, reject ? "reject" : "approve", pick, d?.message);
    }
  } catch (err) {
    if (isAbort(err)) return;
    // If the manager can't decide (API error), fall back to AI Resources' first pick.
    post(
      p,
      "ai-resources",
      SYSTEM,
      t(`İşe alım kararı alınamadı, YZK'nın ilk önerisiyle devam ediliyor. (${(err as Error).message})`, `Hiring decision failed; going with AI Resources' first pick. (${(err as Error).message})`),
      "error",
    );
    for (const req of reqs) if (req.status === "pending") decideHire(req.id, "approve");
  }
}

// ───────────────────────────── execution ─────────────────────────────

function pickAssignee(p: Project, task: Task): Employee | null {
  const idle = employeesOf(task.roleId).find((e) => e.status === "idle");
  if (idle) return idle;
  // Nobody in this role and AI Resources isn't about to hire: the manager does it personally.
  if (employeesOf(task.roleId).length === 0 && pendingRequestsFor(p.id, task.roleId).length === 0) {
    const mgr = employeesOf(managerOf(task.department))[0];
    if (mgr && mgr.status === "idle") return mgr;
  }
  return null;
}

function schedule(p: Project) {
  if (p.status !== "in_progress") return;
  const r = runner(p);
  const roundTasks = p.tasks.filter((x) => x.round === p.round);
  const byId = new Map(p.tasks.map((x) => [x.id, x]));
  // A dependency only counts once it is DONE. Work that builds on a failed task waits
  // instead of running on missing inputs (which would waste tokens on the wrong thing).
  const ready = (id: string) => {
    const dep = byId.get(id);
    return !dep || dep.status === "done";
  };
  const blocked = (task: Task, seen = new Set<string>()): boolean =>
    task.dependsOn.some((id) => {
      const dep = byId.get(id);
      if (!dep || seen.has(id)) return false;
      seen.add(id);
      return dep.status === "failed" || (dep.status === "pending" && blocked(dep, seen));
    });

  for (const task of roundTasks) {
    if (r.running.size >= store.settings.maxParallel) break;
    if (task.status !== "pending" || r.running.has(task.id)) continue;
    if (!task.dependsOn.every(ready)) continue;
    const who = pickAssignee(p, task);
    if (!who) continue;
    void runTask(p, task, who);
  }

  if (r.running.size > 0 || r.delivering) return;
  if (roundTasks.every(isSettled)) {
    // QA may still send the work back to engineering before anything reaches the owner.
    if (openFixCycle(p)) return schedule(p);
    r.delivering = true;
    void deliver(p);
    return;
  }
  // Nothing running and everything left is stuck behind a failure: pause and tell the owner.
  const pending = roundTasks.filter((x) => x.status === "pending");
  if (pending.length && pending.every((x) => blocked(x))) {
    const failed = roundTasks.filter((x) => x.status === "failed");
    const titles = failed.map((x) => `"${x.title}"`).join(", ");
    p.status = "paused";
    p.error = t(
      `${failed.length} görev başarısız oldu (${titles}); ona bağlı işler başlayamıyor. Tekrar denemek için Resume'a basın.`,
      `${failed.length} task(s) failed (${titles}), so the work that builds on them can't start. Press Resume to retry.`,
    );
    post(p, "boss", SYSTEM, p.error, "error", { tone: "bad" });
    void notify({ type: "problem", project: p, text: p.error });
  }
}

/**
 * Asks the context graph for the smallest context that still covers the task:
 * the files it builds on or edits (seeds), their graph neighbours, and a
 * one-line map of everything else. Records how many tokens that saved.
 */
async function contextFor(p: Project, task: Task): Promise<{ text: string; excerpted: string[] }> {
  syncGraph(p.id);
  const seeds = new Set<string>(task.extraSeeds ?? []);
  for (const depId of task.dependsOn) {
    for (const f of p.tasks.find((x) => x.id === depId)?.output?.files ?? []) seeds.add(f);
  }
  if (task.feedback) for (const f of task.output?.files ?? []) seeds.add(f);
  for (const f of p.files) if (task.description.includes(f) || task.title.includes(f)) seeds.add(f);
  // The project's design (chosen from the library or written by the team) guides design and engineering work.
  if (task.department === "design" || task.department === "software") {
    for (const f of ["design/DESIGN.md", "design/tokens.css"]) if (p.files.includes(f)) seeds.add(f);
  }

  const qa = task.roleId === "qa-tester";
  // Fixes and re-tests also look at whatever depends on the files involved (impact analysis).
  const boost = task.kind || qa ? dependentsOf(p.id, [...seeds]) : [];
  const sel = selectContext(p.id, {
    seeds: [...seeds],
    text: `${task.title} ${task.description} ${task.feedback ?? ""}`,
    roleId: task.roleId,
    budget: Math.round(store.settings.contextBudget * (qa ? 1.5 : 1)),
    boost,
  });
  p.context.queries += 1;
  p.context.tokensSent += sel.tokens;
  p.context.tokensFull += Math.max(sel.tokens, sel.fullTokens);
  store.touchProject(p);

  if (!qa) return { text: sel.text, excerpted: sel.excerpted };
  const issues = [...lintGraph(p.id), ...(await syntaxCheck(p.id))];
  const report = issues.length ? issues.map((i) => `- ${i}`).join("\n") : "- no problems found";
  const visual = visualText(p.visual);
  return {
    text: `${sel.text}\n\nAUTOMATED CHECKS ON THE WHOLE PROJECT (context graph + syntax check):\n${report}${visual ? `\n\n${visual}` : ""}`,
    excerpted: sel.excerpted,
  };
}

async function runTask(p: Project, task: Task, emp: Employee) {
  const r = runner(p);
  const signal = r.abort.signal;
  const channel: FeedChannel = task.department;
  r.running.add(task.id);
  task.status = "in_progress";
  task.assigneeId = emp.id;
  emp.status = "busy";
  emp.currentTask = { projectId: p.id, taskId: task.id, title: task.title };
  store.touchCompany();

  const mgr = firstOf(managerOf(task.department));
  const selfManaged = mgr.id === emp.id;
  const isQa = task.roleId === "qa-tester";
  if (task.revisions === 0) {
    post(
      p,
      channel,
      speaker(mgr),
      selfManaged
        ? t(`"${task.title}" işini ben üstleniyorum.`, `I'll take "${task.title}" myself.`)
        : t(`@${emp.name}, "${task.title}" görevi sende.`, `@${emp.name}, "${task.title}" is yours.`),
      "handoff",
      { taskId: task.id, to: emp.name },
    );
  }

  let ok = false;
  let autoFixes = 0;
  let asked = 0;
  try {
    // QA starts by opening the site in a real browser: screenshots + hard facts for everyone who signs off.
    if (isQa) await browserCheck(p, signal);
    if (signal.aborted) return;
    for (;;) {
      const context = await contextFor(p, task);
      const result = await callAgent<TaskResult>({
        employee: emp,
        project: p,
        system: systemPrompt(emp),
        user: workerPrompt(p, task, context.text),
        schemaName: "task_result",
        schema: taskResultSchema,
        maxTokens: 32000,
        // The employee's own effort (set at hiring). A manager doing a team task works at that task's level.
        effort: emp.roleId === task.roleId ? (emp.effort ?? effortForRole(task.roleId)) : effortForRole(task.roleId),
        images: isQa ? shotImages(p.id, p.visual) : undefined,
        hint: {
          stage: "worker",
          roleId: task.roleId,
          revisions: task.revisions,
          title: p.title,
          taskKind: task.kind,
          design: designHint(p),
        },
        signal,
      });
      if (signal.aborted) return;

      // Graph query: the employee asked for files in full before doing the work. Give them once.
      const wanted = (result.needFiles ?? []).filter((f) => p.files.includes(f) && !(task.extraSeeds ?? []).includes(f));
      if (wanted.length && !result.files.length && !(result.edits ?? []).length && asked < 1) {
        asked += 1;
        task.extraSeeds = [...(task.extraSeeds ?? []), ...wanted];
        post(p, channel, SYSTEM, t(`${emp.name} şu dosyaları tam istedi: ${wanted.join(", ")}`, `${emp.name} asked to see these in full: ${wanted.join(", ")}`), "review", { taskId: task.id });
        continue;
      }

      // Never let a file the employee only saw as an excerpt be overwritten wholesale.
      const blocked = result.files.filter((f) => context.excerpted.includes(f.path));
      const { written, skipped } = writeFiles(p.id, result.files.filter((f) => !context.excerpted.includes(f.path)));
      const edited = applyEdits(p.id, result.edits ?? []);
      p.context.outputSaved = (p.context.outputSaved ?? 0) + edited.savedTokens;
      const changed = [...new Set([...written, ...edited.written])];
      p.files = listFiles(p.id);
      syncGraph(p.id);
      // A revision only sends what it changed; keep the earlier files in the task's output.
      const previous = task.feedback ? (task.output?.files ?? []) : [];
      task.output = { summary: result.summary, files: [...new Set([...previous, ...changed])] };
      const skipNote = skipped.length ? `\n${t("Atlanan dosyalar", "Skipped files")}: ${skipped.join(", ")}` : "";
      post(p, channel, speaker(emp), `${result.message}${skipNote}`, "handoff", { taskId: task.id, to: mgr.name, files: changed });

      // Free automated gate: syntax errors or edits that didn't apply go straight back to the
      // employee, without spending a manager review on work that can't pass anyway.
      const syntax = await syntaxCheck(p.id, task.output.files);
      const editProblems = [
        ...edited.failed.map((f) => `${f.path}: ${f.reason}`),
        // A design system the team writes must be a valid library design (so it can be reused and saved).
        ...(changed.some((f) => f.startsWith("design/")) ? validateProjectDesign(projectDir(p.id)) : []),
        ...blocked.map((f) => `${f.path}: you only saw an excerpt of this file, so a full rewrite was refused. Send your change as "edits".`),
      ];
      if ((syntax.length || editProblems.length) && autoFixes < 2) {
        autoFixes += 1;
        task.feedback = [
          editProblems.length
            ? `These edits could not be applied, so those files were left unchanged. Re-send them with an exact, unique "find" copied from the file, or send the whole file in "files":\n${editProblems.map((x) => `- ${x}`).join("\n")}`
            : "",
          syntax.length ? `The automated syntax check failed:\n${syntax.map((x) => `- ${x}`).join("\n")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        p.context.reviewsSkipped = (p.context.reviewsSkipped ?? 0) + 1;
        post(
          p,
          channel,
          SYSTEM,
          t(
            `Otomatik kontrol "${task.title}" işini incelemeden önce ${emp.name} çalışanına geri gönderdi (${syntax.length + editProblems.length} sorun).`,
            `Automated check sent "${task.title}" back to ${emp.name} before review (${syntax.length + editProblems.length} problem(s)).`,
          ),
          "review",
          { taskId: task.id, tone: "bad" },
        );
        continue;
      }
      const autoIssues = [...syntax, ...editProblems];

      // QA work always gets a sign-off from the QA Manager, which doubles as the ship/no-ship verdict.
      if (selfManaged && !isQa) break;

      task.status = "review";
      store.touchProject(p);
      const review = isQa
        ? await callAgent<QaReview>({
            employee: mgr,
            project: p,
            system: systemPrompt(mgr),
            user: qaReviewPrompt(p, task, filesForPrompt(p.id, changed), result.summary, [...lintGraph(p.id), ...(await syntaxCheck(p.id))], mapOf(p), visualText(p.visual)),
            schemaName: "qa_review",
            schema: qaReviewSchema,
            maxTokens: 6000,
            effort: "medium",
            images: shotImages(p.id, p.visual),
            hint: { stage: "qa-review", qaCycle: gateOf(p).cycles },
            signal,
          })
        : await callAgent<Review>({
            employee: mgr,
            project: p,
            system: systemPrompt(mgr),
            user: reviewPrompt(
              p,
              task,
              filesForPrompt(p.id, task.output.files),
              result.summary,
              [...lintGraph(p.id, [...task.output.files, ...dependentsOf(p.id, changed)]), ...autoIssues],
              dependentsOf(p.id, changed),
            ),
            schemaName: "review",
            schema: reviewSchema,
            maxTokens: 6000,
            effort: "medium",
            hint: { stage: "review", roleId: task.roleId, revisions: task.revisions, taskKind: task.kind },
            signal,
          });
      if (signal.aborted) return;

      const outOfRevisions = task.revisions >= store.settings.maxRevisions || selfManaged;
      if (review.approved || outOfRevisions) {
        const note =
          !review.approved && outOfRevisions && !selfManaged
            ? t(" (Revizyon hakkı doldu, mevcut haliyle kabul edildi.)", " (Out of revisions; accepted as is.)")
            : "";
        if (!selfManaged) post(p, channel, speaker(mgr), `${review.message}${note}`, "review", { taskId: task.id, to: emp.name, tone: "good" });
        if (isQa) {
          const qa = review as QaReview;
          task.qa = { passed: qa.productPassed, issues: qa.issues.filter(Boolean) };
          await designSignOff(p, task, signal);
          if (signal.aborted) return;
          reportQa(p, task);
        }
        break;
      }
      task.revisions += 1;
      task.feedback = review.feedback;
      task.status = "in_progress";
      post(p, channel, speaker(mgr), `${review.message}\n${review.feedback}`, "review", { taskId: task.id, to: emp.name, tone: "bad" });
    }
    task.status = "done";
    ok = true;
  } catch (err) {
    if (isAbort(err) || signal.aborted) {
      task.status = "pending";
      return;
    }
    if (err instanceof BudgetExceededError) {
      task.status = "pending";
      fail(p, err);
      return;
    }
    task.status = "failed";
    task.error = (err as Error).message;
    post(p, channel, SYSTEM, `${task.title}: ${task.error}`, "error", { taskId: task.id, tone: "bad" });
    console.error(`[task ${p.id}/${task.id}]`, err);
  } finally {
    r.running.delete(task.id);
    emp.status = "idle";
    delete emp.currentTask;
    if (ok) emp.stats.tasksDone += 1;
    if (isSettled(task)) reportDepartment(p, task.department);
    store.touchCompany();
    store.touchProject(p);
    setImmediate(kickAll);
  }
}

/** Name and fonts of the project's design, for the demo provider. */
function designHint(p: Project): { name?: string; fontsHref?: string } | undefined {
  if (p.designId) return { name: p.designName, fontsHref: fontsHref(getDesign(p.designId)?.meta.fonts ?? []) };
  if (!p.files.includes("design/tokens.css")) return undefined;
  const d = projectDesign(projectDir(p.id));
  return d ? { name: d.meta.name, fontsHref: fontsHref(d.meta.fonts) } : undefined;
}

// ───────────────────────────── browser check & design sign-off ─────────────────────────────

/** Opens the site in a headless browser and posts what it saw to the QA channel. */
async function browserCheck(p: Project, signal: AbortSignal) {
  try {
    const report = await visualCheck(p, signal);
    if (signal.aborted) return;
    p.visual = report;
    const text = report.skipped
      ? t(`Tarayıcı kontrolü yapılamadı: ${report.skipped}.`, `Browser check skipped: ${report.skipped}.`)
      : report.issues.length
        ? t(`Siteyi gerçek tarayıcıda açtım (${report.pages.length} sayfa, masaüstü + telefon). ${report.issues.length} sorun:`, `Opened the site in a real browser (${report.pages.length} page(s), desktop + phone). ${report.issues.length} problem(s):`) +
          `\n${report.issues.slice(0, 8).map((i) => `• ${i}`).join("\n")}`
        : t(`Siteyi gerçek tarayıcıda açtım (${report.pages.length} sayfa, masaüstü + telefon): konsol hatası, eksik dosya, kırık resim veya taşma yok.`, `Opened the site in a real browser (${report.pages.length} page(s), desktop + phone): no console errors, missing files, broken images or sideways scrolling.`);
    post(p, "qa", SYSTEM, text, "review", { images: report.shots.map((s) => s.file), tone: report.skipped ? undefined : report.issues.length ? "bad" : "good" });
  } catch (err) {
    if (signal.aborted) return;
    p.visual = { at: now(), url: "", pages: [], shots: [], issues: [], skipped: `browser error: ${(err as Error).message.split("\n")[0].slice(0, 160)}` };
    post(p, "qa", SYSTEM, t(`Tarayıcı kontrolü başarısız: ${p.visual.skipped}`, `Browser check failed: ${p.visual.skipped}`), "review");
  }
}

/**
 * The Design Manager looks at the screenshots and signs off on the visuals.
 * Visible design defects join QA's issue list, so engineering fixes them in the same cycle.
 */
async function designSignOff(p: Project, task: Task, signal: AbortSignal) {
  const shots = p.visual?.shots ?? [];
  const dm = employeesOf("design-manager")[0];
  const model = dm && getModel(dm.modelKey);
  if (!shots.length || !dm || !model || !seesImages(model) || !task.qa) return;
  const doc = p.files.includes("design/DESIGN.md") ? (filesForPrompt(p.id, ["design/DESIGN.md"]) ?? "") : "";
  const review = await callAgent<DesignReview>({
    employee: dm,
    project: p,
    system: systemPrompt(dm),
    user: designReviewPrompt(p, visualText(p.visual), doc),
    schemaName: "design_review",
    schema: designReviewSchema,
    maxTokens: 3000,
    effort: "medium",
    images: shotImages(p.id, p.visual),
    hint: { stage: "design-review", qaCycle: gateOf(p).cycles },
    signal,
  });
  if (signal.aborted) return;
  const issues = review.approved ? [] : review.issues.filter(Boolean).slice(0, 5);
  post(p, "design", speaker(dm), issues.length ? `${review.message}\n${issues.map((i) => `• ${i}`).join("\n")}` : review.message, "review", {
    images: shots.map((s) => s.file),
    tone: issues.length ? "bad" : "good",
  });
  if (issues.length) {
    task.qa.passed = false;
    task.qa.issues.push(...issues.map((i) => `Design: ${i}`));
  }
}

// ───────────────────────────── management reports & the QA gate ─────────────────────────────

/**
 * When a department finishes its share of the round, its manager reports up.
 * Engineering hands over to QA instead. Templated, so it costs no tokens.
 */
function reportDepartment(p: Project, dept: WorkDepartmentId) {
  if (dept === "qa") return; // QA reports through its verdict.
  const deptTasks = p.tasks.filter((x) => x.round === p.round && x.department === dept);
  if (!deptTasks.length || !deptTasks.every(isSettled)) return;
  const cycle = gateOf(p).cycles;
  const key = `${p.round}:${dept}:${cycle}`;
  p.announced ??= [];
  if (p.announced.includes(key)) return;
  p.announced.push(key);

  const mgr = employeesOf(managerOf(dept))[0];
  const ceo = employeesOf("ceo")[0];
  if (!mgr) return;
  const done = deptTasks.filter((x) => x.status === "done");
  const failed = deptTasks.filter((x) => x.status === "failed");
  // After a QA bounce, only report what this fix cycle changed.
  const relevant = cycle > 0 ? done.filter((x) => x.kind === "fix") : done;
  const files = [...new Set(relevant.flatMap((x) => x.output?.files ?? []))];
  const titles = relevant.map((x) => x.title).join(", ");
  const failNote = failed.length ? t(` ${failed.length} görev başarısız oldu: ${failed.map((x) => x.title).join(", ")}.`, ` ${failed.length} task(s) failed: ${failed.map((x) => x.title).join(", ")}.`) : "";
  const qaMgr = employeesOf("qa-manager")[0];
  const qaPlanned = p.tasks.some((x) => x.round === p.round && x.department === "qa" && !isSettled(x));

  if (dept === "software" && qaPlanned && qaMgr) {
    post(
      p,
      "boss",
      speaker(mgr),
      cycle > 0
        ? t(`Düzeltmeler hazır (${titles}). @${qaMgr.name}, yeniden test edebilir misin?`, `Fixes are in (${titles}). @${qaMgr.name}, please re-test.`) + failNote
        : t(`Yazılım tamam: ${titles}. Ekibin işini inceledim. @${qaMgr.name}, test sende.`, `Engineering is done: ${titles}. I've reviewed my team's work. @${qaMgr.name}, over to you for testing.`) + failNote,
      "report",
      { to: qaMgr.name, files, tone: failed.length ? "bad" : "good" },
    );
    return;
  }
  post(
    p,
    "boss",
    speaker(mgr),
    t(`${deptName(dept)} tamam: ${titles || "-"}.`, `${deptName(dept)} is done: ${titles || "-"}.`) + failNote,
    "report",
    { to: ceo?.name, files, tone: failed.length ? "bad" : "good" },
  );
}

/** The QA Manager's verdict goes to management (and to the Engineering Manager when it fails). */
function reportQa(p: Project, task: Task) {
  const qaMgr = employeesOf("qa-manager")[0];
  const swMgr = employeesOf("software-manager")[0];
  if (!qaMgr || !task.qa) return;
  if (task.qa.passed) {
    post(p, "boss", speaker(qaMgr), t("Testler geçti, ürün teslime hazır.", "Testing passed. The product is ready to ship."), "report", {
      to: employeesOf("ceo")[0]?.name,
      tone: "good",
    });
    void notify({ type: "qa", project: p, passed: true, text: "QA passed. The CEO is preparing the delivery." });
    return;
  }
  const list = task.qa.issues.map((i) => `• ${i}`).join("\n");
  post(
    p,
    "boss",
    speaker(qaMgr),
    t(`Testte ${task.qa.issues.length} sorun bulduk${swMgr ? `, @${swMgr.name} düzeltmen gerekiyor` : ""}:\n${list}`, `Testing found ${task.qa.issues.length} issue(s)${swMgr ? `. @${swMgr.name}, these need fixing` : ""}:\n${list}`),
    "report",
    { to: swMgr?.name, tone: "bad" },
  );
  void notify({ type: "qa", project: p, passed: false, text: `QA found ${task.qa.issues.length} issue(s); engineering is fixing them:\n${list}` });
}

/**
 * If the latest QA sign-off failed and fix rounds remain, the Engineering
 * Manager opens a fix task for the team and QA queues a re-test. Returns true
 * when new work was created.
 */
function openFixCycle(p: Project): boolean {
  const qaDone = p.tasks.filter((x) => x.round === p.round && x.roleId === "qa-tester" && x.status === "done");
  const latest = qaDone.at(-1);
  if (!latest?.qa || latest.qa.passed || !latest.qa.issues.length) return false;
  const gate = gateOf(p);
  const swMgr = employeesOf("software-manager")[0];
  if (gate.cycles >= store.settings.maxFixRounds || !swMgr) {
    if (swMgr && !p.announced?.includes(`${p.round}:shipping-with-issues:${gate.cycles}`)) {
      (p.announced ??= []).push(`${p.round}:shipping-with-issues:${gate.cycles}`);
      post(p, "boss", speaker(swMgr), t("Düzeltme turu hakkımız doldu; kalan sorunları teslim notuna ekliyoruz.", "We're out of fix rounds; the remaining issues go into the delivery notes."), "report", { tone: "bad" });
    }
    return false;
  }
  gate.cycles += 1;
  const swTasks = p.tasks.filter((x) => x.round === p.round && x.department === "software" && x.status === "done");
  const counts = new Map<RoleId, number>();
  for (const x of swTasks) if (!role(x.roleId).isManager) counts.set(x.roleId, (counts.get(x.roleId) ?? 0) + 1);
  const fixRole = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "frontend-developer";
  const issues = latest.qa.issues.map((i) => `- ${i}`).join("\n");

  const fix: Task = {
    id: uniqueId(p, `fix-r${p.round}-${gate.cycles}`),
    round: p.round,
    title: t(`QA bulgularını düzelt (tur ${gate.cycles})`, `Fix QA findings (cycle ${gate.cycles})`),
    description: `QA found these problems. Fix every one of them in the existing files, without breaking anything else:\n${issues}`,
    department: "software",
    roleId: fixRole,
    dependsOn: swTasks.map((x) => x.id),
    status: "pending",
    revisions: 0,
    kind: "fix",
  };
  const retest: Task = {
    id: uniqueId(p, `retest-r${p.round}-${gate.cycles}`),
    round: p.round,
    title: t(`Yeniden test (tur ${gate.cycles})`, `Re-test (cycle ${gate.cycles})`),
    description: `Engineering says these QA findings are fixed. Verify each one and check nothing else broke; update the QA report:\n${issues}`,
    department: "qa",
    roleId: "qa-tester",
    dependsOn: [fix.id],
    status: "pending",
    revisions: 0,
    kind: "retest",
  };
  p.tasks.push(fix, retest);
  post(
    p,
    "boss",
    speaker(swMgr),
    t(`Anlaşıldı, düzeltmeyi ekibime veriyorum. Bitince QA'ya geri göndereceğim.`, `Understood. I'm assigning the fixes to my team and will send it back to QA when they're done.`),
    "report",
    { to: employeesOf("qa-manager")[0]?.name },
  );
  store.touchProject(p);
  staff(p);
  return true;
}

async function deliver(p: Project) {
  const r = runner(p);
  p.status = "delivering";
  store.touchProject(p);
  try {
    const ceo = firstOf("ceo");
    const d = await callAgent<Delivery>({
      employee: ceo,
      project: p,
      system: systemPrompt(ceo),
      user: deliveryPrompt(p, mapOf(p)),
      schemaName: "delivery",
      schema: deliverySchema,
      maxTokens: 4000,
      effort: "low",
      hint: { stage: "delivery", title: p.title },
      signal: r.abort.signal,
    });
    post(p, "boss", speaker(ceo), d.message, "deliverable", { to: OWNER.name, files: p.files.slice(0, 12) });
    p.status = "done";
    store.touchProject(p);
    void notify({ type: "delivered", project: p, text: d.message });
  } catch (err) {
    if (isAbort(err)) return;
    fail(p, err);
  } finally {
    r.delivering = false;
  }
}
