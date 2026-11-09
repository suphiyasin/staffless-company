import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");

const env = (k: string, d = "") => (process.env[k] ?? d).trim();

export const config = {
  port: Number(env("PORT", "4747")),
  host: env("HOST", "127.0.0.1"),
  language: (env("COMPANY_LANGUAGE", "en") === "tr" ? "tr" : "en") as "tr" | "en",
  prod: process.argv.includes("--prod") || process.env.NODE_ENV === "production",
  forceMock: env("FORCE_MOCK") === "true",
  anthropicKey: env("ANTHROPIC_API_KEY"),
  openaiKey: env("OPENAI_API_KEY"),
  geminiKey: env("GEMINI_API_KEY"),
  ollamaHost: env("OLLAMA_HOST", "http://127.0.0.1:11434").replace(/\/+$/, ""),
  compatBaseUrl: env("COMPAT_BASE_URL").replace(/\/+$/, ""),
  compatKey: env("COMPAT_API_KEY"),
  // Local coding-agent CLIs (use your subscription instead of an API key): auto | off
  claudeCli: env("CLAUDE_CLI", "auto") === "off" ? "off" : "auto",
  codexCli: env("CODEX_CLI", "auto") === "off" ? "off" : "auto",
  claudeCliPath: env("CLAUDE_CLI_PATH"),
  codexCliPath: env("CODEX_CLI_PATH"),
  cliTimeoutMs: Number(env("CLI_TIMEOUT_MIN", "20")) * 60_000,
  /** By default API keys are hidden from the CLIs so they bill your subscription, not your API account. */
  cliUseApiKeys: env("CLI_USE_API_KEYS") === "true",
  /** Interpreters for free syntax checks / PHP preview (auto-detected when empty). */
  phpBin: env("PHP_BIN"),
  /** Telegram bot token (can also be pasted in Settings → Telegram). */
  telegramToken: env("TELEGRAM_BOT_TOKEN"),
  /** Bot API base URL; change only for a self-hosted Bot API server. */
  telegramApiBase: env("TELEGRAM_API_BASE", "https://api.telegram.org").replace(/\/+$/, ""),
  /** Chat ids that may command the company without pairing (comma-separated). */
  telegramAllowed: env("TELEGRAM_ALLOWED_CHAT_IDS")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x !== 0),
  pythonBin: env("PYTHON_BIN"),
  /** Chrome/Edge/Chromium for the browser check (auto-detected when empty; "off" disables it). */
  browserPath: env("BROWSER_PATH"),
  paths: {
    data: path.resolve(env("DATA_DIR") || path.join(ROOT, "data")),
    workspace: path.resolve(env("WORKSPACE_DIR") || path.join(ROOT, "workspace")),
    catalog: path.join(ROOT, "config", "models.json"),
    web: path.join(ROOT, "web"),
    webDist: path.join(ROOT, "web", "dist"),
  },
};
