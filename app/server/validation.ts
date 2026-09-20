import type {
  Character,
  Companion,
  Settings,
  Source,
} from "../shared/types.ts";
export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("Expected an object.");
  return value as Record<string, unknown>;
}
export function text(
  value: unknown,
  label: string,
  max = 10000,
  required = false,
): string {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new AppError(`${label} must be text.`);
  const result = value.trim();
  if (required && !result) throw new AppError(`Enter ${label.toLowerCase()}.`);
  if (result.length > max)
    throw new AppError(
      `${label} must be ${max.toLocaleString()} characters or fewer.`,
    );
  return result;
}
export function publicUrl(value: unknown): string {
  const s = text(value, "Source URL", 2000, true);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new AppError("A source URL is invalid.");
  }
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw new AppError("Sources need an HTTP or HTTPS URL.");
  return u.href;
}
export function character(value: unknown): Character {
  const v = record(value);
  if (!["character", "authored", "grow"].includes(String(v.mode)))
    throw new AppError("Choose how your companion begins.");
  const sources: Source[] = (
    Array.isArray(v.sources) ? v.sources.slice(0, 12) : []
  ).map((x) => {
    const s = record(x);
    return {
      id: text(s.id, "Source ID", 80, true),
      title: text(s.title, "Source title", 300),
      url: publicUrl(s.url),
      excerpt: text(s.excerpt, "Source excerpt", 7000),
      fetchedAt: text(s.fetchedAt, "Fetch date", 50),
    };
  });
  const ids = new Set(sources.map((s) => s.id));
  return {
    name: text(v.name, "Name", 100, true),
    pronouns: text(v.pronouns, "Pronouns", 60),
    mode: v.mode as Character["mode"],
    work: text(v.work, "Source work", 200),
    summary: text(v.summary, "Summary", 2000),
    personality: text(v.personality, "Personality", 8000),
    voice: text(v.voice, "Voice", 5000),
    backstory: text(v.backstory, "Backstory", 8000),
    values: text(v.values, "Values", 4000),
    uncertainties: (Array.isArray(v.uncertainties) ? v.uncertainties : [])
      .slice(0, 20)
      .map((x) => text(x, "Uncertainty", 500)),
    claims: (Array.isArray(v.claims) ? v.claims : []).slice(0, 50).map((x) => {
      const c = record(x);
      const sourceIds = (Array.isArray(c.sourceIds) ? c.sourceIds : []).filter(
        (id): id is string => typeof id === "string" && ids.has(id),
      );
      return {
        text: text(c.text, "Claim", 1000),
        sourceIds,
        kind:
          c.kind === "sourced" && sourceIds.length
            ? "sourced"
            : "interpretation",
      };
    }),
    sources,
  };
}
export function companionInput(
  value: unknown,
): Pick<Companion, "userName" | "relationship"> & Character {
  const v = record(value);
  return {
    ...character(v),
    userName: text(v.userName, "Your name", 100, true),
    relationship: text(v.relationship, "Relationship", 6000, true),
  };
}
export function settingsInput(value: unknown, current: Settings): Settings {
  const v = record(value);
  const next = { ...current };
  for (const key of [
    "model",
    "utilityModel",
    "ollamaApiKey",
    "telegramToken",
    "telegramOwnerId",
  ] as const) {
    if (key in v) next[key] = text(v[key], key, 500);
  }
  if ("ollamaUrl" in v) {
    const url = new URL(publicUrl(v.ollamaUrl));
    if (url.search || url.hash || (url.pathname !== "/" && url.pathname !== ""))
      throw new AppError("Use the Ollama server address without a path.");
    next.ollamaUrl = url.origin;
  }
  for (const key of ["reflectionEnabled", "outreachEnabled"] as const) {
    if (key in v) {
      if (typeof v[key] !== "boolean")
        throw new AppError(`${key} must be true or false.`);
      next[key] = v[key];
    }
  }
  for (const [key, min, max] of [
    ["contextSize", 2048, 131072],
    ["quietStart", 0, 23],
    ["quietEnd", 0, 23],
    ["maxOutreachPerDay", 0, 5],
  ] as const) {
    if (key in v) {
      const n = v[key];
      if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max)
        throw new AppError(`${key} must be between ${min} and ${max}.`);
      next[key] = n;
    }
  }
  return next;
}
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";
