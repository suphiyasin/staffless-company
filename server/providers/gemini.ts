import { config } from "../config.ts";
import { fetchJson, schemaInstruction, type ChatRequest, type ChatResponse, type Provider } from "./types.ts";

export const geminiProvider: Provider = {
  id: "gemini",
  label: "Google Gemini",
  configured: () => Boolean(config.geminiKey),

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
    const data = await fetchJson("gemini", url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system + schemaInstruction(req.json) }] },
        contents: req.messages.map((m, i) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [
            ...(i === 0 && m.role === "user" ? (req.images ?? []).map((img) => ({ inline_data: { mime_type: img.mediaType, data: img.data } })) : []),
            { text: m.content },
          ],
        })),
        generationConfig: {
          maxOutputTokens: req.maxTokens,
          ...(req.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: req.signal,
    });
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
    return {
      text,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      warning: cand?.finishReason === "MAX_TOKENS" ? "max_tokens" : undefined,
    };
  },
};
