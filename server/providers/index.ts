import fs from "node:fs";
import { config } from "../config.ts";
import type { ModelInfo, ProviderId, ProviderStatus } from "../types.ts";
import { anthropicProvider } from "./anthropic.ts";
import { geminiProvider } from "./gemini.ts";
import { mockProvider } from "./mock.ts";
import { discoverOllama, ollamaProvider, skippedOllamaModels, usableOllamaModels } from "./ollama.ts";
import { localModelInfo } from "./local-models.ts";
import { compatProvider, openaiProvider } from "./openai.ts";
import { claudeCliProvider, cliDetail, codexCliProvider, detectClis } from "./cli.ts";
import type { Provider } from "./types.ts";

const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
  compat: compatProvider,
  "claude-cli": claudeCliProvider,
  "codex-cli": codexCliProvider,
  mock: mockProvider,
};

let catalog: ModelInfo[] = [];
let ollamaModels: string[] = [];

export const getProvider = (id: ProviderId): Provider => PROVIDERS[id];

/** Loads config/models.json and merges locally installed Ollama models. */
export async function refreshCatalog(): Promise<void> {
  const raw = JSON.parse(fs.readFileSync(config.paths.catalog, "utf8")) as { models: ModelInfo[] };
  catalog = raw.models;
  await Promise.all([discoverOllama(), detectClis()]);
  // Models listed in config/models.json keep their hand-written scores (even custom ones).
  const listed = (name: string) => catalog.some((m) => m.provider === "ollama" && m.model === name);
  const usable = usableOllamaModels();
  ollamaModels = [...usable.map((m) => m.name), ...skippedOllamaModels().map((s) => s.name).filter(listed)];
  for (const m of usable) if (!listed(m.name)) catalog.push(localModelInfo(m));
  for (const s of skippedOllamaModels()) if (!listed(s.name)) console.log(`  🦙 Ollama: skipping ${s.name} (${s.reason})`);
}

const realProviders: ProviderId[] = ["claude-cli", "codex-cli", "anthropic", "openai", "gemini", "ollama", "compat"];

export const isDemoMode = (): boolean =>
  config.forceMock || !realProviders.some((p) => PROVIDERS[p].configured() && (p !== "ollama" || ollamaModels.length > 0));

export function isModelAvailable(m: ModelInfo): boolean {
  if (isDemoMode()) return m.provider === "mock";
  if (m.provider === "mock") return false;
  if (!PROVIDERS[m.provider]?.configured()) return false;
  if (m.provider === "ollama") return ollamaModels.includes(m.model);
  return true;
}

export const getCatalog = (): ModelInfo[] => catalog;

/** Can this model look at screenshots? Cloud models can; local/compat ones only when tagged "vision". */
export const seesImages = (m: ModelInfo): boolean =>
  !m.tags.includes("no-vision") && (m.provider === "ollama" || m.provider === "compat" ? m.tags.includes("vision") : true);
export const getModel = (key: string): ModelInfo | undefined => catalog.find((m) => m.key === key);
export const availableModels = (): ModelInfo[] => catalog.filter(isModelAvailable);

export function providerStatuses(): ProviderStatus[] {
  return realProviders.map((id) => ({
    id,
    label: PROVIDERS[id].label,
    configured: PROVIDERS[id].configured() && (id !== "ollama" || ollamaModels.length > 0),
    detail: id === "claude-cli" || id === "codex-cli" ? cliDetail(id) : undefined,
  }));
}
