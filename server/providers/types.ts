import { Agent, setGlobalDispatcher } from "undici";
import type { ProviderId } from "../types.ts";

// Node's fetch gives up after 300s without response headers. Local models and
// long file-writing turns can take longer than that, so allow up to 20 minutes.
setGlobalDispatcher(new Agent({ headersTimeout: 20 * 60_000, bodyTimeout: 20 * 60_000 }));

export type JsonSchema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number)[];
  description?: string;
  additionalProperties?: false;
};

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** A picture attached to the first user message (e.g. a screenshot). */
export interface ImageInput {
  mediaType: "image/jpeg" | "image/png";
  /** base64, no data: prefix */
  data: string;
  label?: string;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** When set, the provider should return a JSON object matching this schema. */
  json?: { name: string; schema: JsonSchema };
  /** low = quick replies, high = careful work. Providers map it as they can. */
  effort?: "low" | "medium" | "high";
  /** Pictures for models that can see; attached to the first user message. */
  images?: ImageInput[];
  /** Extra context only the mock provider uses to fake realistic answers. */
  hint?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ChatResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Set when the response was truncated or refused. */
  warning?: string;
}

export interface Provider {
  id: ProviderId;
  label: string;
  configured(): boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export class ProviderError extends Error {
  constructor(
    public provider: ProviderId,
    message: string,
    public retryable = false,
    /** The provider could not be reached at all (offline, DNS, refused). */
    public network = false,
  ) {
    super(`[${provider}] ${message}`);
  }
}

/** Appended to the system prompt for providers without native schema enforcement. */
export function schemaInstruction(json: ChatRequest["json"]): string {
  if (!json) return "";
  return (
    "\n\nRespond with ONLY a single JSON object (no markdown fences, no commentary) " +
    `that matches this JSON Schema:\n${JSON.stringify(json.schema)}`
  );
}

export async function fetchJson(provider: ProviderId, url: string, init: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    throw new ProviderError(provider, `Network error: ${(err as Error).message}${cause ? ` (${cause})` : ""}`, true, true);
  }
  const body = await res.text();
  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new ProviderError(provider, `HTTP ${res.status}: ${body.slice(0, 500)}`, retryable);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new ProviderError(provider, `Invalid JSON from API: ${body.slice(0, 200)}`);
  }
}
