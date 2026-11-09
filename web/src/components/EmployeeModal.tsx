import { useEffect, useState } from "react";
import { UserMinus, UserPlus } from "lucide-react";
import { ROLES, TIER_EFFORT } from "../../../server/company/org.ts";
import { api, money, roleDef, roleTitle, tokens } from "../api.ts";
import type { CompanySnapshot, Effort, Employee, RoleId } from "../../../server/types.ts";
import { Modal } from "./Modal.tsx";

interface Candidate {
  modelKey: string;
  label: string;
  provider: string;
  estCostPerTask: number;
}

const FOUNDING = new Set<RoleId>(["ceo", "air-manager", "design-manager", "content-manager", "software-manager", "qa-manager"]);

/** Either edits an existing employee (switch model / let go) or hires a new team member manually. */
export function EmployeeModal({
  company,
  target,
  onClose,
}: {
  company: CompanySnapshot;
  target: Employee | "hire";
  onClose: () => void;
}) {
  const hiring = target === "hire";
  const workerRoles = ROLES.filter((r) => !r.isManager);
  const [roleId, setRoleId] = useState<RoleId>(hiring ? workerRoles[0].id : target.roleId);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [modelKey, setModelKey] = useState(hiring ? "" : target.modelKey);
  const roleDefault: Effort = TIER_EFFORT[roleDef(roleId).tier];
  const [effort, setEffort] = useState<Effort>(hiring ? roleDefault : (target.effort ?? roleDefault));
  const [error, setError] = useState("");

  useEffect(() => {
    if (roleId === "air-manager") return;
    api<Candidate[]>("GET", `/api/roles/${roleId}/candidates`)
      .then((c) => {
        setCandidates(c);
        if (hiring) setModelKey(c[0]?.modelKey ?? "");
      })
      .catch((e) => setError(e.message));
  }, [roleId, hiring]);

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!hiring && target.roleId === "air-manager") {
    return (
      <Modal title={`${target.name} · ${roleTitle(target.roleId)}`} onClose={onClose}>
        <p>
          AI Resources doesn't use a language model. It scores every candidate model deterministically using the role's
          skill weights, the model's price and its speed, so it costs nothing and every recommendation can be explained.
        </p>
        <p>
          The final call belongs to the manager who asked for the worker (or to you / nobody, depending on the hiring
          approval setting).
        </p>
        <p className="muted">
          Edit <code>config/models.json</code> to change the scores.
        </p>
      </Modal>
    );
  }

  return (
    <Modal title={hiring ? "Hire manually" : `${target.name} · ${roleTitle(target.roleId)}`} onClose={onClose}>
      {hiring ? (
        <label className="field">
          Role
          <select value={roleId} onChange={(e) => setRoleId(e.target.value as RoleId)}>
            {workerRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title.en}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="stats">
          <div><b>{target.stats.tasksDone}</b><small>tasks</small></div>
          <div><b>{target.stats.calls}</b><small>calls</small></div>
          <div><b>{tokens(target.stats.inputTokens + target.stats.outputTokens)}</b><small>tokens</small></div>
          <div><b>{money(target.stats.costUsd)}</b><small>cost</small></div>
        </div>
      )}

      <label className="field">
        Model (ranked by AI Resources)
        <select value={modelKey} onChange={(e) => setModelKey(e.target.value)}>
          {candidates.map((c, i) => (
            <option key={c.modelKey} value={c.modelKey}>
              {i === 0 ? "★ " : ""}
              {c.label} · ~{money(c.estCostPerTask)} per task
            </option>
          ))}
        </select>
      </label>
      {!hiring && (
        <label className="field">
          Effort (how hard they think on each task)
          <select value={effort} onChange={(e) => setEffort(e.target.value as Effort)}>
            <option value="low">Low: quick, cheapest</option>
            <option value="medium">Medium: balanced</option>
            <option value="high">High: deepest thinking, slowest</option>
          </select>
        </label>
      )}
      {!hiring && <p className="muted small">Set at hiring from the role ({roleDefault} for {roleTitle(target.roleId)}). Switching the model also renames the employee after it.</p>}
      {error && <p className="error">{error}</p>}

      <div className="row end">
        {!hiring && !FOUNDING.has(target.roleId) && (
          <button className="btn danger" onClick={() => run(() => api("DELETE", `/api/employees/${target.id}`))}>
            <UserMinus size={14} /> Let go
          </button>
        )}
        <span className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={!modelKey}
          onClick={() =>
            run(() =>
              hiring
                ? api("POST", "/api/employees", { roleId, modelKey })
                : (async () => {
                    if (modelKey !== target.modelKey) await api("POST", `/api/employees/${target.id}/model`, { modelKey });
                    if (effort !== target.effort) await api("POST", `/api/employees/${target.id}/effort`, { effort });
                  })(),
            )
          }
        >
          {hiring ? (
            <>
              <UserPlus size={14} /> Hire
            </>
          ) : (
            "Save"
          )}
        </button>
      </div>
    </Modal>
  );
}
