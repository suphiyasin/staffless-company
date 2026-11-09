import { useState } from "react";
import { Loader2, Sparkles, UserPlus } from "lucide-react";
import { DEPARTMENTS, ROLES } from "../../../server/company/org.ts";
import { api, money, PROVIDER_LABEL, roleTitle } from "../api.ts";
import { RoleAvatar } from "../icons.tsx";
import type { CompanySnapshot, Employee } from "../../../server/types.ts";
import { EmployeeModal } from "./EmployeeModal.tsx";

export function TeamView({ company }: { company: CompanySnapshot }) {
  const [open, setOpen] = useState<Employee | "hire" | null>(null);
  const [note, setNote] = useState("");
  const bestFit = async () => {
    try {
      const r = await api<{ changes: string[] }>("POST", "/api/employees/rebalance", {});
      setNote(r.changes.length ? r.changes.join(" · ") : "Everyone already runs on the best-fitting model.");
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const isMgr = (e: Employee) => ROLES.find((r) => r.id === e.roleId)!.isManager;
  const model = (key: string) => company.catalog.find((m) => m.key === key);
  const working = company.employees.filter((e) => e.status === "busy").length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Team</h1>
          <p className="lead">
            {company.employees.length} employees{working ? ` · ${working} working now` : ""}. You talk to the managers; they run their teams.
          </p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={bestFit} title="Move idle employees to the model that fits their role best">
            <Sparkles size={15} /> Apply best fit
          </button>
          <button className="btn" onClick={() => setOpen("hire")}>
            <UserPlus size={15} /> Hire
          </button>
        </div>
      </header>
      {note && <p className="callout team-note">{note}</p>}

      {DEPARTMENTS.map((d) => {
        const roleIds = ROLES.filter((r) => r.department === d.id).map((r) => r.id);
        const staff = company.employees
          .filter((e) => roleIds.includes(e.roleId))
          .sort((a, b) => Number(isMgr(b)) - Number(isMgr(a)));
        if (!staff.length) return null;
        return (
          <section key={d.id} className="group">
            <h2 className="group-title">
              <span className="swatch" style={{ background: d.color }} />
              {d.name.en}
            </h2>
            <div className="list">
              {staff.map((e) => {
                const m = model(e.modelKey);
                return (
                  <button key={e.id} className="list-row" onClick={() => setOpen(e)}>
                    <RoleAvatar roleId={e.roleId} />
                    <span className="list-main">
                      <span className="list-title">{e.name}</span>
                      <span className="list-sub">
                        {roleTitle(e.roleId)}
                        {isMgr(e) ? " · manager" : ""}
                        {e.effort ? ` · ${e.effort} effort` : ""}
                      </span>
                    </span>
                    <span className="list-side">
                      {e.currentTask ? (
                        <span className="working">
                          <Loader2 size={12} className="spin" /> {e.currentTask.title}
                        </span>
                      ) : (
                        <span className="muted">
                          {e.roleId === "air-manager" ? "Rule-based" : m ? PROVIDER_LABEL[m.provider] : ""}
                        </span>
                      )}
                    </span>
                    <span className="list-num">{e.stats.calls ? money(e.stats.costUsd) : ""}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {open && <EmployeeModal company={company} target={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
