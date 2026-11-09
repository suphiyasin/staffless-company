import { useState } from "react";
import { Send, X } from "lucide-react";
import { api } from "../api.ts";
import type { TelegramStatus } from "../../../server/types.ts";

/** Settings → Telegram: connect a bot, pair chats, choose how chatty notifications are. */
export function TelegramSettings({ tg }: { tg: TelegramStatus }) {
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg("");
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tg">
      <p className="muted small">
        Send briefs from your phone and get the plan, QA result and the finished project (as a ZIP) in Telegram. Create a
        bot with <b>@BotFather</b> (<code>/newbot</code>) and paste its token here.
      </p>

      {tg.tokenSource !== "env" && (
        <div className="tg-row">
          <input
            type="password"
            value={token}
            placeholder={tg.configured ? "Bot token saved · paste a new one to replace it" : "123456:ABC-DEF…"}
            onChange={(e) => setToken(e.target.value)}
          />
          <button className="btn" disabled={busy || token.trim().length < 20} onClick={() => run(() => api("POST", "/api/telegram/token", { token }), "Connected.")}>
            Save
          </button>
        </div>
      )}

      {tg.configured && (
        <>
          <p className="small">
            {tg.connected ? (
              <span className="ok-dot">● Connected as @{tg.bot}</span>
            ) : (
              <span className="err-dot">● {tg.error ?? "Connecting…"}</span>
            )}
            {tg.tokenSource === "env" && <span className="muted"> · token from .env</span>}
          </p>
          {tg.pairingCode && (
            <p className="tg-pair">
              Pair a chat: send <code>/pair {tg.pairingCode}</code> to {tg.bot ? <b>@{tg.bot}</b> : "your bot"}. The code changes after each use.
            </p>
          )}
          {tg.chats.length > 0 && (
            <ul className="tg-chats">
              {tg.chats.map((c) => (
                <li key={c.id}>
                  <span>{c.name}</span>
                  <span className="muted small">{c.id}</span>
                  <button className="icon-btn" title="Unpair" aria-label={`Unpair ${c.name}`} onClick={() => run(() => api("DELETE", `/api/telegram/chats/${c.id}`, {}), "Unpaired.")}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="tg-row">
            <select value={tg.notify} onChange={(e) => run(() => api("PUT", "/api/telegram/settings", { notify: e.target.value }), "Saved.")}>
              <option value="important">Important only: plan, QA result, delivery, problems, approvals</option>
              <option value="all">Everything management reports</option>
            </select>
            <button className="btn" disabled={busy || !tg.chats.length} onClick={() => run(() => api("POST", "/api/telegram/test", {}), "Test message sent.")}>
              <Send size={14} /> Test
            </button>
          </div>
        </>
      )}
      {msg && <p className="callout">{msg}</p>}
    </div>
  );
}
