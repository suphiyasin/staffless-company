import { useEffect, useState } from "react";
import type { CompanySnapshot, Project, ProjectSummary, ServerEvent } from "../../server/types.ts";
import { DEPARTMENTS, ROLES } from "../../server/company/org.ts";
import type { ProviderId, RoleId } from "../../server/types.ts";

/** Share of context tokens the graph saved compared with sending the whole project every call. */
export const savedPct = (p: Project) =>
  p.context?.tokensFull > 0 ? Math.max(0, Math.round((1 - p.context.tokensSent / p.context.tokensFull) * 100)) : 0;

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export interface LiveState {
  company: CompanySnapshot | null;
  projects: ProjectSummary[];
  details: Record<string, Project>;
  connected: boolean;
}

/** Subscribes to the server's SSE stream and keeps a live copy of company + project state. */
export function useLiveState(): [LiveState, (p: Project) => void] {
  const [state, setState] = useState<LiveState>({ company: null, projects: [], details: {}, connected: false });

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      es = new EventSource("/api/events");
      es.onopen = () => setState((s) => ({ ...s, connected: true }));
      es.onerror = () => {
        setState((s) => ({ ...s, connected: false }));
        es?.close();
        retry = setTimeout(connect, 2000);
      };
      es.onmessage = (msg) => {
        const ev = JSON.parse(msg.data) as ServerEvent;
        setState((s) => {
          if (ev.type === "company") return { ...s, company: ev.data };
          if (ev.type === "projects") return { ...s, projects: ev.data };
          return { ...s, details: { ...s.details, [ev.data.id]: ev.data } };
        });
      };
    };
    connect();
    return () => {
      clearTimeout(retry);
      es?.close();
    };
  }, []);

  const putProject = (p: Project) => setState((s) => ({ ...s, details: { ...s.details, [p.id]: p } }));
  return [state, putProject];
}

export const roleDef = (id: RoleId) => ROLES.find((r) => r.id === id)!;
export const roleTitle = (id: RoleId) => roleDef(id).title.en;
export const deptOfRole = (id: RoleId) => DEPARTMENTS.find((d) => d.id === roleDef(id).department)!;
export const roleColor = (id?: RoleId) => (id ? deptOfRole(id).color : "#94a3b8");

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google",
  ollama: "Ollama · local",
  compat: "OpenAI-compatible",
  "claude-cli": "Claude Code · subscription",
  "codex-cli": "Codex CLI · ChatGPT plan",
  mock: "Simulated",
};

export const money = (usd: number) =>
  usd === 0 ? "$0" : usd < 0.01 ? `$${usd.toFixed(4)}` : usd < 1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;

export const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Avatar text for an AI employee: "Claude Sonnet 5.5 #2" → "S2", "GPT-5 mini" → "G5". */
export const initials = (name: string) => {
  const num = name.match(/#(\d+)$/)?.[1] ?? "";
  const words = name.replace(/#\d+$/, "").trim().split(/\s+/);
  const key = words.length > 1 && /^(claude|gemini|gpt)/i.test(words[0]) ? words[1] : words[0];
  return ((key?.[0] ?? "?") + (num || (words[words.length - 1]?.match(/\d/)?.[0] ?? ""))).toUpperCase().slice(0, 3);
};

export const STATUS_LABEL: Record<string, string> = {
  planning: "Planning",
  in_progress: "In progress",
  delivering: "Delivering",
  done: "Done",
  failed: "Failed",
  cancelled: "Stopped",
  paused: "Paused",
};
