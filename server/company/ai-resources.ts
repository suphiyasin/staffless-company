import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { availableModels, getModel, isModelAvailable } from "../providers/index.ts";
import { isWeakLocal } from "../providers/local-models.ts";
import { store } from "../store.ts";
import type {
  Employee,
  HirePriority,
  ModelInfo,
  Project,
  Recommendation,
  RoleId,
  Skill,
  StaffingRequest,
  WorkDepartmentId,
} from "../types.ts";
import { effortForRole, FOUNDING_ROLES, role, type RoleDef } from "./org.ts";

/**
 * YZK: Yapay Zekâ Kaynakları (AI Resources, the inverse of Human Resources).
 *
 * Tracks each department's headcount, notices when a task has nobody to do it,
 * ranks the model catalog for that role and either asks the user for approval
 * or hires automatically. Ranking is deterministic so it is free, instant and
 * explainable.
 */

export const staffEvents = new EventEmitter();

const SKILL_NAMES: Record<Skill, { tr: string; en: string }> = {
  planning: { tr: "Planlama", en: "Planning" },
  coding: { tr: "Kodlama", en: "Coding" },
  design: { tr: "Tasarım", en: "Design" },
  writing: { tr: "Yazarlık", en: "Writing" },
  review: { tr: "İnceleme", en: "Review" },
};

const quality = (m: ModelInfo, r: RoleDef) =>
  Object.entries(r.weights).reduce((sum, [skill, w]) => sum + (m.skills[skill as Skill] ?? 0) * (w ?? 0), 0);

/** API-equivalent cost of a typical task. Used for ranking, so heavy models stay "expensive" even on a flat plan. */
const apiCostPerTask = (m: ModelInfo, r: RoleDef) =>
  (r.typicalTokens.input * m.price.input + r.typicalTokens.output * m.price.output) / 1_000_000;

/** What you actually pay per task: nothing extra for subscription-backed CLIs. */
export const estCostPerTask = (m: ModelInfo, r: RoleDef) => (m.tags.includes("subscription") ? 0 : apiCostPerTask(m, r));

export type Strategy = "best" | "near-best" | "good-enough";

/**
 * How hard AI Resources optimises for quality on a role. The role's tier says
 * how much the work depends on the model (engineering is critical, copy is
 * light); the company-wide priority shifts everything up or down.
 */
export function strategyFor(roleId: RoleId, priority: HirePriority): Strategy {
  const tier = role(roleId).tier;
  if (priority === "quality") return "best";
  if (priority === "economy") return tier === "critical" ? "near-best" : "good-enough";
  return tier === "critical" ? "best" : tier === "standard" ? "near-best" : "good-enough";
}

const STRATEGY_TEXT: Record<Strategy, { en: string; tr: string }> = {
  best: { en: "Best model for the job", tr: "Bu iş için en iyi model" },
  "near-best": { en: "Near-best at a lower price", tr: "En iyiye yakın, daha ucuz" },
  "good-enough": { en: "Good enough, cheapest", tr: "Yeterince iyi, en ucuz" },
};

