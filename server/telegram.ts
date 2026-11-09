import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ZipArchive } from "archiver";
import { config } from "./config.ts";
import { store } from "./store.ts";
import { role } from "./company/org.ts";
import { listDesigns } from "./designs.ts";
import type { Project, RoleId, StaffingRequest, TelegramStatus } from "./types.ts";

/**
 * Telegram: give the company work from your phone and hear back when it matters.
 *
 *  - Long polling (getUpdates), so it works from a laptop behind NAT: no webhook, no open port.
 *  - Only paired chats can command the company. Pairing uses a 6-digit code shown in the
 *    panel (Settings → Telegram) and in the server console; the code rotates after each use.
 *  - The bot token comes from TELEGRAM_BOT_TOKEN or is pasted in the panel (saved in
 *    DATA_DIR/telegram.json, which never leaves this machine).
 */

export interface TelegramActions {
  createProject(brief: string, designId?: string): Project;
  requestRevision(projectId: string, text: string): Project;
  cancelProject(projectId: string): void;
  resumeProject(projectId: string): void;
  decideHire(requestId: string, decision: "approve" | "reject", modelKey?: string, note?: string): void;
  phaseOf(project: Project): string;
}

interface Chat {
  id: number;
  name: string;
  pairedAt: string;
}
interface Saved {
  token?: string;
  chats: Chat[];
  notify: "important" | "all";
}

const file = () => path.join(config.paths.data, "telegram.json");
let saved: Saved = { chats: [], notify: "important" };
let actions: TelegramActions | null = null;
let botName = "";
let lastError = "";
let pairingCode = "";
let loop: AbortController | null = null;
const failedPairs = new Map<number, number>();
const nagged = new Map<number, number>();
const sentHireButtons = new Set<string>();
const lastProjectByChat = new Map<number, string>();

const token = () => config.telegramToken || saved.token || "";
const newCode = () => (pairingCode = String(randomInt(100000, 1000000)));
const persist = () => {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(saved, null, 2));
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s: string, n = 3500) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function telegramStatus(): TelegramStatus {
  return {
    configured: Boolean(token()),
    tokenSource: config.telegramToken ? "env" : saved.token ? "panel" : null,
    bot: botName || undefined,
    connected: Boolean(botName) && !lastError,
    error: lastError || undefined,
    chats: saved.chats.map((c) => ({ id: c.id, name: c.name })),
    pairingCode: token() ? pairingCode : undefined,
    notify: saved.notify,
  };
}

// ───────────────────────────── Bot API ─────────────────────────────

async function tg<T = any>(method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${config.telegramApiBase}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(data.description ?? `Telegram HTTP ${res.status}`);
  return data.result as T;
}

async function send(chatId: number, html: string, extra: Record<string, unknown> = {}) {
  try {
    await tg("sendMessage", { chat_id: chatId, text: clip(html), parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  } catch (err) {
    console.warn("  Telegram send failed:", (err as Error).message);
  }
}

async function broadcast(html: string, extra: Record<string, unknown> = {}) {
  await Promise.all(saved.chats.map((c) => send(c.id, html, extra)));
}

function zipProject(dir: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    zip.on("data", (c: Buffer) => chunks.push(c));
    zip.on("end", () => resolve(Buffer.concat(chunks)));
    zip.on("error", reject);
    zip.directory(dir, false);
    void zip.finalize();
  });
}

async function sendZip(project: Project) {
  const dir = path.join(config.paths.workspace, project.id);
  if (!fs.existsSync(dir)) return;
  const buf = await zipProject(dir);
  if (buf.length > 45 * 1024 * 1024) return; // Bot API upload limit is 50 MB
  const name = `${project.title.replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-|-$/g, "") || project.id}.zip`;
  for (const c of saved.chats) {
    const form = new FormData();
    form.set("chat_id", String(c.id));
    form.set("document", new Blob([new Uint8Array(buf)], { type: "application/zip" }), name);
    try {
      await fetch(`${config.telegramApiBase}/bot${token()}/sendDocument`, { method: "POST", body: form });
    } catch (err) {
      console.warn("  Telegram upload failed:", (err as Error).message);
    }
  }
}

// ───────────────────────────── commands ─────────────────────────────

const HELP = [
  "<b>Staffless</b> on Telegram",
  "",
  "Just write what you want built, or:",
  "/new &lt;brief&gt; start a project",
  "/new design:&lt;id&gt; &lt;brief&gt; start it in a library design (e.g. design:sport-energy)",
  "/designs list the design library",
  "/status what the teams are doing",
  "/projects recent projects",
  "/change [id] &lt;text&gt; ask for a change (latest project if no id)",
  "/stop [id] · /resume [id]",
].join("\n");

