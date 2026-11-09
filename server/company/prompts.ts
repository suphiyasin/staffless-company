import { store } from "../store.ts";
import type { Employee, Project, StaffingRequest, Task, WorkDepartmentId } from "../types.ts";
import { department, role, workerRolesOf } from "./org.ts";
import { REQUIRED_TOKENS } from "../designs.ts";

const langName = () => (store.settings.language === "en" ? "English" : "Turkish");

export function systemPrompt(e: Employee): string {
  const r = role(e.roleId);
  const d = department(r.department);
  return `You are ${e.name}, working as the ${r.title.en} in the ${d.name.en} department of "Staffless", a digital agency with no human staff: every employee is an AI model. Colleagues address you by your model name.

Your responsibility: ${r.duty}

How the company works:
- The company owner (everyone's boss) sends a request. The owner only deals with the CEO and the department managers; employees report to their own manager, never to the owner directly.
- The CEO plans which departments are involved. Each department manager splits the work into tasks, supervises their team, reviews every result and asks for fixes. When engineering is done, the Engineering Manager hands the work to QA; if QA finds bugs, engineering fixes them and QA re-tests. Only then does the CEO deliver to the owner.
- When a manager lacks staff, AI Resources (the AI counterpart of Human Resources) proposes a model to hire and the manager accepts or declines.
- Project files are indexed in a context graph. You receive the full content of the files relevant to your task plus a one-line summary of every other file, which keeps work fast and cheap. Trust the map; ask for nothing you don't need.
- Managers' messages to the CEO and the owner appear in the management channel; team work stays in your department's channel. Keep messages short, warm and professional.
- Write all human-facing text (chat messages, summaries, documents) in ${langName()}. Website copy uses the client's language unless the client asks otherwise.
- Do not invent facts about the owner's business (prices, addresses, phone numbers). Use clearly marked placeholders instead.`;
}

/**
 * Tells every role about the project's design: the library design the owner picked,
 * the design system the team already wrote, or the instruction to write one.
 */
export const designNote = (p: Project) => {
  if (p.designId)
    return `\n\nDESIGN CHOSEN BY THE OWNER: "${p.designName}" (${p.designId}). Its files are in the project: design/DESIGN.md (principles, components, do/don't) and design/tokens.css (CSS variables). Design team: adapt this design to the project instead of inventing a new design system; keep its principles, palette and fonts. Engineering: link design/tokens.css before your own CSS, use its variables instead of hard-coded colours, fonts and radii, and load the fonts DESIGN.md lists.`;
  if (p.files.includes("design/tokens.css"))
    return `\n\nPROJECT DESIGN SYSTEM: design/DESIGN.md and design/tokens.css define this project's style (written by the design team). Keep to them. Engineering: link design/tokens.css before your own CSS, use its variables instead of hard-coded values, and load the fonts DESIGN.md lists.`;
  return `\n\nNO LIBRARY DESIGN WAS CHOSEN. If the project has a visual interface, the design team's FIRST task is the project's own design system, written in the shared design-library format so any model (and future projects) can reuse it:
- design/DESIGN.md: begins with frontmatter between --- lines (id: kebab-case, name, description: one sentence, tags: [three words], best_for: [kinds of sites], fonts: [Google Fonts families such as Inter:400,700]), then the sections Principles, Layout, Typography, Color, Components, Imagery & icons, Motion, Do, Don't. Concrete rules, about 600 tokens.
- design/tokens.css: a single :root block that defines every one of these variables: ${REQUIRED_TOKENS.join(", ")}.
Other design work (logo, mockups) and all engineering depend on that task. Engineering: link design/tokens.css before your own CSS and use its variables instead of hard-coded colours, fonts and radii.`;
};

const requestHistory = (p: Project) =>
  (p.requests.length === 1
    ? `OWNER'S REQUEST:\n${p.requests[0]}`
    : `OWNER'S ORIGINAL REQUEST:\n${p.requests[0]}\n\nFOLLOW-UP REQUESTS (latest last):\n${p.requests
        .slice(1)
        .map((r, i) => `${i + 1}. ${r}`)
        .join("\n")}`) + designNote(p);

export function ceoPlanPrompt(p: Project, map: string): string {
  const revision = p.round > 1;
  return `${requestHistory(p)}

${
  revision
    ? `This is revision round ${p.round}. PROJECT MAP (one line per existing file):\n${map || "(empty)"}\n\nPlan ONLY the work needed for the latest follow-up request. Involve only the departments that are really needed (usually software, plus qa).`
    : "Plan the project."
}

Available departments and what they do:
- design: visual identity, design system document, logo and icons as SVG
- content: website copy, tone of voice, SEO
- software: the actual code, in whatever stack the owner asks for (PHP, Python/Flask, Node.js, …). If no stack is named, default to a static HTML/CSS/JS site that opens directly in a browser with no build step. Mention the chosen stack in the summary.
- qa: reviews all files, fixes small bugs, writes a test report

Pick only the departments the job needs; every extra department costs time and money. Include qa for anything that produces code.`;
}

