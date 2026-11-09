import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { api, savedPct, tokens } from "../api.ts";
import type { ContextFile, ContextLink, ContextReport, ContextStats, Project } from "../../../server/types.ts";

type Report = ContextReport & { stats: ContextStats };

const KIND_COLOR: Record<ContextFile["kind"], string> = {
  html: "#f97316",
  template: "#fb923c",
  css: "#3b82f6",
  js: "#eab308",
  php: "#8b5cf6",
  py: "#14b8a6",
  code: "#64748b",
  sql: "#0ea5e9",
  config: "#94a3b8",
  md: "#a78bfa",
  svg: "#ec4899",
  json: "#22c55e",
  other: "#94a3b8",
};

const W = 720;
const H = 420;

/** Small deterministic force layout; graphs here are tens of nodes, so this runs in a few ms. */
function layout(files: ContextFile[], links: ContextLink[]) {
  const n = files.length;
  const idx = new Map(files.map((f, i) => [f.path, i]));
  const pos = files.map((_, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    return { x: W / 2 + Math.cos(a) * 150, y: H / 2 + Math.sin(a) * 120 };
  });
  const edges = links.map((l) => [idx.get(l.from)!, idx.get(l.to)!] as const).filter(([a, b]) => a !== undefined && b !== undefined);
  const k = Math.sqrt((W * H) / Math.max(1, n)) * 0.55;
  let temp = 60;
  for (let it = 0; it < 220; it++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x || 0.01;
        const dy = pos[i].y - pos[j].y || 0.01;
        const d = Math.max(1, Math.hypot(dx, dy));
        const f = (k * k) / d;
        disp[i].x += (dx / d) * f;
        disp[i].y += (dy / d) * f;
        disp[j].x -= (dx / d) * f;
        disp[j].y -= (dy / d) * f;
      }
    }
    for (const [a, b] of edges) {
      const dx = pos[a].x - pos[b].x;
      const dy = pos[a].y - pos[b].y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = (d * d) / k;
      disp[a].x -= (dx / d) * f;
      disp[a].y -= (dy / d) * f;
      disp[b].x += (dx / d) * f;
      disp[b].y += (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      disp[i].x += (W / 2 - pos[i].x) * 0.02 * k;
      disp[i].y += (H / 2 - pos[i].y) * 0.02 * k;
      const d = Math.max(1, Math.hypot(disp[i].x, disp[i].y));
      pos[i].x = Math.min(W - 40, Math.max(40, pos[i].x + (disp[i].x / d) * Math.min(d, temp)));
      pos[i].y = Math.min(H - 30, Math.max(30, pos[i].y + (disp[i].y / d) * Math.min(d, temp)));
    }
    temp *= 0.97;
  }
  return pos;
}

