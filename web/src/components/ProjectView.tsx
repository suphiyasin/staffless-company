import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Download, Eye, FileText, Loader2, Lock, Play, Square, Trash2 } from "lucide-react";
import { api, clock, money, roleColor, roleTitle, savedPct, STATUS_LABEL } from "../api.ts";
import { channelLabel, RoleAvatar } from "../icons.tsx";
import type { CompanySnapshot, FeedChannel, FeedMessage, Project, Task } from "../../../server/types.ts";
import { FilesPanel } from "./FilesPanel.tsx";
import { ContextPanel } from "./ContextPanel.tsx";
import { Overview } from "./Overview.tsx";
import { Shots } from "./VisualCards.tsx";

type Tab = "overview" | "office" | "board" | "files" | "context";
const TABS: [Tab, string][] = [
  ["overview", "Overview"],
  ["office", "Meeting room"],
  ["board", "Tasks"],
  ["files", "Files"],
  ["context", "Context"],
];

export function ProjectView({
  project,
  company,
  onDeleted,
  onOpenHiring,
}: {
  project: Project;
  company: CompanySnapshot;
  onDeleted: () => void;
  onOpenHiring: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const running = ["planning", "in_progress", "delivering"].includes(project.status);
  const roundTasks = project.tasks.filter((t) => t.round === project.round);
  const doneCount = roundTasks.filter((t) => t.status === "done").length;
  const saved = savedPct(project);
  const waitingOnYou = company.staffing.filter((s) => s.projectId === project.id && s.status === "pending" && s.approver === "client").length;

  const act = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const facts = [
    STATUS_LABEL[project.status],
    roundTasks.length ? `${doneCount} of ${roundTasks.length} tasks` : "",
    project.round > 1 ? `round ${project.round}` : "",
    money(project.usage.costUsd),
    saved >= 1 ? `${saved}% less context` : "",
  ].filter(Boolean);

  return (
    <div className="project">
      <header className="project-head">
        <div className="project-title">
          <h1>{project.title}</h1>
          <p className="facts">
            {running && <Loader2 size={13} className="spin" />}
            {facts.join(" · ")}
          </p>
        </div>
        <div className="row">
          {running && (
            <button className="btn ghost" onClick={() => act(() => api("POST", `/api/projects/${project.id}/cancel`))}>
              <Square size={14} /> Stop
            </button>
          )}
          {(project.status === "paused" || project.status === "failed" || project.status === "cancelled") && (
            <button className="btn" onClick={() => act(() => api("POST", `/api/projects/${project.id}/resume`))}>
              <Play size={14} /> Resume
            </button>
          )}
          {!running && (
            <button
              className="icon-btn"
              title="Delete project"
              aria-label="Delete project"
              onClick={() => {
                if (confirm(`Delete "${project.title}" and all its files?`)) {
                  void act(async () => {
                    await api("DELETE", `/api/projects/${project.id}`);
                    onDeleted();
                  });
                }
              }}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </header>

      {waitingOnYou > 0 && tab !== "overview" && (
        <button className="notice" onClick={onOpenHiring}>
          {waitingOnYou} hire{waitingOnYou > 1 ? "s" : ""} waiting for your approval →
        </button>
      )}
      {(error || project.error) && <p className="error">{error || project.error}</p>}

      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
            {id === "board" && roundTasks.length > 0 && <span className="tab-count">{roundTasks.length}</span>}
            {id === "files" && project.files.length > 0 && <span className="tab-count">{project.files.length}</span>}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <Overview project={project} company={company} running={running} onOpenMeeting={() => setTab("office")} onOpenHiring={onOpenHiring} />
      )}
      {tab === "office" && <Office project={project} running={running} />}
      {tab === "board" && <Board project={project} company={company} />}
      {tab === "files" && <FilesPanel project={project} canRunPhp={company.tools?.php ?? false} />}
      {tab === "context" && <ContextPanel project={project} />}
    </div>
  );
}

const CHANNELS: FeedChannel[] = ["boss", "design", "content", "software", "qa", "ai-resources"];
const channelOf = (m: FeedMessage): FeedChannel => m.channel ?? "boss";

function ChannelPicker({
  value,
  counts,
  onChange,
}: {
  value: FeedChannel;
  counts: Partial<Record<FeedChannel, number>>;
  onChange: (c: FeedChannel) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const options = CHANNELS.filter((c) => c === "boss" || counts[c]);
  return (
    <div className="picker" ref={ref}>
      <button className="picker-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {value !== "boss" && <Lock size={12} />}
        {channelLabel(value)}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="picker-menu" role="listbox">
          {options.map((c) => (
            <button
              key={c}
              role="option"
              aria-selected={c === value}
              className={c === value ? "on" : ""}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
            >
              <span>{channelLabel(c)}</span>
              <span className="muted">{c === "boss" ? "with you" : `internal · ${counts[c] ?? 0}`}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Office({ project, running }: { project: Project; running: boolean }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [channel, setChannel] = useState<FeedChannel>("boss");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const counts = useMemo(() => {
    const c: Partial<Record<FeedChannel, number>> = {};
    for (const m of project.feed) c[channelOf(m)] = (c[channelOf(m)] ?? 0) + 1;
    return c;
  }, [project.feed]);
  const messages = project.feed.filter((m) => channelOf(m) === channel);
  const isBoss = channel === "boss";

  // Jump to the latest message on open / channel switch; glide smoothly for new messages.
  const lastChannel = useRef<FeedChannel | null>(null);
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const instant = lastChannel.current !== channel;
    lastChannel.current = channel;
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? "auto" : "smooth" });
  }, [messages.length, channel]);

  const send = async () => {
    if (text.trim().length < 3 || running) return;
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

  const hasSite = project.files.includes("index.html");

  return (
    <div className="office">
      <div className="office-bar">
        <ChannelPicker value={channel} counts={counts} onChange={setChannel} />
        <span className="muted small">
          {isBoss ? "You, the CEO and the department heads." : "Internal team channel. Managers report anything important to you."}
        </span>
      </div>
      <div className="feed" ref={feedRef}>
        <div className="feed-inner">
          {messages.map((m) => (
            <Message key={m.id} m={m} projectId={project.id} hasSite={hasSite} />
          ))}
          {messages.length === 0 && <p className="muted empty-line">Nothing here yet.</p>}
          {running && isBoss && (
            <p className="typing">
              <span />
              <span />
              <span /> Teams are working
            </p>
          )}
        </div>
      </div>
      {isBoss && (
        <div className="composer">
          <div className="prompt-box compact">
            <textarea
              rows={1}
              value={text}
              disabled={running}
              placeholder={running ? "You can ask for changes once the team is done" : "Ask the CEO for a change…"}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="send-btn" disabled={busy || running || text.trim().length < 3} onClick={send} aria-label="Send">
              <ArrowUp size={17} />
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </div>
  );
}

function Message({ m, projectId, hasSite }: { m: FeedMessage; projectId: string; hasSite: boolean }) {
  if (m.from.kind === "system")
    return m.images?.length ? (
      <div className={`sys sys-shots ${m.kind}`}>
        <p>{m.text}</p>
        <Shots projectId={projectId} files={m.images} />
      </div>
    ) : (
      <p className={`sys ${m.kind}`}>{m.text}</p>
    );
  if (m.from.kind === "client") {
    return (
      <div className="msg mine">
        <div className="bubble">{m.text}</div>
      </div>
    );
  }
  const to = m.to === "Client" || m.to === "Owner" || m.to === "Müşteri" ? "you" : m.to;
  return (
    <div className={`msg ${m.tone ? `tone-${m.tone}` : ""} kind-${m.kind}`}>
      <RoleAvatar roleId={m.from.roleId} />
      <div className="msg-body">
        <div className="msg-head">
          <b>{m.from.name}</b>
          {m.from.roleId && <span>{roleTitle(m.from.roleId)}</span>}
          {to && <span>→ {to}</span>}
          <time>{clock(m.at)}</time>
        </div>
        <div className="msg-text">{m.text}</div>
        {m.images && m.images.length > 0 && <Shots projectId={projectId} files={m.images} />}
        {m.files && m.files.length > 0 && m.kind !== "deliverable" && (
          <div className="msg-files">
            <FileText size={12} />
            {m.files.slice(0, 6).join(", ")}
            {m.files.length > 6 ? ` +${m.files.length - 6}` : ""}
          </div>
        )}
        {m.kind === "deliverable" && (
          <div className="row msg-actions">
            {hasSite && (
              <a className="btn primary small" href={`/preview/${projectId}/index.html`} target="_blank" rel="noreferrer">
                <Eye size={14} /> Preview
              </a>
            )}
            <a className="btn small" href={`/api/projects/${projectId}/zip`}>
              <Download size={14} /> Download
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

const COLUMNS: { key: Task["status"][]; label: string }[] = [
  { key: ["pending"], label: "To do" },
  { key: ["in_progress"], label: "In progress" },
  { key: ["review"], label: "In review" },
  { key: ["done", "failed"], label: "Done" },
];

function Board({ project, company }: { project: Project; company: CompanySnapshot }) {
  const [round, setRound] = useState(project.round);
  const tasks = project.tasks.filter((t) => t.round === round);
  const byId = new Map(project.tasks.map((t) => [t.id, t]));

  return (
    <div className="board-wrap">
      {project.round > 1 && (
        <div className="segmented">
          {Array.from({ length: project.round }, (_, i) => i + 1).map((r) => (
            <button key={r} className={r === round ? "on" : ""} onClick={() => setRound(r)}>
              Round {r}
            </button>
          ))}
        </div>
      )}
      {tasks.length === 0 && <p className="muted empty-line">Managers haven't planned any tasks yet.</p>}
      <div className="board">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => col.key.includes(t.status));
          return (
            <div key={col.label} className="col">
              <h3>
                {col.label} <span>{items.length}</span>
              </h3>
              {items.map((t) => {
                const who = company.employees.find((e) => e.id === t.assigneeId);
                const waitingOn = t.dependsOn.filter((d) => byId.get(d)?.status !== "done" && byId.get(d)?.status !== "failed");
                return (
                  <details key={t.id} className={`card ${t.status}`}>
                    <summary>
                      <span className="card-title">{t.title}</span>
                      <span className="card-meta">
                        <span className="swatch" style={{ background: roleColor(t.roleId) }} />
                        {roleTitle(t.roleId)}
                        {who ? ` · ${who.name}` : ""}
                        {t.revisions > 0 ? ` · ${t.revisions} revision${t.revisions > 1 ? "s" : ""}` : ""}
                      </span>
                      {t.status === "pending" && waitingOn.length > 0 && (
                        <span className="card-note">Waiting on {waitingOn.map((d) => byId.get(d)?.title ?? d).join(", ")}</span>
                      )}
                      {t.qa && (
                        <span className={`card-note ${t.qa.passed ? "good" : "bad"}`}>
                          {t.qa.passed ? "QA passed" : `QA found ${t.qa.issues.length} issue(s)`}
                        </span>
                      )}
                      {t.error && <span className="card-note bad">{t.error}</span>}
                    </summary>
                    <p>{t.description}</p>
                    {t.output && <p className="muted">{t.output.summary}</p>}
                    {t.output?.files.length ? <p className="muted mono">{t.output.files.join(", ")}</p> : null}
                  </details>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
