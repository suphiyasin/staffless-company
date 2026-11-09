import { useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { api } from "../api.ts";
import type { DesignMeta } from "../../../server/types.ts";
import { DesignGrid, useDesigns } from "./DesignGallery.tsx";
import { Modal } from "./Modal.tsx";

type Full = DesignMeta & { markdown: string; tokens: string };

/** The design library page: browse, preview, and start a project in a style. */
export function DesignsView({ onUse }: { onUse: (d: DesignMeta) => void }) {
  const [version, setVersion] = useState(0);
  const designs = useDesigns(version);
  const reload = () => api("POST", "/api/designs/reload").then(() => setVersion((v) => v + 1)).catch(() => {});
  const [open, setOpen] = useState<DesignMeta | null>(null);
  const [full, setFull] = useState<Full | null>(null);

  useEffect(() => {
    setFull(null);
    if (open) api<Full>("GET", `/api/designs/${open.id}`).then(setFull).catch(() => {});
  }, [open]);

  return (
    <div className="page wide">
      <header className="page-head">
        <div>
          <h1>Designs</h1>
          <p className="lead">
            Ready-made styles your team can build on. Each one is a plain <code>DESIGN.md</code> plus <code>tokens.css</code>, so
            Claude, GPT, Gemini and local models all follow it the same way. Add your own in <code>data/designs</code> or send a
            pull request to <code>designs/</code>.
          </p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={reload} title="Read designs/ and data/designs again">
            <RefreshCw size={15} /> Reload
          </button>
        </div>
      </header>
      {!designs ? <p className="muted">Loading…</p> : <DesignGrid designs={designs} onPick={(d) => d && setOpen(d)} />}

      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)} wide>
          <div className="design-detail">
            <div className="big-preview">
              <iframe src={`/api/designs/${open.id}/preview`} title={`${open.name} preview`} sandbox="" />
            </div>
            <div className="design-doc">
              <p>{open.description}</p>
              <p className="muted small">
                Best for {open.bestFor.join(", ")} · Fonts: {open.fonts.map((f) => f.split(":")[0]).join(", ")} · {open.source === "custom" ? "your design" : "library"}
              </p>
              {full && (
                <details>
                  <summary>DESIGN.md and tokens.css (what the AI team receives, ~{Math.ceil((full.markdown.length + full.tokens.length) / 4)} tokens)</summary>
                  <pre className="code">{full.markdown}</pre>
                  <pre className="code">{full.tokens}</pre>
                </details>
              )}
              <div className="row end">
                <button className="btn primary" onClick={() => onUse(open)}>
                  Start a project in this style <ArrowRight size={15} />
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