/** Orders candidate models for a role: the model that is best at what the role needs comes first. */
export function rankModels(roleId: RoleId, priority: HirePriority, allModels = availableModels()): ModelInfo[] {
  const r = role(roleId);
  // Small local models only do the simplest work: light worker roles (copy, SEO).
  // Everywhere else they are a last resort, after every other model.
  const simple = r.tier === "light" && !r.isManager;
  const lastResort = simple ? [] : allModels.filter(isWeakLocal);
  const pool = lastResort.length < allModels.length ? allModels.filter((m) => !lastResort.includes(m)) : allModels;
  const tail = pool === allModels ? [] : lastResort;
  const q = (m: ModelInfo) => quality(m, r);
  const c = (m: ModelInfo) => apiCostPerTask(m, r);
  const billed = (m: ModelInfo) => estCostPerTask(m, r);
  // On equal weight, prefer what you already pay for (a subscription) over per-call billing.
  const byQuality = (a: ModelInfo, b: ModelInfo) => q(b) - q(a) || billed(a) - billed(b) || c(a) - c(b);
  const byCost = (a: ModelInfo, b: ModelInfo) => c(a) - c(b) || billed(a) - billed(b) || q(b) - q(a) || b.speed - a.speed;

  // Ultra-premium models only when the owner explicitly asks for maximum quality.
  const nonPremium = pool.filter((m) => !m.tags.includes("premium"));
  const base = priority === "quality" || !nonPremium.length ? pool : nonPremium;
  const strategy = strategyFor(roleId, priority);
  if (strategy === "best") return [...base.sort(byQuality), ...pool.filter((m) => !base.includes(m)).sort(byQuality), ...tail.sort(byQuality)];

  const maxQ = Math.max(...base.map(q));
  // near-best: anything within 1 point of the best, then the cheapest of those.
  // good-enough: anything scoring 6+, then the cheapest of those.
  const threshold = strategy === "near-best" ? maxQ - 1 - 1e-9 : Math.min(6, maxQ);
  // A free local model gets simple work once it is decent (5+); copy and SEO don't need a frontier model.
  const eligible = base.filter((m) => q(m) >= threshold || (simple && m.provider === "ollama" && q(m) >= 5)).sort(byCost);
  const rest = pool.filter((m) => !eligible.includes(m)).sort(byQuality);
  return [...eligible, ...rest, ...tail.sort(byQuality)];
}

function reasonsFor(m: ModelInfo, r: RoleDef): string[] {
  const en = store.settings.language === "en";
  const reasons: string[] = [];
  const topSkill = Object.entries(r.weights).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] as Skill | undefined;
  if (topSkill) {
    reasons.push(`${SKILL_NAMES[topSkill][en ? "en" : "tr"]}: ${m.skills[topSkill]}/10`);
  }
  const cost = estCostPerTask(m, r);
  if (m.tags.includes("subscription")) {
    const eq = apiCostPerTask(m, r);
    reasons.push(en ? `Included in your plan (API-equivalent ~$${eq.toFixed(3)}/task)` : `Aboneliğine dahil (API karşılığı ~$${eq.toFixed(3)}/görev)`);
  } else if (cost === 0) reasons.push(en ? "Free" : "Ücretsiz");
  else reasons.push(en ? `~$${cost.toFixed(3)} per task` : `Görev başına ~$${cost.toFixed(3)}`);
  if (m.speed >= 8) reasons.push(en ? "Very fast" : "Çok hızlı");
  if (m.tags.includes("local")) reasons.push(en ? "Runs on your machine" : "Bilgisayarınızda çalışır");
  if (m.notes) reasons.push(m.notes);
  return reasons;
}

export function recommend(roleId: RoleId, n = 3): Recommendation[] {
  const r = role(roleId);
  return rankModels(roleId, store.settings.hirePriority)
    .slice(0, n)
    .map((m) => ({
      modelKey: m.key,
      label: m.label,
      provider: m.provider,
      score: Math.round(quality(m, r) * 10) / 10,
      reasons: reasonsFor(m, r),
      estCostPerTask: estCostPerTask(m, r),
    }));
}

export const AIR_ENGINE_NAME = "AIR Engine";

/**
 * Employees are named after the AI that powers them ("Claude Sonnet 5.5").
 * Several employees on the same model get a number: "Claude Sonnet 5.5 #2".
 */
