import { useState } from "react";
import { CircleDot, RefreshCw } from "lucide-react";
import { api } from "../api.ts";
import type { CompanySnapshot, Settings } from "../../../server/types.ts";
import { Modal } from "./Modal.tsx";
import { TelegramSettings } from "./TelegramSettings.tsx";

export function SettingsModal({ company, onClose }: { company: CompanySnapshot; onClose: () => void }) {
  const [s, setS] = useState<Settings>(company.settings);
  const [msg, setMsg] = useState("");
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));

  const save = async () => {
    try {
      await api("PUT", "/api/settings", s);
      onClose();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const refresh = async () => {
    try {
      const r = await api<{ available: number; changes: string[] }>("POST", "/api/catalog/refresh", {});
      setMsg(`${r.available} model(s) available.${r.changes.length ? " " + r.changes.join("; ") : ""}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <Modal title="Company settings" onClose={onClose}>
      <label className="field">
        Who approves new hires?
        <select value={s.hireApproval} onChange={(e) => set("hireApproval", e.target.value as Settings["hireApproval"])}>
          <option value="manager">The manager who asked for the worker (recommended)</option>
          <option value="client">Me, the client</option>
          <option value="auto">Nobody: AI Resources hires its first pick</option>
        </select>
      </label>

      <label className="field">
        Hiring priority
        <select value={s.hirePriority} onChange={(e) => set("hirePriority", e.target.value as Settings["hirePriority"])}>
          <option value="quality">Quality: the best model for every role</option>
          <option value="balanced">Balanced: best for engineering & leadership, near-best for design/QA, cheapest for copy</option>
          <option value="economy">Economy: near-best for engineering, cheapest good-enough for the rest</option>
        </select>
      </label>

      <div className="grid2">
        <label className="field">
          Context budget per task (tokens)
          <input
            type="number"
            min={2000}
            max={200000}
            step={1000}
            value={s.contextBudget}
            onChange={(e) => set("contextBudget", Number(e.target.value))}
          />
        </label>
        <label className="field">
          Project budget (USD, 0 = unlimited)
          <input type="number" min={0} step={0.5} value={s.budgetUsd} onChange={(e) => set("budgetUsd", Number(e.target.value))} />
        </label>
        <label className="field">
          Manager does it alone up to (tasks)
          <input type="number" min={0} max={5} value={s.managerHandlesUpTo} onChange={(e) => set("managerHandlesUpTo", Number(e.target.value))} />
        </label>
        <label className="field">
          Max employees per role
          <input type="number" min={1} max={5} value={s.maxPerRole} onChange={(e) => set("maxPerRole", Number(e.target.value))} />
        </label>
        <label className="field">
          Tasks running in parallel
          <input type="number" min={1} max={8} value={s.maxParallel} onChange={(e) => set("maxParallel", Number(e.target.value))} />
        </label>
        <label className="field">
          QA fix rounds before delivery
          <input type="number" min={0} max={3} value={s.maxFixRounds} onChange={(e) => set("maxFixRounds", Number(e.target.value))} />
        </label>
        <label className="field">
          Revisions per task
          <input type="number" min={0} max={3} value={s.maxRevisions} onChange={(e) => set("maxRevisions", Number(e.target.value))} />
        </label>
        <label className="field">
          Agents' language
          <select value={s.language} onChange={(e) => set("language", e.target.value as Settings["language"])}>
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>
        </label>
      </div>
      <p className="muted small">
        The context graph always sends a one-line map of every file; the budget caps how many full files an agent gets
        on top of it. Files the task must edit are always included.
      </p>

      <h3 className="sub">Telegram</h3>
      {company.telegram && <TelegramSettings tg={company.telegram} />}

      <h3 className="sub">AI providers</h3>
      <ul className="providers">
        {company.providers.map((p) => (
          <li key={p.id}>
            <CircleDot size={13} className={p.configured ? "ok" : "off"} /> {p.label}
            {p.detail && <small className="muted provider-detail">{p.detail}</small>}
          </li>
        ))}
      </ul>
      <p className="muted small">
        <b>Claude Code</b> and <b>Codex CLI</b> run on your existing subscription: install the CLI, log in once
        (<code>claude auth login</code> / <code>codex login</code>) and press "Refresh models". API keys are read from{" "}
        <code>.env</code> (restart after changing them).
      </p>
      {msg && <p className="callout">{msg}</p>}

      <div className="row end">
        <button className="btn" onClick={refresh}>
          <RefreshCw size={14} /> Refresh models
        </button>
        <span className="grow" />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}
