// Shared health checks — consumed by `glashaus doctor` (CLI) and the
// webview's [ PULSE ] block. Each check: { label, ok, detail }.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { getDb } from './db.js';
import { config } from './config.js';

const BACKUP_DIR = config.backupDir;
const PIDFILE = path.join(config.home, 'glashaus.pid');

// Service-managed runtimes never write a pidfile — ask launchd/systemd
// first, fall back to the pidfile for plain background starts.
const PLIST_LABEL = 'com.glashaus.runtime';
function servicePid() {
  try {
    if (process.platform === 'darwin') {
      const home = process.env.HOME ?? '';
      if (!fs.existsSync(path.join(home, 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`))) return null;
      const out = execSync(`launchctl print gui/${process.getuid()}/${PLIST_LABEL} 2>/dev/null`, { encoding: 'utf8' });
      const m = out.match(/^\s*pid = (\d+)/m);
      return m ? Number(m[1]) : null;
    }
    const out = execSync('systemctl --user show -p MainPID glashaus 2>/dev/null', { encoding: 'utf8' });
    const m = out.match(/MainPID=(\d+)/);
    return m && m[1] !== '0' ? Number(m[1]) : null;
  } catch { return null; }
}

export function runtimePid() {
  const managed = servicePid();
  if (managed) return managed;
  try {
    const pid = Number(fs.readFileSync(PIDFILE, 'utf8').trim());
    if (pid) { process.kill(pid, 0); return pid; }
  } catch { /* stale or absent */ }
  return null;
}

export async function runChecks() {
  const checks = [];
  const add = (label, ok, detail = '') => checks.push({ label, ok, detail });

  // If this very process IS the runtime (checks run from the webview), it's
  // trivially up — the pidfile is only authoritative from the doctor CLI.
  const selfIsRuntime = (process.argv[1] ?? '').endsWith('index.js');
  const pid = selfIsRuntime ? process.pid : runtimePid();
  add('process', !!pid, pid ? `pid ${pid}` : 'DOWN — glashaus start');

  // Two runtimes sharing one bot token means Telegram hands each update to
  // only one of them — the classic orphan after deleting a home without
  // `glashaus stop` (the pidfile dies with the home; the process doesn't).
  // A service manager resurrecting a dying runtime reads as "up" on any
  // single check — the boot ledger reveals the loop.
  try {
    const ledger = path.join(config.logsDir, 'boots.log');
    if (fs.existsSync(ledger)) {
      const boots = fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean)
        .map(t => Date.parse(t)).filter(t => Date.now() - t < 10 * 60e3);
      if (boots.length >= 3) add('stability', false, `${boots.length} boots in 10m — crash loop; check config + errors`);
    }
  } catch { /* best-effort */ }

  try {
    const runtimes = execSync('ps -eo pid=,args=', { encoding: 'utf8' }).split('\n')
      .filter(l => /glashaus[/\\]src[/\\]index\.js/.test(l));
    if (runtimes.length > 1) {
      const pids = runtimes.map(l => l.trim().split(/\s+/)[0]).join(', ');
      add('runtimes', false, `${runtimes.length} running (pids ${pids}) — extras steal Telegram updates; kill the orphans`);
    }
  } catch { /* ps unavailable — skip */ }

  try {
    const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const names = (await res.json()).models?.map(m => m.name) ?? [];
    add('model', names.some(n => n.startsWith(config.model.split(':')[0])), config.model);
    add('embed', names.some(n => n.startsWith(config.embedModel)), config.embedModel);
  } catch {
    add('model', false, `ollama unreachable at ${config.ollamaUrl}`);
    add('embed', false, 'ollama unreachable');
  }

  if (config.telegramToken) {
    // One flaky handshake must not read as a dead bot: two attempts, and
    // "token rejected" kept distinct from "network blinked just now".
    let verdict = null;
    for (let attempt = 0; attempt < 2 && !verdict; attempt++) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/getMe`, { signal: AbortSignal.timeout(8000) });
        const body = await res.json();
        verdict = body.ok === true
          ? { ok: true, detail: 'api reachable' }
          : { ok: false, detail: 'token rejected by telegram — recheck config.json' };
      } catch {
        if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
      }
    }
    add('telegram', verdict?.ok ?? false,
      verdict?.detail ?? 'telegram unreachable twice just now (network?) — the running bot may still be fine; check glashaus logs');
  }

  const db = getDb();
  add('integrity', db.pragma('quick_check', { simple: true }) === 'ok', 'sqlite quick_check');
  add('store', fs.existsSync(config.dbPath), `${(fs.statSync(config.dbPath).size / 1048576).toFixed(1)} mb`);

  const backlog = db.prepare(`SELECT COUNT(*) n FROM messages WHERE summarized = 0 AND id <= (SELECT COALESCE(MAX(id),0) - ? FROM messages)`).get(config.recentWindow).n;
  add('backlog', backlog < config.summarizeChunk * 3, `${backlog}`);

  const noEmbed = db.prepare('SELECT COUNT(*) n FROM facts WHERE active = 1 AND embedding IS NULL').get().n;
  add('embeddings', noEmbed < 20, `${noEmbed} pending`);

  const lastDream = db.prepare('SELECT date FROM dreams ORDER BY id DESC LIMIT 1').get();
  const dreamAge = lastDream ? (Date.now() - Date.parse(lastDream.date)) / 86400000 : Infinity;
  add('dream', dreamAge < 2, lastDream?.date ?? 'never');

  const backups = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sqlite')).sort() : [];
  if (!backups.length) add('backup', false, 'none — glashaus backup');
  else {
    const ageHrs = (Date.now() - fs.statSync(path.join(BACKUP_DIR, backups.at(-1))).mtimeMs) / 3600000;
    add('backup', ageHrs < 48, `${ageHrs.toFixed(0)}h`);
  }

  // Only errors from the last 24h count — the log doesn't rotate, and stale
  // lines shouldn't cry wolf forever.
  const errPath = path.join(config.logsDir, 'glashaus.err');
  const errFresh = fs.existsSync(errPath) && fs.statSync(errPath).size > 0
    && (Date.now() - fs.statSync(errPath).mtimeMs) < 24 * 3600e3;
  const errTail = errFresh ? fs.readFileSync(errPath, 'utf8').trim().split('\n').filter(Boolean).slice(-3) : [];
  add('errors', !errFresh, errFresh ? errTail.at(-1).slice(0, 120) : 'none in 24h');

  return checks;
}

export function backupList() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sqlite')).sort().reverse()
    .map(f => ({ name: f, mb: (fs.statSync(path.join(BACKUP_DIR, f)).size / 1048576).toFixed(1) }));
}
