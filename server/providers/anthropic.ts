import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.ts";
import { ProviderError, type ChatRequest, type ChatResponse, type Provider } from "./types.ts";

// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ apiKey: config.anthropicKey, maxRetries: 3 }));

export const anthropicProvider: Provider = {
  id: "anthropic",
  label: "Anthropic (Claude)",
  configured: () => Boolean(config.anthropicKey),

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const useFallback = FALLBACK_MODELS.has(req.model);
    try {
      // Streaming + finalMessage() keeps long file-writing turns clear of HTTP timeouts.
      // Thinking is left at the model default (adaptive); effort controls depth.
      const stream = getClient().beta.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: req.messages.map((m, i) =>
            i === 0 && m.role === "user" && req.images?.length
              ? {
                  role: "user" as const,
                  content: [
                    ...req.images.flatMap((img) => [
                      { type: "text" as const, text: `Image: ${img.label ?? "screenshot"}` },
                      { type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.data } },
                    ]),
                    { type: "text" as const, text: m.content },
                  ],
                }
              : m,
          ),
          output_config: {
            effort: req.effort ?? "medium",
            ...(req.json ? { format: { type: "json_schema" as const, schema: req.json.schema } } : {}),
          },
          ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal: req.signal },
      );
      const msg = await stream.finalMessage();

      if (msg.stop_reason === "refusal") {
        throw new ProviderError("anthropic", "Model declined the request (refusal).");
      }
      const text = msg.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");

      return {
        text,
        inputTokens:
          msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0),
        outputTokens: msg.usage.output_tokens,
        warning: msg.stop_reason === "max_tokens" ? "max_tokens" : undefined,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Anthropic.APIConnectionError) throw new ProviderError("anthropic", `Connection error: ${err.message}`, true, true);
      if (err instanceof Anthropic.AuthenticationError) throw new ProviderError("anthropic", "Invalid API key.");
      if (err instanceof Anthropic.BadRequestError) throw new ProviderError("anthropic", `Bad request: ${err.message}`);
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError("anthropic", "Rate limited.", true);
      if (err instanceof Anthropic.APIError) throw new ProviderError("anthropic", `API error ${err.status}: ${err.message}`, true);
      throw err;
    }
  },
};
