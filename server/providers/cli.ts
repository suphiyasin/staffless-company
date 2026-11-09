import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.ts";
import type { ProviderId } from "../types.ts";
import { ProviderError, type ChatRequest, type ChatResponse, type Provider } from "./types.ts";

/**
 * Providers that drive locally installed coding-agent CLIs instead of an API:
 *
 *   claude-cli → Claude Code (`claude -p`), billed to your Claude Pro/Max login
 *   codex-cli  → OpenAI Codex (`codex exec`), billed to your ChatGPT login
 *
 * Both run non-interactively with tools disabled / a read-only sandbox, in an
 * empty working directory, and return schema-validated JSON.
 */

interface Launch {
  command: string;
  prefix: string[];
  source: string;
}

interface CliState {
  launch: Launch | null;
  loggedIn: boolean;
  detail: string;
}

const state: Record<"claude-cli" | "codex-cli", CliState> = {
  "claude-cli": { launch: null, loggedIn: false, detail: "not checked" },
  "codex-cli": { launch: null, loggedIn: false, detail: "not checked" },
};

const isWin = process.platform === "win32";
const workDir = path.join(os.tmpdir(), "staffless-cli");

// ───────────────────────────── locating binaries ─────────────────────────────

function which(names: string[]): string | null {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const p = path.join(dir, name);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/**
 * Turns a found executable into something spawn() can run without a shell.
 * npm's Windows .cmd shims are parsed to find the real .exe or .js target,
 * which avoids cmd.exe quoting problems with long multi-line prompts.
 */
function resolveLaunch(file: string): Launch | null {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return { command: process.execPath, prefix: [file], source: file };
  if (ext === ".cmd" || ext === ".bat") {
    // npm shims can mention several paths (e.g. an optional "%dp0%\node.exe" before the real
    // "%dp0%\node_modules\…\codex.js"); use the first one that exists, skipping the bundled-node check.
    const text = fs.readFileSync(file, "utf8");
    const targets = [...text.matchAll(/"%(?:~dp0|dp0%)\\([^"]+)"/gi)].map((m) => m[1]).filter((t) => !/^node(\.exe)?$/i.test(t));
    for (const t of targets) {
      const target = path.join(path.dirname(file), t);
      if (fs.existsSync(target)) return resolveLaunch(target) ?? { command: target, prefix: [], source: file };
    }
    return null;
  }
  return { command: file, prefix: [], source: file };
}

function locate(envPath: string, names: string[]): Launch | null {
  if (envPath) return fs.existsSync(envPath) ? resolveLaunch(envPath) : null;
  const found = which(isWin ? names.flatMap((n) => [`${n}.exe`, `${n}.cmd`]) : names);
  return found ? resolveLaunch(found) : null;
}

// ───────────────────────────── running ─────────────────────────────

/**
 * Child environment: drop variables that make a CLI think it is nested inside
 * another Claude Code session, and API keys that would silently switch it from
 * your subscription to pay-as-you-go billing.
 */
function childEnv(dropKeys: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_") || k === "CLAUDE_PID" || k === "CLAUDE_EFFORT") continue;
    if (dropKeys.includes(k)) continue;
    env[k] = v;
  }
  return env;
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  if (isWin) spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }).on("error", () => {});
  else
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  provider: ProviderId,
  launch: Launch,
  args: string[],
  opts: { stdin?: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs?: number },
): Promise<RunResult> {
  fs.mkdirSync(workDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, [...launch.prefix, ...args], {
      cwd: workDir,
      env: opts.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const timer = setTimeout(() => {
      killTree(child.pid);
      finish(() => reject(new ProviderError(provider, `CLI timed out after ${Math.round((opts.timeoutMs ?? 0) / 60000)} min`, true)));
    }, opts.timeoutMs ?? config.cliTimeoutMs);
    const onAbort = () => {
      killTree(child.pid);
      finish(() => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })));
    };
    opts.signal?.addEventListener("abort", onAbort);

    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    child.on("error", (err) => finish(() => reject(new ProviderError(provider, `Could not start CLI: ${err.message}`))));
    child.on("close", (code) => finish(() => resolve({ code, stdout, stderr })));
    child.stdin.on("error", () => {});
    child.stdin.end(opts.stdin ?? "");
  });
}