export function ContextPanel({ project }: { project: Project }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      api<Report>("GET", `/api/projects/${project.id}/context`)
        .then(setReport)
        .catch((e) => setError((e as Error).message));
    }, 250);
    return () => clearTimeout(t);
  }, [project.id, project.updatedAt]);

  const pos = useMemo(() => (report ? layout(report.files, report.links) : []), [report]);

  if (error) return <p className="error">{error}</p>;
  if (!report) return <div className="empty">Building the context graph…</div>;

  const stats = report.stats;
  const saved = savedPct(project);
  const idx = new Map(report.files.map((f, i) => [f.path, i]));
  const neighbours = new Set<string>();
  if (focus) {
    for (const l of report.links) {
      if (l.from === focus) neighbours.add(l.to);
      if (l.to === focus) neighbours.add(l.from);
    }
  }
  const focused = report.files.find((f) => f.path === focus);
  const dependsOn = focused ? [...new Set(report.links.filter((l) => l.from === focused.path).map((l) => l.to))] : [];
  const usedBy = focused ? [...new Set(report.links.filter((l) => l.to === focused.path).map((l) => l.from))] : [];

  // Query: a file name or a symbol (.class, #id, --var, fn:name, cls:Name).
  const q = query.trim().toLowerCase();
  const matched = new Set(
    q ? report.files.filter((f) => f.path.toLowerCase().includes(q) || [...f.defines, ...f.uses].some((s) => s.toLowerCase().includes(q))).map((f) => f.path) : [],
  );
  const symbols = q
    ? [...new Set(report.files.flatMap((f) => [...f.defines, ...f.uses]))]
        .filter((s) => s.toLowerCase().includes(q))
        .slice(0, 8)
        .map((s) => ({
          symbol: s,
          definedIn: report.files.filter((f) => f.defines.includes(s)).map((f) => f.path),
          usedIn: report.files.filter((f) => f.uses.includes(s)).map((f) => f.path),
        }))
    : [];

  return (
    <div className="context">
      <div className="ctx-stats">
        <div title={`Sent ${tokens(stats.tokensSent)} context tokens instead of ${tokens(stats.tokensFull)} (whole project on every call)`}>
          <b>{saved}%</b>
          <small>less context</small>
        </div>
        <div title="Output tokens avoided because employees sent find/replace edits instead of rewriting whole files">
          <b>{tokens(stats.outputSaved ?? 0)}</b>
          <small>output tokens saved</small>
        </div>
        <div title="Manager reviews skipped because syntax errors or broken edits were bounced back automatically">
          <b>{stats.reviewsSkipped ?? 0}</b>
          <small>reviews skipped</small>
        </div>
        <div>
          <b>{report.files.length}</b>
          <small>files indexed</small>
        </div>
      </div>
      <p className="muted small">
        {report.symbols} symbols · {report.links.length} relations · {stats.queries} agent queries · {tokens(stats.tokensSent)} of{" "}
        {tokens(stats.tokensFull)} tokens sent.
        {stats.queries > 0 && saved < 10 && " Small projects fit almost entirely in one context; savings grow with the project."}
      </p>

      {report.files.length > 0 && (
        <div className="ctx-query">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a file or symbol: theme.css, .btn, #contact, --primary, fn:openMenu…"
            aria-label="Query the context graph"
          />
          {q && <span className="muted small">{matched.size} file(s)</span>}
        </div>
      )}
      {symbols.length > 0 && (
        <ul className="ctx-symbols">
          {symbols.map((s) => (
            <li key={s.symbol}>
              <code>{s.symbol}</code>
              <span className="muted">
                defined in {s.definedIn.join(", ") || "nowhere"} · used in {s.usedIn.join(", ") || "nowhere"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {report.files.length === 0 ? (
        <div className="empty">Nothing indexed yet. The graph grows as the team writes files.</div>
      ) : (
        <div className="ctx-graph">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Project context graph">
            {report.links.map((l, i) => {
              const a = pos[idx.get(l.from)!];
              const b = pos[idx.get(l.to)!];
              if (!a || !b) return null;
              const lit = focus && (l.from === focus || l.to === focus);
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={`edge ${l.rel} ${focus ? (lit ? "lit" : "dim") : ""}`}
                  strokeWidth={Math.min(4, 1 + l.weight / 3)}
                >
                  <title>{`${l.from} ${l.rel === "links" ? "links to" : "uses"} ${l.to}${l.via.length ? ` (${l.via.join(" ")})` : ""}`}</title>
                </line>
              );
            })}
            {report.files.map((f, i) => {
              const p = pos[i];
              const r = 6 + Math.min(16, Math.sqrt(f.tokens) / 4);
              const dim = q ? !matched.has(f.path) : focus && f.path !== focus && !neighbours.has(f.path);
              return (
                <g
                  key={f.path}
                  className={`gnode ${dim ? "dim" : ""}`}
                  transform={`translate(${p.x},${p.y})`}
                  onMouseEnter={() => setFocus(f.path)}
                  onClick={() => setFocus(f.path)}
                >
                  <circle r={r} fill={KIND_COLOR[f.kind]} />
                  <text y={r + 12} textAnchor="middle">
                    {f.path.split("/").pop()}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="legend">
            {Object.entries(KIND_COLOR)
              .filter(([k]) => report.files.some((f) => f.kind === k))
              .map(([k, c]) => (
                <span key={k}>
                  <i style={{ background: c }} /> {k}
                </span>
              ))}
            <span>
              <i className="line" /> links
            </span>
            <span>
              <i className="line dashed" /> shares symbols
            </span>
          </div>
        </div>
      )}

      {focused && (
        <div className="ctx-detail">
          <b>{focused.path}</b> <span className="muted">· {focused.kind} · ~{focused.tokens} tokens</span>
          <p>{focused.summary}</p>
          {focused.defines.length > 0 && (
            <p className="muted small">
              <b>Defines:</b> {focused.defines.slice(0, 20).join(" ")}
              {focused.defines.length > 20 ? ` +${focused.defines.length - 20}` : ""}
            </p>
          )}
          {focused.uses.length > 0 && (
            <p className="muted small">
              <b>Uses:</b> {focused.uses.slice(0, 20).join(" ")}
              {focused.uses.length > 20 ? ` +${focused.uses.length - 20}` : ""}
            </p>
          )}
          <p className="muted small">
            <b>Depends on:</b> {dependsOn.join(", ") || "nothing"}
          </p>
          <p className="muted small">
            <b>Used by:</b> {usedBy.join(", ") || "nothing"}
            {usedBy.length > 0 && " (a change here can affect these)"}
          </p>
        </div>
      )}

      <h3 className="sub">Automated checks {report.issues.length ? `(${report.issues.length})` : ""}</h3>
      {report.issues.length === 0 ? (
        <p className="ok-text">
          <CheckCircle2 size={15} /> No broken references, unstyled classes or missing ids found.
        </p>
      ) : (
        <ul className="issues">
          {report.issues.map((i) => (
            <li key={i}>
              <AlertTriangle size={13} /> {i}
            </li>
          ))}
        </ul>
      )}

      <details className="ctx-map">
        <summary>Project map (one line per file, ~{tokens(Math.ceil(report.map.length / 4))} tokens for the whole project)</summary>
        <pre className="code">{report.map}</pre>
      </details>
    </div>
  );
}