export function managerPlanPrompt(p: Project, dept: WorkDepartmentId, goal: string, otherTasks: Task[], map: string): string {
  const roles = workerRolesOf(dept)
    .map((r) => `- ${r.id}: ${r.title.en}. ${r.duty}`)
    .join("\n");
  const others = otherTasks.length
    ? otherTasks.map((t) => `- [${t.id}] (${t.department}/${t.roleId}) ${t.title}`).join("\n")
    : "(none yet)";
  return `${requestHistory(p)}

PROJECT SUMMARY FROM THE CEO:
${p.summary}

YOUR DEPARTMENT'S GOAL:
${goal}

${p.round > 1 ? `PROJECT MAP (one line per existing file):\n${map || "(empty)"}\n\n` : ""}TASKS ALREADY PLANNED BY OTHER DEPARTMENTS (you may depend on them by key):
${others}

YOUR TEAM ROLES:
${roles}

Split your department's work into 1-4 concrete tasks. Rules:
- Each task is done by one employee in one go and must produce files. Name the exact file paths to create or update; the context graph uses those paths to give the employee exactly the right files.
- Prefer fewer, meatier tasks. Do not create review-only tasks; you review every task yourself.
- Use dependsOn ONLY for real input dependencies: a task that cannot be done without another task's files (e.g. the shared CSS needs the design system's colours). Every dependency makes someone wait.
- Never chain tasks that can run side by side. Sibling pages or modules should all depend on one shared foundation task, not on each other, so several employees can work in parallel. Work that needs no input (backend, data files, scaffolding) should have no dependencies at all.
- Only reference existing keys or keys of your own tasks.
- Keys must be unique, like "${dept}-1"${p.round > 1 ? ` (this is round ${p.round}: use "${dept}-r${p.round}-1")` : ""}.
- Follow the stack in the owner's request and the CEO's summary.
  · Static site (default): index.html at the project root, relative paths, no build step, no frameworks that need npm install.
  · PHP: entry point index.php at the root, plain PHP 8 without Composer unless asked, PDO with prepared statements for databases, escape output with htmlspecialchars, config in a separate config.php.
  · Python: Flask unless asked otherwise, app.py at the root, templates/ and static/ folders, a requirements.txt.
  · Any server-side stack: add a README.md with exact run instructions, never hard-code real secrets (use .env.example).`;
}

export function hireDecisionPrompt(p: Project, requests: StaffingRequest[]): string {
  const blocks = requests
    .map((r) => {
      const tasks = p.tasks
        .filter((t) => t.round === p.round && t.roleId === r.roleId && t.status === "pending")
        .map((t) => `    • ${t.title}: ${t.description.slice(0, 200)}`)
        .join("\n");
      const cands = r.recommendations
        .map(
          (c, i) =>
            `    ${i + 1}. ${c.modelKey} (${c.label}): fit ${c.score}/10, ~$${c.estCostPerTask.toFixed(3)} per task. ${c.reasons.join("; ")}`,
        )
        .join("\n");
      return `REQUEST ${r.id}: ${role(r.roleId).title.en} (${r.reason})\n  Tasks waiting for this hire:\n${tasks || "    (none)"}\n  Candidates (AI Resources' ranking, best first):\n${cands}`;
    })
    .join("\n\n");
  const budget = store.settings.budgetUsd;
  return `${requestHistory(p)}

AI Resources needs your decision on new hires for your team.

${blocks}

Company hiring priority: ${store.settings.hirePriority}. Project budget: ${budget > 0 ? `$${budget} (spent so far: $${p.usage.costUsd.toFixed(3)})` : "unlimited"}.

For each request choose the candidate you want (by modelKey) or "reject" if you prefer to do the work yourself. Usually accept AI Resources' first pick; choose another only if it is clearly better for these specific tasks (quality for hard work, price or speed for simple work).`;
}

