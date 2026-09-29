import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "../app/server/store.ts";
import { WorkspaceData } from "../app/server/workspace-data.ts";
import { Workspace, documentPlan } from "../app/server/workspace.ts";
import { CompanionService } from "../app/server/companion.ts";
import { companionInput } from "../app/server/validation.ts";
import type { ModelProvider, ChatOptions } from "../app/server/ollama.ts";
import type { SandboxRunner } from "../app/server/sandbox.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const plan = {
  title: "Test plan",
  summary: "Synthetic content.",
  sections: [
    { heading: "Next step", paragraphs: ["Check the photograph."], items: [] },
  ],
  caveats: [],
};
class Model implements ModelProvider {
  supportsTools = false;
  seen: ChatOptions[] = [];
  async models() {
    return [];
  }
  async research() {
    return [];
  }
  async chat(o: ChatOptions) {
    this.seen.push(o);
    return o.json ? JSON.stringify(plan) : "I can see the image.";
  }
}
function home() {
  const s = new Store(":memory:");
  s.saveCompanion(
    companionInput({
      name: "Elle",
      userName: "Synthetic tester",
      mode: "grow",
      relationship: "Test only",
    }),
  );
  return s;
}
const runner: SandboxRunner = {
  async status() {
    return { ready: true, message: "Synthetic runner" };
  },
  async run() {
    return [
      {
        name: "result.txt",
        mime: "text/plain",
        data: Buffer.from("Complete").toString("base64"),
      },
    ];
  },
};
async function settled(w: Workspace) {
  for (let i = 0; i < 100 && w.busy; i++) await delay(5);
  assert.equal(w.busy, false);
}

