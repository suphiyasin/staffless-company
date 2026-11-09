import { useEffect, useState } from "react";
import { BookmarkPlus, Check, MonitorSmartphone } from "lucide-react";
import { api, clock } from "../api.ts";
import type { DesignMeta, Project } from "../../../server/types.ts";
import { DesignThumb } from "./DesignGallery.tsx";

const shotUrl = (projectId: string, file: string) => `/api/projects/${projectId}/shots/${file}`;

/** Screenshot thumbnails (desktop wide, phone narrow); click to open full size. */
export function Shots({ projectId, files }: { projectId: string; files: string[] }) {
  if (!files.length) return null;
  return (
    <div className="shots">
      {files.map((f) => (
        <a key={f} href={shotUrl(projectId, f)} target="_blank" rel="noreferrer" className={f.includes("mobile") ? "phone" : "desk"} title="Open full size">
          <img src={shotUrl(projectId, f)} alt={f.includes("mobile") ? "Phone screenshot" : "Desktop screenshot"} loading="lazy" />
        </a>
      ))}
    </div>
  );
}

/** What QA's headless browser saw last time it opened the site. */
export function BrowserCheck({ project }: { project: Project }) {
  const v = project.visual;
  if (!v) return null;
  return (
    <section className="ov-section">
      <div className="ov-section-head">
        <h3>
          <MonitorSmartphone size={15} /> Browser check
        </h3>
        <span className="muted small">{clock(v.at)}</span>
      </div>
      {v.skipped ? (
        <p className="muted small">Not run: {v.skipped}.</p>
      ) : (
        <>
          <p className={`small ${v.issues.length ? "bad-text" : "good-text"}`}>
            {v.issues.length
              ? `${v.issues.length} problem${v.issues.length > 1 ? "s" : ""} on ${v.pages.length} page${v.pages.length > 1 ? "s" : ""}`
              : `${v.pages.length} page${v.pages.length > 1 ? "s" : ""} opened on desktop and phone: no errors, missing files or sideways scrolling.`}
          </p>
          {v.issues.length > 0 && (
            <ul className="check-list">
              {v.issues.slice(0, 8).map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          <Shots projectId={project.id} files={v.shots.map((s) => s.file)} />
        </>
      )}
    </section>
  );
}

/** The design system the team wrote for this project, with "Save to library". */
export function ProjectStyle({ project }: { project: Project }) {
  const has = !project.designId && project.files.includes("design/tokens.css") && project.files.includes("design/DESIGN.md");
  const [meta, setMeta] = useState<DesignMeta | null>(null);
  const [saved, setSaved] = useState<DesignMeta | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const stamp = project.updatedAt;

  useEffect(() => {
    if (!has) return;
    api<DesignMeta | null>("GET", `/api/projects/${project.id}/design`).then(setMeta).catch(() => setMeta(null));
  }, [has, project.id, stamp]);

  if (!has || !meta) return null;
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      setSaved(await api<DesignMeta>("POST", `/api/projects/${project.id}/design/save`, {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ov-section">
      <div className="ov-section-head">
        <h3>Project style</h3>
        <span className="muted small">written by the design team</span>
      </div>
      <div className="style-card">
        <div className="style-thumb">
          <DesignThumb id={meta.id} name={meta.name} src={`/api/projects/${project.id}/design/preview?v=${encodeURIComponent(stamp)}`} />
        </div>
        <div className="style-info">
          <b>{meta.name}</b>
          <p className="muted small">{meta.description}</p>
          <span className="swatches">
            {[meta.colors.bg, meta.colors.surface, meta.colors.text, meta.colors.primary, meta.colors.accent].map((c, i) => (
              <i key={i} style={{ background: c }} />
            ))}
          </span>
          {saved ? (
            <p className="good-text small">
              <Check size={13} /> Saved to your library as "{saved.name}". Pick it under Designs for your next project.
            </p>
          ) : (
            <button className="btn small" onClick={save} disabled={busy}>
              <BookmarkPlus size={14} /> Save to library
            </button>
          )}
          {error && <p className="error small">{error}</p>}
        </div>
      </div>
    </section>
  );
}
