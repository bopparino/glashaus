import http from "node:http";
import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Store } from "./store.ts";
import type { CompanionService } from "./companion.ts";
import type { StreamEvent } from "../shared/types.ts";
import {
  AppError,
  companionInput,
  record,
  settingsInput,
  text,
} from "./validation.ts";

const digest = (value: string) => createHash("sha256").update(value).digest();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class MobileDevices {
  private pending?: {
    hash: Buffer;
    expires: number;
    attempts: number;
    companionId: string;
  };
  private active = new Map<string, Set<AbortController>>();
  private store: Store;
  private now: () => number;
  constructor(store: Store, now = Date.now) {
    this.store = store;
    this.now = now;
  }
  createCode() {
    const companion = this.store.companion();
    if (!companion)
      throw new AppError(
        "Create or restore your companion before pairing a phone.",
        409,
      );
    const code = Array.from(
      { length: 10 },
      () => alphabet[randomInt(alphabet.length)],
    ).join("");
    const expires = this.now() + 5 * 60_000;
    this.pending = {
      hash: digest(code),
      expires,
      attempts: 0,
      companionId: companion.id,
    };
    return {
      code: `${code.slice(0, 5)}-${code.slice(5)}`,
      expiresAt: new Date(expires).toISOString(),
    };
  }
  pair(value: unknown) {
    const input = record(value);
    const name = text(input.name, "Device name", 80, true);
    const supplied = text(input.code, "Pairing code", 40, true)
      .toUpperCase()
      .replace(/[\s-]/g, "");
    const pending = this.pending;
    if (
      !pending ||
      pending.expires <= this.now() ||
      pending.companionId !== this.store.companion()?.id
    ) {
      this.pending = undefined;
      throw new AppError(
        "Create a new pairing code in GlasHaus on your computer.",
        401,
      );
    }
    pending.attempts++;
    if (!timingSafeEqual(digest(supplied), pending.hash)) {
      if (pending.attempts >= 5) this.pending = undefined;
      throw new AppError(
        "That pairing code is incorrect or expired. Check the code on your computer.",
        401,
      );
    }
    this.pending = undefined;
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url");
    const at = new Date(this.now()).toISOString();
    this.store.db
      .prepare("INSERT INTO mobile_devices VALUES (?,?,?,?,?)")
      .run(id, name, digest(token).toString("hex"), at, at);
    return { id, token, companionId: this.store.companion()!.id };
  }
  authenticate(header?: string) {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? "")?.[1];
    const row =
      token &&
      this.store.db
        .prepare("SELECT id FROM mobile_devices WHERE tokenHash=?")
        .get(digest(token).toString("hex"));
    if (!row)
      throw new AppError(
        "Pair this phone again from GlasHaus on your computer.",
        401,
      );
    const id = String(row.id);
    this.store.db
      .prepare("UPDATE mobile_devices SET lastSeenAt=? WHERE id=?")
      .run(new Date(this.now()).toISOString(), id);
    return id;
  }
  list() {
    return this.store.db
      .prepare(
        "SELECT id,name,createdAt,lastSeenAt FROM mobile_devices ORDER BY createdAt",
      )
      .all();
  }
  watch(id: string, controller: AbortController) {
    const requests = this.active.get(id) ?? new Set<AbortController>();
    requests.add(controller);
    this.active.set(id, requests);
    return () => {
      requests.delete(controller);
      if (!requests.size) this.active.delete(id);
    };
  }
  revoke(id: string) {
    this.store.db.prepare("DELETE FROM mobile_devices WHERE id=?").run(id);
    for (const request of this.active.get(id) ?? []) request.abort();
  }
  stop() {
    this.pending = undefined;
    for (const requests of this.active.values())
      for (const request of requests) request.abort();
  }
}

const phoneSettings = (store: Store) => {
  const { model, utilityModel, contextSize, reflectionEnabled } =
    store.settings();
  return { model, utilityModel, contextSize, reflectionEnabled };
};

