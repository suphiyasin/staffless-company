import type { DepartmentId, Effort, Lang, RoleId, Skill, WorkDepartmentId } from "../types.ts";

export interface DepartmentDef {
  id: DepartmentId;
  name: Record<Lang, string>;
  color: string;
  managerRole: RoleId;
}

export interface RoleDef {
  id: RoleId;
  department: DepartmentId;
  title: Record<Lang, string>;
  isManager: boolean;
  /**
   * How much the role depends on raw model quality. Under the default priority AI Resources hires
   * the best model for "critical" roles, the cheapest near-best for "standard" ones and the
   * cheapest good-enough model for "light" ones.
   */
  tier: "critical" | "standard" | "light";
  /** How much each skill matters for this role (weights sum to 1). */
  weights: Partial<Record<Skill, number>>;
  /** What this role is responsible for; injected into prompts. */
  duty: string;
  /** Rough output size per task, used for cost estimates (tokens). */
  typicalTokens: { input: number; output: number };
}

export const DEPARTMENTS: DepartmentDef[] = [
  { id: "management", name: { tr: "Yönetim", en: "Management" }, color: "#a78bfa", managerRole: "ceo" },
  { id: "design", name: { tr: "Grafik & Tasarım", en: "Design" }, color: "#f472b6", managerRole: "design-manager" },
  { id: "content", name: { tr: "İçerik", en: "Content" }, color: "#fbbf24", managerRole: "content-manager" },
  { id: "software", name: { tr: "Yazılım", en: "Software" }, color: "#60a5fa", managerRole: "software-manager" },
  { id: "qa", name: { tr: "Test & Kalite", en: "Quality" }, color: "#34d399", managerRole: "qa-manager" },
  {
    id: "ai-resources",
    name: { tr: "Yapay Zekâ Kaynakları", en: "AI Resources" },
    color: "#fb923c",
    managerRole: "air-manager",
  },
];

/** Order in which department managers plan (later ones can depend on earlier tasks). */
export const WORK_DEPARTMENTS: WorkDepartmentId[] = ["design", "content", "software", "qa"];

