// Main entry: chat channels (Telegram if configured, webview always) +
// memory viewer + nightly dream/consolidation + proactive heartbeat +
// daily backups.
//   glashaus start  /  npm run bot
import cron from 'node-cron';
import { config, isConfigured } from './config.js';
import { runDream } from './dream.js';
import { consolidate } from './consolidate.js';
import { heartbeat } from './heartbeat.js';
import { saveMessage } from './memory.js';
import { runBackup } from './backup.js';
import { backfillEmbeddings } from './embeddings.js';
import { startViewer } from './viewer.js';
import { syncPersonaFromDisk } from './persona.js';

if (!isConfigured()) {
  console.error('No instance found. Run `glashaus setup` first.');
  process.exit(1);
}

// Persona files are the source of truth for identity docs — pick up edits
// made while the service was down.
syncPersonaFromDisk();

const telegram = config.telegramToken
  ? (await import('./telegram.js')).createBot()
  : null;
startViewer();

let pendingMorningMessage = null;
const tz = { timezone: config.timezone };

// Night shift (local time): dream, then memory hygiene, then backup.
cron.schedule(config.crons.dream, async () => {
  try {
    const result = await runDream();
    if (result?.morning_message) pendingMorningMessage = result.morning_message;
  } catch (err) {
    console.error('[dream]', err.message);
  }
}, tz);

cron.schedule(config.crons.consolidate, () => consolidate().catch(err => console.error('[consolidate]', err.message)), tz);
cron.schedule(config.crons.backup, () => runBackup().catch(err => console.error('[backup]', err.message)), tz);
runBackup().catch(err => console.error('[backup]', err.message));

// Heartbeat: on each tick the companion considers reaching out — grounded in
// real state, capped per day, quiet hours respected. Most ticks choose silence.
// With Telegram, outreach persists only after delivery confirms; without it,
// the message lands in the webview chat stream (visible next time it's open).
cron.schedule(config.crons.heartbeat, async () => {
  try {
    const message = await heartbeat({ pendingMorning: pendingMorningMessage });
    if (message) {
      if (telegram) await telegram.sendToOwner(message); // throws on failure — nothing persists
      pendingMorningMessage = null;
      saveMessage('assistant', message, 'outreach');
    }
  } catch (err) {
    console.error('[heartbeat]', err.message);
  }
}, tz);

// Backfill embeddings for anything that predates the vector branch.
backfillEmbeddings(200).then(n => n && console.log(`[embed-backfill] ${n} memories embedded`)).catch(() => {});

console.log(`${config.companionName} is up — model ${config.model}, viewer http://${config.viewerBind}:${config.viewerPort}, telegram ${telegram ? 'on' : 'off'}`);

if (telegram) {
  // If long-polling dies fatally, exit so the service manager resurrects the
  // process — a live process with dead polling looks healthy but is deaf.
  telegram.start().catch(err => {
    console.error('[fatal] telegram polling died:', err.message);
    process.exit(1);
  });
}
