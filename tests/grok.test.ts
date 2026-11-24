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

test("model discovery uses draft connections and returns usable IDs from each provider", async () => {
  const saved = { ...DEFAULT_SETTINGS, grokApiKey: "saved-test-key" };
  const models = new CompanionModels(
    () => saved,
    async (input, options) => {
      const url = String(input);
      if (url.endsWith("/v1/language-models")) {
        assert.equal(options?.redirect, "error");
        assert.equal(url, "https://api.x.ai/v1/language-models");
        assert.equal(
          new Headers(options?.headers).get("Authorization"),
          "Bearer draft-test-key",
        );
        return Response.json({
          models: [
            { id: "grok-test", output_modalities: ["text"] },
            { id: "grok-test", output_modalities: ["text"] },
            { id: "audio-test", output_modalities: ["audio"] },
            null,
          ],
        });
      }
      assert.equal(url, "http://127.0.0.1:11435/api/tags");
      assert.equal(new Headers(options?.headers).get("Authorization"), null);
      return Response.json({
        models: [
          { name: "test-model:latest", size: 10 },
          { model: "other-model:7b", size: 20 },
        ],
      });
    },
  );
  assert.deepEqual(
    await models.models(undefined, {
      ...saved,
      provider: "grok",
      grokApiKey: "draft-test-key",
    }),
    [{ name: "grok-test", size: 0 }],
  );
  assert.deepEqual(
    await models.models(undefined, {
      ...saved,
      ollamaUrl: "http://127.0.0.1:11435",
    }),
    [
      { name: "test-model:latest", size: 10 },
      { name: "other-model:7b", size: 20 },
    ],
  );
});