/** CLIs take a single prompt, so retries (assistant turn + correction) are folded into one. */
function flatten(req: ChatRequest): string {
  return req.messages
    .map((m, i) =>
      m.role === "assistant"
        ? `\n\n--- YOUR PREVIOUS ANSWER ---\n${m.content}`
        : i === 0
          ? m.content
          : `\n\n--- FOLLOW-UP ---\n${m.content}`,
    )
    .join("");
}

const tail = (s: string, n = 400) => s.trim().slice(-n);
const retryableText = (s: string) => /overload|rate.?limit|429|5\d\d|timeout|ECONNRESET|temporar/i.test(s) || networkText(s);
const networkText = (s: string) => /network|connection (error|refused|reset)|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|getaddrinfo|fetch failed|unable to connect|offline/i.test(s);

// ───────────────────────────── Claude Code ─────────────────────────────

export const claudeCliProvider: Provider = {
  id: "claude-cli",
  label: "Claude Code (subscription)",
  configured: () => Boolean(state["claude-cli"].launch && state["claude-cli"].loggedIn),

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const launch = state["claude-cli"].launch;
    if (!launch) throw new ProviderError("claude-cli", "Claude Code CLI not found");
    // Pictures need the stream-json input format; the final "result" event has the same shape.
    const images = req.images ?? [];
    const args = [
      "-p",
      ...(images.length ? ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"] : ["--output-format", "json"]),
      "--model", req.model,
      "--system-prompt", req.system,
      "--tools", "",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--effort", req.effort ?? "medium",
    ];
    if (req.json) args.push("--json-schema", JSON.stringify(req.json.schema));

    const stdin = images.length
      ? JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              ...images.flatMap((img) => [
                { type: "text", text: `Image: ${img.label ?? "screenshot"}` },
                { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } },
              ]),
              { type: "text", text: flatten(req) },
            ],
          },
        }) + "\n"
      : flatten(req);
    const res = await run("claude-cli", launch, args, {
      stdin,
      env: childEnv(config.cliUseApiKeys ? [] : ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]),
      signal: req.signal,
    });

    const line = res.stdout.trim().split(/\r?\n/).reverse().find((l) => l.startsWith("{"));
    let out: any;
    try {
      out = line ? JSON.parse(line) : null;
    } catch {
      out = null;
    }
    if (!out) {
      const msg = tail(res.stderr || res.stdout) || `exit code ${res.code}`;
      throw new ProviderError("claude-cli", msg, retryableText(msg), networkText(msg));
    }
    if (out.is_error || out.subtype?.startsWith("error")) {
      const msg = String(out.result ?? out.subtype ?? "unknown error");
      throw new ProviderError("claude-cli", msg, retryableText(msg), networkText(msg));
    }
    const u = out.usage ?? {};
    return {
      text: out.structured_output !== undefined ? JSON.stringify(out.structured_output) : String(out.result ?? ""),
      inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      warning: out.stop_reason === "max_tokens" ? "max_tokens" : undefined,
    };
  },
};

// ───────────────────────────── Codex ─────────────────────────────

const CODEX_PREAMBLE =
  "You are being used as a plain text-generation model inside an automated pipeline. " +
  "Do not run commands, read files or browse; answer directly from the information below.\n\n";

