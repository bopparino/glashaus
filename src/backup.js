// Daily backups of the one file that IS the companion — snapshot with
// retention + integrity check, run on a cron inside the bot (index.js) and
// manually via `glashaus backup`.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getDb } from './db.js';
import { exportSoul } from './soul.js';
import { config } from './config.js';

const BACKUP_DIR = config.backupDir;
const KEEP_DAILY = config.backupKeepDays;

export async function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const dest = path.join(BACKUP_DIR, `glashaus-${stamp}.sqlite`);

  fs.rmSync(dest, { force: true }); // refresh same-day backups cleanly
  const db = getDb();
  db.pragma('wal_checkpoint(TRUNCATE)'); // fold the WAL journal into the main file
  await db.backup(dest); // sqlite online backup API — safe while live

  // Integrity check the copy, not just the original.
  const check = new Database(dest, { readonly: true });
  const ok = check.pragma('integrity_check', { simple: true }) === 'ok';
  check.close();
  if (!ok) {
    fs.rmSync(dest, { force: true });
    throw new Error('backup failed integrity check — original untouched, copy discarded');
  }

  // Retention: keep the newest N dailies.
  const old = fs.readdirSync(BACKUP_DIR)
    .filter(f => /^glashaus-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
    .sort()
    .slice(0, -KEEP_DAILY);
  for (const f of old) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });

  const size = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
  console.log(`[backup] ${dest} (${size} MB, integrity ok)`);

  // The personality-only capsule rides along with every backup.
  try { exportSoul(); } catch (err) { console.error('[soul]', err.message); }
  return dest;
}

if (process.argv.includes('--now')) {
  await runBackup();
}
