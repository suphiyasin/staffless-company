import { useEffect, useState } from "react";
import { Code2, Download, ExternalLink, FileText, MonitorPlay, Play, Square } from "lucide-react";
import { api } from "../api.ts";
import type { Project } from "../../../server/types.ts";

export function FilesPanel({ project, canRunPhp }: { project: Project; canRunPhp: boolean }) {
  const [phpUrl, setPhpUrl] = useState<string | null>(null);
  const [runError, setRunError] = useState("");
  const hasPhp = project.files.some((f) => /\.(php|phtml)$/i.test(f));
  useEffect(() => {
    if (!hasPhp) return;
    api<{ url: string | null }>("GET", `/api/projects/${project.id}/run`).then((r) => setPhpUrl(r.url)).catch(() => {});
  }, [project.id, hasPhp]);
  const runPhp = async () => {
    if (!confirm("This runs the AI-written PHP code on your computer with PHP's built-in server (127.0.0.1 only, stops after 30 minutes). Only continue if you trust the code. Run it?")) return;
    setRunError("");
    try {
      const r = await api<{ url: string }>("POST", `/api/projects/${project.id}/run`, {});
      setPhpUrl(r.url);
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      setRunError((e as Error).message);
    }
  };
  const stopPhp = async () => {
    await api("DELETE", `/api/projects/${project.id}/run`, {}).catch(() => {});
    setPhpUrl(null);
  };
  const [current, setCurrent] = useState<string | null>(project.files.includes("index.html") ? "index.html" : (project.files[0] ?? null));
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"code" | "preview">("code");

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    fetch(`/api/projects/${project.id}/file?path=${encodeURIComponent(current)}`)
      .then((r) => r.text())
      .then((t) => !cancelled && setContent(t));
    return () => {
      cancelled = true;
    };
    // Re-fetch when the project changes, since a revision may have rewritten the file.
  }, [current, project.id, project.updatedAt]);

  if (project.files.length === 0) {
    return <div className="empty">No files yet. They'll show up here as soon as the team starts producing them.</div>;
  }

  const hasSite = project.files.includes("index.html");
  const previewUrl = `/preview/${project.id}/index.html`;

  return (
    <div className="files">
      <div className="files-bar">
        <div className="row">
          <button className={`btn small ${mode === "code" ? "primary" : ""}`} onClick={() => setMode("code")}>
            <Code2 size={14} /> Code
          </button>
          {hasSite && (
            <button className={`btn small ${mode === "preview" ? "primary" : ""}`} onClick={() => setMode("preview")}>
              <MonitorPlay size={14} /> Live preview
            </button>
          )}
        </div>
        <div className="row">
          {hasPhp && canRunPhp && !phpUrl && (
            <button className="btn small" onClick={runPhp} title="Serve the project with PHP's built-in server">
              <Play size={14} /> Run with PHP
            </button>
          )}
          {phpUrl && (
            <>
              <a className="btn small primary" href={phpUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> {phpUrl.replace("http://", "")}
              </a>
              <button className="btn small" onClick={stopPhp}>
                <Square size={13} /> Stop
              </button>
            </>
          )}
          {hasSite && (
            <a className="btn small" href={previewUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Open in new tab
            </a>
          )}
          <a className="btn small" href={`/api/projects/${project.id}/zip`}>
            <Download size={14} /> Download ZIP
          </a>
        </div>
      </div>
      {runError && <p className="error">{runError}</p>}
      {mode === "preview" && hasSite ? (
        <iframe
          className="preview"
          key={project.updatedAt}
          src={previewUrl}
          sandbox="allow-scripts allow-forms allow-modals"
          title="Preview"
        />
      ) : (
        <div className="files-body">
          <ul className="file-list">
            {project.files.map((f) => (
              <li key={f}>
                <button className={f === current ? "active" : ""} onClick={() => setCurrent(f)}>
                  <FileText size={12} /> {f}
                </button>
              </li>
            ))}
          </ul>
          <pre className="code">
            <code>{content}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