// A separate loopback-only listener carries ONLY the authenticated mobile API.
// Put this port behind private HTTPS (e.g. Tailscale Serve), never the admin port.
export function createMobileApi(
  store: Store,
  service: CompanionService,
  unavailable: () => boolean,
  server = http.createServer(),
) {
  const devices = new MobileDevices(store);
  let active = 0;
  server.on("request", async (req, res) => {
    active++;
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    let unwatch = () => {};
    let streaming = false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const json = (value: unknown, status = 200) => {
      if (res.destroyed) return;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const emit = (event: StreamEvent) => {
      if (res.destroyed || res.writableEnded) return;
      if (!streaming) {
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson",
          "X-Accel-Buffering": "no",
        });
        streaming = true;
      }
      res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      // Native clients do not send Origin. No browser CORS access or proxy-
      // supplied identity is trusted; every private route needs its own token.
      if (req.headers.origin)
        throw new AppError(
          "Use the paired GlasHaus app for this connection.",
          403,
        );
      if (unavailable())
        throw new AppError(
          "GlasHaus is restarting or cleaning up. Reconnect in a moment.",
          503,
        );
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = `${req.method} ${url.pathname}`;
      if (url.search)
        throw new AppError("Use the endpoint without query parameters.");
      if (route === "POST /mobile/pair")
        return json(devices.pair(await requestBody(req, controller.signal)));
      const device = devices.authenticate(req.headers.authorization);
      unwatch = devices.watch(device, controller);
      if (route === "GET /mobile/state")
        return json({
          companion: store.companion(),
          settings: phoneSettings(store),
          turns: store.turns(),
          memories: store.memories(),
          reflections: store.reflections(),
          serverTime: new Date().toISOString(),
        });
      if (route === "GET /mobile/models")
        return json(await service.provider.models(controller.signal));
      if (route === "GET /mobile/export") {
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="glashaus-backup.json"',
        );
        return json(store.archive());
      }
      if (route === "POST /mobile/chat") {
        const input = record(await requestBody(req, controller.signal));
        const id = text(input.id, "Message ID", 80, true);
        if (!/^[A-Za-z0-9_-]+$/.test(id))
          throw new AppError("Invalid message ID.");
        await service.chat(
          `mobile:${device}:${id}`,
          text(input.text, "Message", 16000, true),
          "web",
          controller.signal,
          emit,
        );
        return res.end();
      }
      if (route === "POST /mobile/settings") {
        const input = record(await requestBody(req, controller.signal));
        const allowed = new Set([
          "model",
          "utilityModel",
          "contextSize",
          "reflectionEnabled",
        ]);
        if (Object.keys(input).some((key) => !allowed.has(key)))
          throw new AppError(
            "Provider addresses, credentials and computer startup are managed on the host.",
          );
        store.saveSettings(settingsInput(input, store.settings()));
        return json(phoneSettings(store));
      }
      if (route === "POST /mobile/identity") {
        const input = record(await requestBody(req, controller.signal));
        const current = store.companion();
        if (
          !current ||
          input.id !== current.id ||
          input.revision !== current.revision
        )
          throw new AppError(
            "The identity changed. Refresh it before saving your edits.",
            409,
          );
        if (service.busy || service.background !== "Idle")
          throw new AppError(
            "Let the current reply or memory work finish before editing identity.",
            409,
          );
        return json(store.saveCompanion(companionInput(input), true));
      }
      if (route === "POST /mobile/memories") {
        if (!store.companion())
          throw new AppError("Create a companion on the computer first.");
        const input = record(await requestBody(req, controller.signal));
        if (
          !["user", "relationship", "companion"].includes(String(input.subject))
        )
          throw new AppError("Choose who this memory is about.");
        const memory = store.writeMemory({
          text: text(input.text, "Memory", 1500, true),
          kind: input.kind === "opinion" ? "opinion" : "fact",
          subject: input.subject as "user" | "relationship" | "companion",
          evidence: "Added by you on a paired phone",
          turnId: null,
        });
        if (!memory)
          throw new AppError(
            "That memory already exists or was previously forgotten. Edit the existing memory or use different wording.",
            409,
          );
        return json(memory);
      }
      if (/^\/mobile\/memories\/[\w-]+$/.test(url.pathname)) {
        const id = url.pathname.split("/").at(-1)!;
        if (req.method === "PATCH") {
          const input = record(await requestBody(req, controller.signal));
          store.editMemory(id, text(input.text, "Memory", 1500, true));
          return json({ ok: true });
        }
        if (req.method === "DELETE") {
          store.forgetMemory(id);
          return json({ ok: true });
        }
      }
      if (route === "POST /mobile/reflect")
        return json(
          await service.serial(() => service.reflect(controller.signal)),
        );
      if (route === "POST /mobile/disconnect") {
        devices.revoke(device);
        return json({ ok: true });
      }
      throw new AppError("This action is not available from the phone.", 404);
    } catch (error) {
      const message = controller.signal.aborted
        ? "Connection closed. Retry when your phone is connected."
        : error instanceof AppError
          ? error.message
          : "GlasHaus could not finish this action. Try again.";
      if (streaming) {
        emit({ type: "error", text: message });
        res.end();
      } else
        json(
          { error: message },
          error instanceof AppError
            ? error.status
            : controller.signal.aborted
              ? 409
              : 500,
        );
    } finally {
      unwatch();
      active--;
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 350000;
  return {
    server,
    devices,
    get active() {
      return active;
    },
    async close() {
      devices.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function requestBody(
  req: http.IncomingMessage,
  signal: AbortSignal,
): Promise<unknown> {
  if (!req.headers["content-type"]?.includes("application/json"))
    throw new AppError("Send JSON for this action.", 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    signal.throwIfAborted();
    size += chunk.length;
    if (size > 100_000) throw new AppError("This request is too large.", 413);
    chunks.push(Buffer.from(chunk));
  }
  signal.throwIfAborted();
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("This request contains invalid JSON.");
  }
}
