import https from "node:https";
import type http from "node:http";
import {
  createHash,
  randomBytes,
  randomUUID,
  X509Certificate,
} from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { networkInterfaces } from "node:os";
import path from "node:path";
import type { Store } from "./store.ts";
import type { CompanionService } from "./companion.ts";
import type { StreamEvent, Turn } from "../shared/types.ts";
import { AppError, record, text } from "./validation.ts";
import { diagnostics } from "./diagnostics.ts";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

// Enrollment is local-Mac initiated, single-use, short-lived and memory-only.
// Only hashes of device credentials are persisted. Exported archives omit them.
export class MobileDevices {
  private enrollment?: { hash: string; expiresAt: number; epoch: string };
  private active = new Map<string, Set<AbortController>>();
  private store: Store;
  private now: () => number;
  constructor(store: Store, now = () => Date.now()) {
    this.store = store;
    this.now = now;
  }
  private epoch() {
    const old = this.store.db
      .prepare("SELECT value FROM meta WHERE key='mobileEpoch'")
      .get();
    if (old) return String(old.value);
    const value = randomUUID();
    this.store.db
      .prepare("INSERT INTO meta VALUES ('mobileEpoch',?)")
      .run(value);
    return value;
  }
  createEnrollment() {
    const code = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + 5 * 60_000;
    this.enrollment = { hash: digest(code), expiresAt, epoch: this.epoch() };
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }
  pair(value: unknown) {
    const input = record(value);
    const code = text(input.code, "Pairing code", 100, true);
    const name = text(input.name, "Device name", 80, true);
    const pending = this.enrollment;
    if (
      !pending ||
      pending.expiresAt <= this.now() ||
      pending.hash !== digest(code) ||
      pending.epoch !== this.epoch()
    )
      throw new AppError(
        "This pairing link expired or was already used. Create a new one on your Mac.",
        401,
      );
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url");
    const at = new Date(this.now()).toISOString();
    this.store.db
      .prepare("INSERT INTO mobile_devices VALUES (?,?,?,?,?)")
      .run(id, name, digest(token), at, at);
    this.enrollment = undefined;
    return { id, token };
  }
  authenticate(value: string | undefined) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(value ?? "");
    const row =
      match &&
      this.store.db
        .prepare("SELECT id FROM mobile_devices WHERE tokenHash=?")
        .get(digest(match[1]));
    if (!row)
      throw new AppError(
        "This iPhone is not paired. Create a new pairing link on your Mac.",
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
    const set = this.active.get(id) ?? new Set<AbortController>();
    set.add(controller);
    this.active.set(id, set);
    return () => {
      set.delete(controller);
      if (!set.size) this.active.delete(id);
    };
  }
  revoke(id: string) {
    this.store.db.prepare("DELETE FROM mobile_devices WHERE id=?").run(id);
    for (const controller of this.active.get(id) ?? []) controller.abort();
  }
  stop() {
    this.enrollment = undefined;
    for (const controllers of this.active.values())
      for (const controller of controllers) controller.abort();
  }
}

