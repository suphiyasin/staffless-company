import type { ModelInfo } from "../types.ts";

/** What Ollama tells us about an installed model (/api/tags + /api/show). */
export interface LocalModel {
  name: string;
  family: string;
  /** Billions of parameters (0 if unknown). */
  paramsB: number;
  capabilities: string[];
  /** The Modelfile carries its own SYSTEM prompt. */
  hasSystem: boolean;
}

/**
 * Local models are rated on a scale that tops out below the frontier models:
 * size decides the base, the model generation nudges it by one point.
 * Only large local models (≈100B+ of a recent generation, e.g. gpt-oss 120B, DeepSeek V3-class) are trusted with
 * more than the simplest work.
 */
const SIZE_STEPS: [maxB: number, strength: number][] = [
  [2, 2],
  [5, 3],
  [10, 4],
  [20, 5],
  [100, 6],
  [250, 7],
  [500, 8],
];
const MAX_LOCAL = 9;
/** From this strength on a local model competes for every role, not just the simplest ones. */
export const STRONG_LOCAL = 8;

/** Library model names; a model with a SYSTEM prompt and none of these in its name is a custom persona. */
const KNOWN =
  /qwen|llama|deepseek|gemma|mistral|mixtral|ministral|devstral|codestral|magistral|phi|gpt-oss|glm|kimi|command|granite|olmo|\byi\b|starcoder|smollm|falcon|nemotron|hermes|dolphin|exaone|internlm|cogito|minimax|solar|\baya\b|openchat|wizard|zephyr|tinyllama|orca|vicuna/i;
const NEWER =
  /qwen3|qwen2\.5|deepseek-(v3|v4|r1)|gpt-oss|gemma[34]|llama4|llama3\.3|glm-?4\.[5-9]|glm-?5|kimi|mistral-(small|medium|large)|devstral|magistral|minimax|cogito|nemotron/i;
const OLDER = /llama2|codellama|vicuna|orca|wizard|zephyr|tinyllama|falcon|deepseek-coder(?!-v2)|^mistral:|^qwen:|^qwen2:|^gemma:|^gemma2|^phi:|^phi2|^phi3:/i;
const CODER = /coder|code|devstral|codestral|starcoder/i;
const VISION_ONLY = /-vl|vision|llava|moondream|bakllava/i;

export function parseParams(size: string | undefined, name: string): number {
  const fromDetails = /([\d.]+)\s*([BMT])/i.exec(size ?? "");
  const m = fromDetails ?? /[:\-_](\d+(?:\.\d+)?)([bmt])\b/i.exec(name);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  return unit === "T" ? n * 1000 : unit === "M" ? n / 1000 : n;
}

/** Why a model should not be hired, or null if it can work. */
export function skipReason(m: LocalModel): string | null {
  if (!m.capabilities.includes("completion")) return "not a chat model (embeddings)";
  if (m.hasSystem && !KNOWN.test(m.name)) return "custom persona model (its own SYSTEM prompt)";
  return null;
}

export function strengthOf(m: LocalModel): number {
  const base = m.paramsB ? (SIZE_STEPS.find(([max]) => m.paramsB < max)?.[1] ?? MAX_LOCAL) : 3;
  const gen = NEWER.test(m.name) ? 1 : OLDER.test(m.name) ? -1 : 0;
  return Math.max(1, Math.min(MAX_LOCAL, base + gen));
}

const clamp = (n: number) => Math.max(1, Math.min(MAX_LOCAL, n));

/** Builds the catalog entry AI Resources ranks. */
export function localModelInfo(m: LocalModel): ModelInfo {
  const s = strengthOf(m);
  const coder = CODER.test(m.name);
  const visionOnly = VISION_ONLY.test(m.name) ? 1 : 0;
  const cloud = /cloud/i.test(m.name);
  const speed = cloud ? 7 : m.paramsB < 5 ? 8 : m.paramsB < 10 ? 7 : m.paramsB < 20 ? 6 : m.paramsB < 40 ? 5 : m.paramsB < 90 ? 4 : 3;
  const strong = s >= STRONG_LOCAL;
  const size = m.paramsB ? `${m.paramsB >= 10 ? Math.round(m.paramsB) : m.paramsB.toFixed(1)}B` : "unknown size";
  return {
    key: `ollama:${m.name}`,
    provider: "ollama",
    model: m.name,
    label: `${m.name} (local)`,
    skills: {
      planning: clamp(s - (coder ? 1 : 0) - visionOnly),
      coding: clamp(s + (coder ? 1 : 0) - visionOnly),
      design: clamp(s - 1 - visionOnly),
      writing: clamp(s - (coder ? 1 : 0) - visionOnly),
      review: clamp(s - visionOnly),
    },
    speed,
    price: { input: 0, output: 0 },
    tags: ["local", ...(strong ? ["local-strong"] : []), ...(cloud ? ["cloud"] : []), ...(m.capabilities.includes("thinking") ? ["thinking"] : []), ...(m.capabilities.includes("vision") ? ["vision"] : [])],
    notes: strong
      ? `Ollama · ${size} · rated ${s}/10, strong enough for any role.`
      : s - visionOnly >= 5
        ? `Ollama · ${size} · rated ${s - visionOnly}/10, used for simple tasks only (copy, SEO).`
        : `Ollama · ${size} · rated ${s - visionOnly}/10, too small for company work; used only if nothing else is available.`,
    discovered: true,
  };
}

/** Small local models only take simple worker roles; big ones compete everywhere. */
export const isWeakLocal = (m: ModelInfo) => m.provider === "ollama" && !m.tags.includes("local-strong");
