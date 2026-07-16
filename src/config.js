import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// GlasHaus keeps all instance state (config, persona, database, logs, backups)
// in one home directory. The app install stays stateless — delete the package,
// reinstall, point at the same home, and your companion is intact.
export const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const home = process.env.GLASHAUS_HOME || path.join(os.homedir(), '.glashaus');

// Optional GLASHAUS_HOME/.env — real environment always wins.
try {
  for (const line of fs.readFileSync(path.join(home, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env — fine */ }

const configPath = path.join(home, 'config.json');

export function isConfigured() {
  return fs.existsSync(configPath);
}

export function loadInstanceConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

// Written by `glashaus setup` and by settings edits; 0600 because the Telegram
// token lives here when Telegram is enabled.
export function writeInstanceConfig(next) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
}

const file = loadInstanceConfig();
const env = process.env;

const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
const pick = (envKey, fileVal, d) => env[envKey] ?? fileVal ?? d;

// Env (GLASHAUS_*) overrides config.json overrides defaults. The flat key shape
// is the engine's contract; config.json mirrors it in nested sections purely
// for human editing.
// Boot-time validation: a hand-edited config.json must fail LOUDLY with the
// key named, never as a stack trace from deep inside node-cron — under a
// service manager a silent boot death becomes an invisible crash loop.
export async function validateInstanceConfig(cfg = config) {
  const errors = [];
  const { validate } = await import('node-cron');
  for (const [name, expr] of Object.entries(cfg.crons)) {
    if (!validate(expr)) errors.push(`schedule.${name}: "${expr}" is not a valid cron expression`);
  }
  try { new Intl.DateTimeFormat('en-US', { timeZone: cfg.timezone }); }
  catch { errors.push(`timezone: "${cfg.timezone}" is not a valid IANA timezone`); }
  if (!cfg.model) errors.push('ollama.model: no model configured — run `glashaus setup`');
  const num = (label, v, lo, hi) => {
    if (v != null && (Number.isNaN(v) || v < lo || v > hi)) errors.push(`${label}: ${v} is outside [${lo}..${hi}]`);
  };
  num('heartbeat.quietStart', cfg.heartbeat.quietStart, 0, 24);
  num('heartbeat.quietEnd', cfg.heartbeat.quietEnd, 0, 24);
  num('heartbeat.maxPerDay', cfg.heartbeat.maxPerDay, 0, 48);
  num('viewer.port', cfg.viewerPort, 1, 65535);
  num('context.recentWindow', cfg.recentWindow, 4, 400);
  num('ollama.maxTokens', cfg.maxTokens, 64, 131072);
  if (cfg.temperature != null) num('ollama.temperature', cfg.temperature, 0, 2);
  return errors;
}

export const config = {
  appRoot,
  home,

  companionName: pick('GLASHAUS_COMPANION_NAME', file.companion?.name, 'Companion'),
  userName: pick('GLASHAUS_USER_NAME', file.user?.name, 'Friend'),
  // Optional ("he/him" | "she/her" | …): lets the register guardrail catch
  // the companion talking ABOUT the user instead of to them. Empty = tier off.
  userPronouns: pick('GLASHAUS_USER_PRONOUNS', file.user?.pronouns, ''),
  timezone: pick('GLASHAUS_TIMEZONE', file.timezone,
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
  // Free-text "where/when" note appended to the clock line, e.g. "Berlin".
  locationNote: pick('GLASHAUS_LOCATION', file.locationNote, ''),

  dbPath: pick('GLASHAUS_DB', file.dbPath, path.join(home, 'data', 'glashaus.sqlite')),
  personaDir: path.join(home, 'persona'),
  logsDir: path.join(home, 'logs'),
  backupDir: pick('GLASHAUS_BACKUP_DIR', file.backupDir, path.join(home, 'backups')),
  backupKeepDays: num(pick('GLASHAUS_BACKUP_KEEP_DAYS', file.backupKeepDays), 30),

  ollamaUrl: pick('OLLAMA_HOST', file.ollama?.url, 'http://127.0.0.1:11434')
    .replace(/\/$/, ''),
  model: pick('GLASHAUS_MODEL', file.ollama?.model, ''),
  // Split brain (optional): the voice speaks, the utility bookkeeps. A local
  // RP-tuned voice with a strong instruction-follower on capture/dreams ends
  // refusal roulette without giving up structured-output quality. Unset =
  // both fall back to `model`.
  voiceModel: pick('GLASHAUS_VOICE_MODEL', file.ollama?.voiceModel, null),
  utilityModel: pick('GLASHAUS_UTILITY_MODEL', file.ollama?.utilityModel, null),
  embedModel: pick('GLASHAUS_EMBED_MODEL', file.ollama?.embedModel, 'nomic-embed-text'),
  maxTokens: num(pick('GLASHAUS_MAX_TOKENS', file.ollama?.maxTokens), 4096),
  // Context window to request from Ollama. null = detect the model's real
  // window at boot (capped at 32k for KV-cache sanity) — many models default
  // to a small window and silently truncate FROM THE TOP, i.e. the SOUL.
  numCtx: pick('GLASHAUS_NUM_CTX', file.ollama?.numCtx, null) !== null
    ? Number(pick('GLASHAUS_NUM_CTX', file.ollama?.numCtx, null))
    : null,
  // Sampling for conversational replies only; utility calls stay at model
  // defaults for determinism. null = leave it to the model.
  temperature: pick('GLASHAUS_TEMPERATURE', file.ollama?.temperature, null) !== null
    ? Number(pick('GLASHAUS_TEMPERATURE', file.ollama?.temperature, null))
    : null,
  minP: pick('GLASHAUS_MIN_P', file.ollama?.minP, null) !== null
    ? Number(pick('GLASHAUS_MIN_P', file.ollama?.minP, null))
    : null,

  telegramToken: env.TELEGRAM_BOT_TOKEN || file.telegram?.token || '',
  ownerId: String(env.TELEGRAM_OWNER_ID || file.telegram?.ownerId || ''),

  // Context management — rolling summarization is what keeps a companion alive
  // past the point where raw history would drown the context window.
  recentWindow: num(pick('GLASHAUS_RECENT_WINDOW', file.context?.recentWindow), 40),
  summarizeChunk: num(pick('GLASHAUS_SUMMARIZE_CHUNK', file.context?.summarizeChunk), 30),
  captureEvery: num(pick('GLASHAUS_CAPTURE_EVERY', file.context?.captureEvery), 8),

  crons: {
    dream: pick('GLASHAUS_DREAM_CRON', file.schedule?.dream, '30 3 * * *'),
    consolidate: pick('GLASHAUS_CONSOLIDATE_CRON', file.schedule?.consolidate, '50 3 * * *'),
    backup: pick('GLASHAUS_BACKUP_CRON', file.schedule?.backup, '15 4 * * *'),
    heartbeat: pick('GLASHAUS_HEARTBEAT_CRON', file.schedule?.heartbeat, '*/30 * * * *'),
  },

  heartbeat: {
    enabled: file.heartbeat?.enabled ?? true,
    quietStart: num(pick('GLASHAUS_QUIET_START', file.heartbeat?.quietStart), 23),
    quietEnd: num(pick('GLASHAUS_QUIET_END', file.heartbeat?.quietEnd), 8.5),
    minSilenceHours: num(pick('GLASHAUS_MIN_SILENCE_HOURS', file.heartbeat?.minSilenceHours), 3),
    maxPerDay: num(pick('GLASHAUS_MAX_PER_DAY', file.heartbeat?.maxPerDay), 3),
    minGapHours: num(pick('GLASHAUS_MIN_GAP_HOURS', file.heartbeat?.minGapHours), 2.5),
  },

  viewerPort: num(pick('GLASHAUS_VIEW_PORT', file.viewer?.port), 7777),
  viewerBind: pick('GLASHAUS_VIEW_BIND', file.viewer?.bind, '127.0.0.1'),
};