export const ROLES: RoleDef[] = [
  {
    id: "ceo",
    department: "management",
    title: { tr: "Genel Müdür", en: "CEO" },
    isManager: true,
    tier: "critical",
    weights: { planning: 0.7, writing: 0.2, review: 0.1 },
    duty: "Talks to the owner, understands the request, decides which departments work on it and delivers the result.",
    typicalTokens: { input: 3000, output: 1500 },
  },
  {
    id: "design-manager",
    department: "design",
    title: { tr: "Grafik Müdürü", en: "Design Manager" },
    isManager: true,
    tier: "standard",
    weights: { planning: 0.4, design: 0.4, review: 0.2 },
    duty: "Plans the visual identity and interface design, assigns design work to the team and reviews it.",
    typicalTokens: { input: 4000, output: 2000 },
  },
  {
    id: "content-manager",
    department: "content",
    title: { tr: "İçerik Müdürü", en: "Content Manager" },
    isManager: true,
    tier: "light",
    weights: { planning: 0.4, writing: 0.4, review: 0.2 },
    duty: "Plans the copy, tone of voice and SEO, assigns the work to the team and reviews it.",
    typicalTokens: { input: 4000, output: 2000 },
  },
  {
    id: "software-manager",
    department: "software",
    title: { tr: "Yazılım Müdürü", en: "Engineering Manager" },
    isManager: true,
    tier: "critical",
    weights: { planning: 0.4, coding: 0.4, review: 0.2 },
    duty: "Owns the technical architecture and stack, assigns engineering work to the team, reviews the code, then hands finished work to QA.",
    typicalTokens: { input: 5000, output: 2000 },
  },
  {
    id: "qa-manager",
    department: "qa",
    title: { tr: "Kalite Müdürü", en: "QA Manager" },
    isManager: true,
    tier: "standard",
    weights: { planning: 0.3, review: 0.6, coding: 0.1 },
    duty: "Verifies before delivery that everything matches the request and works; signs off or sends work back to engineering.",
    typicalTokens: { input: 6000, output: 1500 },
  },
  {
    id: "air-manager",
    department: "ai-resources",
    title: { tr: "YZK Müdürü", en: "Head of AI Resources" },
    isManager: true,
    tier: "light",
    weights: { planning: 1 },
    duty: "Tracks every department's headcount, ranks suitable AI models and hires the one the requesting manager approves.",
    typicalTokens: { input: 0, output: 0 },
  },
  {
    id: "ui-designer",
    department: "design",
    title: { tr: "UI/UX Tasarımcı", en: "UI/UX Designer" },
    isManager: false,
    tier: "standard",
    weights: { design: 0.7, writing: 0.1, coding: 0.2 },
    duty: "Produces a design system document (markdown) covering palette, typography, layout and components, plus CSS variables when useful.",
    typicalTokens: { input: 3000, output: 4000 },
  },
  {
    id: "graphic-designer",
    department: "design",
    title: { tr: "Grafik Tasarımcı", en: "Graphic Designer" },
    isManager: false,
    tier: "standard",
    weights: { design: 0.6, coding: 0.4 },
    duty: "Draws logos, icons and illustrations as clean, hand-written SVG files.",
    typicalTokens: { input: 2500, output: 4000 },
  },
  {
    id: "copywriter",
    department: "content",
    title: { tr: "Metin Yazarı", en: "Copywriter" },
    isManager: false,
    tier: "light",
    weights: { writing: 0.8, planning: 0.2 },
    duty: "Writes headlines, taglines, descriptions and button copy for each page (markdown).",
    typicalTokens: { input: 2500, output: 3000 },
  },
  {
    id: "seo-specialist",
    department: "content",
    title: { tr: "SEO Uzmanı", en: "SEO Specialist" },
    isManager: false,
    tier: "light",
    weights: { writing: 0.5, coding: 0.2, planning: 0.3 },
    duty: "Prepares keywords, meta tags, page titles and structured-data suggestions.",
    typicalTokens: { input: 2500, output: 2000 },
  },
  {
    id: "frontend-developer",
    department: "software",
    title: { tr: "Frontend Geliştirici", en: "Frontend Developer" },
    isManager: false,
    tier: "critical",
    weights: { coding: 0.75, design: 0.25 },
    duty: "Builds responsive, accessible interfaces with HTML, CSS and JavaScript (or the templates of the chosen stack).",
    typicalTokens: { input: 8000, output: 12000 },
  },
  {
    id: "backend-developer",
    department: "software",
    title: { tr: "Backend Geliştirici", en: "Backend Developer" },
    isManager: false,
    tier: "critical",
    weights: { coding: 0.85, planning: 0.15 },
    duty: "Writes server-side code, API endpoints and data models in the stack the owner asked for (PHP, Python, Node.js…).",
    typicalTokens: { input: 8000, output: 12000 },
  },
  {
    id: "qa-tester",
    department: "qa",
    title: { tr: "Test Uzmanı", en: "QA Tester" },
    isManager: false,
    tier: "standard",
    weights: { review: 0.7, coding: 0.3 },
    duty: "Reviews the produced files line by line, finds bugs, fixes small ones directly and writes a test report listing anything engineering must fix.",
    typicalTokens: { input: 15000, output: 5000 },
  },
];

/** Thinking depth per tier: deep where quality matters most, quick where the work is light. */
export const TIER_EFFORT: Record<RoleDef["tier"], Effort> = { critical: "high", standard: "medium", light: "low" };

export const effortForRole = (id: RoleId): Effort => TIER_EFFORT[role(id).tier];

export const role = (id: RoleId): RoleDef => {
  const r = ROLES.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown role: ${id}`);
  return r;
};

export const department = (id: DepartmentId): DepartmentDef => DEPARTMENTS.find((d) => d.id === id)!;

export const workerRolesOf = (dept: DepartmentId): RoleDef[] =>
  ROLES.filter((r) => r.department === dept && !r.isManager);

export const managerOf = (dept: DepartmentId): RoleId => department(dept).managerRole;

/** Founding team: hired automatically on first boot. */
export const FOUNDING_ROLES: RoleId[] = [
  "ceo",
  "air-manager",
  "design-manager",
  "content-manager",
  "software-manager",
  "qa-manager",
];
