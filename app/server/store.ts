import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS } from "../shared/types.ts";
import { repeatRule } from "./recurrence.ts";
import type {
  Companion,
  Memory,
  PublicSettings,
  Reflection,
  Research,
  Settings,
  Turn,
  Source,
} from "../shared/types.ts";
import {
  AppError,
  character,
  companionInput,
  record,
  text,
} from "./validation.ts";

import { WorkspaceData } from "./workspace-data.ts";

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
    if (version > 8) {
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
      PRAGMA application_id=${APP_ID};`);
    this.transaction(() =>
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY, turnId TEXT UNIQUE REFERENCES turns(id), title TEXT NOT NULL,
        dueAt TEXT NOT NULL, timeZone TEXT NOT NULL, status TEXT NOT NULL,
        revision INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, firedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS reminders_due ON reminders(status,dueAt);
      CREATE TABLE IF NOT EXISTS reminder_events (
        id TEXT PRIMARY KEY, reminderId TEXT NOT NULL REFERENCES reminders(id), dueAt TEXT NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tool_runs (
        id TEXT PRIMARY KEY, turnId TEXT NOT NULL REFERENCES turns(id), name TEXT NOT NULL,
        arguments TEXT NOT NULL, result TEXT NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mobile_devices (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE,
        createdAt TEXT NOT NULL, lastSeenAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS check_ins (
        id TEXT PRIMARY KEY, sourceTurnId TEXT NOT NULL UNIQUE REFERENCES turns(id),
        content TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL,
        status TEXT NOT NULL, createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL
      );
    `),
    );
    this.transaction(() => {
      const columns = this.db.prepare("PRAGMA table_info(reminders)").all();
      if (!columns.some((column) => column.name === "recurrence")) {
        this.db.exec("ALTER TABLE reminders ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'; ALTER TABLE reminders ADD COLUMN anchorAt TEXT NOT NULL DEFAULT ''; UPDATE reminders SET anchorAt=dueAt;");
      }
      this.db.exec(`CREATE TABLE IF NOT EXISTS integration_actions (id TEXT PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT NOT NULL); PRAGMA user_version=8;
        CREATE TABLE IF NOT EXISTS workspace_files (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, bytes BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS workspace_tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workspace_turns (turnId TEXT PRIMARY KEY REFERENCES turns(id), ids TEXT NOT NULL);`);
      this.db.exec(`UPDATE integration_actions SET data=json_set(data,'$.status','unknown','$.result','The Mac restarted during this action. Check the destination before creating another proposal.','$.revision',json_extract(data,'$.revision')+1) WHERE json_extract(data,'$.status')='executing';`);
    });
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
  resetData(purge: boolean): string[] {
    // Clear dependent rows first. No archive is made by a destructive action.
    // secure_delete + VACUUM/checkpoint limit remnants in SQLite itself; they
    // cannot erase filesystem snapshots, SSD history or copies outside this DB.
    this.db.exec("PRAGMA secure_delete=ON");
    this.transaction(() => {
      for (const table of [
        "workspace_turns",
        "workspace_tasks",
        "workspace_files",
        "mobile_devices",
        "integration_actions",
        "check_ins",
        "reminder_events",
        "reminders",
        "tool_runs",
        "memory_replacements",
        "memory_suppressions",
        "blocked_turns",
        "memories",
        "reflections",
        "jobs",
        "outreach",
        "research",
        "imports",
        "turns",
        "revisions",
        "companion",
      ])
        this.db.exec(`DELETE FROM ${table}`);
      if (purge) {
        this.db.exec("DELETE FROM settings; DELETE FROM meta");
      } else {
        // Do not replay already acknowledged Telegram messages into a new home.
        this.db.exec("DELETE FROM meta WHERE key <> 'telegramOffset'");
      }
    });
    try {
      this.db.exec("VACUUM");
      const result = this.db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      if (Number(result?.busy ?? 0) !== 0) throw new Error("Checkpoint busy");
      return [];
    } catch {
      return [
        "The current data was cleared, but SQLite could not finish compacting its files. Close other copies of GlasHaus, then retry Purge local data.",
      ];
    }
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
    )
      .reverse()
      .map((turn) => ({ ...turn, sources: this.sourcesForTurn(turn.id), attachments: new WorkspaceData(this.db).turnFiles(turn.id) }));
  }
  turn(id: string): Turn | null {
    const turn = this.db
      .prepare("SELECT * FROM turns WHERE id=?")
      .get(id) as unknown as Turn | undefined;
    return turn ? { ...turn, sources: this.sourcesForTurn(id), attachments: new WorkspaceData(this.db).turnFiles(id) } : null;
  }
  sourcesForTurn(id: string): Source[] {
    const sources = new Map<string, Source>();
    for (const row of this.db
      .prepare(
        "SELECT result FROM tool_runs WHERE turnId=? AND name IN ('web_search','web_fetch') ORDER BY rowid",
      )
      .all(id)) {
      const result = JSON.parse(String(row.result));
      for (const source of Array.isArray(result.sources)
        ? result.sources
        : []) {
        if (
          !source ||
          typeof source !== "object" ||
          typeof source.url !== "string"
        )
          continue;
        try {
          const url = new URL(source.url);
          if (
            !["https:", "http:"].includes(url.protocol) ||
            url.username ||
            url.password
          )
            continue;
          sources.set(url.href, {
            id: String(source.id ?? ""),
            title: String(source.title ?? url.hostname).slice(0, 300),
            url: url.href,
            excerpt: String(source.excerpt ?? "").slice(0, 6000),
            fetchedAt: String(source.fetchedAt ?? ""),
          });
        } catch {
          /* Invalid imported citations are never made clickable. */
        }
      }
    }
    return [...sources.values()].slice(0, 10);
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
      schemaVersion: 7,
      workspace: new WorkspaceData(this.db).archive(),
      reviewedActions: this.db.prepare("SELECT data FROM integration_actions ORDER BY createdAt,id").all().map(r => JSON.parse(String(r.data))),
      checkIns: this.db
        .prepare("SELECT * FROM check_ins ORDER BY createdAt,id")
        .all(),
      reminders: this.db
        .prepare("SELECT * FROM reminders ORDER BY createdAt,id")
        .all(),
      reminderEvents: this.db
        .prepare("SELECT * FROM reminder_events ORDER BY createdAt,id")
        .all(),
      toolRuns: this.db
        .prepare("SELECT * FROM tool_runs ORDER BY createdAt,id")
        .all(),
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
      a.schemaVersion !== 2 &&
      a.schemaVersion !== 3 &&
      a.schemaVersion !== 4 &&
      a.schemaVersion !== 5 &&
      a.schemaVersion !== 6 &&
      a.schemaVersion !== 7
    )
      throw new AppError(
        "This archive needs a newer version of GlasHaus. Nothing was changed.",
      );
    const c = companionInput(a.companion);
    const reviewedActions = Number(a.schemaVersion) >= 6 ? a.reviewedActions : [];
    if (!Array.isArray(reviewedActions) || reviewedActions.length > 100000) throw new AppError("Invalid reviewed action history.");
    const safeActions = reviewedActions.map(raw => {
      const r = record(raw);
      const id = text(r.id, "Action ID", 160, true), createdAt = text(r.createdAt, "Action date", 60, true);
      if (!/^[\w-]+$/.test(id) || !Number.isFinite(Date.parse(createdAt)) || !["email", "calendar", "connector"].includes(String(r.kind)) || !["draft", "executing", "complete", "cancelled", "unknown"].includes(String(r.status)) || !Number.isInteger(r.revision) || Number(r.revision) < 1) throw new AppError("Invalid reviewed action in archive.");
      const payload = record(r.payload);
      if (JSON.stringify(payload).length > 24000) throw new AppError("An archived proposal is too large.");
      return { id, kind: r.kind, title: text(r.title, "Proposal title", 300, true), payload, status: r.status === "draft" ? "cancelled" : r.status === "executing" ? "unknown" : r.status, revision: Number(r.revision) + 1, configRevision: 0, createdAt, result: r.status === "draft" ? "Cancelled during restore. Connected accounts require fresh setup and a new proposal." : text(r.result, "Action outcome", 30000) };
    });
    if (new Set(safeActions.map(r => r.id)).size !== safeActions.length) throw new AppError("Duplicate reviewed action IDs in archive.");
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
    const restoreWorkspace = Number(a.schemaVersion) >= 7 ? new WorkspaceData(this.db).validateArchive(a.workspace, ids) : () => {};
    if (ids.size !== turns.length)
      throw new AppError("The archive has duplicate conversation IDs.");
    const extensionRows = (key: string, max: number) =>
      Number(a.schemaVersion) >= 3 ? rows(key, max) : [];
    const checkIns = (
      Number(a.schemaVersion) >= 4 ? rows("checkIns", 100000) : []
    ).map((raw) => {
      const r = record(raw);
      if (
        !ids.has(String(r.sourceTurnId)) ||
        ![
          "available",
          "seen",
          "dismissed",
          "expired",
          "skipped",
          "failed",
          "withdrawn",
        ].includes(String(r.status))
      )
        throw new AppError("Invalid check-in history in archive.");
      const createdAt = text(r.createdAt, "Check-in date", 60, true);
      const expiresAt = text(r.expiresAt, "Check-in expiry", 60, true);
      if (
        ![createdAt, expiresAt].every(
          (v) =>
            Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v,
        )
      )
        throw new AppError("Invalid check-in date in archive.");
      return {
        id: text(r.id, "Check-in ID", 200, true),
        sourceTurnId: String(r.sourceTurnId),
        content: text(r.content, "Check-in", 1500),
        reason: text(r.reason, "Check-in reason", 500),
        evidence: text(r.evidence, "Check-in evidence", 1000),
        // An import cannot cause old, unseen outreach to appear as new.
        status: r.status === "available" ? "expired" : String(r.status),
        createdAt,
        expiresAt,
      };
    });
    const reminders = extensionRows("reminders", 100000).map((raw) => {
      const r = record(raw);
      if (
        ![
          "draft",
          "scheduled",
          "due",
          "completed",
          "cancelled",
          "paused",
        ].includes(String(r.status)) ||
        !Number.isInteger(r.revision) ||
        Number(r.revision) < 1
      )
        throw new AppError("The archive contains an invalid reminder.");
      if (r.turnId && !ids.has(String(r.turnId)))
        throw new AppError("A reminder refers to missing history.");
      const dueAt = text(r.dueAt, "Reminder time", 60, true);
      if (
        !Number.isFinite(Date.parse(dueAt)) ||
        new Date(dueAt).toISOString() !== dueAt
      )
        throw new AppError("Invalid reminder time in archive.");
      const zone = text(r.timeZone, "Time zone", 100, true);
      const recurrence = repeatRule(r.recurrence);
      const anchorAt = r.anchorAt === undefined ? dueAt : text(r.anchorAt, "Repeat start", 60, true);
      if (!Number.isFinite(Date.parse(anchorAt)) || new Date(anchorAt).toISOString() !== anchorAt)
        throw new AppError("Invalid repeat start in archive.");
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
      } catch {
        throw new AppError("Invalid reminder time zone in archive.");
      }
      return {
        id: text(r.id, "Reminder ID", 160, true),
        turnId: r.turnId ? String(r.turnId) : null,
        title: text(r.title, "Reminder", 500, true),
        dueAt,
        timeZone: zone,
        recurrence,
        anchorAt,
        status: r.status === "scheduled" ? "paused" : String(r.status),
        revision: Number(r.revision),
        createdAt: text(r.createdAt, "Date", 60, true),
        updatedAt: text(r.updatedAt, "Date", 60, true),
        firedAt: r.firedAt ? text(r.firedAt, "Date", 60, true) : null,
      };
    });
    const reminderIds = new Set(reminders.map((r) => r.id));
    if (reminderIds.size !== reminders.length)
      throw new AppError("Duplicate reminder IDs in archive.");
    const reminderEvents = extensionRows("reminderEvents", 100000).map(
      (raw) => {
        const r = record(raw);
        if (!reminderIds.has(String(r.reminderId)))
          throw new AppError("A reminder event refers to a missing reminder.");
        return {
          id: text(r.id, "Event ID", 200, true),
          reminderId: String(r.reminderId),
          dueAt: text(r.dueAt, "Date", 60, true),
          createdAt: text(r.createdAt, "Date", 60, true),
        };
      },
    );
    const toolRuns = extensionRows("toolRuns", 100000).map((raw) => {
      const r = record(raw);
      if (
        !ids.has(String(r.turnId)) ||
        ![
          "web_search",
          "web_fetch",
          "prepare_reminder",
          "list_reminders",
          "read_inbox", "read_email", "list_calendar_events", "list_connected_tools", "read_connected_tool", "prepare_external_action",
        ].includes(String(r.name))
      )
        throw new AppError("Invalid tool history in archive.");
      const args = text(r.arguments, "Tool arguments", 4000, true),
        result = text(r.result, "Tool result", 40000, true);
      try {
        record(JSON.parse(args));
        record(JSON.parse(result));
      } catch {
        throw new AppError("Invalid tool result in archive.");
      }
      return {
        id: text(r.id, "Tool ID", 200, true),
        turnId: String(r.turnId),
        name: String(r.name),
        arguments: args,
        result,
        createdAt: text(r.createdAt, "Date", 60, true),
      };
    });
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
      restoreWorkspace();
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
      for (const r of checkIns)
        this.db
          .prepare("INSERT INTO check_ins VALUES (?,?,?,?,?,?,?,?)")
          .run(
            r.id,
            r.sourceTurnId,
            r.content,
            r.reason,
            r.evidence,
            r.status,
            r.createdAt,
            r.expiresAt,
          );
      // Outreach is an explicit host preference, never inherited from a backup.
      this.saveSettings({ ...this.settings(), outreachEnabled: false });
      this.db.prepare("DELETE FROM settings WHERE key='integrations'").run();
      for (const r of safeActions) this.db.prepare("INSERT INTO integration_actions VALUES (?,?,?)").run(r.id, JSON.stringify(r), r.createdAt);
      for (const r of reminders)
        this.db
          .prepare("INSERT INTO reminders VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(
            r.id,
            r.turnId,
            r.title,
            r.dueAt,
            r.timeZone,
            r.status,
            r.revision,
            r.createdAt,
            r.updatedAt,
            r.firedAt,
            r.recurrence,
            r.anchorAt,
          );
      for (const r of reminderEvents)
        this.db
          .prepare("INSERT INTO reminder_events VALUES (?,?,?,?)")
          .run(r.id, r.reminderId, r.dueAt, r.createdAt);
      for (const r of toolRuns)
        this.db
          .prepare("INSERT INTO tool_runs VALUES (?,?,?,?,?,?)")
          .run(r.id, r.turnId, r.name, r.arguments, r.result, r.createdAt);
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
