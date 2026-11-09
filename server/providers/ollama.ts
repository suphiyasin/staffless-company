import { config } from "../config.ts";
import { fetchJson, schemaInstruction, type ChatRequest, type ChatResponse, type Provider } from "./types.ts";
import { parseParams, skipReason, type LocalModel } from "./local-models.ts";

let available = false;
let installed: LocalModel[] = [];

interface TagsResponse {
  models?: { name: string; details?: { family?: string; parameter_size?: string } }[];
}
interface ShowResponse {
  capabilities?: string[];
  system?: string;
}

/** Pings the local Ollama daemon and describes every installed model. Called at boot and on refresh. */
export async function discoverOllama(): Promise<LocalModel[]> {
  try {
    const res = await fetch(`${config.ollamaHost}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as TagsResponse;
    installed = await Promise.all(
      (data.models ?? []).map(async (m): Promise<LocalModel> => {
        let show: ShowResponse = {};
        try {
          const r = await fetch(`${config.ollamaHost}/api/show`, {
            method: "POST",
            body: JSON.stringify({ model: m.name }),
            signal: AbortSignal.timeout(3000),
          });
          if (r.ok) show = (await r.json()) as ShowResponse;
        } catch {
          /* older Ollama or slow disk: fall back to what /api/tags says */
        }
        return {
          name: m.name,
          family: m.details?.family ?? "",
          paramsB: parseParams(m.details?.parameter_size, m.name),
          capabilities: show.capabilities ?? ["completion"],
          hasSystem: !!show.system?.trim(),
        };
      }),
    );
    available = true;
  } catch {
    available = false;
    installed = [];
  }
  return installed;
}

/** Installed models that can be hired (chat models, no custom personas). */
export const usableOllamaModels = (): LocalModel[] => installed.filter((m) => !skipReason(m));
export const skippedOllamaModels = (): { name: string; reason: string }[] =>
  installed.flatMap((m) => {
    const reason = skipReason(m);
    return reason ? [{ name: m.name, reason }] : [];
  });

const thinks = (model: string) => installed.find((m) => m.name === model)?.capabilities.includes("thinking") ?? false;

export const ollamaProvider: Provider = {
  id: "ollama",
  label: "Ollama (local)",
  configured: () => available,

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const data = await fetchJson("ollama", `${config.ollamaHost}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        stream: false,
        messages: [
          { role: "system", content: req.system + schemaInstruction(req.json) },
          ...req.messages.map((m, i) => (i === 0 && m.role === "user" && req.images?.length ? { ...m, images: req.images.map((img) => img.data) } : m)),
        ],
        ...(req.json ? { format: req.json.schema } : {}),
        // Thinking models (Qwen3, DeepSeek R1…) only think when the task asks for more than low effort.
        ...(thinks(req.model) ? { think: req.effort !== undefined && req.effort !== "low" } : {}),
        options: { num_predict: req.maxTokens, num_ctx: 32768 },
      }),
      signal: req.signal,
    });
    return {
      text: data.message?.content ?? "",
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      warning: data.done_reason === "length" ? "max_tokens" : undefined,
    };
  },
};
