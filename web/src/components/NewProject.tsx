import { useState } from "react";
import { ArrowUp, Palette, X } from "lucide-react";
import { api } from "../api.ts";
import type { CompanySnapshot, DesignMeta, Project } from "../../../server/types.ts";
import { DesignPicker } from "./DesignGallery.tsx";

const EXAMPLES: [string, string][] = [
  ["Restaurant website", 'A modern website for a restaurant called "Harbor Table" with a menu, photo gallery and a reservation form.'],
  ["Photographer portfolio", "A dark, portfolio-first one-page site for me as a freelance photographer."],
  ["App landing page", "A landing page for a mobile app with a pricing table and an FAQ section."],
  ["PHP guestbook", "A small guestbook in PHP with SQLite: a form to leave a message and a list of the latest messages."],
];

export function NewProject({
  company,
  onCreated,
  preset,
}: {
  company: CompanySnapshot;
  onCreated: (p: Project) => void;
  preset?: DesignMeta | null;
}) {
  const [brief, setBrief] = useState("");
  const [design, setDesign] = useState<DesignMeta | null>(preset ?? null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = brief.trim().length >= 5 && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      onCreated(await api<Project>("POST", "/api/projects", { brief, designId: design?.id }));
      setBrief("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <h1>What should we build?</h1>
      <p className="lead">Brief the CEO. Managers run their teams and report back to you.</p>

      <div className="prompt-box">
        <textarea
          value={brief}
          autoFocus
          rows={4}
          placeholder="Describe the project…"
          onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button className="send-btn" disabled={!ready} onClick={submit} aria-label="Send">
          <ArrowUp size={18} />
        </button>
      </div>
      <div className="style-row">
        <button className="style-chip" onClick={() => setPicking(true)}>
          <Palette size={14} />
          {design ? (
            <>
              <span className="swatches">
                {[design.colors.bg, design.colors.primary, design.colors.accent].map((c, i) => (
                  <i key={i} style={{ background: c }} />
                ))}
              </span>
              Style: {design.name}
            </>
          ) : (
            "Style: let the designers decide"
          )}
        </button>
        {design && (
          <button className="icon-btn" onClick={() => setDesign(null)} aria-label="Clear style" title="Clear style">
            <X size={14} />
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <div className="suggestions">
        {EXAMPLES.map(([label, text]) => (
          <button key={label} onClick={() => setBrief(text)}>
            {label}
          </button>
        ))}
      </div>

      {picking && <DesignPicker selected={design?.id ?? null} onPick={setDesign} onClose={() => setPicking(false)} />}
      {company.demoMode && (
        <p className="hint">
          Demo mode: a simulated AI plays every role. Log in to Claude Code or Codex CLI, or add an API key, then use
          Settings → Refresh models for real output.
        </p>
      )}
    </div>
  );
}