test("image attachments reach vision, survive replay/backup, and clear atomically", async () => {
  const s = home(),
    p = new Model(),
    service = new CompanionService(s, p),
    d = new WorkspaceData(s.db);
  const f = d.upload({ name: "photo.png", data: png });
  await service.chat(
    "photo:1",
    "What is this?",
    "web",
    new AbortController().signal,
    () => {},
    [f.id],
  );
  assert.deepEqual(p.seen[0].messages.at(-1)?.images, [png]);
  await service.chat(
    "photo:1",
    "What is this?",
    "web",
    new AbortController().signal,
    () => {},
    [f.id],
  );
  assert.equal(p.seen.length, 1);
  await assert.rejects(
    service.chat(
      "photo:1",
      "What is this?",
      "web",
      new AbortController().signal,
      () => {},
      [],
    ),
    /different attachments/,
  );
  const backup = s.archive(),
    restored = new Store(":memory:");
  restored.importArchive(backup);
  assert.equal(restored.turn("photo:1")?.attachments?.[0].id, f.id);
  assert.equal(
    new WorkspaceData(restored.db).file(f.id).bytes.toString("base64"),
    png,
  );
  restored.resetData(true);
  assert.deepEqual(new WorkspaceData(restored.db).files(), []);
  restored.close();
  s.close();
});
test("tasks publish artifacts, retry explicitly, and reject idempotency collisions", async () => {
  const s = home(),
    w = new Workspace(s, new Model(), runner);
  const request = {
    title: "Calculation",
    kind: "document",
    instruction: "Make a plan",
    requestId: "one",
  };
  const t = await w.create(request);
  await settled(w);
  assert.equal(w.data.task(t.id).status, "complete");
  assert.equal(w.data.files().length, 1);
  assert.equal((await w.create(request)).id, t.id);
  await assert.rejects(
    w.create({ ...request, instruction: "Different" }),
    /already used/,
  );
  const retried = await w.retry(t.id, "two");
  await settled(w);
  assert.equal(retried.parentId, t.id);
  assert.equal(w.data.files().length, 2);
  await w.shutdown();
  s.close();
});
test("cancel stops a running job without publishing outputs", async () => {
  const s = home();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const w = new Workspace(s, new Model(), {
    ...runner,
    async run(_files, _kind, signal) {
      entered();
      await delay(10000, undefined, { signal });
      return [];
    },
  });
  const t = await w.create({
    title: "Cancel",
    instruction: "Test",
    requestId: "cancel",
  });
  await started;
  w.cancel(t.id);
  await settled(w);
  assert.equal(w.data.task(t.id).status, "cancelled");
  assert.equal(w.data.files().length, 0);
  await w.shutdown();
  s.close();
});
test("invalid archive file data changes nothing; oversized images and invalid plans fail early", () => {
  const s = home(),
    d = new WorkspaceData(s.db);
  d.upload({ name: "photo.png", data: png });
  const archive = s.archive();
  archive.workspace.files[0].data = Buffer.from("corrupt").toString("base64");
  const clean = new Store(":memory:");
  assert.throws(() => clean.importArchive(archive), /Invalid archived file/);
  assert.equal(clean.companion(), null);
  assert.throws(() =>
    d.upload({
      name: "fake.png",
      data: Buffer.from("Not an image").toString("base64"),
    }),
  );
  assert.throws(() => documentPlan({ ...plan, sections: [] }));
  clean.close();
  s.close();
});
test("restart retains task evidence and requires explicit retry", () => {
  const s = home(),
    w = new Workspace(s, new Model(), runner),
    date = new Date().toISOString();
  w.data.saveTask({
    id: "interrupted",
    kind: "document",
    title: "Test",
    instruction: "Test",
    status: "running",
    stage: "Rendering",
    error: "",
    inputIds: [],
    outputIds: [],
    parentId: null,
    turnId: null,
    createdAt: date,
    updatedAt: date,
  });
  const restarted = new Workspace(s, new Model(), runner);
  assert.equal(restarted.data.task("interrupted").status, "interrupted");
  s.close();
});
test("a queued document ends the chat with its receipt instead of polling the model", async () => {
  const s = home();
  s.saveSettings({ ...s.settings(), assistantToolsEnabled: true });
  const p = new Model();
  let chatCalls = 0;
  p.supportsTools = true;
  p.chat = async (options: ChatOptions) => {
    if (options.json) return JSON.stringify(plan);
    chatCalls++;
    options.onToolCalls?.([
      {
        function: {
          name: "create_document",
          arguments: { title: "A plan", instruction: "Create a plan" },
        },
      },
      { function: { name: "run_python_task", arguments: { title: "Stale task", instruction: "Repeat an older calculation" } } },
    ]);
    return "";
  };
  const service = new CompanionService(s, p);
  const w = new Workspace(s, p, runner);
  service.workspace = w;
  const { Actions } = await import("../app/server/actions.ts");
  service.actions = new Actions(
    s,
    p,
    service.reminders,
    service.integrations,
    w,
  );
  const turn = await service.chat(
    "task:receipt",
    "Make a PDF",
    "web",
    new AbortController().signal,
    () => {},
  );
  assert.equal(turn.status, "complete");
  assert.match(turn.reply, /started/);
  assert.equal(chatCalls, 1);
  assert.equal(
    s.db
      .prepare(
        "SELECT count(*) AS n FROM tool_runs WHERE name='create_document'",
      )
      .get()!.n,
    1,
  );
  await settled(w);
  assert.equal(w.data.tasks().length, 1);
  await w.shutdown();
  s.close();
});
test("simultaneous task requests with one idempotency key create one job", async () => {
  const s = home(),
    w = new Workspace(s, new Model(), {
      ...runner,
      async status() {
        await delay(5);
        return { ready: true, message: "Ready" };
      },
    });
  const request = {
    title: "Same task",
    instruction: "Same plan",
    requestId: "same",
  };
  const [a, b] = await Promise.all([w.create(request), w.create(request)]);
  assert.equal(a.id, b.id);
  await settled(w);
  assert.equal(w.data.tasks().length, 1);
  assert.equal(w.data.files().length, 1);
  await w.shutdown();
  s.close();
});