export function workerPrompt(p: Project, t: Task, context: string): string {
  return `${requestHistory(p)}

PROJECT SUMMARY:
${p.summary}

YOUR TASK: ${t.title}
${t.description}
${
  t.feedback
    ? `\nYOUR MANAGER REVIEWED YOUR PREVIOUS ATTEMPT AND ASKED FOR CHANGES:\n${t.feedback}\nYour previous files are included below; return the corrected full versions.\n`
    : ""
}
${context || "PROJECT MAP:\n(empty project: you are creating the first files)"}

Output rules (output tokens are the most expensive part of this company's bill):
- To change an EXISTING file whose full content is shown above, use "edits": exact find/replace snippets. Copy "find" verbatim from the file, make it unique (include a nearby line or two), keep it short. This is far cheaper than rewriting the file.
- Use "files" only for NEW files, or when you rewrite more than about half of a file. Files must be COMPLETE: never write placeholders like "rest unchanged" or "...".
- Files marked EXCERPT show only the relevant parts: change them with "edits" only.
- If you truly need the full content of a file you only see in the one-line list (or as an excerpt), list it in "needFiles" and leave "files" and "edits" empty; you will get it. Don't ask for files you don't need: every file costs tokens.
- Do not return files you did not change. Paths are relative to the project root. Text files only (SVG for graphics).
- Make it production quality: valid, accessible, responsive, consistent with the design system and copy if they exist.

Before answering, check your own work: every href/src points to a file that exists or that you create; every class you use is styled; every id your script queries exists in the HTML; every CSS variable you use is defined.`;
}

export function reviewPrompt(p: Project, t: Task, files: string, summary: string, issues: string[], impact: string[] = []): string {
  return `${requestHistory(p)}

PROJECT SUMMARY:
${p.summary}

TASK YOU ASSIGNED: ${t.title}
${t.description}

EMPLOYEE'S SUMMARY: ${summary}

FILES THEY PRODUCED:
${files || "(no files)"}

${impact.length ? `FILES THAT DEPEND ON THESE CHANGES (from the context graph; the checks below cover them too):\n${impact.join(", ")}\n\n` : ""}AUTOMATED CHECKS ON THESE FILES (context graph + syntax check; deterministic, free):
${issues.length ? issues.map((i) => `- ${i}`).join("\n") : "- no problems found"}

Review the work as a demanding but fair manager. Approve if it fulfils the task and has no real bugs. Reject only for concrete, important problems and list exactly what to fix; treat the automated findings as facts, but ignore any that are clearly intentional. This is revision ${t.revisions} of at most ${store.settings.maxRevisions}.`;
}

export function qaReviewPrompt(p: Project, t: Task, report: string, summary: string, issues: string[], map: string, visual = ""): string {
  const checks = issues.length ? issues.map((i) => `- ${i}`).join("\n") : "- no problems found";
  return `${requestHistory(p)}

PROJECT SUMMARY:
${p.summary}

QA TASK YOU ASSIGNED: ${t.title}
${t.description}

TESTER'S SUMMARY: ${summary}

TESTER'S REPORT AND FILES:
${report || "(no files)"}

AUTOMATED CHECKS ON THE WHOLE PROJECT (context graph + syntax check; deterministic, free):
${checks}
${visual ? `\n${visual}\n` : ""}
PROJECT MAP:
${map}

You are the QA Manager signing off. Decide two things:
1. approved: is the tester's work thorough and credible? (revision ${t.revisions} of at most ${store.settings.maxRevisions})
2. productPassed: can this ship to the owner? Fail it only for real defects: broken features, broken references, clearly visible layout bugs, missing requested content. Browser-check findings (script errors, missing files, broken images, sideways scrolling on a phone) are real defects. List each one in "issues" with the file it is in, so the Engineering Manager can assign the fix. Cosmetic nitpicks are not failures.`;
}

/** The Design Manager looks at the real screenshots and signs off on the visuals. */
export function designReviewPrompt(p: Project, visual: string, designDoc: string): string {
  return `${requestHistory(p)}

Engineering has built the site and QA opened it in a real browser. Screenshots of the entry page are attached (desktop 1280px wide and phone 390px wide).

THE PROJECT'S DESIGN (design/DESIGN.md):
${designDoc ? designDoc.slice(0, 6000) : "(no design document; judge against the request)"}

${visual}

You are the Design Manager. Compare what you SEE with the design: palette, fonts, spacing, hierarchy, alignment, contrast, and how it holds up on the phone. Approve unless something is clearly wrong or unfinished: overlapping or cut-off elements, unreadable contrast, a broken phone layout, missing styles, or a look that ignores the design. List at most 5 concrete fixes, each naming the element and, if you can tell, the file. Do not ask for new features or new content.`;
}

export function deliveryPrompt(p: Project, map: string): string {
  const done = p.tasks.filter((t) => t.round === p.round && t.status === "done");
  const failed = p.tasks.filter((t) => t.round === p.round && t.status === "failed");
  return `${requestHistory(p)}

PROJECT SUMMARY:
${p.summary}

COMPLETED TASKS:
${done.map((t) => `- ${t.title}: ${t.output?.summary ?? ""}`).join("\n") || "(none)"}
${failed.length ? `\nTASKS THAT FAILED:\n${failed.map((t) => `- ${t.title}: ${t.error ?? ""}`).join("\n")}` : ""}

PROJECT MAP:
${map}

Write the delivery message to the owner (your boss). Mention the "Preview" and "Download" buttons on the project overview, be honest about anything that failed, and invite follow-up change requests.`;
}