export function mobileIdentity(directory: string) {
  const folder = path.join(directory, "mobile");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const keyPath = path.join(folder, "server-key.pem"),
    certPath = path.join(folder, "server-cert.pem");
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    // No shell interpolation. Subject is fixed; a local enrollment pins this
    // exact certificate instead of asking the phone to trust a new public CA.
    const key = execFileSync("openssl", ["genrsa", "2048"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    writeFileSync(keyPath, key, { mode: 0o600 });
    const cert = execFileSync(
      "openssl",
      [
        "req",
        "-new",
        "-x509",
        "-key",
        keyPath,
        "-sha256",
        "-days",
        "365",
        "-subj",
        "/CN=Glashaus Local Companion",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    writeFileSync(certPath, cert, { mode: 0o600 });
  }
  if (process.platform !== "win32") {
    chmodSync(keyPath, 0o600);
    chmodSync(certPath, 0o600);
  }
  const key = readFileSync(keyPath),
    cert = readFileSync(certPath);
  const certificate = new X509Certificate(cert);
  if (Date.parse(certificate.validTo) <= Date.now())
    throw new Error(
      "The phone certificate expired. Follow docs/IOS.md to rotate it and pair again.",
    );
  return {
    key,
    cert,
    fingerprint: createHash("sha256").update(certificate.raw).digest("hex"),
  };
}

export function createMobileServer(options: {
  store: Store;
  service: CompanionService;
  unavailable: () => boolean;
  identity: ReturnType<typeof mobileIdentity>;
}) {
  const { store, service, identity } = options;
  const devices = new MobileDevices(store);
  let port = 0;
  const server = https.createServer(
    {
      key: identity.key,
      cert: identity.cert,
      minVersion: "TLSv1.2",
      requestTimeout: 20_000,
      headersTimeout: 10_000,
    },
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const controller = new AbortController();
      const abort = () => {
        controller.abort();
        if (!res.writableEnded) res.destroy();
      };
      controller.signal.addEventListener("abort", abort, { once: true });
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      let unwatch = () => {};
      let streaming = false;
      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      const emit = (event: StreamEvent) => {
        if (res.destroyed || res.writableEnded) return;
        if (!streaming) {
          res.writeHead(200, { "Content-Type": "application/x-ndjson" });
          streaming = true;
        }
        res.write(JSON.stringify(event) + "\n");
      };
      try {
        // This is a native-only API. No browser origins, CORS, cookies, redirects,
        // settings endpoints, file serving, or loopback admin API are exposed.
        if (req.headers.origin || req.headers["sec-fetch-site"])
          throw new AppError("Use the paired native app.", 403);
        if (options.unavailable())
          throw new AppError(
            "Glashaus is restarting or clearing data. Try again shortly.",
            503,
          );
        const url = new URL(req.url ?? "/", "https://glashaus.invalid");
        if (req.method === "POST" && url.pathname === "/v1/pair")
          return json(devices.pair(await body(req)), 201);
        const device = devices.authenticate(req.headers.authorization);
        unwatch = devices.watch(device, controller);
        const inputBody = ["POST", "PATCH"].includes(req.method ?? "")
          ? await body(req, url.pathname === "/v1/workspace/images" ? 4_300_000 : 100_000)
          : undefined;
        // Reading a body yields; deletion/revocation may have happened meanwhile.
        devices.authenticate(req.headers.authorization);
        if (options.unavailable())
          throw new AppError("The Mac is busy restarting. Retry shortly.", 503);
        if (req.method === "GET" && url.pathname === "/v1/diagnostics") return json(diagnostics(service));
        if (url.pathname.startsWith("/v1/workspace")) {
          const result = await service.workspace.route(req.method ?? "GET", url.pathname.slice(3), inputBody);
          if (result) {
            if ("file" in result && result.file) { res.writeHead(200, { "Content-Type": result.file.mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.file.name)}`, "Cache-Control": "no-store" }); res.end(result.value); return; }
            return json(result.value);
          }
        }
        const integrationResult = await service.integrations.route(req.method ?? "GET", url.pathname.replace(/^\/v1/, ""), inputBody, controller.signal);
        if (integrationResult) {
          if (integrationResult.audio) { res.writeHead(200, { "Content-Type": "audio/mpeg" }); res.end(integrationResult.value); return; }
          return json(integrationResult.value);
        }
        if (req.method === "GET" && url.pathname === "/v1/state") {
          const companion = store.companion();
          return json({
            companion: companion
              ? {
                  id: companion.id,
                  name: companion.name,
                  userName: companion.userName,
                  summary: companion.summary,
                  personality: companion.personality,
                  voice: companion.voice,
                  backstory: companion.backstory,
                  values: companion.values,
                  relationship: companion.relationship,
                }
              : null,
            ...history(store),
            reminders: service.reminders.list(),
            proposals: service.integrations.actions(),
            voice: service.integrations.voice.status(),
            checkIns: service.checkIns.list(),
            checkInPolicy: service.checkIns.policy(),
            memories: store.memories(),
            reflections: store.reflections(),
            timeZone: store.settings().timeZone,
            serverTime: new Date().toISOString(),
          });
        }
        if (req.method === "GET" && url.pathname === "/v1/history")
          return json(
            history(store, url.searchParams.get("before") ?? undefined),
          );
        if (req.method === "POST" && url.pathname === "/v1/chat") {
          const input = record(inputBody);
          const id = text(input.id, "Message ID", 160, true);
          if (!/^[A-Za-z0-9:_-]+$/.test(id))
            throw new AppError("Invalid message ID.");
          // Web means a direct interactive client, as opposed to Telegram delivery.
          await service.chat(
            id,
            text(input.text, "Message", 16000, true),
            "web",
            controller.signal,
            emit,
            input.attachmentIds,
          );
          return res.end();
        }
        if (req.method === "POST" && url.pathname === "/v1/reminders")
          return json(service.reminders.draft(inputBody), 201);
        if (
          req.method === "PATCH" &&
          url.pathname === "/v1/check-ins/preferences"
        )
          return json(service.checkIns.configure(inputBody));
        if (
          req.method === "PATCH" &&
          /^\/v1\/check-ins\/[\w-]+$/.test(url.pathname)
        )
          return json(
            service.checkIns.update(url.pathname.split("/").at(-1)!, inputBody),
          );
        if (
          req.method === "PATCH" &&
          /^\/v1\/reminders\/[\w-]+$/.test(url.pathname)
        )
          return json(
            service.reminders.update(
              url.pathname.split("/").at(-1)!,
              inputBody,
            ),
          );
        if (/^\/v1\/memories\/[\w-]+$/.test(url.pathname)) {
          const id = url.pathname.split("/").at(-1)!;
          if (req.method === "PATCH") {
            const input = record(inputBody);
            store.editMemory(id, text(input.text, "Memory", 1500, true));
            return json({ ok: true });
          }
          if (req.method === "DELETE") {
            store.forgetMemory(id);
            return json({ ok: true });
          }
        }
        if (req.method === "DELETE" && url.pathname === "/v1/device") {
          unwatch();
          json({ ok: true });
          devices.revoke(device);
          return;
        }
        throw new AppError("That phone action was not found.", 404);
      } catch (error) {
        if (res.destroyed || res.writableEnded) return;
        const message =
          error instanceof AppError
            ? error.message
            : "The Mac could not complete this request. Retry after reconnecting.";
        if (streaming) {
          emit({ type: "error", text: message });
          res.end();
        } else
          json(
            { error: message },
            error instanceof AppError ? error.status : 500,
          );
      } finally {
        unwatch();
        controller.signal.removeEventListener("abort", abort);
      }
    },
  );
  server.maxConnections = 32;
  return {
    server,
    devices,
    status() {
      const addresses = Object.values(networkInterfaces()).flatMap((entries) =>
        (entries ?? [])
          .filter(
            (entry) =>
              entry.family === "IPv4" &&
              !entry.internal &&
              /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
                entry.address,
              ),
          )
          .map((entry) => `https://${entry.address}:${port}`),
      );
      return {
        enabled: port > 0,
        addresses: [...new Set(addresses)],
        simulatorAddress: `https://127.0.0.1:${port}`,
        fingerprint: identity.fingerprint,
        devices: devices.list(),
      };
    },
    enroll(address: unknown) {
      const value = text(address, "Mac address", 200, true);
      const allowed = this.status();
      if (![...allowed.addresses, allowed.simulatorAddress].includes(value))
        throw new AppError("Choose one of this Mac’s current addresses.");
      const enrollment = devices.createEnrollment();
      const url = new URL("glashaus://pair");
      url.searchParams.set("server", value);
      url.searchParams.set("pin", identity.fingerprint);
      url.searchParams.set("code", enrollment.code);
      return { link: url.href, expiresAt: enrollment.expiresAt };
    },
    async listen(requestedPort: number, host = "0.0.0.0") {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(requestedPort, host, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      port = (server.address() as { port: number }).port;
    },
    async close() {
      devices.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function history(store: Store, before?: string) {
  if (before && !/^[1-9]\d{0,14}$/.test(before))
    throw new AppError("Invalid conversation cursor.");
  const rows = store.db
    .prepare(
      "SELECT rowid AS cursor, * FROM turns WHERE rowid < ? ORDER BY rowid DESC LIMIT 101",
    )
    .all(
      before ? Number(before) : Number.MAX_SAFE_INTEGER,
    ) as unknown as (Turn & { cursor: number })[];
  const page = rows.slice(0, 100);
  return {
    turns: page.reverse().map(({ cursor, ...turn }) => ({
      ...turn,
      sources: store.sourcesForTurn(turn.id),
      attachments: store.turn(turn.id)?.attachments ?? [],
    })),
    olderCursor: rows.length > 100 ? String(rows[99].cursor) : null,
  };
}
async function body(req: http.IncomingMessage, max = 100_000) {
  if (!req.headers["content-type"]?.includes("application/json"))
    throw new AppError("Send JSON.", 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new AppError("This request is too large.", 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("Invalid JSON.");
  }
}
