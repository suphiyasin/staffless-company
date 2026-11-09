import { useEffect, useState } from "react";
import { Menu, Monitor, Moon, Palette, Plus, Settings, Sun, UserSearch, Users } from "lucide-react";
import { api, money, useLiveState } from "./api.ts";
import { ProjectView } from "./components/ProjectView.tsx";
import { NewProject } from "./components/NewProject.tsx";
import { TeamView } from "./components/TeamView.tsx";
import { HiringView } from "./components/HiringView.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { DesignsView } from "./components/DesignsView.tsx";
import type { DesignMeta, Project } from "../../server/types.ts";

type Theme = "system" | "light" | "dark";
type Page = "project" | "team" | "hiring" | "designs";
const THEMES: Theme[] = ["system", "light", "dark"];

/** The Staffless mark: an S in a rounded square (colours follow the theme). */
function Logo() {
  return (
    <svg className="mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="15" />
      <path
        d="M42.5 21.5C40 17.6 35.9 16 31.6 16 25.6 16 21 19.4 21 24.6c0 11.3 22 6.6 22 17.3C43 47 38.2 50 32.2 50c-4.8 0-9-2-11.2-6"
        fill="none"
        strokeWidth="6.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function stored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function App() {
  const [state, putProject] = useLiveState();
  const [selected, setSelected] = useState<string | null>(
    () => new URLSearchParams(location.search).get("p") || stored<string>("aic.selected", "") || null,
  );
  const [page, setPage] = useState<Page>("project");
  const [showSettings, setShowSettings] = useState(false);
  const [presetDesign, setPresetDesign] = useState<DesignMeta | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => stored<Theme>("aic.theme", "system"));
  const { company, projects, details, connected } = state;

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    store("aic.theme", theme);
  }, [theme]);

  useEffect(() => {
    store("aic.selected", selected || null);
    const url = new URL(location.href);
    if (selected) url.searchParams.set("p", selected);
    else url.searchParams.delete("p");
    history.replaceState(null, "", url);
    if (selected && !details[selected]) {
      api<Project>("GET", `/api/projects/${selected}`)
        .then(putProject)
        .catch(() => setSelected(null));
    }
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!company) return <div className="boot">Opening the office…</div>;

  const project = selected ? details[selected] : undefined;
  const pending = company.staffing.filter((s) => s.status === "pending");
  const needsYou = pending.filter((s) => s.approver === "client").length;
  const connectedVia = company.providers.filter((p) => p.configured).map((p) => p.label);
  const go = (p: Page, id: string | null = selected) => {
    setPage(p);
    setSelected(id);
    setNavOpen(false);
  };
  const ThemeIcon = theme === "system" ? Monitor : theme === "light" ? Sun : Moon;

  return (
    <div className={`app ${navOpen ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          Staffless
        </div>

        <button className="new-btn" onClick={() => go("project", null)}>
          <Plus size={16} /> New project
        </button>

        <nav className="nav-section">
          <div className="nav-label">Projects</div>
          {projects.length === 0 && <div className="nav-empty">No projects yet</div>}
          {projects.map((p) => (
            <button
              key={p.id}
              className={`nav-item ${page === "project" && p.id === selected ? "active" : ""}`}
              onClick={() => go("project", p.id)}
            >
              <span className={`dot status-${p.status}`} />
              <span className="nav-text">{p.title}</span>
            </button>
          ))}
        </nav>

        <nav className="nav-section nav-bottom">
          <button className={`nav-item ${page === "team" ? "active" : ""}`} onClick={() => go("team")}>
            <Users size={16} />
            <span className="nav-text">Team</span>
            <span className="nav-meta">{company.employees.length}</span>
          </button>
          <button className={`nav-item ${page === "designs" ? "active" : ""}`} onClick={() => go("designs")}>
            <Palette size={16} />
            <span className="nav-text">Designs</span>
          </button>
          <button className={`nav-item ${page === "hiring" ? "active" : ""}`} onClick={() => go("hiring")}>
            <UserSearch size={16} />
            <span className="nav-text">AI Resources</span>
            {pending.length > 0 && <span className={`nav-badge ${needsYou ? "urgent" : ""}`}>{pending.length}</span>}
          </button>
          <button className="nav-item" onClick={() => setShowSettings(true)}>
            <Settings size={16} />
            <span className="nav-text">Settings</span>
          </button>
          <div className="sidebar-foot">
            <span
              className={`status-line ${connected && company.network?.online !== false ? "" : "off"}`}
              title={company.network?.online === false ? `Can't reach ${company.network.waitingFor}; work resumes automatically` : connectedVia.join(", ")}
            >
              <span className="dot" />
              {!connected
                ? "Reconnecting…"
                : company.network?.online === false
                  ? "Offline · waiting"
                  : company.demoMode
                    ? "Demo mode"
                    : (connectedVia[0] ?? "Connected")}
              <span className="muted"> · {money(company.totalUsage.costUsd)}</span>
            </span>
            <button
              className="icon-btn"
              title={`Theme: ${theme}`}
              aria-label={`Theme: ${theme}`}
              onClick={() => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])}
            >
              <ThemeIcon size={15} />
            </button>
          </div>
        </nav>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />

      <main className="main">
        <button className="menu-btn icon-btn" onClick={() => setNavOpen(true)} aria-label="Menu">
          <Menu size={18} />
        </button>
        {page === "designs" ? (
          <DesignsView
            onUse={(d) => {
              setPresetDesign(d);
              go("project", null);
            }}
          />
        ) : page === "team" ? (
          <TeamView company={company} />
        ) : page === "hiring" ? (
          <HiringView company={company} projects={projects} />
        ) : project ? (
          <ProjectView
            key={project.id}
            project={project}
            company={company}
            onDeleted={() => go("project", null)}
            onOpenHiring={() => go("hiring")}
          />
        ) : selected ? (
          <div className="boot">Loading…</div>
        ) : (
          <NewProject
            key={presetDesign?.id ?? "none"}
            company={company}
            preset={presetDesign}
            onCreated={(p) => {
              putProject(p);
              setPresetDesign(null);
              go("project", p.id);
            }}
          />
        )}
      </main>

      {showSettings && <SettingsModal company={company} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
