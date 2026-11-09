import { useState } from "react";
import { AlertTriangle, ArrowRight, ArrowUp, Download, Eye, Loader2 } from "lucide-react";
import { DEPARTMENTS } from "../../../server/company/org.ts";
import { api, clock, money, roleTitle, savedPct, tokens } from "../api.ts";
import type { CompanySnapshot, FeedMessage, Project, Task, WorkDepartmentId } from "../../../server/types.ts";
import { BrowserCheck, ProjectStyle } from "./VisualCards.tsx";

/**
 * The owner's view of a project: where it stands, what needs attention, how
 * each department is doing and what management reported. The full
 * conversation lives in the meeting room.
 */

const isBoss = (m: FeedMessage) => (m.channel ?? "boss") === "boss";
const firstLine = (s: string) => s.split("\n")[0];

function phase(project: Project, company: CompanySnapshot): { title: string; detail: string } {
  const roundTasks = project.tasks.filter((t) => t.round === project.round);
  const deptName = (d: WorkDepartmentId) => DEPARTMENTS.find((x) => x.id === d)!.name.en;
  switch (project.status) {
    case "planning":
      return { title: "Planning", detail: "The CEO and the department heads are planning the work." };
    case "delivering":
      return { title: "Wrapping up", detail: "QA signed off. The CEO is preparing the delivery." };
    case "done":
      return { title: "Delivered", detail: "The CEO has handed the project over to you." };
    case "failed":
      return { title: "Stopped by an error", detail: project.error ?? "Something went wrong." };
    case "paused":
      return { title: "Paused", detail: project.error ?? "Press Resume to continue where the team left off." };
    case "cancelled":
      return { title: "Stopped", detail: "You stopped this project. Resume to continue." };
  }
  const fixing = roundTasks.some((t) => t.kind === "fix" && t.status !== "done" && t.status !== "failed");
  if (fixing) return { title: "Fixing QA findings", detail: "QA sent issues back; engineering is fixing them before a re-test." };
  const active = [...new Set(roundTasks.filter((t) => t.status === "in_progress" || t.status === "review").map((t) => t.department))];
  const waitingHire = company.staffing.some((s) => s.projectId === project.id && s.status === "pending");
  if (!active.length && waitingHire) return { title: "Staffing up", detail: "AI Resources is hiring the people the teams need." };
  if (!active.length) return { title: "In progress", detail: "Teams are getting ready." };
  const names = active.map(deptName);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return { title: "In progress", detail: `${list} ${names.length > 1 ? "are" : "is"} working.` };
}

/** Why a department that has work isn't working yet, in one line. */
function waitingReason(project: Project, company: CompanySnapshot, tasks: Task[]): string {
  const byId = new Map(project.tasks.map((t) => [t.id, t]));
  const deptName = (d: WorkDepartmentId) => DEPARTMENTS.find((x) => x.id === d)!.name.en;
  for (const t of tasks.filter((x) => x.status === "pending")) {
    const open = t.dependsOn.map((id) => byId.get(id)).filter((x): x is Task => Boolean(x) && x!.status !== "done");
    if (!open.length) continue;
    const failed = open.find((x) => x.status === "failed");
    if (failed) return `Blocked: "${failed.title}" failed. Resume the project to retry it.`;
    const outside = open.find((x) => x.department !== t.department);
    if (outside) return `Waiting for ${deptName(outside.department)}: ${outside.title}`;
    return `Next up after "${open[0].title}"`;
  }
  const hiring = company.staffing.some((s) => s.projectId === project.id && s.status === "pending" && tasks.some((t) => t.roleId === s.roleId));
  if (hiring) return "Waiting for a new hire to join the team";
  return "Waiting for a free team member";
}

