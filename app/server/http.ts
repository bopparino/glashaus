import http from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Companion, StreamEvent } from "../shared/types.ts";
import { CompanionService } from "./companion.ts";
import { Store } from "./store.ts";
import { Ollama } from "./ollama.ts";
import type { ModelProvider } from "./ollama.ts";
import { Telegram } from "./telegram.ts";
import type { StartupControl } from "./startup.ts";
import type { UpdateControl } from "./updates.ts";
import { VERSION } from "../shared/version.ts";
import { claimDataReset, prepareDataReset } from "./data-reset.ts";
import {
  AppError,
  companionInput,
  errorMessage,
  record,
  settingsInput,
  text,
} from "./validation.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
export function createApp(options: {
  directory: string;
  webRoot: string;
  provider?: ModelProvider;
  background?: boolean;
  server?: http.Server;
  startup?: StartupControl;
  handoff?: () => void;
  updates?: UpdateControl;
  activation?: { id: string; ready: () => boolean };
}) {
  const store = new Store(options.directory);
  const provider = options.provider ?? new Ollama(() => store.settings());
  const service = new CompanionService(store, provider);
  const telegram = new Telegram(store, service);
  let csrfToken = randomBytes(32).toString("hex");
  let activating = !!options.activation && !options.activation.ready();
  const startBackground = () => {
    if (options.background !== false) {
      service.start();
      telegram.start();
    }
  };
  if (!activating) startBackground();
  const activationTimer = activating
    ? setInterval(() => {
        if (options.activation?.ready()) {
          activating = false;
          clearInterval(activationTimer);
          startBackground();
        }
      }, 250)
    : undefined;
  const server = options.server ?? http.createServer();
  let handingOff = false;
  let resetting = false;
  let mutations = 0;
  server.on("request", async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    let streaming = false;
    let mutating = false;
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded)
        controller.abort(new Error("Request disconnected."));
    });
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    const emit = (event: StreamEvent) => {
      if (res.destroyed || res.writableEnded) return;
      if (!streaming) {
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        });
        streaming = true;
      }
      res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      const host = req.headers.host ?? "";
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host))
        throw new AppError(
          "This app accepts requests only from localhost.",
          403,
        );
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`)
        throw new AppError("This request came from another website.", 403);
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname.startsWith("/api/")) {
        res.setHeader("Cache-Control", "no-store");
        if (!["GET", "HEAD"].includes(req.method ?? "")) {
          const supplied = Buffer.from(
            String(req.headers["x-glashaus-token"] ?? ""),
          );
          const expected = Buffer.from(csrfToken);
          if (
            supplied.length !== expected.length ||
            !timingSafeEqual(supplied, expected)
          )
            throw new AppError(
              "Refresh the app before trying that action again.",
              403,
            );
        }
        const route = `${req.method} ${url.pathname}`;
        if (resetting && route !== "GET /api/health")
          throw new AppError(
            "Data cleanup is in progress. Wait for it to finish, then refresh.",
            409,
          );
        if (!["GET", "HEAD"].includes(req.method ?? "")) {
          mutations++;
          mutating = true;
        }
        if (
          activating &&
          !["GET", "HEAD"].includes(req.method ?? "") &&
          route !== "POST /api/startup/stop"
        )
          throw new AppError(
            "The update is checking startup. Your companion will be available in a moment.",
            503,
          );
        if (handingOff && !["GET", "HEAD"].includes(req.method ?? ""))
          throw new AppError(
            "GlasHaus is switching to background mode. Wait a moment before trying again.",
            503,
          );
        if (route === "GET /api/health")
          return json({
            version: VERSION,
            id: (await options.startup?.status())?.id,
            updateId: options.activation?.id ?? null,
            activating,
          });
        if (route === "GET /api/updates")
          return json(
            options.updates
              ? await options.updates.status()
              : {
                  current: VERSION,
                  latest: null,
                  checkedAt: null,
                  available: false,
                  message: "Updates are available in the installed app.",
                  operation: null,
                },
          );
        if (route === "POST /api/updates/check") {
          if (!options.updates)
            throw new AppError("Updates are unavailable in this preview.");
          return json(await options.updates.check());
        }
        if (route === "POST /api/updates") {
          if (!options.updates)
            throw new AppError("Updates are unavailable in this preview.");
          const input = record(await body(req));
          if (input.confirmed !== true)
            throw new AppError("Confirm Update and restart first.");
          if (
            service.busy ||
            service.background !== "Idle" ||
            store.research().some((r) => r.status === "running")
          )
            throw new AppError(
              "Let the current conversation or research finish, then update.",
              409,
            );
          return json(
            await options.updates.start(
              text(input.version, "Release version", 80, true),
            ),
            202,
          );
        }
        if (route === "GET /api/startup")
          return json(
            options.startup
              ? await options.startup.status()
              : {
                  available: false,
                  enabled: false,
                  managed: false,
                  platform: "Preview",
                  message:
                    "Background startup is available in the installed app.",
                },
          );
        if (
          route === "POST /api/startup" ||
          route === "POST /api/startup/stop"
        ) {
          if (!options.startup || !options.handoff)
            throw new AppError(
              "Background startup is unavailable in this preview.",
            );
          if (
            service.busy ||
            service.background !== "Idle" ||
            store.research().some((r) => r.status === "running")
          )
            throw new AppError(
              "Wait for the current conversation or research to finish before changing startup.",
              409,
            );
          const input = record(await body(req));
          const before = await options.startup.status();
          if (
            service.busy ||
            service.background !== "Idle" ||
            store.research().some((r) => r.status === "running")
          )
            throw new AppError(
              "Let the current conversation or research finish, then try again.",
              409,
            );
          const stopping = route.endsWith("/stop");
          if (stopping && !before.managed)
            throw new AppError(
              "This is a manual session. Stop it with Ctrl+C in its terminal.",
            );
          if (!stopping && typeof input.enabled !== "boolean")
            throw new AppError("Choose whether sign-in startup is enabled.");
          if (!stopping) {
            if (input.enabled) await options.startup.enable();
            else await options.startup.disable();
          }
          if (input.enabled && service.busy)
            throw new AppError(
              "Startup is registered, but a new reply is in progress. Let it finish, then enable background startup again to finish switching.",
              409,
            );
          const restarting =
            !stopping && input.enabled === true && !before.managed;
          if (restarting || stopping) {
            handingOff = true;
            service.stop();
            telegram.stop();
            res.once("finish", () => {
              setTimeout(options.handoff!, 250);
            });
          }
          return json({ restarting, stopped: stopping });
        }
        if (route === "GET /api/state")
          return json({
            companion: store.companion(),
            settings: store.publicSettings(),
            turns: store.turns(),
            memories: store.memories(),
            reflections: store.reflections(),
            research: store.research(),
            csrfToken,
            version: VERSION,
            background: service.background,
            telegram: telegram.status,
          });
        if (route === "GET /api/models")
          return json(await provider.models(controller.signal));
        if (route === "POST /api/data/reset") {
          const input = record(await body(req));
          const current = store.companion();
          if (!["companion", "purge"].includes(String(input.mode)))
            throw new AppError("Choose Delete companion or Purge local data.");
          if (input.companionId !== (current?.id ?? null))
            throw new AppError(
              "The companion changed. Refresh and review the deletion again.",
              409,
            );
          const mode = input.mode === "purge" ? "purge" : "companion";
          if (mode === "companion" && !current)
            throw new AppError("There is no companion to delete.", 409);
          const phrase =
            mode === "purge" ? "PURGE ALL" : `DELETE ${current!.name}`;
          if (input.confirmation !== phrase || input.confirmed !== true)
            throw new AppError(
              "Read the scope and type the exact confirmation before deleting.",
            );
          const ensureIdle = () => {
            if (
              mutations !== 1 ||
              service.busy ||
              service.background !== "Idle" ||
              store.research().some((r) => r.status === "running")
            )
              throw new AppError(
                "Let the current reply, research, memory work, or settings action finish before deleting data.",
                409,
              );
          };
          ensureIdle();
          const release = claimDataReset(options.directory);
          resetting = true;
          let result:
            ReturnType<ReturnType<typeof prepareDataReset>> | undefined;
          try {
            // Quiesce the poller before clearing anything it could write back.
            // New HTTP mutations are blocked for the entire operation.
            service.stop();
            await telegram.shutdown();
            ensureIdle();
            const reset = prepareDataReset(store, mode);
            result = reset();
            csrfToken = randomBytes(32).toString("hex");
          } finally {
            try {
              release();
            } catch (error) {
              if (!result) throw error;
              result.complete = false;
              result.warnings.push(
                "Data was cleared, but its cleanup lock could not be released. Stop the app and run the recover command before trying another update or cleanup.",
              );
            } finally {
              resetting = false;
              startBackground();
            }
          }
          return json(result);
        }
        if (route === "GET /api/export") {
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="glashaus-${new Date().toISOString().slice(0, 10)}.json"`,
          );
          return json(store.archive());
        }
        if (route === "POST /api/settings") {
          const old = store.settings();
          const settings = settingsInput(await body(req), old);
          store.saveSettings(settings);
          if (
            settings.telegramToken !== old.telegramToken ||
            settings.telegramOwnerId !== old.telegramOwnerId
          ) {
            if (settings.telegramToken !== old.telegramToken)
              store.setMeta("telegramOffset", "0");
            telegram.start();
          }
          return json(store.publicSettings());
        }
        if (route === "POST /api/telegram/pair") {
          if (!store.settings().telegramToken)
            throw new AppError("Add your BotFather token first.");
          telegram.start();
          return json(telegram.status);
        }
        if (route === "POST /api/companion" || route === "PATCH /api/companion")
          return json(
            store.saveCompanion(
              companionInput(await body(req)),
              req.method === "PATCH",
            ),
          );
        if (route === "POST /api/preview") {
          const draft = companionInput(await body(req));
          return json({
            text: await service.preview(
              {
                ...draft,
                id: "preview",
                createdAt: new Date().toISOString(),
                revision: 0,
              },
              controller.signal,
            ),
          });
        }
        if (route === "POST /api/research") {
          await service.research(await body(req), controller.signal, emit);
          return res.end();
        }
        if (route === "POST /api/chat") {
          const input = record(await body(req));
          const message = text(input.text, "Message", 16000, true);
          const id = text(input.id, "Message ID", 160, true);
          if (!/^[A-Za-z0-9:_-]+$/.test(id))
            throw new AppError("Invalid message ID.");
          await service.chat(id, message, "web", controller.signal, emit);
          return res.end();
        }
        if (route === "POST /api/memories") {
          if (!store.companion())
            throw new AppError("Create a companion first.");
          const m = record(await body(req));
          if (
            !["user", "companion", "relationship"].includes(String(m.subject))
          )
            throw new AppError("Choose who this memory is about.");
          return json(
            store.writeMemory({
              kind: m.kind === "opinion" ? "opinion" : "fact",
              subject: m.subject as "user" | "companion" | "relationship",
              text: text(m.text, "Memory", 1500, true),
              evidence: "Added by you",
              turnId: null,
            }),
          );
        }
        if (/^\/api\/memories\/[\w-]+$/.test(url.pathname)) {
          const id = url.pathname.split("/").at(-1)!;
          if (req.method === "PATCH") {
            const m = record(await body(req));
            store.editMemory(id, text(m.text, "Memory", 1500, true));
            return json({ ok: true });
          }
          if (req.method === "DELETE") {
            store.forgetMemory(id);
            return json({ ok: true });
          }
        }
        if (route === "POST /api/reflect")
          return json(
            await service.serial(() => service.reflect(controller.signal)),
          );
        if (route === "POST /api/import") {
          if (service.busy)
            throw new AppError(
              "Wait for the current conversation to finish.",
              409,
            );
          return json(store.importArchive(await body(req, 50_000_000)));
        }
        throw new AppError("That action was not found.", 404);
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        throw new AppError("Method not allowed.", 405);
      let file = path.resolve(
        options.webRoot,
        `.${decodeURIComponent(url.pathname)}`,
      );
      const relative = path.relative(path.resolve(options.webRoot), file);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new AppError("Not found.", 404);
      if (!existsSync(file) || !statSync(file).isFile())
        file = path.join(options.webRoot, "index.html");
      if (!existsSync(file))
        return json(
          {
            message:
              "The web app is not built yet. Run pnpm build, then start GlasHaus again.",
          },
          503,
        );
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control":
          path.dirname(file) === path.join(options.webRoot, "assets")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : readFileSync(file));
    } catch (e) {
      const message = controller.signal.aborted
        ? "Stopped. Your progress is saved."
        : e instanceof AppError
          ? e.message
          : "GlasHaus could not complete that action. Check the local app log and try again.";
      if (!(e instanceof AppError) && !controller.signal.aborted)
        console.error(
          "[glashaus]",
          e instanceof Error ? e.name : "Unexpected error",
        );
      if (streaming) {
        emit({ type: "error", text: message });
        res.end();
      } else if (!res.destroyed)
        json({ error: message }, e instanceof AppError ? e.status : 500);
    } finally {
      if (mutating) mutations--;
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 350000;
  return {
    server,
    store,
    service,
    telegram,
    async close() {
      clearInterval(activationTimer);
      service.stop();
      await telegram.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
async function body(req: http.IncomingMessage, max = 200000): Promise<unknown> {
  if (!req.headers["content-type"]?.includes("application/json"))
    throw new AppError("Send this request as JSON.", 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max)
      throw new AppError("That file or request is too large.", 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("The request contains invalid JSON.");
  }
}
