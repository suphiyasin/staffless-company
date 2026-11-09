import type { JsonSchema } from "../providers/types.ts";
import type { RoleId, WorkDepartmentId } from "../types.ts";

// Every object is closed (additionalProperties: false) and lists every key as
// required, so the same schema works with Claude structured outputs and
// OpenAI strict mode.

const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const str = (description?: string): JsonSchema => ({ type: "string", ...(description ? { description } : {}) });

export const ceoPlanSchema = (departments: WorkDepartmentId[]): JsonSchema =>
  obj({
    title: str("Short project name, max 5 words"),
    summary: str("What will be built, in 3-6 sentences. This is the brief every department reads."),
    reply: str("Your message to the client: confirm you understood and explain the plan briefly."),
    departments: {
      type: "array",
      items: obj({
        department: { type: "string", enum: departments },
        goal: str("What this department must deliver"),
      }),
    },
  });

export const managerPlanSchema = (roles: RoleId[]): JsonSchema =>
  obj({
    reply: str("Short message to the CEO accepting the job and describing your team's plan."),
    tasks: {
      type: "array",
      items: obj({
        key: str("Unique short id like 'software-1'"),
        title: str(),
        description: str("Detailed instructions: exactly which files to create and what they must contain."),
        role: { type: "string", enum: roles },
        dependsOn: { type: "array", items: str("key of a task that must finish first") },
      }),
    },
  });

export const taskResultSchema: JsonSchema = obj({
  summary: str("What you did, 1-3 sentences."),
  message: str("Short message to your manager."),
  files: {
    type: "array",
    description: "New files, or full rewrites. Leave empty when edits cover your changes.",
    items: obj({
      path: str("Relative path inside the project, e.g. 'index.html' or 'assets/logo.svg'"),
      content: str("Full file content"),
    }),
  },
  needFiles: {
    type: "array",
    description: "Paths you must see in full before you can do the task well (only files listed in the project, not shown in full). Leave files and edits empty when you ask.",
    items: str("Project file path"),
  },
  edits: {
    type: "array",
    description: "Find/replace changes to EXISTING files whose full content you were given. Much cheaper than rewriting.",
    items: obj({
      path: str("Existing file to change"),
      find: str("Exact text copied from the current file; must occur exactly once. Include enough surrounding lines to be unique."),
      replace: str("Replacement text"),
    }),
  },
});

export const reviewSchema: JsonSchema = obj({
  approved: { type: "boolean" },
  feedback: str("If not approved: concrete list of what must change. If approved: empty string."),
  message: str("Short message to the employee."),
});

export const qaReviewSchema: JsonSchema = obj({
  approved: { type: "boolean", description: "Is the tester's report thorough and credible?" },
  feedback: str("If the report is not good enough: what the tester must redo. Otherwise empty string."),
  productPassed: { type: "boolean", description: "Is the product ready to ship (no blocking or clearly visible bugs left)?" },
  issues: { type: "array", items: str("One concrete defect engineering must fix, naming the file") },
  message: str("Short message to the tester."),
});

export const designReviewSchema: JsonSchema = obj({
  approved: { type: "boolean", description: "Does the built site follow the design and look finished on desktop and phone?" },
  issues: { type: "array", items: str("One visible design defect engineering must fix: the element, what is wrong, the file if known") },
  message: str("Short note to the QA Manager."),
});
export interface DesignReview {
  approved: boolean;
  issues: string[];
  message: string;
}

export const hireDecisionSchema = (requestIds: string[], choices: string[]): JsonSchema =>
  obj({
    decisions: {
      type: "array",
      items: obj({
        requestId: { type: "string", enum: requestIds },
        choice: { type: "string", enum: [...choices, "reject"], description: "modelKey of the candidate to hire, or 'reject'" },
        message: str("One or two sentences to AI Resources explaining your decision."),
      }),
    },
  });

export const deliverySchema: JsonSchema = obj({
  message: str("Delivery message to the client: what was built, how to open it, what to try next."),
});

export interface CeoPlan {
  title: string;
  summary: string;
  reply: string;
  departments: { department: WorkDepartmentId; goal: string }[];
}
export interface ManagerPlan {
  reply: string;
  tasks: { key: string; title: string; description: string; role: RoleId; dependsOn: string[] }[];
}
export interface TaskResult {
  summary: string;
  message: string;
  files: { path: string; content: string }[];
  edits: { path: string; find: string; replace: string }[];
  needFiles: string[];
}
export interface Review {
  approved: boolean;
  feedback: string;
  message: string;
}
export interface QaReview extends Review {
  productPassed: boolean;
  issues: string[];
}
export interface HireDecision {
  decisions: { requestId: string; choice: string; message: string }[];
}
export interface Delivery {
  message: string;
}

/** Minimal validator for the schema subset above. Returns a list of problems. */
export function validate(value: unknown, schema: JsonSchema, at = "$"): string[] {
  const errs: string[] = [];
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${at} must be an object`];
      const v = value as Record<string, unknown>;
      for (const k of schema.required ?? []) if (!(k in v)) errs.push(`${at}.${k} is missing`);
      for (const [k, sub] of Object.entries(schema.properties ?? {})) {
        if (k in v) errs.push(...validate(v[k], sub, `${at}.${k}`));
      }
      break;
    }
    case "array":
      if (!Array.isArray(value)) return [`${at} must be an array`];
      if (schema.items) value.forEach((item, i) => errs.push(...validate(item, schema.items!, `${at}[${i}]`)));
      break;
    case "string":
      if (typeof value !== "string") errs.push(`${at} must be a string`);
      break;
    case "boolean":
      if (typeof value !== "boolean") errs.push(`${at} must be a boolean`);
      break;
    case "number":
    case "integer":
      if (typeof value !== "number") errs.push(`${at} must be a number`);
      break;
  }
  if (schema.enum && !schema.enum.includes(value as string)) {
    errs.push(`${at} must be one of ${schema.enum.join(", ")}`);
  }
  return errs;
}
