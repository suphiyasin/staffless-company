import { EventEmitter } from "node:events";
import net from "node:net";
import { config } from "./config.ts";
import { ProviderError } from "./providers/types.ts";
import type { ProviderId } from "./types.ts";

/**
 * Keeps work alive through network drops. When a call fails because a
 * provider can't be reached, we stop counting it as a failure: we wait until
 * the provider's host accepts connections again, then repeat the same call.
 * Ordinary transient errors (429, 5xx) still get a few backed-off retries.
 */

export interface NetworkStatus {
  online: boolean;
  /** What we are waiting for, e.g. "api.anthropic.com". */
  waitingFor?: string;
  since?: string;
}

export const netEvents = new EventEmitter();
let status: NetworkStatus = { online: true };
const waiting = new Map<string, number>(); // host → number of calls waiting on it

export const networkStatus = (): NetworkStatus => status;

function setStatus(next: NetworkStatus) {
  if (next.online === status.online && next.waitingFor === status.waitingFor) return;
  status = next;
  netEvents.emit("change", status);
}

function hostOf(url: string, fallbackPort: number): { host: string; port: number } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: Number(u.port) || (u.protocol === "https:" ? 443 : fallbackPort) };
  } catch {
    return null;
  }
}

/** The host a provider must reach. Local or simulated providers have none to wait for. */
export function targetFor(provider: ProviderId): { host: string; port: number } | null {
  switch (provider) {
    case "anthropic":
    case "claude-cli":
      return { host: "api.anthropic.com", port: 443 };
    case "openai":
    case "codex-cli":
      return { host: "api.openai.com", port: 443 };
    case "gemini":
      return { host: "generativelanguage.googleapis.com", port: 443 };
    case "ollama":
      return hostOf(config.ollamaHost, 11434);
    case "compat":
      return config.compatBaseUrl ? hostOf(config.compatBaseUrl, 80) : null;
    default:
      return null;
  }
}

export function reachable(target: { host: string; port: number }, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: target.host, port: target.port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      },
      { once: true },
    );
  });

/** Blocks until the host accepts TCP connections. Polls every few seconds; aborts with the project. */
export async function waitUntilReachable(target: { host: string; port: number }, signal?: AbortSignal, pollMs = 5000) {
  const key = `${target.host}:${target.port}`;
  waiting.set(key, (waiting.get(key) ?? 0) + 1);
  setStatus({ online: false, waitingFor: target.host, since: status.since ?? new Date().toISOString() });
  try {
    for (;;) {
      if (await reachable(target)) return;
      await sleep(pollMs, signal);
    }
  } finally {
    const left = (waiting.get(key) ?? 1) - 1;
    if (left > 0) waiting.set(key, left);
    else waiting.delete(key);
    if (!waiting.size) setStatus({ online: true });
  }
}

const NETWORK_TEXT = /network|connection (error|refused|reset)|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|getaddrinfo|fetch failed|socket hang up|offline|unable to connect/i;
export const looksLikeNetwork = (err: unknown) =>
  (err instanceof ProviderError && err.network) || NETWORK_TEXT.test((err as Error)?.message ?? "");

/**
 * Runs a provider call. Network failures wait for the provider to come back
 * and then retry without limit (the project's abort signal still stops it);
 * other retryable errors get up to `retries` backed-off attempts.
 */
export async function resilient<T>(
  provider: ProviderId,
  fn: () => Promise<T>,
  opts: { signal?: AbortSignal; retries?: number; pollMs?: number } = {},
): Promise<T> {
  const target = targetFor(provider);
  let transient = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if ((err as Error)?.name === "AbortError" || opts.signal?.aborted) throw err;
      if (target && looksLikeNetwork(err) && !(await reachable(target))) {
        await waitUntilReachable(target, opts.signal, opts.pollMs);
        continue; // back online: repeat the same call, not counted as a failure
      }
      const retryable = err instanceof ProviderError ? err.retryable : looksLikeNetwork(err);
      if (retryable && transient < (opts.retries ?? 3)) {
        transient += 1;
        await sleep(Math.min(30_000, 2000 * 2 ** (transient - 1)), opts.signal);
        continue;
      }
      throw err;
    }
  }
}
