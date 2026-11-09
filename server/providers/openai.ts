import { config } from "../config.ts";
import { fetchJson, schemaInstruction, type ChatRequest, type ChatResponse, type Provider } from "./types.ts";
import type { ProviderId } from "../types.ts";

/**
 * OpenAI Chat Completions. The same code powers the "compat" provider, which
 * talks to any OpenAI-compatible endpoint (OpenRouter, Groq, LM Studio, vLLM...).
 */
function makeOpenAIProvider(opts: {
  id: ProviderId;
  label: string;
  baseUrl: () => string;
  apiKey: () => string;
  configured: () => boolean;
  official: boolean;
}): Provider {
  return {
    id: opts.id,
    label: opts.label,
    configured: opts.configured,

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: [
          { role: "system", content: req.system + schemaInstruction(req.json) },
          ...req.messages.map((m, i) =>
            i === 0 && m.role === "user" && req.images?.length
              ? {
                  role: "user",
                  content: [
                    { type: "text", text: m.content },
                    ...req.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.data}` } })),
                  ],
                }
              : m,
          ),
        ],
      };
      if (opts.official) {
        body.max_completion_tokens = req.maxTokens;
        body.reasoning_effort = req.effort ?? "medium";
        if (req.json) {
          body.response_format = {
            type: "json_schema",
            json_schema: { name: req.json.name, schema: req.json.schema, strict: true },
          };
        }
      } else {
        body.max_tokens = req.maxTokens;
        if (req.json) body.response_format = { type: "json_object" };
      }

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opts.apiKey()) headers.authorization = `Bearer ${opts.apiKey()}`;

      const data = await fetchJson(opts.id, `${opts.baseUrl()}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: req.signal,
      });
      const choice = data.choices?.[0];
      return {
        text: choice?.message?.content ?? "",
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        warning: choice?.finish_reason === "length" ? "max_tokens" : undefined,
      };
    },
  };
}

export const openaiProvider = makeOpenAIProvider({
  id: "openai",
  label: "OpenAI",
  baseUrl: () => "https://api.openai.com/v1",
  apiKey: () => config.openaiKey,
  configured: () => Boolean(config.openaiKey),
  official: true,
});

export const compatProvider = makeOpenAIProvider({
  id: "compat",
  label: "OpenAI-compatible",
  baseUrl: () => config.compatBaseUrl,
  apiKey: () => config.compatKey,
  configured: () => Boolean(config.compatBaseUrl),
  official: false,
});
