import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS } from "../shared/types.ts";
import type {
  Companion,
  Memory,
  PublicSettings,
  Reflection,
  Research,
  Settings,
  Turn,
} from "../shared/types.ts";
import {
  AppError,
  character,
  companionInput,
  record,
  text,
} from "./validation.ts";

const APP_ID = 1196179763;
const iso = () => new Date().toISOString();
const hash = (s: string) =>
  createHash("sha256")
    .update(s.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");
export class Store {
  db: DatabaseSync;
  directory: string;
  constructor(directory: string) {
    this.directory = directory;
    if (directory !== ":memory:")
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file =
      directory === ":memory:"
        ? directory
        : path.join(directory, "glashaus-v3.sqlite");
    this.db = new DatabaseSync(file, { timeout: 5000 });
    const applicationId = this.db
      .prepare("PRAGMA application_id")
      .get()?.application_id;
    if (applicationId && applicationId !== APP_ID) {
      this.db.close();
      throw new AppError(
        "This database belongs to another application. Choose a separate GlasHaus v3 data directory.",
      );
    }
    if (
      !applicationId &&
      this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .get()
    ) {
      this.db.close();
      throw new AppError(
        "This is an existing unrecognized database. Use import instead of opening it as a v3 home.",
      );
    }
    const version = Number(
      this.db.prepare("PRAGMA user_version").get()?.user_version ?? 0,
    );
    if (version > 2) {
      this.db.close();
      throw new AppError(
        "This companion was saved by a newer GlasHaus. Update the app before opening it.",
      );
    }
    this.db
      .exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS companion (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY, userText TEXT NOT NULL, reply TEXT NOT NULL DEFAULT '',
        channel TEXT NOT NULL CHECK(channel IN ('web','telegram')), status TEXT NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL, text TEXT NOT NULL,
        evidence TEXT NOT NULL, turnId TEXT REFERENCES turns(id), active INTEGER NOT NULL DEFAULT 1,
        fingerprint TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blocked_turns (turnId TEXT PRIMARY KEY REFERENCES turns(id));
      CREATE TABLE IF NOT EXISTS memory_suppressions (fingerprint TEXT PRIMARY KEY, memoryId TEXT NOT NULL REFERENCES memories(id));
      CREATE TABLE IF NOT EXISTS memory_replacements (previousId TEXT PRIMARY KEY REFERENCES memories(id), nextId TEXT NOT NULL REFERENCES memories(id), createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reflections (id TEXT PRIMARY KEY, content TEXT NOT NULL, sourceTurnIds TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY, format TEXT NOT NULL, original TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outreach (id TEXT PRIMARY KEY, content TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS turns_time ON turns(createdAt);
      CREATE INDEX IF NOT EXISTS memories_active ON memories(active, kind);
      PRAGMA application_id=${APP_ID}; PRAGMA user_version=2;`);
    this.db.exec(
      "UPDATE turns SET status='interrupted', error='The app restarted before this reply finished.' WHERE status='running'; UPDATE jobs SET status='pending' WHERE status='running';",
    );
    for (const r of this.research())
      if (r.status === "running")
        this.saveResearch({
          ...r,
          status: "interrupted",
          stage: "Interrupted",
          error: "The app restarted. Resume to keep researching.",
        });
    if (directory !== ":memory:" && process.platform !== "win32")
      chmodSync(file, 0o600);
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  settings(): Settings {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key='runtime'")
      .get();
    return {
      ...DEFAULT_SETTINGS,
      ...(row ? JSON.parse(String(row.value)) : {}),
    };
  }
  publicSettings(): PublicSettings {
    const { ollamaApiKey, telegramToken, ...settings } = this.settings();
    return {
      ...settings,
      hasSearchKey: Boolean(ollamaApiKey),
      hasTelegramToken: Boolean(telegramToken),
    };
  }
  saveSettings(settings: Settings) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES ('runtime',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(settings));
  }
  companion(): Companion | null {
    const row = this.db.prepare("SELECT data FROM companion WHERE id=1").get();
    return row ? JSON.parse(String(row.data)) : null;
  }
  saveCompanion(
    input: ReturnType<typeof companionInput>,
    editing = false,
  ): Companion {
    const current = this.companion();
    if (current && !editing)
      throw new AppError(
        "A companion already lives here. Edit them in Settings, or use a separate data directory.",
        409,
      );
    const c: Companion = {
      ...input,
      id: current?.id ?? randomUUID(),
      createdAt: current?.createdAt ?? iso(),
      revision: (current?.revision ?? 0) + 1,
    };
    this.transaction(() => {
      if (current)
        this.db
          .prepare("INSERT INTO revisions(data,createdAt) VALUES (?,?)")
          .run(JSON.stringify(current), iso());
      this.db
        .prepare(
          "INSERT INTO companion VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(JSON.stringify(c));
    });
    return c;
  }
  turns(limit = 200): Turn[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM turns ORDER BY createdAt DESC, rowid DESC LIMIT ?",
        )
        .all(limit) as unknown as Turn[]
    ).reverse();
  }
  turn(id: string): Turn | null {
    return (
      (this.db
        .prepare("SELECT * FROM turns WHERE id=?")
        .get(id) as unknown as Turn) ?? null
    );
  }
  startTurn(id: string, userText: string, channel: Turn["channel"]): Turn {
    const old = this.turn(id);
    if (old) {
      if (old.userText !== userText || old.channel !== channel)
        throw new AppError(
          "This message ID was already used for a different message.",
          409,
        );
      if (old.status === "running")
        throw new AppError("This reply is already being written.", 409);
      if (old.status === "complete") return old;
      this.db
        .prepare(
          "UPDATE turns SET status='running',reply='',error='' WHERE id=?",
        )
        .run(id);
    } else
      this.db
        .prepare(
          "INSERT INTO turns(id,userText,channel,status,createdAt) VALUES (?,?,?,'running',?)",
        )
        .run(id, userText, channel, iso());
    return this.turn(id)!;
  }
  finishTurn(
    id: string,
    reply: string,
    status: Turn["status"],
    error = "",
  ): Turn {
    this.db
      .prepare("UPDATE turns SET reply=?, status=?, error=? WHERE id=?")
      .run(reply, status, error, id);
    return this.turn(id)!;
  }
  markDelivered(id: string) {
    this.db.prepare("UPDATE turns SET delivered=1 WHERE id=?").run(id);
  }
  memories(includeDeleted = false): Memory[] {
    return this.db
      .prepare(
        `SELECT id,kind,subject,text,evidence,turnId,active,createdAt,updatedAt FROM memories ${includeDeleted ? "" : "WHERE active=1"} ORDER BY updatedAt DESC`,
      )
      .all() as unknown as Memory[];
  }
  writeMemory(
    input: Pick<Memory, "kind" | "subject" | "text" | "evidence" | "turnId">,
  ): Memory | null {
    const fingerprint = `${input.kind}:${input.subject}:${hash(input.text)}`;
    if (
      this.db
        .prepare("SELECT 1 FROM memory_suppressions WHERE fingerprint=?")
        .get(fingerprint)
    )
      return null;
    if (
      input.turnId &&
      this.db
        .prepare("SELECT 1 FROM blocked_turns WHERE turnId=?")
        .get(input.turnId)
    )
      return null;
    const id = randomUUID(),
      stamp = iso();
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO memories(id,kind,subject,text,evidence,turnId,active,fingerprint,createdAt,updatedAt) VALUES (?,?,?,?,?,?,1,?,?,?)",
      )
      .run(
        id,
        input.kind,
        input.subject,
        input.text,
        input.evidence,
        input.turnId,
        fingerprint,
        stamp,
        stamp,
      );
    return result.changes ? this.memories().find((m) => m.id === id)! : null;
  }
  replaceMemory(
    input: Pick<Memory, "kind" | "subject" | "text" | "evidence" | "turnId">,
    supersedes: string[] = [],
  ): Memory | null {
    return this.transaction(() => {
      const requested = this.memories().filter((m) =>
        supersedes.includes(m.id),
      );
      // A model cannot overwrite a manual correction or a different subject/kind.
      if (
        requested.some(
          (m) =>
            m.kind !== input.kind || m.subject !== input.subject || !m.turnId,
        )
      )
        return null;
      const next = this.writeMemory(input);
      if (!next) return null;
      for (const previous of requested) {
        this.db
          .prepare("UPDATE memories SET active=0,updatedAt=? WHERE id=?")
          .run(iso(), previous.id);
        this.db
          .prepare("INSERT INTO memory_replacements VALUES (?,?,?)")
          .run(previous.id, next.id, iso());
        if (previous.turnId)
          this.db
            .prepare("INSERT OR IGNORE INTO blocked_turns VALUES (?)")
            .run(previous.turnId);
      }
      return next;
    });
  }
  editMemory(id: string, content: string) {
    const m = this.memories().find((m) => m.id === id);
    if (!m) throw new AppError("That memory was not found.", 404);
    this.transaction(() => {
      const nextFingerprint = `${m.kind}:${m.subject}:${hash(content)}`;
      const collision = this.db
        .prepare("SELECT id FROM memories WHERE fingerprint=? AND id<>?")
        .get(nextFingerprint, id);
      if (collision)
        throw new AppError(
          "That memory already exists or was forgotten. Choose different wording or edit the existing memory.",
        );
      this.db
        .prepare("INSERT OR IGNORE INTO memory_suppressions VALUES (?,?)")
        .run(`${m.kind}:${m.subject}:${hash(m.text)}`, id);
      if (m.turnId)
        this.db
          .prepare("INSERT OR IGNORE INTO blocked_turns VALUES (?)")
          .run(m.turnId);
      this.db
        .prepare(
          "UPDATE memories SET text=?,fingerprint=?,evidence='Corrected by you',turnId=NULL,updatedAt=? WHERE id=?",
        )
        .run(content, nextFingerprint, iso(), id);
    });
  }
  forgetMemory(id: string) {
    const m = this.memories().find((m) => m.id === id);
    if (!m) throw new AppError("That memory was not found.", 404);
    this.transaction(() => {
      this.db
        .prepare("UPDATE memories SET active=0,updatedAt=? WHERE id=?")
        .run(iso(), id);
      if (m.turnId)
        this.db
          .prepare("INSERT OR IGNORE INTO blocked_turns VALUES (?)")
          .run(m.turnId);
    });
  }
  recall(query: string, limit = 12): Memory[] {
    const terms = new Set(
      query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [],
    );
    return this.memories()
      .map((m) => ({
        m,
        score:
          [...terms].filter((t) => m.text.toLowerCase().includes(t)).length +
          (m.subject === "relationship" ? 0.3 : 0),
      }))
      .sort(
        (a, b) =>
          b.score - a.score || b.m.updatedAt.localeCompare(a.m.updatedAt),
      )
      .slice(0, limit)
      .map((x) => x.m);
  }
  blockedTurn(id: string) {
    return Boolean(
      this.db.prepare("SELECT 1 FROM blocked_turns WHERE turnId=?").get(id),
    );
  }
  reflections(): Reflection[] {
    return this.db
      .prepare("SELECT * FROM reflections ORDER BY createdAt DESC LIMIT 100")
      .all()
      .map((r) => ({
        ...r,
        sourceTurnIds: JSON.parse(String(r.sourceTurnIds)),
      })) as unknown as Reflection[];
  }
  addReflection(content: string, sourceTurnIds: string[]) {
    const r: Reflection = {
      id: randomUUID(),
      content,
      sourceTurnIds,
      createdAt: iso(),
    };
    this.db
      .prepare("INSERT INTO reflections VALUES (?,?,?,?)")
      .run(r.id, content, JSON.stringify(sourceTurnIds), r.createdAt);
    return r;
  }
  research(): Research[] {
    return this.db
      .prepare("SELECT data FROM research ORDER BY rowid DESC LIMIT 12")
      .all()
      .map((r) => JSON.parse(String(r.data)));
  }
  saveResearch(r: Research) {
    this.db
      .prepare(
        "INSERT INTO research VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(r.id, JSON.stringify(r));
  }
  enqueue(id: string, type: string, payload: unknown) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO jobs(id,type,payload,createdAt) VALUES (?,?,?,?)",
      )
      .run(id, type, JSON.stringify(payload), iso());
  }
  nextJob(): {
    id: string;
    type: string;
    payload: string;
    attempts: number;
  } | null {
    const row = this.db
      .prepare(
        "SELECT * FROM jobs WHERE status='pending' AND attempts<3 ORDER BY createdAt LIMIT 1",
      )
      .get();
    return (row as unknown as ReturnType<Store["nextJob"]>) ?? null;
  }
  jobStatus(id: string, status: string, error = "") {
    this.db
      .prepare(
        "UPDATE jobs SET status=?,error=?,attempts=attempts+CASE WHEN ?='running' THEN 1 ELSE 0 END WHERE id=?",
      )
      .run(status, error, status, id);
  }
  deferJob(id: string) {
    this.db
      .prepare(
        "UPDATE jobs SET status='pending', attempts=MAX(0,attempts-1),error='' WHERE id=?",
      )
      .run(id);
  }
  meta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row ? String(row.value) : null;
  }
  setMeta(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  archive() {
    return {
      format: "glashaus-archive",
      version: 3,
      schemaVersion: 2,
      exportedAt: iso(),
      companion: this.companion(),
      turns: this.db.prepare("SELECT * FROM turns ORDER BY rowid").all(),
      memories: this.memories(true),
      memorySuppressions: this.db
        .prepare("SELECT * FROM memory_suppressions")
        .all(),
      memoryReplacements: this.db
        .prepare("SELECT * FROM memory_replacements")
        .all(),
      reflections: this.db
        .prepare("SELECT * FROM reflections ORDER BY createdAt")
        .all()
        .map((r) => ({
          ...r,
          sourceTurnIds: JSON.parse(String(r.sourceTurnIds)),
        })),
      revisions: this.db.prepare("SELECT * FROM revisions ORDER BY id").all(),
      research: this.db
        .prepare("SELECT data FROM research ORDER BY rowid")
        .all()
        .map((r) => JSON.parse(String(r.data))),
      blockedTurns: this.db
        .prepare("SELECT turnId FROM blocked_turns")
        .all()
        .map((r) => r.turnId),
      imports: this.db.prepare("SELECT * FROM imports").all(),
      note: "Credentials and machine settings are intentionally excluded.",
    };
  }
  importArchive(value: unknown): {
    kind: string;
    messages: number;
    memories: number;
  } {
    if (this.companion() || this.turns(1).length)
      throw new AppError(
        "Restore is available only in an empty home. Your current companion has not been changed.",
        409,
      );
    const a = record(value);
    if (a.format === "glashaus-soul-capsule") return this.importCapsule(a);
    if (a.format !== "glashaus-archive" || a.version !== 3)
      throw new AppError(
        "Use a GlasHaus v3 archive or a v2 soul capsule. Full v2 SQLite migration is not included in this alpha.",
      );
    if (
      a.schemaVersion !== undefined &&
      a.schemaVersion !== 1 &&
      a.schemaVersion !== 2
    )
      throw new AppError(
        "This archive needs a newer version of GlasHaus. Nothing was changed.",
      );
    const c = companionInput(a.companion);
    const rawC = record(a.companion);
    const rows = (key: string, max: number) => {
      if (!Array.isArray(a[key]) || a[key].length > max)
        throw new AppError(`The archive has an invalid ${key} section.`);
      return a[key] as unknown[];
    };
    const turns = rows("turns", 100000).map((r) => {
      const t = record(r);
      if (
        !["web", "telegram"].includes(String(t.channel)) ||
        !["running", "complete", "interrupted", "failed"].includes(
          String(t.status),
        )
      )
        throw new AppError("The archive contains an invalid conversation.");
      return {
        id: text(t.id, "Turn ID", 160, true),
        userText: text(t.userText, "Message", 16000),
        reply: text(t.reply, "Reply", 100000),
        channel: t.channel,
        status: t.status === "running" ? "interrupted" : t.status,
        delivered: t.delivered ? 1 : 0,
        error: text(t.error, "Turn error", 1000),
        createdAt: text(t.createdAt, "Date", 60, true),
      };
    });
    const ids = new Set(turns.map((t) => t.id));
    if (ids.size !== turns.length)
      throw new AppError("The archive has duplicate conversation IDs.");
    const memories = rows("memories", 100000).map((raw) => {
      const m = record(raw);
      if (
        !["fact", "opinion"].includes(String(m.kind)) ||
        !["user", "companion", "relationship"].includes(String(m.subject))
      )
        throw new AppError("The archive contains an invalid memory.");
      if (m.turnId && !ids.has(String(m.turnId)))
        throw new AppError("A memory refers to a missing conversation.");
      return {
        kind: String(m.kind),
        subject: String(m.subject),
        turnId: m.turnId ? String(m.turnId) : null,
        active: m.active ? 1 : 0,
        id: text(m.id, "Memory ID", 160, true),
        text: text(m.text, "Memory", 4000, true),
        evidence: text(m.evidence, "Evidence", 16000),
        createdAt: text(m.createdAt, "Date", 60, true),
        updatedAt: text(m.updatedAt, "Date", 60, true),
      };
    });
    const reflections = rows("reflections", 10000).map((raw) => {
      const r = record(raw);
      const sourceTurnIds = Array.isArray(r.sourceTurnIds)
        ? r.sourceTurnIds.map(String)
        : [];
      if (sourceTurnIds.some((id) => !ids.has(id)))
        throw new AppError("A reflection refers to missing history.");
      return {
        id: text(r.id, "Reflection ID", 160, true),
        content: text(r.content, "Reflection", 20000),
        createdAt: text(r.createdAt, "Date", 60, true),
        sourceTurnIds,
      };
    });
    const memoryIds = new Set(memories.map((m) => m.id));
    const suppressions = (
      Array.isArray(a.memorySuppressions) ? a.memorySuppressions : []
    ).map((raw) => {
      const r = record(raw);
      const fingerprint = text(r.fingerprint, "Memory fingerprint", 100, true);
      const memoryId = text(r.memoryId, "Memory ID", 160, true);
      if (
        !/^(fact|opinion):(user|companion|relationship):[a-f0-9]{64}$/.test(
          fingerprint,
        ) ||
        !memoryIds.has(memoryId)
      )
        throw new AppError("Invalid memory correction history.");
      return { fingerprint, memoryId };
    });
    const replacements = (
      Array.isArray(a.memoryReplacements) ? a.memoryReplacements : []
    ).map((raw) => {
      const r = record(raw);
      const previousId = text(r.previousId, "Previous memory ID", 160, true),
        nextId = text(r.nextId, "Next memory ID", 160, true);
      if (
        !memoryIds.has(previousId) ||
        !memoryIds.has(nextId) ||
        previousId === nextId
      )
        throw new AppError("Invalid memory replacement history.");
      return {
        previousId,
        nextId,
        createdAt: text(r.createdAt, "Replacement date", 60, true),
      };
    });
    const revisions = (Array.isArray(a.revisions) ? a.revisions : [])
      .slice(0, 10000)
      .map((raw) => {
        const r = record(raw);
        const data = record(
          typeof r.data === "string" ? JSON.parse(r.data) : r.data,
        );
        const foundation = companionInput(data);
        return {
          data: JSON.stringify({ ...data, ...foundation }),
          createdAt: text(r.createdAt, "Revision date", 60, true),
        };
      });
    const research = (Array.isArray(a.research) ? a.research : [])
      .slice(0, 10000)
      .map((raw) => {
        const r = record(raw);
        const foundation = character({
          name: r.name,
          mode: "character",
          sources: r.sources,
        });
        if (
          !["running", "complete", "failed", "interrupted"].includes(
            String(r.status),
          )
        )
          throw new AppError("The archive has invalid research status.");
        return {
          id: text(r.id, "Research ID", 160, true),
          name: foundation.name,
          work: text(r.work, "Source work", 200),
          scope: text(r.scope, "Story scope", 500),
          status: r.status === "running" ? "interrupted" : r.status,
          stage: text(r.stage, "Research stage", 500),
          sources: foundation.sources,
          draft: r.draft ? character(r.draft) : null,
          error: text(r.error, "Research error", 1000),
          createdAt: text(r.createdAt, "Research date", 60, true),
        };
      });
    this.transaction(() => {
      const companion: Companion = {
        ...c,
        id: text(rawC.id, "Companion ID", 160, true),
        createdAt: text(rawC.createdAt, "Created date", 60, true),
        revision: Number.isInteger(rawC.revision) ? Number(rawC.revision) : 1,
      };
      this.db
        .prepare("INSERT INTO companion VALUES (1,?)")
        .run(JSON.stringify(companion));
      for (const t of turns)
        this.db
          .prepare("INSERT INTO turns VALUES (?,?,?,?,?,?,?,?)")
          .run(
            t.id,
            t.userText,
            t.reply,
            String(t.channel),
            String(t.status),
            t.delivered,
            t.error,
            t.createdAt,
          );
      for (const m of memories)
        this.db
          .prepare("INSERT INTO memories VALUES (?,?,?,?,?,?,?,?,?,?)")
          .run(
            m.id,
            String(m.kind),
            String(m.subject),
            m.text,
            m.evidence,
            m.turnId ? String(m.turnId) : null,
            m.active ? 1 : 0,
            `${m.kind}:${m.subject}:${hash(m.text)}`,
            m.createdAt,
            m.updatedAt,
          );
      for (const r of reflections)
        this.db
          .prepare("INSERT INTO reflections VALUES (?,?,?,?)")
          .run(r.id, r.content, JSON.stringify(r.sourceTurnIds), r.createdAt);
      for (const r of suppressions)
        this.db
          .prepare("INSERT INTO memory_suppressions VALUES (?,?)")
          .run(r.fingerprint, r.memoryId);
      for (const r of replacements)
        this.db
          .prepare("INSERT INTO memory_replacements VALUES (?,?,?)")
          .run(r.previousId, r.nextId, r.createdAt);
      for (const r of revisions)
        this.db
          .prepare("INSERT INTO revisions(data,createdAt) VALUES (?,?)")
          .run(r.data, r.createdAt);
      for (const r of research)
        this.db
          .prepare("INSERT INTO research VALUES (?,?)")
          .run(r.id, JSON.stringify(r));
      for (const id of Array.isArray(a.blockedTurns) ? a.blockedTurns : [])
        if (ids.has(String(id)))
          this.db
            .prepare("INSERT OR IGNORE INTO blocked_turns VALUES (?)")
            .run(String(id));
      // Preserve the original import intact, including extension fields this version does not yet interpret.
      this.db
        .prepare("INSERT INTO imports VALUES (?,?,?,?)")
        .run(randomUUID(), "glashaus-archive", JSON.stringify(a), iso());
    });
    return { kind: "full", messages: turns.length, memories: memories.length };
  }
  private importCapsule(a: Record<string, unknown>) {
    if (a.version !== 1 || !Array.isArray(a.documents))
      throw new AppError("This soul capsule version is not supported.");
    const docs = new Map(
      a.documents.map((raw) => {
        const d = record(raw);
        return [String(d.name), String(d.content ?? "")];
      }),
    );
    const c = companionInput({
      name: text(a.companion, "Companion name", 100, true),
      pronouns: "",
      mode: "authored",
      work: "",
      summary: "Restored from a GlasHaus soul capsule.",
      personality: (docs.get("SOUL") ?? "").slice(0, 8000),
      voice: (docs.get("VOICE") ?? "").slice(0, 5000),
      backstory: "",
      values: "",
      userName: "You",
      relationship: (
        docs.get("IDENTITY") ||
        "Continue the relationship recorded in the imported persona."
      ).slice(0, 6000),
      uncertainties: [
        "This capsule carries identity, not complete conversation history.",
      ],
      claims: [],
      sources: [],
    });
    this.transaction(() => {
      this.db.prepare("INSERT INTO companion VALUES (1,?)").run(
        JSON.stringify({
          ...c,
          id: randomUUID(),
          createdAt: iso(),
          revision: 1,
        }),
      );
      this.db
        .prepare("INSERT INTO imports VALUES (?,?,?,?)")
        .run(randomUUID(), "glashaus-soul-capsule", JSON.stringify(a), iso());
      for (const raw of Array.isArray(a.identity_facts)
        ? a.identity_facts
        : []) {
        const f = record(raw);
        const content = text(f.content, "Imported memory", 4000);
        if (!content) continue;
        this.writeMemory({
          kind: "fact",
          subject: f.category === "companion" ? "companion" : "relationship",
          text: content,
          evidence: "Imported identity fact from v2 soul capsule",
          turnId: null,
        });
      }
      for (const raw of Array.isArray(a.opinions) ? a.opinions : []) {
        const o = record(raw);
        const claim = text(o.claim, "Imported opinion", 4000);
        if (claim)
          this.writeMemory({
            kind: "opinion",
            subject: "companion",
            text: claim,
            evidence: text(o.context, "Opinion context", 16000),
            turnId: null,
          });
      }
    });
    return { kind: "capsule", messages: 0, memories: this.memories().length };
  }
}
