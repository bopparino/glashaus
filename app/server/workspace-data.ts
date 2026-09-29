import type { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import type { WorkspaceFile, WorkspaceTask } from "../shared/workspace.ts";
import { AppError, record, text } from "./validation.ts";

// Keeping the bounded library in SQLite makes backup/restore and data deletion
// atomic with conversation history. No host paths are accepted by the API.
export const LIBRARY_LIMIT = 24 * 1024 * 1024;
export const IMAGE_LIMIT = 3 * 1024 * 1024;
export const FILE_LIMIT = 8 * 1024 * 1024;
const mimes = [
  "image/png",
  "image/jpeg",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
];
const date = () => new Date().toISOString();
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
export function imageMime(bytes: Buffer): string {
  if (bytes.length > IMAGE_LIMIT || bytes.length < 24)
    throw new AppError("Choose a JPEG or PNG smaller than 3 MB.");
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    const w = bytes.readUInt32BE(16),
      h = bytes.readUInt32BE(20);
    if (!w || !h || w * h > 20_000_000)
      throw new AppError("Resize the image to under 20 megapixels.");
    return "image/png";
  }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    // Read JPEG frame dimensions, rejecting malformed or oversized images before
    // they reach a decoder. Metadata is not used as instructions.
    let i = 2;
    while (i + 8 < bytes.length) {
      if (bytes[i++] !== 255) break;
      while (bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const n = bytes.readUInt16BE(i);
      if (n < 2 || i + n > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        const h = bytes.readUInt16BE(i + 3),
          w = bytes.readUInt16BE(i + 5);
        if (!w || !h || w * h > 20_000_000)
          throw new AppError("Resize the image to under 20 megapixels.");
        return "image/jpeg";
      }
      i += n;
    }
  }
  throw new AppError("This file is not a supported JPEG or PNG.");
}
export function decodeBase64(value: unknown, limit = FILE_LIMIT): Buffer {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(limit / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new AppError("Invalid file data.");
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > limit)
    throw new AppError("File is too large or empty.");
  return bytes;
}
export class WorkspaceData {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }
  files(): WorkspaceFile[] {
    return this.db
      .prepare("SELECT metadata FROM workspace_files ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(String(r.metadata)));
  }
  file(id: string): { metadata: WorkspaceFile; bytes: Buffer } {
    const r = this.db
      .prepare("SELECT * FROM workspace_files WHERE id=?")
      .get(id);
    if (!r) throw new AppError("This file is no longer in the library.", 404);
    return {
      metadata: JSON.parse(String(r.metadata)),
      bytes: Buffer.from(r.bytes as Uint8Array),
    };
  }
  saveFile(
    name: string,
    mime: string,
    bytes: Buffer,
    kind: WorkspaceFile["kind"],
  ): WorkspaceFile {
    if (!mimes.includes(mime) || !bytes.length || bytes.length > FILE_LIMIT)
      throw new AppError("Unsupported or oversized output file.");
    const used = Number(
      this.db
        .prepare(
          "SELECT COALESCE(SUM(length(bytes)),0) AS n FROM workspace_files",
        )
        .get()!.n,
    );
    if (used + bytes.length > LIBRARY_LIMIT)
      throw new AppError(
        "The library is full (24 MB). Save and remove unneeded files before trying again.",
      );
    const metadata: WorkspaceFile = {
      id: randomUUID(),
      name: text(name, "File name", 120, true).replace(/[\x00-\x1f/\\]/g, "_"),
      mime,
      size: bytes.length,
      sha256: digest(bytes),
      createdAt: date(),
      kind,
    };
    this.db
      .prepare("INSERT INTO workspace_files VALUES (?,?,?)")
      .run(metadata.id, JSON.stringify(metadata), bytes);
    return metadata;
  }
  upload(value: unknown) {
    const r = record(value),
      bytes = decodeBase64(r.data, IMAGE_LIMIT);
    return this.saveFile(
      text(r.name, "File name", 120, true),
      imageMime(bytes),
      bytes,
      "image",
    );
  }
  ids(value: unknown): string[] {
    if (value === undefined) return [];
    if (
      !Array.isArray(value) ||
      value.length > 3 ||
      value.some((v) => typeof v !== "string") ||
      new Set(value).size !== value.length
    )
      throw new AppError("Attach up to three different images.");
    for (const id of value)
      if (this.file(id).metadata.kind !== "image")
        throw new AppError("Only images can be attached to this message.");
    return value;
  }
  turnIds(id: string): string[] {
    const r = this.db
      .prepare("SELECT ids FROM workspace_turns WHERE turnId=?")
      .get(id);
    return r ? JSON.parse(String(r.ids)) : [];
  }
  turnFiles(id: string): WorkspaceFile[] {
    return this.turnIds(id).flatMap((id) => {
      try {
        return [this.file(id).metadata];
      } catch {
        return [];
      }
    });
  }
  attach(turnId: string, ids: string[]) {
    this.db
      .prepare("INSERT OR IGNORE INTO workspace_turns VALUES (?,?)")
      .run(turnId, JSON.stringify(ids));
  }
  tasks(): WorkspaceTask[] {
    return this.db
      .prepare("SELECT data FROM workspace_tasks ORDER BY rowid DESC LIMIT 200")
      .all()
      .map((r) => JSON.parse(String(r.data)));
  }
  task(id: string): WorkspaceTask {
    const r = this.db
      .prepare("SELECT data FROM workspace_tasks WHERE id=?")
      .get(id);
    if (!r) throw new AppError("Task not found.", 404);
    return JSON.parse(String(r.data));
  }
  saveTask(task: WorkspaceTask) {
    this.db
      .prepare(
        "INSERT INTO workspace_tasks VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(task.id, JSON.stringify(task));
  }
  removeFile(id: string) {
    if (
      this.tasks().some(
        (t) =>
          ["queued", "running"].includes(t.status) && t.inputIds.includes(id),
      )
    )
      throw new AppError(
        "This image is being used by a task. Cancel it first.",
        409,
      );
    this.file(id);
    this.db.prepare("DELETE FROM workspace_files WHERE id=?").run(id);
  }
  archive() {
    return {
      files: this.files().map((f) => ({
        ...f,
        data: this.file(f.id).bytes.toString("base64"),
      })),
      tasks: this.db
        .prepare("SELECT data FROM workspace_tasks ORDER BY rowid")
        .all()
        .map((r) => JSON.parse(String(r.data))),
      turns: this.db.prepare("SELECT * FROM workspace_turns").all(),
    };
  }
  // Validate everything before the caller starts the restore transaction.
  validateArchive(value: unknown, turnIds: Set<string>) {
    const r = record(value);
    if (
      !Array.isArray(r.files) ||
      !Array.isArray(r.tasks) ||
      !Array.isArray(r.turns) ||
      r.files.length > 10000 ||
      r.tasks.length > 10000 ||
      r.turns.length > 100000
    )
      throw new AppError("Invalid workspace archive.");
    let total = 0;
    const files = r.files.map((raw) => {
      const f = record(raw),
        bytes = decodeBase64(f.data);
      total += bytes.length;
      if (
        total > LIBRARY_LIMIT ||
        !mimes.includes(String(f.mime)) ||
        !["image", "artifact"].includes(String(f.kind)) ||
        f.sha256 !== digest(bytes) ||
        f.size !== bytes.length
      )
        throw new AppError("Invalid archived file.");
      if (f.kind === "image" && imageMime(bytes) !== f.mime)
        throw new AppError("Invalid archived image.");
      if (typeof f.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(f.id))
        throw new AppError("Invalid archived file ID.");
      const metadata: WorkspaceFile = {
        id: text(f.id, "File ID", 160, true),
        name: text(f.name, "File name", 120, true).replace(
          /[\x00-\x1f/\\]/g,
          "_",
        ),
        mime: String(f.mime),
        size: bytes.length,
        sha256: digest(bytes),
        kind: f.kind as WorkspaceFile["kind"],
        createdAt: text(f.createdAt, "Date", 60, true),
      };
      return { metadata, bytes };
    });
    if (new Set(files.map((f) => f.metadata.id)).size !== files.length)
      throw new AppError("Duplicate archived file IDs.");
    const lists = (v: unknown): string[] => {
      if (
        !Array.isArray(v) ||
        v.length > 20 ||
        v.some((i) => typeof i !== "string" || i.length > 160)
      )
        throw new AppError("Invalid file references.");
      return v;
    };
    const tasks = r.tasks.map((raw) => {
      const t = record(raw);
      if (
        !["document", "python"].includes(String(t.kind)) ||
        ![
          "queued",
          "running",
          "complete",
          "failed",
          "cancelled",
          "interrupted",
        ].includes(String(t.status)) ||
        (t.turnId !== null && !turnIds.has(String(t.turnId)))
      )
        throw new AppError("Invalid archived task.");
      return {
        id: text(t.id, "Task ID", 160, true),
        turnId: t.turnId as string | null,
        title: text(t.title, "Task title", 160, true),
        instruction: text(t.instruction, "Task request", 16000, true),
        kind: t.kind,
        status: ["queued", "running"].includes(String(t.status))
          ? "interrupted"
          : t.status,
        stage: "Restored from backup",
        error: text(t.error, "Task error", 2000),
        inputIds: lists(t.inputIds),
        outputIds: lists(t.outputIds),
        parentId:
          t.parentId === null
            ? null
            : text(t.parentId, "Parent task", 160, true),
        createdAt: text(t.createdAt, "Date", 60, true),
        updatedAt: date(),
      } as WorkspaceTask;
    });
    if (new Set(tasks.map((t) => t.id)).size !== tasks.length)
      throw new AppError("Duplicate archived task IDs.");
    const turns = r.turns.map((raw) => {
      const t = record(raw);
      if (!turnIds.has(String(t.turnId)))
        throw new AppError("Missing attachment conversation.");
      return {
        turnId: String(t.turnId),
        ids: lists(JSON.parse(text(t.ids, "Attachments", 2000, true))),
      };
    });
    return () => {
      for (const f of files)
        this.db
          .prepare("INSERT INTO workspace_files VALUES (?,?,?)")
          .run(f.metadata.id, JSON.stringify(f.metadata), f.bytes);
      for (const t of tasks) this.saveTask(t);
      for (const t of turns) this.attach(t.turnId, t.ids);
    };
  }
}