function findProject(chatId: number, idOrNothing?: string): Project | undefined {
  if (idOrNothing && store.projects.has(idOrNothing)) return store.projects.get(idOrNothing);
  const remembered = lastProjectByChat.get(chatId);
  if (remembered && store.projects.has(remembered)) return store.projects.get(remembered);
  return [...store.projects.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function line(p: Project): string {
  const tasks = p.tasks.filter((t) => t.round === p.round);
  const done = tasks.filter((t) => t.status === "done").length;
  return `• <b>${esc(p.title)}</b> <code>${p.id}</code>\n  ${esc(actions?.phaseOf(p) ?? p.status)} · ${done}/${tasks.length} tasks · $${p.usage.costUsd.toFixed(2)}`;
}

async function handleMessage(msg: any) {
  const chatId: number = msg.chat?.id;
  const text: string = (msg.text ?? "").trim();
  if (!chatId || !text) return;
  const paired = saved.chats.some((c) => c.id === chatId) || config.telegramAllowed.includes(chatId);

  if (text.startsWith("/pair")) {
    if (paired) return send(chatId, "This chat is already paired. /help");
    if ((failedPairs.get(chatId) ?? 0) >= 5) return send(chatId, "Too many wrong codes. Restart the Staffless server to try again.");
    if (text.split(/\s+/)[1] !== pairingCode) {
      failedPairs.set(chatId, (failedPairs.get(chatId) ?? 0) + 1);
      return send(chatId, "Wrong code. Use the code shown in Staffless → Settings → Telegram.");
    }
    const name = msg.chat.title || [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(" ") || String(chatId);
    saved.chats.push({ id: chatId, name, pairedAt: new Date().toISOString() });
    persist();
    newCode();
    store.touchCompany();
    return send(chatId, `Paired. You are the boss now.\n\n${HELP}`);
  }

  if (!paired) {
    // Strangers get one hint per minute and nothing else.
    if (Date.now() - (nagged.get(chatId) ?? 0) > 60_000) {
      nagged.set(chatId, Date.now());
      await send(chatId, "This bot belongs to a Staffless install. Pair it with <code>/pair &lt;code&gt;</code> using the code shown in Settings → Telegram.");
    }
    return;
  }
  if (!actions) return;

  const [cmd, ...rest] = text.split(/\s+/);
  const arg = text.slice(cmd.length).trim();
  try {
    switch (cmd.toLowerCase().replace(/@.*$/, "")) {
      case "/start":
      case "/help":
        return send(chatId, HELP);
      case "/designs": {
        const designs = listDesigns();
        return send(chatId, designs.length ? designs.map((d) => `• <code>${d.id}</code> ${esc(d.name)} · ${esc(d.tags.join(", "))}`).join("\n") : "The design library is empty.");
      }
      case "/status": {
        const running = [...store.projects.values()].filter((p) => ["planning", "in_progress", "delivering", "paused"].includes(p.status));
        return send(chatId, running.length ? running.map(line).join("\n\n") : "Nothing running. Send a brief to start a project.");
      }
      case "/projects": {
        const list = [...store.projects.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
        return send(chatId, list.length ? list.map(line).join("\n\n") : "No projects yet.");
      }
      case "/change": {
        const maybeId = rest[0] && store.projects.has(rest[0]) ? rest[0] : undefined;
        const change = maybeId ? arg.slice(maybeId.length).trim() : arg;
        const p = findProject(chatId, maybeId);
        if (!p) return send(chatId, "No project to change yet.");
        if (change.length < 3) return send(chatId, "Tell me what to change, e.g. <code>/change make the header dark green</code>");
        actions.requestRevision(p.id, change);
        lastProjectByChat.set(chatId, p.id);
        return send(chatId, `Passing it to the CEO: <b>${esc(p.title)}</b>, round ${p.round}.`);
      }
      case "/stop":
      case "/resume": {
        const p = findProject(chatId, rest[0]);
        if (!p) return send(chatId, "No such project.");
        if (cmd === "/stop") actions.cancelProject(p.id);
        else actions.resumeProject(p.id);
        return send(chatId, `${cmd === "/stop" ? "Stopped" : "Resuming"} <b>${esc(p.title)}</b>.`);
      }
      case "/new":
      default: {
        if (cmd.startsWith("/") && cmd !== "/new") return send(chatId, `Unknown command.\n\n${HELP}`);
        let brief = cmd === "/new" ? arg : text;
        // Optional style: "design:sport-energy A site for our club…"
        const styleMatch = brief.match(/^design:([a-z0-9-]+)\s+/i);
        if (styleMatch) brief = brief.slice(styleMatch[0].length);
        if (brief.length < 5) return send(chatId, "Describe the project in a bit more detail.");
        const p = actions.createProject(brief, styleMatch?.[1].toLowerCase());
        lastProjectByChat.set(chatId, p.id);
        return send(chatId, `Brief received (<code>${p.id}</code>). The CEO is planning; I'll report back here.`);
      }
    }
  } catch (err) {
    return send(chatId, `Couldn't do that: ${esc((err as Error).message)}`);
  }
}

async function handleCallback(q: any) {
  const chatId: number = q.message?.chat?.id;
  const paired = saved.chats.some((c) => c.id === chatId) || config.telegramAllowed.includes(chatId);
  const [kind, id, choice] = String(q.data ?? "").split(":");
  let answer = "Done";
  if (!paired || kind !== "hire" || !actions) answer = "Not allowed";
  else {
    try {
      actions.decideHire(id, choice === "a" ? "approve" : "reject", undefined, "Decided by the owner on Telegram");
      answer = choice === "a" ? "Hired" : "Declined";
      await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      await send(chatId, choice === "a" ? "Hired. The team gets to work." : "Declined. The manager will do it personally.");
    } catch (err) {
      answer = (err as Error).message.slice(0, 180);
    }
  }
  await tg("answerCallbackQuery", { callback_query_id: q.id, text: answer }).catch(() => {});
}

async function pollLoop(signal: AbortSignal) {
  let offset = 0;
  let backoff = 2000;
  while (!signal.aborted) {
    try {
      const updates = await tg<any[]>("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] }, signal);
      backoff = 2000;
      if (lastError) {
        lastError = "";
        store.touchCompany();
      }
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) await handleMessage(u.message);
        if (u.callback_query) await handleCallback(u.callback_query);
      }
    } catch (err) {
      if (signal.aborted) return;
      const msg = (err as Error).message;
      if (lastError !== msg) {
        lastError = msg;
        store.touchCompany();
      }
      // Offline or Telegram hiccup: keep trying, more slowly.
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(60_000, backoff * 2);
    }
  }
}

export async function startTelegram(a?: TelegramActions) {
  if (a) actions = a;
  try {
    saved = { ...saved, ...JSON.parse(fs.readFileSync(file(), "utf8")) };
  } catch {
    /* first run */
  }
  loop?.abort();
  loop = null;
  botName = "";
  lastError = "";
  if (!token()) return;
  newCode();
  try {
    const me = await tg<{ username: string }>("getMe");
    botName = me.username;
    console.log(`  💬 Telegram: @${botName} · ${saved.chats.length} paired chat(s)${saved.chats.length ? "" : ` · pair with /pair ${pairingCode}`}`);
  } catch (err) {
    lastError = (err as Error).message;
    console.warn(`  💬 Telegram: ${lastError}`);
  }
  loop = new AbortController();
  void pollLoop(loop.signal);
  store.touchCompany();
}

export async function setTelegramToken(value: string) {
  saved.token = value.trim() || undefined;
  persist();
  await startTelegram();
  if (lastError) throw new Error(`Telegram rejected the token: ${lastError}`);
}

export function setTelegramNotify(level: string) {
  if (level !== "important" && level !== "all") throw new Error("notify must be important or all");
  saved.notify = level;
  persist();
  store.touchCompany();
}

export function unpairChat(id: number) {
  saved.chats = saved.chats.filter((c) => c.id !== id);
  persist();
  store.touchCompany();
}

export async function sendTest() {
  if (!saved.chats.length) throw new Error("No paired chats yet.");
  await broadcast("✅ Test from Staffless. Notifications will arrive here.");
}

// ───────────────────────────── notifications ─────────────────────────────

export type Notice =
  | { type: "accepted"; project: Project; text: string }
  | { type: "planned"; project: Project; text: string }
  | { type: "report"; project: Project; text: string; from: string }
  | { type: "qa"; project: Project; passed: boolean; text: string }
  | { type: "delivered"; project: Project; text: string }
  | { type: "problem"; project: Project; text: string }
  | { type: "hire"; project: Project; requests: StaffingRequest[] };

export async function notify(n: Notice) {
  if (!token() || !saved.chats.length) return;
  const head = `<b>${esc(n.project.title)}</b> <code>${n.project.id}</code>`;
  switch (n.type) {
    case "accepted":
      return broadcast(`🏢 ${head}\nCEO: ${esc(n.text)}`);
    case "planned":
      return broadcast(`🗂 ${head}\n${esc(n.text)}`);
    case "report":
      if (saved.notify !== "all") return;
      return broadcast(`📋 ${head}\n${esc(n.from)}: ${esc(n.text)}`);
    case "qa":
      return broadcast(`${n.passed ? "✅" : "🛠"} ${head}\n${esc(n.text)}`);
    case "problem":
      return broadcast(`⚠️ ${head}\n${esc(n.text)}`);
    case "delivered": {
      const p = n.project;
      await broadcast(`🎉 ${head} is delivered\n\n${esc(n.text)}\n\n${p.files.length} files · $${p.usage.costUsd.toFixed(2)}. Reply <code>/change …</code> for changes.`);
      return sendZip(p);
    }
    case "hire":
      for (const r of n.requests) {
        if (r.approver !== "client" || sentHireButtons.has(r.id)) continue;
        sentHireButtons.add(r.id);
        const top = r.recommendations[0];
        await broadcast(`🧑‍💼 ${head}\nAI Resources: the team needs a <b>${esc(role(r.roleId as RoleId).title.en)}</b>. ${esc(r.reason)}\nPick: <b>${esc(top?.label ?? "?")}</b>`, {
          reply_markup: { inline_keyboard: [[{ text: `Hire ${top?.label ?? ""}`.slice(0, 60), callback_data: `hire:${r.id}:a` }, { text: "Decline", callback_data: `hire:${r.id}:r` }]] },
        });
      }
  }
}
