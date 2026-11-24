import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../app/shared/types.ts";
import { CompanionModels } from "../app/server/grok.ts";
import { ModelUnavailable } from "../app/server/validation.ts";

test("Grok sends stateless inference to xAI and switching back keeps Ollama credentials separate", async () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    provider: "grok" as const,
    grokModel: "test-grok",
    grokApiKey: "fake-private-key",
    model: "test-ollama",
  };
  let provider: "grok" | "ollama" = "grok";
  const calls: { url: string; body: any; authorization: string | null }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init.body)),
      authorization: new Headers(init.headers).get("Authorization"),
    });
    if (url.includes("api.x.ai")) {
      return Response.json({
        status: "completed",
        output: [
          {
            type: "reasoning",
            content: [{ type: "output_text", text: "internal" }],
          },
          {
            type: "message",
            content: [{ type: "output_text", text: "A short hello." }],
          },
        ],
      });
    }
    return new Response(
      '{"message":{"content":"A local hello."},"done":true}\n',
    );
  }) as typeof fetch;
  const models = new CompanionModels(
    () => ({ ...settings, provider }),
    fetcher,
  );
  const messages = [{ role: "user" as const, content: "Say hello." }];
  const tokens: string[] = [];
  assert.equal(
    await models.chat({ messages, onToken: (token) => tokens.push(token) }),
    "A short hello.",
  );
  assert.deepEqual(tokens, ["A short hello."]);
  assert.equal(calls[0].url, "https://api.x.ai/v1/responses");
  assert.equal(calls[0].authorization, "Bearer fake-private-key");
  assert.equal(calls[0].body.store, false);
  assert.deepEqual(calls[0].body.input, messages);
  provider = "ollama";
  assert.equal(await models.chat({ messages }), "A local hello.");
  assert.equal(calls[1].body.model, "test-ollama");
  assert.equal(calls[1].authorization, null);
});

test("Grok maps rate limits into retryable model outages", async () => {
  const models = new CompanionModels(
    () => ({
      ...DEFAULT_SETTINGS,
      provider: "grok",
      grokApiKey: "synthetic",
      grokModel: "test-model",
    }),
    async () => new Response("", { status: 429 }),
  );
  await assert.rejects(() => models.chat({ messages: [] }), ModelUnavailable);
});
