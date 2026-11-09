// Shared domain types. Imported by both the server and the web panel.

export type ProviderId = "anthropic" | "openai" | "gemini" | "ollama" | "compat" | "claude-cli" | "codex-cli" | "mock";
export type Skill = "planning" | "coding" | "design" | "writing" | "review";
export type Lang = "tr" | "en";

export type DepartmentId = "management" | "design" | "content" | "software" | "qa" | "ai-resources";
export type WorkDepartmentId = "design" | "content" | "software" | "qa";

export type RoleId =
  | "ceo"
  | "design-manager"
  | "content-manager"
  | "software-manager"
  | "qa-manager"
  | "air-manager"
  | "ui-designer"
  | "graphic-designer"
  | "copywriter"
  | "seo-specialist"
  | "frontend-developer"
  | "backend-developer"
  | "qa-tester";

export interface ModelInfo {
  key: string;
  provider: ProviderId;
  model: string;
  label: string;
  skills: Record<Skill, number>;
  speed: number;
  price: { input: number; output: number };
  tags: string[];
  notes: string;
  discovered?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Employee {
  id: string;
  name: string;
  roleId: RoleId;
  modelKey: string;
  /** How hard this employee thinks on each task; set at hiring from the role's tier. */
  effort?: Effort;
  hiredAt: string;
  status: "idle" | "busy";
  currentTask?: { projectId: string; taskId: string; title: string };
  stats: Usage & { tasksDone: number; calls: number };
}

export type HirePriority = "quality" | "balanced" | "economy";
export type Effort = "low" | "medium" | "high";
/** Who signs off on a hire: the manager who asked for the worker, the client, or nobody. */
export type HireApproval = "manager" | "client" | "auto";

export interface Settings {
  hireApproval: HireApproval;
  hirePriority: HirePriority;
  /** Max tokens of file context an agent receives per task (the project map is always included). */
  contextBudget: number;
  maxPerRole: number;
  /** A department with at most this many open tasks gets no hires: its manager does the work. */
  managerHandlesUpTo: number;
  maxParallel: number;
  maxRevisions: number;
  /** How many times QA may send engineering back to fix bugs before delivery. */
  maxFixRounds: number;
  budgetUsd: number; // 0 = unlimited, per project
  language: Lang;
}

export interface Recommendation {
  modelKey: string;
  label: string;
  provider: ProviderId;
  score: number;
  reasons: string[];
  estCostPerTask: number;
}

export interface StaffingRequest {
  id: string;
  projectId: string;
  roleId: RoleId;
  reason: string;
  recommendations: Recommendation[];
  status: "pending" | "approved" | "rejected";
  /** Who must decide while pending; who decided once resolved. */
  approver: HireApproval;
  /** True while the requesting manager (an AI) is deliberating. */
  deliberating?: boolean;
  decisionNote?: string;
  chosenModelKey?: string;
  employeeId?: string;
  createdAt: string;
}

export type TaskStatus = "pending" | "in_progress" | "review" | "done" | "failed";

export interface Task {
  id: string;
  round: number;
  title: string;
  description: string;
  department: WorkDepartmentId;
  roleId: RoleId;
  dependsOn: string[];
  status: TaskStatus;
  assigneeId?: string;
  revisions: number;
  feedback?: string;
  output?: { summary: string; files: string[] };
  error?: string;
  /** "fix" tasks are opened by a manager after QA rejects; "retest" verifies them. */
  kind?: "fix" | "retest";
  /** Files the employee asked to see in full (graph query); always included next time. */
  extraSeeds?: string[];
  /** QA sign-off on a qa-tester task: does the product pass? */
  qa?: { passed: boolean; issues: string[] };
}

/**
 * Where a message is posted. The owner (you) only sits in "boss": the
 * management line with the CEO and department heads. Day-to-day work between a
 * manager and their team stays in that department's channel.
 */
export type FeedChannel = "boss" | WorkDepartmentId | "ai-resources";

export interface Speaker {
  kind: "client" | "employee" | "system";
  name: string;
  roleId?: RoleId;
  employeeId?: string;
}

export interface FeedMessage {
  id: string;
  at: string;
  from: Speaker;
  to?: string;
  text: string;
  kind: "chat" | "handoff" | "hire" | "deliverable" | "review" | "error" | "report";
  taskId?: string;
  channel?: FeedChannel;
  files?: string[];
  tone?: "good" | "bad";
  /** Screenshot files (from the browser check) shown with the message. */
  images?: string[];
}

export interface VisualShot {
  file: string;
  page: string;
  viewport: "desktop" | "mobile";
}

/** What the headless browser saw when QA opened the site. */
export interface VisualReport {
  at: string;
  url: string;
  pages: string[];
  shots: VisualShot[];
  issues: string[];
  /** Why the check could not run (no browser, PHP not started…). */
  skipped?: string;
}

export type ProjectStatus =
  | "planning"
  | "in_progress"
  | "delivering"
  | "done"
  | "failed"
  | "cancelled"
  | "paused";

export interface DepartmentBrief {
  department: WorkDepartmentId;
  goal: string;
}

export interface Project {
  id: string;
  title: string;
  brief: string;
  round: number;
  requests: string[]; // brief + every follow-up revision request
  /** Design picked by the owner from the library (copied into design/). */
  designId?: string;
  designName?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  departments: DepartmentBrief[];
  tasks: Task[];
  feed: FeedMessage[];
  files: string[];
  usage: Usage;
  context: ContextStats;
  /** QA gate state for the current round: how many fix cycles QA has sent back. */
  gate?: { round: number; cycles: number };
  /** Department hand-off reports already posted ("round:dept:cycle"). */
  announced?: string[];
  /** Latest browser check (screenshots + findings). */
  visual?: VisualReport;
  error?: string;
}

export interface ContextStats {
  /** Agent calls that received graph-selected context. */
  queries: number;
  /** Context tokens actually sent. */
  tokensSent: number;
  /** Tokens it would have cost to send every project file each time. */
  tokensFull: number;
  /** Output tokens avoided because workers sent find/replace edits instead of whole files. */
  outputSaved?: number;
  /** Calls avoided because syntax errors were bounced back before a manager review. */
  reviewsSkipped?: number;
}

export interface ContextFile {
  path: string;
  kind: "html" | "css" | "js" | "php" | "py" | "code" | "sql" | "template" | "config" | "md" | "svg" | "json" | "other";
  tokens: number;
  summary: string;
  headings: string[];
  defines: string[];
  uses: string[];
  refs: string[];
}

export interface ContextLink {
  from: string;
  to: string;
  rel: "links" | "uses";
  weight: number;
  via: string[];
}

export interface ContextReport {
  files: ContextFile[];
  links: ContextLink[];
  binaries: string[];
  map: string;
  issues: string[];
  symbols: number;
}

export interface DesignMeta {
  id: string;
  name: string;
  description: string;
  tags: string[];
  bestFor: string[];
  /** Google Fonts families, e.g. "Oswald:500,700". */
  fonts: string[];
  colors: { bg: string; surface: string; text: string; primary: string; accent: string };
  source: "library" | "custom";
}

export interface TelegramStatus {
  configured: boolean;
  tokenSource: "env" | "panel" | null;
  bot?: string;
  connected: boolean;
  error?: string;
  chats: { id: number; name: string }[];
  pairingCode?: string;
  notify: "important" | "all";
}

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  configured: boolean;
  detail?: string;
}

export interface CompanySnapshot {
  settings: Settings;
  employees: Employee[];
  staffing: StaffingRequest[];
  providers: ProviderStatus[];
  catalog: ModelInfo[];
  demoMode: boolean;
  totalUsage: Usage;
  /** Local interpreters found for free syntax checks and running PHP previews. */
  tools: { php: boolean; python: boolean; browser: boolean };
  /** False while a provider is unreachable and work is paused waiting for it. */
  network: { online: boolean; waitingFor?: string; since?: string };
  telegram: TelegramStatus;
}

export interface ProjectSummary {
  id: string;
  title: string;
  status: ProjectStatus;
  createdAt: string;
  usage: Usage;
}

export type ServerEvent =
  | { type: "company"; data: CompanySnapshot }
  | { type: "project"; data: Project }
  | { type: "projects"; data: ProjectSummary[] };
