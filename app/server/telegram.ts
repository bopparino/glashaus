import { randomInt } from "node:crypto";
import type { StreamEvent } from "../shared/types.ts";
import { CompanionService } from "./companion.ts";
import { Store } from "./store.ts";
import { AppError, errorMessage } from "./validation.ts";

export class TelegramError extends AppError {
  code: number;
  retryAfter: number;
  constructor(message: string, code = 0, retryAfter = 0) {
    super(message, 502);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
export function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}
function networkCodes(error: unknown, depth = 0): string[] {
  if (!error || typeof error !== "object" || depth > 4) return [];
  const e = error as { code?: string; cause?: unknown; errors?: unknown[] };
  return [
    e.code ?? "",
    ...networkCodes(e.cause, depth + 1),
    ...(e.errors ?? []).flatMap((item) => networkCodes(item, depth + 1)),
  ];
}
export function telegramHtml(text: string) {
  return text
    .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<i>$1</i>");
}

interface Update {
  update_id: number;
  message?: {
    message_id: number;
    date?: number;
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number };
    reply_to_message?: { text?: string };
  };
}
export class Telegram {
  store: Store;
  service: CompanionService;
  status: {
    connected: boolean;
    pairingCode?: string;
    botName?: string;
    error?: string;
  } = { connected: false };
  private controller: AbortController | null = null;
  private pairingExpires = 0;
  private revision = 0;
  private task: Promise<void> = Promise.resolve();
  private fetcher: typeof fetch;
  private wait: typeof waitForRetry;
  constructor(
    store: Store,
    service: CompanionService,
    fetcher = fetch,
    wait = waitForRetry,
  ) {
    this.store = store;
    this.service = service;
    this.fetcher = fetcher;
    this.wait = wait;
  }
  stop() {
    this.revision++;
    this.controller?.abort();
    this.controller = null;
    this.status.connected = false;
  }
  async shutdown() {
    this.stop();
    await this.task;
  }
  start() {
    this.stop();
    if (!this.store.settings().telegramToken) {
      this.status = { connected: false };
      return;
    }
    this.controller = new AbortController();
    const signal = this.controller.signal,
      revision = this.revision;
    this.status = { connected: false };
    if (!this.store.settings().telegramOwnerId) {
      this.status.pairingCode = String(randomInt(100000, 1000000));
      this.pairingExpires = Date.now() + 15 * 60 * 1000;
    }
    // Wait for the previous poller to abort before using the same token again.
    this.task = this.task.then(() =>
      signal.aborted ? undefined : this.poll(signal, revision),
    );
  }
  async api<T>(
    method: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(
        `https://api.telegram.org/bot${this.store.settings().telegramToken}/${method}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(40000)])
            : AbortSignal.timeout(20000),
        },
      );
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const codes = networkCodes(error);
      throw new TelegramError(
        codes.some((code) => ["EACCES", "EPERM"].includes(code))
          ? "Network access to Telegram is blocked by this process's permissions or firewall. Your token has not been rejected."
          : "Telegram could not be reached. Check the connection; GlasHaus will retry automatically.",
      );
    }
    let result: {
      ok: boolean;
      result: T;
      error_code?: number;
      parameters?: { retry_after?: number };
    };
    try {
      result = (await response.json()) as typeof result;
    } catch {
      throw new TelegramError(
        "Telegram returned an unreadable response. GlasHaus will retry.",
        response.status >= 500 ? response.status : 0,
      );
    }
    if (!response.ok || !result?.ok) {
      const code = result?.error_code ?? response.status;
      const message =
        code === 401
          ? "Telegram rejected this bot token. Check the saved BotFather token, then reconnect."
          : code === 403
            ? "Telegram denied this request. Check that the bot is allowed to message you, then reconnect."
            : code === 409
              ? "Another process or webhook is using this Telegram bot. Stop the other instance, then reconnect."
              : code === 429
                ? "Telegram's rate limit was reached. GlasHaus will wait and retry."
                : `Telegram request failed (HTTP ${code}).`;
      const seconds = Number(result?.parameters?.retry_after);
      throw new TelegramError(
        message,
        code,
        Number.isFinite(seconds)
          ? Math.max(0, Math.min(seconds * 1000, 2_147_000_000))
          : 0,
      );
    }
    return result.result;
  }
  async send(
    chatId: number | string,
    text: string,
    signal?: AbortSignal,
    deliveryId?: string,
  ) {
    const parts = splitTelegram(text);
    const checkpoint = deliveryId ? `telegramDelivery:${deliveryId}` : "";
    const sent = checkpoint ? Number(this.store.meta(checkpoint) ?? 0) : 0;
    for (let i = sent; i < parts.length; i++) {
      signal?.throwIfAborted();
      try {
        await this.api(
          "sendMessage",
          { chat_id: chatId, text: telegramHtml(parts[i]), parse_mode: "HTML" },
          signal,
        );
      } catch (error) {
        // Only a definite rejected request is safe to retry as plain text.
        if (!(error instanceof TelegramError) || error.code !== 400)
          throw error;
        await this.api(
          "sendMessage",
          { chat_id: chatId, text: parts[i] },
          signal,
        );
      }
      signal?.throwIfAborted();
      if (checkpoint) this.store.setMeta(checkpoint, String(i + 1));
    }
  }
  private async poll(signal: AbortSignal, revision: number) {
    let ready = false,
      failures = 0;
    while (!signal.aborted) {
      try {
        if (!ready) {
          const me = await this.api<{ username: string }>("getMe", {}, signal);
          if (signal.aborted) return;
          const webhook = await this.api<{ url: string }>(
            "getWebhookInfo",
            {},
            signal,
          );
          if (webhook.url)
            throw new TelegramError(
              "This bot has a webhook configured. Remove it from the other integration before connecting GlasHaus; no webhook was changed.",
              409,
            );
          signal.throwIfAborted();
          this.status = {
            ...this.status,
            connected: true,
            botName: me.username,
            error: undefined,
          };
          await this.api(
            "setMyCommands",
            {
              commands: [
                {
                  command: "status",
                  description: "Connection and companion status",
                },
                { command: "memory", description: "Recent shared memories" },
              ],
            },
            signal,
          ).catch(() => {});
          ready = true;
        }
        signal.throwIfAborted();
        const offset = Number(this.store.meta("telegramOffset") ?? 0);
        const updates = await this.api<Update[]>(
          "getUpdates",
          { offset, timeout: 25, allowed_updates: ["message"] },
          signal,
        );
        signal.throwIfAborted();
        for (const u of updates) {
          if (signal.aborted) return;
          await this.onUpdate(u, signal);
          signal.throwIfAborted();
          this.store.setMeta("telegramOffset", String(u.update_id + 1));
        }
        failures = 0;
        if (revision === this.revision)
          this.status = { ...this.status, connected: true, error: undefined };
      } catch (e) {
        if (signal.aborted) return;
        if (revision === this.revision)
          this.status = {
            ...this.status,
            connected: false,
            error: errorMessage(e),
          };
        if (e instanceof TelegramError && [401, 403, 409, 400].includes(e.code))
          return;
        const delay = Math.max(
          e instanceof TelegramError ? e.retryAfter : 0,
          Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)),
        );
        await this.wait(delay, signal);
      }
    }
  }
  private async onUpdate(update: Update, signal: AbortSignal) {
    const message = update.message;
    if (!message || message.chat.type !== "private" || !message.from) return;
    const s = this.store.settings(),
      user = String(message.from.id);
    if (!s.telegramOwnerId) {
      if (
        !this.status.pairingCode ||
        Date.now() > this.pairingExpires ||
        message.text?.trim() !== `/start ${this.status.pairingCode}`
      )
        return;
      this.store.saveSettings({ ...s, telegramOwnerId: user });
      this.status.pairingCode = undefined;
      await this.send(
        message.chat.id,
        "Connected to your GlasHaus. This bot now talks only with you.",
        signal,
      );
      return;
    }
    if (user !== s.telegramOwnerId) return;
    const input = message.text?.trim();
    if (!input) {
      await this.send(
        message.chat.id,
        "This first v3 build supports text messages. Send me a description of what you wanted to share.",
        signal,
      );
      return;
    }
    const command = input.split(/\s/)[0].replace(/@\w+$/, "").toLowerCase();
    if (command === "/start" || command === "/status") {
      await this.send(
        message.chat.id,
        `${this.store.companion()?.name ?? "No companion yet"} · GlasHaus v3\nModel: ${s.model || "Choose one in Settings"}\n${this.service.background}`,
        signal,
      );
      return;
    }
    if (command === "/memory") {
      await this.send(
        message.chat.id,
        this.store
          .memories()
          .slice(0, 8)
          .map((m) => `• ${m.text}`)
          .join("\n") || "No memories saved yet.",
        signal,
      );
      return;
    }
    if (command === "/pause" || command === "/resume") {
      await this.send(
        message.chat.id,
        "Proactive messages are not enabled in this v3 alpha. I only reply when you message me.",
        signal,
      );
      return;
    }
    const companion = this.store.companion();
    if (!companion) {
      await this.send(
        message.chat.id,
        "No companion lives here right now. Create or restore one in the web app before chatting.",
        signal,
      );
      return;
    }
    if (
      message.date &&
      message.date < Math.floor(Date.parse(companion.createdAt) / 1000)
    )
      return; // Do not feed a new companion queued messages from before setup.
    const id = `telegram:${update.update_id}`;
    const existing = this.store.turn(id);
    if (existing?.delivered) return;
    if (input.length > 16000) {
      await this.send(
        message.chat.id,
        "That message is too long for one turn. Please split it into smaller parts.",
        signal,
      );
      return;
    }
    const quote = message.reply_to_message?.text?.slice(0, 1200);
    const content = quote ? `[Replying to: ${quote}]\n${input}` : input;
    let accumulated = "",
      lastDraft = 0;
    let draftSupported = true;
    let draftPending = false;
    const emit = (e: StreamEvent) => {
      if (e.type !== "token") return;
      accumulated += e.text ?? "";
      if (!draftSupported || draftPending || Date.now() - lastDraft < 900)
        return;
      lastDraft = Date.now();
      draftPending = true;
      void this.api(
        "sendMessageDraft",
        {
          chat_id: message.chat.id,
          draft_id: message.message_id || 1,
          text: accumulated.slice(-4000),
        },
        signal,
      )
        .catch(() => {
          draftSupported = false;
        })
        .finally(() => {
          draftPending = false;
        });
    };
    const typing = setInterval(() => {
      void this.api(
        "sendChatAction",
        { chat_id: message.chat.id, action: "typing" },
        signal,
      ).catch(() => {});
    }, 4000);
    try {
      await this.api(
        "sendChatAction",
        { chat_id: message.chat.id, action: "typing" },
        signal,
      ).catch(() => {});
      const turn = await this.service.chat(
        id,
        content,
        "telegram",
        signal,
        emit,
      );
      await this.send(message.chat.id, turn.reply, signal, id);
      signal.throwIfAborted();
      this.service.delivered(id);
    } catch (e) {
      if (this.store.turn(id)?.status === "complete") throw e; // Keep the update pending until a completed reply is delivered.
      if (!signal.aborted)
        await this.send(
          message.chat.id,
          `GlasHaus: ${errorMessage(e)} Your message is saved when generation has started. Please send it again to retry.`,
          signal,
        );
    } finally {
      clearInterval(typing);
    }
  }
}
export function splitTelegram(text: string, max = 3900): string[] {
  const result: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    if (/^[\uDC00-\uDFFF]$/.test(rest[cut] ?? "")) cut--;
    result.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) result.push(rest);
  return result;
}
