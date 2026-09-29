import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { Store } from "../app/server/store.ts";
import { Integrations } from "../app/server/integrations.ts";
import { saveIntegrations, publicIntegrations } from "../app/server/integration-settings.ts";
import { Voice } from "../app/server/voice.ts";
import { mailDraft } from "../app/server/mail.ts";
import { calendarDraft } from "../app/server/calendar.ts";
import { companionInput } from "../app/server/validation.ts";
const signal = () => new AbortController().signal;
const email = { kind: "email", payload: { to: "recipient@example.test", subject: "Synthetic test", body: "No real email is sent by this test." } };
function setup(directory = ":memory:") {
  const store = new Store(directory); store.saveCompanion(companionInput({ name: "Test", userName: "Tester", mode: "grow", relationship: "Synthetic fixture" }));
  const integrations = new Integrations(store);
  saveIntegrations(store, { revision: 1, mail: { address: "sender@icloud.com", password: "synthetic-not-a-password", enabled: true } });
  return { store, integrations };
}
test("external proposals are immutable, reviewed once, revision-bound and deduplicated", async () => {
  const { store, integrations } = setup(); let calls = 0;
  integrations.mail.send = async () => { calls++; return { messageId: "fake", accepted: 1, message: "Fixture only" }; };
  try {
    const draft = integrations.draft(email, "t1");
    assert.equal(integrations.draft(email, "t1").id, draft.id); assert.equal(calls, 0);
    await assert.rejects(integrations.update(draft.id, { revision: 9, action: "confirm" }, signal()), /changed/);
    const approved = await integrations.update(draft.id, { revision: 1, action: "confirm" }, signal());
    assert.equal(approved.status, "complete"); assert.equal(calls, 1);
    await assert.rejects(integrations.update(draft.id, { revision: 1, action: "confirm" }, signal()), /changed/);
    const stale = integrations.draft(email, "t2");
    saveIntegrations(store, { revision: 2, mail: { enabled: false } });
    await assert.rejects(integrations.update(stale.id, { revision: 1, action: "confirm" }, signal()), /settings changed/);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(publicIntegrations(store)).includes("synthetic-not-a-password"), false);
    assert.equal(JSON.stringify(store.archive()).includes("synthetic-not-a-password"), false);
  } finally { store.close(); }
});
test("lost external responses become unknown, survive restart, and never retry themselves", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "glashaus-proposal-"));
  let { store, integrations } = setup(directory);
  try {
    integrations.mail.send = async () => { throw new Error("Fixture disconnect after remote acceptance"); };
    const draft = integrations.draft(email); const result = await integrations.update(draft.id, { revision: 1, action: "confirm" }, signal());
    assert.equal(result.status, "unknown");
    const interrupted = integrations.draft(email); integrations.save({ ...interrupted, status: "executing" });
    store.close(); store = new Store(directory); integrations = new Integrations(store);
    assert.equal(integrations.get(interrupted.id).status, "unknown");
    const restored = new Store(":memory:");
    try { const pending = integrations.draft(email); restored.importArchive(store.archive()); assert.equal(new Integrations(restored).get(pending.id).status, "cancelled"); assert.equal(publicIntegrations(restored).mail.enabled, false); } finally { restored.close(); }
    store.resetData(true); assert.equal(integrations.actions().length, 0); assert.equal(publicIntegrations(store).mail.hasPassword, false);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test("mail and calendar drafts reject headers and ambiguous event times", () => {
  assert.throws(() => mailDraft({ to: "a@example.com\nb@example.com", subject: "Hello", body: "x" }), /email address/);
  assert.throws(() => mailDraft({ to: "a@example.com", subject: "Hello\r\nBCC: stolen@example.test", body: "x" }), /one line/);
  assert.throws(() => calendarDraft({ calendarId: "cal", title: "Dinner", start: "2026-10-01T19:00", end: "2026-10-01T20:00" }), /UTC offsets/);
  assert.throws(() => calendarDraft({ operation: "delete", calendarId: "cal", title: "Dinner", start: "2026-10-01T19:00Z", end: "2026-10-01T20:00Z" }), /event/i);
});
test("calendar review uses verified account details and detects configuration changes during preview", async () => {
  const { store, integrations } = setup();
  try {
    saveIntegrations(store, { revision: 2, calendar: { enabled: true, ids: ["fixture-calendar"] } });
    const request = { kind: "calendar", payload: { operation: "create", calendarId: "fixture-calendar", calendarName: "Invented name", title: "Dinner", start: "2026-10-01T19:00:00-04:00", end: "2026-10-01T20:00:00-04:00" } };
    integrations.calendar.preview = async () => ({ calendarName: "Verified calendar", calendarSource: "Synthetic account", conflicts: [{ title: "Existing event" }], checkedAt: new Date().toISOString() });
    let writes = 0; integrations.calendar.write = async () => { writes++; return {}; };
    const action = await integrations.prepare(request, signal(), "fixture-turn");
    assert.equal(action.payload.calendarName, "Verified calendar");
    assert.deepEqual(action.payload.conflicts, [{ title: "Existing event" }]);
    assert.equal(action.status, "draft"); assert.equal(writes, 0);
    assert.equal((await integrations.prepare(request, signal(), "fixture-turn")).id, action.id);
    integrations.calendar.preview = async () => {
      saveIntegrations(store, { revision: 3, calendar: { enabled: false, ids: [] } });
      return { calendarName: "No longer connected" };
    };
    await assert.rejects(integrations.prepare(request, signal(), "new-turn"), /settings changed/);
    assert.equal(integrations.actions().length, 1);
  } finally { store.close(); }
});
test("custom-rate or removed voices are rejected before audio is billed", async () => {
  const { store } = setup();
  try {
    saveIntegrations(store, { revision: 2, voice: { apiKey: "synthetic-key", voiceId: "premium-voice" } });
    let audioCalls = 0;
    const voice = new Voice(store, async (url) => {
      if (String(url).endsWith("subscription")) return Response.json({ character_count: 0, character_limit: 10000 });
      if (String(url).includes("/v2/voices?")) {
        const query = new URL(String(url)).searchParams;
        assert.equal(query.get("voice_ids"), "premium-voice"); assert.equal(query.get("include_custom_rates"), "false");
        return Response.json({ voices: [] });
      }
      audioCalls++; return new Response("unexpected");
    });
    await assert.rejects(voice.speak({ preview: true }, signal()), /custom rate/);
    assert.equal(audioCalls, 0); assert.equal(voice.status().used, 0);
  } finally { store.close(); }
});
test("voice reserves usage, rejects over-limit requests, and does not expose provider secrets", async () => {
  const { store } = setup();
  try {
    saveIntegrations(store, { revision: 2, voice: { apiKey: "synthetic-key", voiceId: "voice-fixture", monthlyCharacters: 100 } });
    let audioCalls = 0;
    const voice = new Voice(store, async (url, init) => {
      assert.equal((init?.headers as Record<string,string>)["xi-api-key"], "synthetic-key");
      if (String(url).endsWith("subscription")) return Response.json({ character_count: 0, character_limit: 10000 });
      if (String(url).includes("/v2/voices?")) { assert.equal(new URL(String(url)).searchParams.get("include_custom_rates"), "false"); return Response.json({ voices: [{ voice_id: "voice-fixture" }] }); }
      audioCalls++; return new Response(new Uint8Array([1,2,3]), { headers: { "Content-Type": "audio/mpeg" } });
    });
    assert.equal((await voice.speak({ preview: true }, signal())).length, 3);
    await assert.rejects(voice.speak({ preview: true }, signal()), /monthly Glashaus voice limit/);
    assert.equal(audioCalls, 1);
    const old = voice.status().used;
    saveIntegrations(store, { revision: 3, voice: { monthlyCharacters: 1000 } });
    voice.fetch = async (url) => String(url).endsWith("subscription") ? Response.json({ character_count: 9999, character_limit: 10000 }) : new Response("bad", { status: 500 });
    await assert.rejects(voice.speak({ preview: true }, signal()), /included ElevenLabs allowance/);
    assert.equal(voice.status().used, old);
    assert.equal(JSON.stringify(publicIntegrations(store)).includes("synthetic-key"), false);
  } finally { store.close(); }
});
test("real MCP transport discovers tools and enforces selected read versus reviewed actions", async () => {
  let writes = 0;
  const server = http.createServer(async (req, res) => {
    const mcp = new McpServer({ name: "fixture", version: "1.0.0" });
    mcp.registerTool("read_note", { inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: "text", text }] }));
    mcp.registerTool("write_note", { inputSchema: { text: z.string() } }, async ({ text }) => { writes++; return { content: [{ type: "text", text }] }; });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void mcp.close(); });
    await mcp.connect(transport); await transport.handleRequest(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { store, integrations } = setup();
  try {
    const url = `http://127.0.0.1:${(server.address() as {port:number}).port}/mcp`;
    saveIntegrations(store, { revision: 2, connectors: [{ id: "fixture", name: "Fixture", url, tools: ["read_note", "write_note"], readTools: ["read_note"] }] });
    const list = await integrations.connectors.discover("fixture", signal()); assert.equal(list.tools.length, 2);
    const read = await integrations.connectors.call("fixture", "read_note", { text: "fixture" }, signal(), true); assert.ok(JSON.stringify(read).includes("fixture"));
    await assert.rejects(integrations.connectors.call("fixture", "write_note", { text: "no" }, signal(), true), /needs your review/);
    assert.equal(writes, 0);
    const draft = integrations.draft({ kind: "connector", payload: { connectorId: "fixture", name: "write_note", arguments: { text: "approved fixture" } } });
    assert.equal((await integrations.update(draft.id, { revision: 1, action: "confirm" }, signal())).status, "complete"); assert.equal(writes, 1);
  } finally { store.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