export const codexCliProvider: Provider = {
  id: "codex-cli",
  label: "Codex CLI (ChatGPT)",
  configured: () => Boolean(state["codex-cli"].launch && state["codex-cli"].loggedIn),

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const launch = state["codex-cli"].launch;
    if (!launch) throw new ProviderError("codex-cli", "Codex CLI not found");
    fs.mkdirSync(workDir, { recursive: true });
    const id = randomUUID().slice(0, 8);
    const outFile = path.join(workDir, `codex-${id}.txt`);
    const schemaFile = path.join(workDir, `codex-${id}.schema.json`);

    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox", "read-only",
      "--color", "never",
      "--json",
      "-C", workDir,
      "-o", outFile,
      "-c", `model_reasoning_effort="${req.effort ?? "medium"}"`,
    ];
    if (req.model && req.model !== "default") args.push("-m", req.model);
    if (req.json) {
      fs.writeFileSync(schemaFile, JSON.stringify(req.json.schema));
      args.push("--output-schema", schemaFile);
    }
    const imageFiles = (req.images ?? []).map((img, n) => {
      const file = path.join(workDir, `codex-${id}-${n}.${img.mediaType === "image/png" ? "png" : "jpg"}`);
      fs.writeFileSync(file, Buffer.from(img.data, "base64"));
      return file;
    });
    for (const f of imageFiles) args.push("--image", f);
    args.push("--", "-");

    try {
      const res = await run("codex-cli", launch, args, {
        stdin: `${CODEX_PREAMBLE}# Instructions\n${req.system}\n\n# Task\n${flatten(req)}`,
        env: childEnv(config.cliUseApiKeys ? [] : ["OPENAI_API_KEY"]),
        signal: req.signal,
      });

      let inputTokens = 0;
      let outputTokens = 0;
      let lastError = "";
      for (const l of res.stdout.split(/\r?\n/)) {
        if (!l.startsWith("{")) continue;
        try {
          const ev = JSON.parse(l);
          const usage = ev.usage ?? ev.msg?.usage ?? ev.info?.total_token_usage;
          if (usage) {
            inputTokens += usage.input_tokens ?? 0;
            outputTokens += usage.output_tokens ?? 0;
          }
          if (/error|failed/i.test(String(ev.type ?? ev.msg?.type ?? ""))) {
            lastError = String(ev.message ?? ev.error?.message ?? ev.msg?.message ?? JSON.stringify(ev).slice(0, 300));
          }
        } catch {
          /* non-JSON progress line */
        }
      }
      const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
      if (!text.trim()) {
        const msg = lastError || tail(res.stderr || res.stdout) || `exit code ${res.code}`;
        throw new ProviderError("codex-cli", msg, retryableText(msg), networkText(msg));
      }
      return { text, inputTokens, outputTokens };
    } finally {
      fs.rmSync(outFile, { force: true });
      fs.rmSync(schemaFile, { force: true });
      for (const f of imageFiles) fs.rmSync(f, { force: true });
    }
  },
};

// ───────────────────────────── detection ─────────────────────────────

/** Finds the CLIs and checks they are logged in. Called at boot and on "Refresh models". */
export async function detectClis(): Promise<void> {
  const env = childEnv([]);

  const claude = state["claude-cli"];
  claude.launch = config.claudeCli === "off" ? null : locate(config.claudeCliPath, ["claude"]);
  claude.loggedIn = false;
  if (config.claudeCli === "off") claude.detail = "disabled (CLAUDE_CLI=off)";
  else if (!claude.launch) claude.detail = "not installed (npm i -g @anthropic-ai/claude-code)";
  else {
    try {
      const r = await run("claude-cli", claude.launch, ["auth", "status"], { env, timeoutMs: 20_000 });
      const status = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
      claude.loggedIn = Boolean(status.loggedIn);
      claude.detail = claude.loggedIn ? `logged in (${status.authMethod ?? "ok"})` : "not logged in (run: claude auth login)";
    } catch (err) {
      claude.detail = `status check failed: ${(err as Error).message}`;
    }
  }

  const codex = state["codex-cli"];
  codex.launch = config.codexCli === "off" ? null : locate(config.codexCliPath, ["codex"]);
  codex.loggedIn = false;
  if (config.codexCli === "off") codex.detail = "disabled (CODEX_CLI=off)";
  else if (!codex.launch) codex.detail = "not installed (npm i -g @openai/codex)";
  else {
    try {
      const r = await run("codex-cli", codex.launch, ["login", "status"], { env, timeoutMs: 20_000 });
      const text = `${r.stdout}\n${r.stderr}`;
      codex.loggedIn = r.code === 0 && !/not logged in/i.test(text);
      codex.detail = codex.loggedIn ? tail(text.split(/\r?\n/).filter(Boolean)[0] ?? "logged in", 80) : "not logged in (run: codex login)";
    } catch (err) {
      codex.detail = `status check failed: ${(err as Error).message}`;
    }
  }
}

export const cliDetail = (id: "claude-cli" | "codex-cli") => state[id].detail;