function nameFor(modelKey: string, selfId?: string): string {
  if (!modelKey) return AIR_ENGINE_NAME;
  const base = getModel(modelKey)?.label ?? modelKey;
  const taken = new Set(store.employees.filter((e) => e.id !== selfId).map((e) => e.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} #${n}`)) return `${base} #${n}`;
}

export function hire(roleId: RoleId, modelKey: string): Employee {
  const e: Employee = {
    id: randomUUID().slice(0, 8),
    name: nameFor(modelKey),
    effort: effortForRole(roleId),
    roleId,
    modelKey,
    hiredAt: new Date().toISOString(),
    status: "idle",
    stats: { inputTokens: 0, outputTokens: 0, costUsd: 0, tasksDone: 0, calls: 0 },
  };
  store.employees.push(e);
  store.touchCompany();
  staffEvents.emit("change");
  return e;
}

export function fire(employeeId: string): void {
  const e = store.employees.find((x) => x.id === employeeId);
  if (!e) throw new Error("Employee not found");
  if (FOUNDING_ROLES.includes(e.roleId)) throw new Error("Founding managers cannot be fired; change their model instead.");
  if (e.status === "busy") throw new Error("Employee is busy with a task.");
  store.employees = store.employees.filter((x) => x.id !== employeeId);
  store.touchCompany();
  staffEvents.emit("change");
}

export function setEffort(employeeId: string, effort: string): void {
  const e = store.employees.find((x) => x.id === employeeId);
  if (!e) throw new Error("Employee not found");
  if (effort !== "low" && effort !== "medium" && effort !== "high") throw new Error("Effort must be low, medium or high");
  e.effort = effort;
  store.touchCompany();
}

export function reassign(employeeId: string, modelKey: string): void {
  const e = store.employees.find((x) => x.id === employeeId);
  const m = getModel(modelKey);
  if (!e) throw new Error("Employee not found");
  if (!m || !isModelAvailable(m)) throw new Error("Model is not available");
  e.modelKey = modelKey;
  e.name = nameFor(modelKey, e.id);
  store.touchCompany();
}

/**
 * Boot-time housekeeping: hire the founding managers, and move anyone whose
 * model is no longer reachable (e.g. an API key was removed) to the best
 * available alternative.
 */
export function reconcileStaff(): string[] {
  const log: string[] = [];
  for (const roleId of FOUNDING_ROLES) {
    if (store.employees.some((e) => e.roleId === roleId)) continue;
    const top = roleId === "air-manager" ? "" : rankModels(roleId, store.settings.hirePriority)[0]?.key;
    if (top === undefined) continue;
    const e = hire(roleId, top);
    log.push(`${role(roleId).title.en}: ${e.name}`);
  }
  for (const e of store.employees) {
    if (e.roleId === "air-manager") continue;
    const m = getModel(e.modelKey);
    if (m && isModelAvailable(m)) continue;
    const next = rankModels(e.roleId, store.settings.hirePriority)[0];
    if (!next) continue;
    log.push(`${e.name}: ${m?.label ?? e.modelKey} → ${next.label}`);
    e.modelKey = next.key;
  }
  // Open requests may recommend models that are no longer reachable (e.g. demo mode ended): re-rank them.
  for (const req of store.staffing) {
    if (req.status !== "pending" || req.deliberating) continue;
    const stale = req.recommendations.some((rec) => {
      const m = getModel(rec.modelKey);
      return !m || !isModelAvailable(m);
    });
    if (!stale) continue;
    const fresh = recommend(req.roleId);
    if (!fresh.length) continue;
    req.recommendations = fresh;
    log.push(`${role(req.roleId).title.en} request re-ranked → ${fresh[0].label}`);
  }
  // Employees hired before effort levels existed get their role's default.
  for (const e of store.employees) {
    if (!e.effort && e.roleId !== "air-manager") {
      e.effort = effortForRole(e.roleId);
      log.push(`${e.name}: effort ${e.effort}`);
    }
  }
  // Keep names in sync with models (also migrates old human-style names).
  for (const e of store.employees) {
    const expected = nameFor(e.modelKey, e.id);
    const base = e.roleId === "air-manager" ? AIR_ENGINE_NAME : (getModel(e.modelKey)?.label ?? e.modelKey);
    if (!e.name.startsWith(base)) e.name = expected;
  }
  store.touchCompany();
  return log;
}

export const employeesOf = (roleId: RoleId) => store.employees.filter((e) => e.roleId === roleId);

export const pendingRequestsFor = (projectId: string, roleId: RoleId) =>
  store.staffing.filter((s) => s.projectId === projectId && s.roleId === roleId && s.status === "pending");

/** One worker per this many open tasks of a role (up to maxPerRole). */
const TASKS_PER_WORKER = 2;

/**
 * Sizes every team to its workload. A department with only a little work
 * (up to `managerHandlesUpTo` open tasks) gets no new hires: its manager does
 * the work personally. Busier teams get one worker per TASKS_PER_WORKER open
 * tasks per role, up to maxPerRole. Returns the requests opened and the
 * departments left to their managers.
 */
export function assessStaffing(project: Project): { created: StaffingRequest[]; managerHandled: { department: WorkDepartmentId; tasks: number }[] } {
  const en = store.settings.language === "en";
  const created: StaffingRequest[] = [];
  const managerHandled: { department: WorkDepartmentId; tasks: number }[] = [];
  const open = project.tasks.filter((t) => t.round === project.round && (t.status === "pending" || t.status === "in_progress"));
  const workerTasks = open.filter((t) => !role(t.roleId).isManager);

  for (const dept of [...new Set(workerTasks.map((t) => t.department))]) {
    const deptTasks = workerTasks.filter((t) => t.department === dept);
    const roles = [...new Set(deptTasks.map((t) => t.roleId))];
    const nobodyYet = roles.every((r) => employeesOf(r).length === 0);
    if (deptTasks.length <= store.settings.managerHandlesUpTo) {
      if (nobodyYet) managerHandled.push({ department: dept, tasks: deptTasks.length });
      continue;
    }
    for (const roleId of roles) assessRole(roleId, deptTasks.filter((t) => t.roleId === roleId).length);
  }
  if (created.length) store.touchCompany();
  return { created, managerHandled };

  function assessRole(roleId: RoleId, workload: number) {
    const desired = Math.max(1, Math.min(store.settings.maxPerRole, Math.ceil(workload / TASKS_PER_WORKER)));
    const have = employeesOf(roleId).length;
    const waiting = pendingRequestsFor(project.id, roleId).length;
    // A rejected request for this role in this project means "don't ask again".
    const rejected = store.staffing.some(
      (s) => s.projectId === project.id && s.roleId === roleId && s.status === "rejected",
    );
    if (rejected) return;

    const r = role(roleId);
    const plan = `${STRATEGY_TEXT[strategyFor(roleId, store.settings.hirePriority)][en ? "en" : "tr"]}, ${effortForRole(roleId)} effort`;
    for (let i = have + waiting; i < desired; i++) {
      const recs = recommend(roleId);
      if (!recs.length) break;
      const req: StaffingRequest = {
        id: randomUUID().slice(0, 8),
        projectId: project.id,
        roleId,
        reason: en
          ? `${workload} open ${r.title.en} task(s), team has ${have}; aiming for ${desired}. ${plan}.`
          : `${workload} açık ${r.title.tr} işi var, ekipte ${have} kişi var; hedef ${desired}. ${plan}.`,
        recommendations: recs,
        status: "pending",
        approver: store.settings.hireApproval,
        createdAt: new Date().toISOString(),
      };
      store.staffing.push(req);
      created.push(req);
    }
  }
}

/** Moves every idle employee to the best-fitting model for their role under the current rules. */
export function rebalance(): string[] {
  const log: string[] = [];
  for (const e of store.employees) {
    if (e.roleId === "air-manager" || e.status === "busy") continue;
    const best = rankModels(e.roleId, store.settings.hirePriority)[0];
    const effort = effortForRole(e.roleId);
    if (!best || (best.key === e.modelKey && e.effort === effort)) continue;
    const before = `${e.name} (${e.effort ?? "?"})`;
    e.modelKey = best.key;
    e.effort = effort;
    e.name = nameFor(best.key, e.id);
    log.push(`${role(e.roleId).title.en}: ${before} → ${e.name} (${effort})`);
  }
  if (log.length) {
    store.touchCompany();
    staffEvents.emit("change");
  }
  return log;
}

export function resolveRequest(
  id: string,
  decision: "approve" | "reject",
  modelKey?: string,
  note?: string,
): { request: StaffingRequest; employee?: Employee } {
  const req = store.staffing.find((s) => s.id === id);
  if (!req) throw new Error("Staffing request not found");
  if (req.status !== "pending") throw new Error("Request already resolved");

  req.deliberating = false;
  if (note) req.decisionNote = note;
  if (decision === "reject") {
    req.status = "rejected";
    store.touchCompany();
    staffEvents.emit("change");
    return { request: req };
  }

  const key = modelKey ?? req.recommendations[0]?.modelKey;
  const m = key ? getModel(key) : undefined;
  if (!m || !isModelAvailable(m)) throw new Error("Selected model is not available");
  const employee = hire(req.roleId, m.key);
  req.status = "approved";
  req.chosenModelKey = m.key;
  req.employeeId = employee.id;
  store.touchCompany();
  return { request: req, employee };
}
