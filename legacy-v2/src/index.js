// Main entry: chat channels (Telegram if configured, webview always) +
// memory viewer + nightly dream/consolidation + proactive heartbeat +
// daily backups.
//   glashaus start  /  npm run bot
import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { config, isConfigured, validateInstanceConfig } from './config.js';
import { runDream } from './dream.js';
import { consolidate } from './consolidate.js';
import { heartbeat, markDelivered } from './heartbeat.js';
import { raiseThread } from './threads.js';
import { markShared } from './pursuits.js';
import { runGrowth } from './growth.js';
import { runWander } from './wander.js';
import { fulfillIntention } from './selfstate.js';
import { saveMessage } from './memory.js';
import { runBackup } from './backup.js';
import { backfillEmbeddings } from './embeddings.js';
import { startViewer } from './viewer.js';
import { syncPersonaFromDisk } from './persona.js';
import { markHandedOver } from './scratchpad.js';

if (!isConfigured()) {
  console.error('No instance found. Run `glashaus setup` first.');
  process.exit(1);
}

const configErrors = await validateInstanceConfig();
if (configErrors.length) {
  console.error('config.json has problems — fix these and restart:');
  for (const e of configErrors) console.error('  · ' + e);
  process.exit(1);
}

// Boot ledger: doctor uses this to spot a service manager resurrecting a
// crashing runtime over and over (which otherwise looks like "up").
try {
  fs.mkdirSync(config.logsDir, { recursive: true });
  const ledger = path.join(config.logsDir, 'boots.log');
  const boots = (fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').trim().split('\n') : [])
    .filter(Boolean).slice(-19);
  boots.push(new Date().toISOString());
  fs.writeFileSync(ledger, boots.join('\n') + '\n');
} catch { /* ledger is best-effort */ }

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

// Grow mode: the weekly self-authorship pass — she revises her own soul from
// lived evidence (src/growth.js; every revision archived + reversible).
if (config.growMode) {
  cron.schedule(config.crons.growth, () => runGrowth().catch(err => console.error('[growth]', err.message)), tz);
}

// The wander pass: daytime reading of her own choosing (needs an ollama.com
// API key; gates on curiosity and caps per day inside runWander).
if (config.ollamaApiKey && config.wander.enabled) {
  cron.schedule(config.crons.wander, () => runWander().catch(err => console.error('[wander]', err.message)), tz);
}

// Heartbeat: on each tick the companion considers reaching out — grounded in
// real state (including open intentions), capped per day, quiet hours
// respected. Most ticks choose silence. With Telegram, outreach persists only
// after delivery confirms; without it, the message lands in the webview chat
// stream (visible next time it's open). An intention this message acts on is
// marked fulfilled under the same rule: delivery first.
cron.schedule(config.crons.heartbeat, async () => {
  try {
    const out = await heartbeat({ pendingMorning: pendingMorningMessage });
    if (out) {
      if (telegram) await telegram.sendToOwner(out.text); // throws on failure — nothing persists
      pendingMorningMessage = null;
      const messageId = saveMessage('assistant', out.text, 'outreach');
      if (out.intentionId) fulfillIntention(out.intentionId);
      // She raised it herself — recorded so the anti-nag gate can hold her to
      // it, and so the next decision can see that she already brought it up.
      if (out.threadId) raiseThread(out.threadId, { actor: 'outreach', note: out.text.slice(0, 200), messageId });
      // She told him about it — so she won't tell him again. Delivery-first,
      // like everything else on this path.
      if (out.pursuitId) markShared(out.pursuitId);
      // She handed over something she had stacked for him — it leaves the queue
      // on delivery, same rule as every other side effect in this block.
      if (out.noteId) markHandedOver(out.noteId);
      markDelivered(out.logId);
    }
  } catch (err) {
    console.error('[heartbeat]', err.message);
  }
}, tz);

// Backfill embeddings for anything that predates the vector branch.
backfillEmbeddings(200).then(n => n && console.log(`[embed-backfill] ${n} memories embedded`)).catch(() => {});

console.log(`${config.companionName} is up — model ${config.model}, viewer http://${config.viewerBind}:${config.viewerPort}, telegram ${telegram ? 'on' : 'off'}${config.growMode ? ', growing' : ''}${config.ollamaApiKey && config.wander.enabled ? ', wandering' : ''}${config.ollamaApiKey && config.search.enabled ? ', lookup live' : ''}`);

if (telegram) {
  // If long-polling dies fatally, exit so the service manager resurrects the
  // process — a live process with dead polling looks healthy but is deaf.
  telegram.start().catch(err => {
    console.error('[fatal] telegram polling died:', err.message);
    process.exit(1);
  });
}