export function Overview({
  project,
  company,
  running,
  onOpenMeeting,
  onOpenHiring,
}: {
  project: Project;
  company: CompanySnapshot;
  running: boolean;
  onOpenMeeting: () => void;
  onOpenHiring: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const roundTasks = project.tasks.filter((t) => t.round === project.round);
  const done = roundTasks.filter((t) => t.status === "done").length;
  const failed = roundTasks.filter((t) => t.status === "failed");
  const qaTask = roundTasks.filter((t) => t.qa).at(-1);
  const offline = running && company.network?.online === false;
  const now = offline
    ? {
        title: "Waiting for the connection",
        detail: `Can't reach ${company.network.waitingFor}. Nothing is lost: work resumes on its own when the connection is back.`,
      }
    : phase(project, company);
  const delivery = project.status === "done" ? project.feed.filter((m) => m.kind === "deliverable").at(-1) : undefined;
  const hiresForYou = company.staffing.filter((s) => s.projectId === project.id && s.status === "pending" && s.approver === "client").length;
  const reports = project.feed.filter((m) => isBoss(m) && (m.kind === "report" || m.kind === "deliverable" || m.kind === "error")).slice(-6).reverse();
  const hasSite = project.files.includes("index.html");
  const revisions = roundTasks.reduce((n, t) => n + t.revisions, 0);

  const send = async () => {
    if (text.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      await api("POST", `/api/projects/${project.id}/revision`, { text });
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overview">
      <section className="ov-now">
        <h2>
          {running && <Loader2 size={16} className="spin" />}
          {now.title}
        </h2>
        <p>{now.detail}</p>
      </section>

      {(hiresForYou > 0 || failed.length > 0) && (
        <section className="ov-attention">
          {hiresForYou > 0 && (
            <button onClick={onOpenHiring}>
              <AlertTriangle size={14} /> {hiresForYou} hire{hiresForYou > 1 ? "s" : ""} waiting for your approval
              <ArrowRight size={14} />
            </button>
          )}
          {failed.map((t) => (
            <div key={t.id}>
              <AlertTriangle size={14} /> {t.title} failed: {t.error}
            </div>
          ))}
        </section>
      )}

      {delivery && (
        <section className="ov-delivery">
          <div className="ov-label">Delivery from {delivery.from.name}, {roleTitle(delivery.from.roleId ?? "ceo")}</div>
          <p>{delivery.text}</p>
          <div className="row">
            {hasSite && (
              <a className="btn primary" href={`/preview/${project.id}/index.html`} target="_blank" rel="noreferrer">
                <Eye size={15} /> Preview
              </a>
            )}
            <a className="btn" href={`/api/projects/${project.id}/zip`}>
              <Download size={15} /> Download
            </a>
          </div>
          <div className="prompt-box compact">
            <textarea
              rows={1}
              value={text}
              placeholder="Want changes? Tell the CEO…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="send-btn" disabled={busy || text.trim().length < 3} onClick={send} aria-label="Send">
              <ArrowUp size={17} />
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      <section className="ov-numbers">
        <div>
          <b>
            {done}/{roundTasks.length || "–"}
          </b>
          <small>tasks done{revisions ? ` · ${revisions} revision${revisions > 1 ? "s" : ""}` : ""}</small>
        </div>
        <div>
          <b className={qaTask ? (qaTask.qa!.passed ? "good" : "bad") : ""}>{qaTask ? (qaTask.qa!.passed ? "Passed" : "Failed") : "Pending"}</b>
          <small>quality check</small>
        </div>
        <div>
          <b>{money(project.usage.costUsd)}</b>
          <small>{tokens(project.usage.inputTokens + project.usage.outputTokens)} tokens</small>
        </div>
        <div>
          <b>{savedPct(project)}%</b>
          <small>less context{project.context.outputSaved ? ` · ${tokens(project.context.outputSaved)} output saved` : ""}</small>
        </div>
      </section>

      {project.departments.length > 0 && (
        <section className="ov-section">
          <h3>Departments</h3>
          <div className="list">
            {project.departments.map((d) => {
              const dept = DEPARTMENTS.find((x) => x.id === d.department)!;
              const tasks = roundTasks.filter((t) => t.department === d.department);
              const fin = tasks.filter((t) => t.status === "done").length;
              const busyNow = tasks.some((t) => t.status === "in_progress" || t.status === "review");
              const mgr = company.employees.find((e) => e.roleId === dept.managerRole);
              const last = project.feed.filter((m) => isBoss(m) && m.kind === "report" && m.from.roleId === dept.managerRole).at(-1);
              const state = !tasks.length ? "Planning" : fin === tasks.length ? "Done" : busyNow ? "Working" : "Waiting";
              const note = state === "Waiting" ? waitingReason(project, company, tasks) : last ? firstLine(last.text) : d.goal;
              return (
                <div key={d.department} className="dept-row">
                  <div className="dept-top">
                    <span className="swatch" style={{ background: dept.color }} />
                    <span className="dept-name">{dept.name.en}</span>
                    <span className="muted">{mgr?.name}</span>
                    <span className={`dept-state ${state.toLowerCase()}`}>{state}</span>
                    <span className="dept-count">
                      {fin}/{tasks.length}
                    </span>
                  </div>
                  <div className="bar">
                    <div style={{ width: `${tasks.length ? (fin / tasks.length) * 100 : 0}%`, background: dept.color }} />
                  </div>
                  <p className={`dept-note ${state === "Waiting" ? "waiting" : ""}`}>{note}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <BrowserCheck project={project} />
      <ProjectStyle project={project} />

      <section className="ov-section">
        <div className="ov-section-head">
          <h3>Latest reports</h3>
          <button className="link" onClick={onOpenMeeting}>
            Meeting room <ArrowRight size={13} />
          </button>
        </div>
        {reports.length === 0 ? (
          <p className="muted small">No reports yet. Managers report here when their department finishes.</p>
        ) : (
          <ul className="reports">
            {reports.map((m) => (
              <li key={m.id} className={m.tone ? `tone-${m.tone}` : ""}>
                <time>{clock(m.at)}</time>
                <div>
                  <span className="who">
                    {m.from.kind === "system" ? "System" : m.from.name}
                    {m.from.roleId && <span className="muted"> · {roleTitle(m.from.roleId)}</span>}
                  </span>
                  <p>{m.text}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ov-section">
        <h3>Your brief{project.designName ? ` · style: ${project.designName}` : ""}</h3>
        <ol className="brief">
          {project.requests.map((r, i) => (
            <li key={i}>
              {project.requests.length > 1 && <span className="muted">{i === 0 ? "Original" : `Change ${i}`} · </span>}
              {r}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
