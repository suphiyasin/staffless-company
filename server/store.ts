import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import { bus } from "./events.ts";
import type {
  CompanySnapshot,
  Employee,
  Project,
  ProjectSummary,
  Settings,
  StaffingRequest,
  Usage,
} from "./types.ts";

const DEFAULT_SETTINGS: Settings = {
  hireApproval: "manager",
  hirePriority: "balanced",
  contextBudget: 24_000,
  maxPerRole: 3,
  managerHandlesUpTo: 1,
  maxParallel: 5,
  maxRevisions: 1,
  maxFixRounds: 1,
  budgetUsd: 0,
  language: config.language,
};

interface CompanyFile {
  settings: Settings;
  employees: Employee[];
  staffing: StaffingRequest[];
}

const companyPath = () => path.join(config.paths.data, "company.json");
const projectsDir = () => path.join(config.paths.data, "projects");

function writeJsonAtomic(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 });

/**
 * In-memory state with debounced persistence to ./data and throttled
 * broadcasting to the web panel. Everything mutates objects in place and then
 * calls touchCompany() / touchProject().
 */
class Store {
  settings: Settings = { ...DEFAULT_SETTINGS };
  employees: Employee[] = [];
  staffing: StaffingRequest[] = [];
  projects = new Map<string, Project>();

  private companyTimer: NodeJS.Timeout | null = null;
  private projectTimers = new Map<string, NodeJS.Timeout>();
  private snapshotBuilder: (() => CompanySnapshot) | null = null;

  setSnapshotBuilder(fn: () => CompanySnapshot) {
    this.snapshotBuilder = fn;
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(companyPath(), "utf8")) as Partial<CompanyFile>;
      const legacy = raw.settings as (Partial<Settings> & { autoApproveHires?: boolean }) | undefined;
      this.settings = { ...DEFAULT_SETTINGS, ...(legacy ?? {}) };
      if (legacy && !legacy.hireApproval && legacy.autoApproveHires !== undefined) {
        this.settings.hireApproval = legacy.autoApproveHires ? "auto" : "manager";
      }
      delete (this.settings as { autoApproveHires?: boolean }).autoApproveHires;
      this.employees = raw.employees ?? [];
      this.staffing = (raw.staffing ?? []).map((s) => ({ ...s, approver: s.approver ?? "client", deliberating: false }));
    } catch {
      /* first boot */
    }
    // Nobody can be mid-task right after a restart.
    for (const e of this.employees) {
      e.status = "idle";
      delete e.currentTask;
    }

    if (fs.existsSync(projectsDir())) {
      for (const f of fs.readdirSync(projectsDir())) {
        if (!f.endsWith(".json")) continue;
        try {
          const p = JSON.parse(fs.readFileSync(path.join(projectsDir(), f), "utf8")) as Project;
          p.context ??= { queries: 0, tokensSent: 0, tokensFull: 0 };
          if (p.status === "planning" || p.status === "in_progress" || p.status === "delivering") {
            p.status = "paused";
            for (const t of p.tasks) {
              if (t.status === "in_progress" || t.status === "review") t.status = "pending";
            }
          }
          this.projects.set(p.id, p);
        } catch (err) {
          console.warn(`Could not read project ${f}:`, err);
        }
      }
    }
  }

  touchCompany() {
    if (this.companyTimer) return;
    this.companyTimer = setTimeout(() => {
      this.companyTimer = null;
      const file: CompanyFile = { settings: this.settings, employees: this.employees, staffing: this.staffing };
      writeJsonAtomic(companyPath(), file);
      if (this.snapshotBuilder) bus.publish({ type: "company", data: this.snapshotBuilder() });
    }, 120);
  }

  touchProject(p: Project) {
    p.updatedAt = new Date().toISOString();
    if (this.projectTimers.has(p.id)) return;
    this.projectTimers.set(
      p.id,
      setTimeout(() => {
        this.projectTimers.delete(p.id);
        // A late write from an aborted task must not resurrect a deleted project.
        if (this.projects.get(p.id) !== p) return;
        writeJsonAtomic(path.join(projectsDir(), `${p.id}.json`), p);
        bus.publish({ type: "project", data: p });
        bus.publish({ type: "projects", data: this.projectSummaries() });
      }, 120),
    );
  }

  deleteProject(id: string) {
    clearTimeout(this.projectTimers.get(id));
    this.projectTimers.delete(id);
    this.projects.delete(id);
    fs.rmSync(path.join(projectsDir(), `${id}.json`), { force: true });
    bus.publish({ type: "projects", data: this.projectSummaries() });
  }

  projectSummaries(): ProjectSummary[] {
    return [...this.projects.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => ({ id: p.id, title: p.title, status: p.status, createdAt: p.createdAt, usage: p.usage }));
  }

  totalUsage(): Usage {
    const u = emptyUsage();
    for (const p of this.projects.values()) {
      u.inputTokens += p.usage.inputTokens;
      u.outputTokens += p.usage.outputTokens;
      u.costUsd += p.usage.costUsd;
    }
    return u;
  }
}

export const store = new Store();
