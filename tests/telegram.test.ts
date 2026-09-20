import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../app/server/store.ts";
import { CompanionService } from "../app/server/companion.ts";
import {
  Telegram,
  TelegramError,
  telegramHtml,
  waitForRetry,
} from "../app/server/telegram.ts";
import { companionInput } from "../app/server/validation.ts";
import type { ModelProvider } from "../app/server/ollama.ts";

const reply = (result: unknown) => Response.json({ ok: true, result });
const rejected = (code: number, retry = 0) =>
  Response.json(
    { ok: false, error_code: code, parameters: { retry_after: retry } },
    { status: code },
  );
async function until(check: () => boolean) {
  for (let i = 0; i < 300 && !check(); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert(check(), "Expected Telegram state was not reached.");
}
function fixture(
  handler?: (
    method: string,
    body: any,
    signal: AbortSignal,
  ) => Promise<Response> | Response,
  wait = waitForRetry,
) {
  const store = new Store(":memory:");
  store.saveSettings({
    ...store.settings(),
    telegramToken: "123:synthetic-token",
    model: "test-model",
  });
  store.saveCompanion(
    companionInput({
      name: "Test",
      mode: "grow",
      userName: "Visitor",
      relationship: "Friends",
    }),
  );
  let modelCalls = 0;
  const provider: ModelProvider = {
    models: async () => [],
    research: async () => [],
    chat: async () => {
      modelCalls++;
      return "A".repeat(3900) + "B".repeat(100);
    },
  };
  const service = new CompanionService(store, provider);
  const calls: { method: string; body: any }[] = [];
  const fetcher = (async (url: string, options: RequestInit) => {
    const method = url.split("/").at(-1)!;
    const body = JSON.parse(String(options.body));
    const signal = options.signal!;
    calls.push({ method, body });
    const custom = await handler?.(method, body, signal);
    if (custom) return custom;
    if (method === "getMe") return reply({ username: "synthetic_bot" });
    if (method === "getWebhookInfo") return reply({ url: "" });
    if (method === "getUpdates") {
      await waitForRetry(60000, signal);
      signal.throwIfAborted();
      return reply([]);
    }
    return reply(true);
  }) as typeof fetch;
  const telegram = new Telegram(store, service, fetcher, wait);
  return {
    store,
    service,
    telegram,
    calls,
    get modelCalls() {
      return modelCalls;
    },
    async close() {
      await telegram.shutdown();
      service.stop();
      store.close();
    },
  };
}

test("Telegram retries a failed initial connection, then starts polling", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const f = fixture(
    (method) => {
      if (method === "getMe" && attempts++ === 0)
        throw new TypeError("network failed");
      return undefined as any;
    },
    async (ms) => {
      delays.push(ms);
    },
  );
  try {
    f.telegram.start();
    await until(() => f.calls.some((c) => c.method === "getUpdates"));
    assert(f.telegram.status.connected);
    assert.equal(attempts, 2);
    assert.deepEqual(delays, [1000]);
  } finally {
    await f.close();
  }
});
test("Telegram reports blocked network access without exposing the token or URL", async () => {
  const f = fixture(() => {
    throw new TypeError("secret URL", {
      cause: Object.assign(new Error("secret"), { code: "EACCES" }),
    });
  });
  try {
    await assert.rejects(
      () => f.telegram.api("getMe", {}),
      (e: any) =>
        /blocked/.test(e.message) &&
        !e.message.includes("synthetic-token") &&
        !e.message.includes("secret"),
    );
  } finally {
    await f.close();
  }
});
test("invalid tokens and polling conflicts stop instead of retrying indefinitely", async () => {
  for (const code of [401, 409]) {
    let delays = 0;
    const f = fixture(
      (method) =>
        method === (code === 401 ? "getMe" : "getUpdates")
          ? rejected(code)
          : (undefined as any),
      async () => {
        delays++;
      },
    );
    try {
      f.telegram.start();
      await until(() => !!f.telegram.status.error);
      assert.equal(delays, 0);
      assert.equal(f.telegram.status.connected, false);
      assert.match(
        f.telegram.status.error!,
        code === 401 ? /rejected/ : /Another process/,
      );
    } finally {
      await f.close();
    }
  }
});
test("a configured webhook is explained and never deleted", async () => {
  const f = fixture((method) =>
    method === "getWebhookInfo"
      ? reply({ url: "https://example.com/private-hook" })
      : (undefined as any),
  );
  try {
    f.telegram.start();
    await until(() => !!f.telegram.status.error);
    assert.match(f.telegram.status.error!, /webhook/);
    assert(
      !f.calls.some(
        (c) => c.method === "deleteWebhook" || c.method === "getUpdates",
      ),
    );
    assert(!f.telegram.status.error!.includes("private-hook"));
  } finally {
    await f.close();
  }
});
test("Telegram honors retry_after on rate limits", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const f = fixture(
    (method) =>
      method === "getMe" && attempts++ === 0
        ? rejected(429, 7)
        : (undefined as any),
    async (ms) => {
      delays.push(ms);
    },
  );
  try {
    f.telegram.start();
    await until(() => f.calls.some((c) => c.method === "getUpdates"));
    assert.deepEqual(delays, [7000]);
  } finally {
    await f.close();
  }
});
test("pairing rejects wrong codes and group chats, locks owner, ignores strangers", async () => {
  let sent = false;
  const message = (
    id: number,
    from: number,
    text: string,
    type = "private",
  ) => ({
    update_id: id,
    message: {
      message_id: id,
      text,
      from: { id: from },
      chat: { id: from, type },
    },
  });
  const f = fixture((method) => {
    if (method !== "getUpdates" || sent) return undefined as any;
    sent = true;
    return reply([
      message(1, 9, "/start 000000"),
      message(2, 9, `/start ${f.telegram.status.pairingCode}`, "group"),
      message(3, 42, `/start ${f.telegram.status.pairingCode}`),
      message(4, 9, "Uninvited stranger"),
      message(5, 42, "/status"),
    ]);
  });
  try {
    f.telegram.start();
    await until(() => f.store.meta("telegramOffset") === "6");
    assert.equal(f.store.settings().telegramOwnerId, "42");
    assert.equal(f.telegram.status.pairingCode, undefined);
    assert.equal(f.modelCalls, 0);
    const sends = f.calls.filter((c) => c.method === "sendMessage");
    assert.equal(sends.length, 2);
    assert(sends.every((c) => c.body.chat_id === 42));
  } finally {
    await f.close();
  }
});
test("partial Telegram delivery resumes without regenerating or repeating acknowledged chunks", async () => {
  let failed = false;
  const f = fixture(
    (method, body) => {
      if (method === "getUpdates" && body.offset < 8)
        return reply([
          {
            update_id: 7,
            message: {
              message_id: 7,
              text: "Hello there",
              from: { id: 42 },
              chat: { id: 42, type: "private" },
            },
          },
        ]);
      if (method === "sendMessage" && body.text.startsWith("B") && !failed) {
        failed = true;
        return rejected(503);
      }
      return undefined as any;
    },
    async () => {},
  );
  f.store.saveSettings({ ...f.store.settings(), telegramOwnerId: "42" });
  try {
    f.telegram.start();
    await until(() => f.store.meta("telegramOffset") === "8");
    assert.equal(f.modelCalls, 1);
    assert.equal(f.store.turn("telegram:7")?.delivered, 1);
    assert.equal(
      f.calls.filter(
        (c) => c.method === "sendMessage" && c.body.text.startsWith("A"),
      ).length,
      1,
    );
    assert.equal(
      f.calls.filter(
        (c) => c.method === "sendMessage" && c.body.text.startsWith("B"),
      ).length,
      2,
    );
  } finally {
    await f.close();
  }
});
test("formatting is escaped and only a definite rejection falls back to plain text", async () => {
  assert.equal(
    telegramHtml("<tag> & **bold** and *soft*"),
    "&lt;tag&gt; &amp; <b>bold</b> and <i>soft</i>",
  );
  const f = fixture((method, body) =>
    method === "sendMessage" && body.parse_mode
      ? rejected(400)
      : (undefined as any),
  );
  try {
    await f.telegram.send(42, "**Hello**");
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].body.text, "**Hello**");
    assert.equal(f.calls[1].body.parse_mode, undefined);
  } finally {
    await f.close();
  }
});
test("shutdown cancels retry sleep and no old poller survives reconnect", async () => {
  const f = fixture();
  try {
    f.telegram.start();
    await until(() => f.calls.some((c) => c.method === "getUpdates"));
    f.telegram.start();
    await until(
      () => f.calls.filter((c) => c.method === "getUpdates").length === 2,
    );
    await f.telegram.shutdown();
    assert.equal(f.telegram.status.connected, false);
    const before = f.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(f.calls.length, before);
  } finally {
    await f.close();
  }
});
