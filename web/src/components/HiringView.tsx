import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { api, deptOfRole, money, roleTitle } from "../api.ts";
import type { CompanySnapshot, ProjectSummary, StaffingRequest } from "../../../server/types.ts";

const MODE_TEXT = {
  manager: "The manager who asked for the worker approves each hire.",
  client: "You approve each hire.",
  auto: "Hires are approved automatically.",
};

function Request({ req, company, project }: { req: StaffingRequest; company: CompanySnapshot; project?: ProjectSummary }) {
  const [choice, setChoice] = useState(req.recommendations[0]?.modelKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dept = deptOfRole(req.roleId);
  const manager = company.employees.find((e) => e.roleId === dept.managerRole);
  const yours = req.approver === "client";

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    setError("");
    try {
      await api("POST", `/api/staffing/${req.id}`, { decision, modelKey: choice });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="request">
      <div className="request-head">
        <div>
          <h3>{roleTitle(req.roleId)}</h3>
          <p className="muted">
            {dept.name.en}
            {project ? ` · ${project.title}` : ""} · {req.reason}
          </p>
        </div>
        {!yours && (
          <span className="waiting">
            <Loader2 size={13} className="spin" /> {manager?.name ?? "Manager"} is deciding
          </span>
        )}
      </div>
      <div className="options">
        {req.recommendations.map((r, i) => (
          <label key={r.modelKey} className={`option ${(yours ? choice : req.recommendations[0]?.modelKey) === r.modelKey ? "on" : ""}`}>
            {yours && <input type="radio" name={req.id} checked={choice === r.modelKey} onChange={() => setChoice(r.modelKey)} />}
            <span className="option-main">
              <span className="option-title">
                {r.label}
                {i === 0 && <span className="tag">Recommended</span>}
              </span>
              <span className="muted">{r.reasons.slice(0, 2).join(" · ")}</span>
            </span>
            <span className="option-side muted">
              {r.score}/10
              <br />~{money(r.estCostPerTask)}
            </span>
          </label>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {yours && (
        <div className="row end">
          <button className="btn ghost" disabled={busy} onClick={() => decide("reject")}>
            <X size={15} /> Decline
          </button>
          <button className="btn primary" disabled={busy} onClick={() => decide("approve")}>
            <Check size={15} /> Hire
          </button>
        </div>
      )}
    </div>
  );
}

export function HiringView({ company, projects }: { company: CompanySnapshot; projects: ProjectSummary[] }) {
  const pending = company.staffing.filter((s) => s.status === "pending");
  const history = company.staffing.filter((s) => s.status !== "pending").slice(-12).reverse();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>AI Resources</h1>
          <p className="lead">
            The AI counterpart of Human Resources. It spots missing roles and ranks models by skill, price and speed.{" "}
            {MODE_TEXT[company.settings.hireApproval]}
          </p>
        </div>
      </header>

      <section className="group">
        <h2 className="group-title">Open positions</h2>
        {pending.length === 0 ? (
          <p className="muted empty-line">No open positions.</p>
        ) : (
          pending.map((r) => <Request key={r.id} req={r} company={company} project={projects.find((p) => p.id === r.projectId)} />)
        )}
      </section>

      {history.length > 0 && (
        <section className="group">
          <h2 className="group-title">Recent decisions</h2>
          <div className="list">
            {history.map((s) => {
              const emp = company.employees.find((e) => e.id === s.employeeId);
              return (
                <div key={s.id} className="list-row static" title={s.decisionNote}>
                  <span className={`state ${s.status}`}>{s.status === "approved" ? <Check size={14} /> : <X size={14} />}</span>
                  <span className="list-main">
                    <span className="list-title">{roleTitle(s.roleId)}</span>
                    <span className="list-sub">{s.status === "approved" ? emp?.name ?? "left the company" : "declined"}</span>
                  </span>
                  <span className="list-side muted">by {s.approver === "manager" ? "manager" : s.approver === "client" ? "you" : "auto"}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
