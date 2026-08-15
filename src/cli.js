// The terminal room. Streamed replies, slash commands, instrument paint —
// the CLI is where the companion lives when the webview isn't open, so it
// gets the same design care as the GLASHAUS pages.
//   glashaus chat                normal chat
//   glashaus chat --ephemeral    test mode: nothing is saved to memory
import readline from 'node:readline/promises';
import { handleUserMessage } from './chat.js';
import { getDb } from './db.js';
// Every slash command lives in one registry shared with Telegram and the
// webview (src/commands.js) — the terminal just paints the result in ANSI.
import { runCommand, isCommand } from './commands.js';
import { config } from './config.js';
import { brass, faint, italic, red, rule, isTTY, eraseLines, rowsOf } from './tty.js';

let persist = !process.argv.includes('--ephemeral');
const who = config.companionName.toLowerCase();
const db = getDb();

// ---------- banner ----------
// The same liturgy the webview speaks, in ANSI: gold for her, faint for the
// machinery, one cross. Every number is real state.
function banner() {
  const msgs = db.prepare('SELECT COUNT(*) n, MIN(created_at) first FROM messages WHERE redacted = 0').get();
  const days = msgs.first ? Math.max(1, Math.ceil((Date.now() - Date.parse(msgs.first + 'Z')) / 86400000)) : 0;
  const bornDay = config.bornDate
    ? Math.max(1, Math.floor((Date.now() - Date.parse(config.bornDate + 'T00:00:00Z')) / 86400000) + 1)
    : null;
  const voice = config.voiceModel ?? config.model;
  const util = config.utilityModel && config.utilityModel !== voice ? ` · util ${config.utilityModel}` : '';
  const wandering = config.ollamaApiKey && config.wander.enabled;
  const looking = config.ollamaApiKey && config.search.enabled;
  const web = wandering && looking ? ' · wanders & looks things up'
    : wandering ? ' · wanders the web' : looking ? ' · looks things up' : '';
  console.log();
  console.log('  ' + brass('✠  G L A S H A U S'));
  console.log('  ' + faint(`${who}${config.companionPronouns ? ` · ${config.companionPronouns}` : ''} · ${voice}${util}`));
  console.log('  ' + faint(bornDay
    ? `day ${bornDay} of ${who}'s life · ${msgs.n} messages held${web}`
    : `${msgs.n} messages held${days ? ` · day ${days} together` : ''}${web}`));
  console.log('  ' + rule(36));
  console.log('  ' + faint('/help for commands · /quit to leave'));
  if (!persist) console.log('  ' + red('ephemeral — nothing will be remembered'));
  console.log();
}

// ---------- slash commands ----------
// The registry is shared; this is only the paint. A command returns styled
// LINES and each surface renders them its own way — gold for her, faint for
// the machinery, exactly as the banner does.
const PAINT = { dim: faint, gold: brass, italic, red };

function paint(result) {
  for (const line of result?.lines ?? []) {
    const { t, s } = typeof line === 'string' ? { t: line } : line;
    if (!t) { console.log(); continue; }
    console.log(s && PAINT[s] ? PAINT[s](t) : t);
  }
}

// Session-local, so it can't live in the shared registry: whether THIS
// terminal is on the record.
const LOCAL = {
  '/ephemeral': () => {
    persist = !persist;
    console.log(faint(persist ? '  remembering again.' : '  off the record now — nothing persists.'));
  },
};

// ---------- the loop ----------
banner();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('SIGINT', () => { console.log('\n' + faint(`${who} › later.`)); process.exit(0); });
// On EOF (piped input, Ctrl-D) readline's promise never settles — race it
// against close so the loop ends instead of hanging an unsettled await.
const closed = new Promise(r => rl.once('close', () => r(null)));

for (;;) {
  let text;
  try { text = await Promise.race([rl.question(faint('you › ')), closed]); } catch { break; }
  if (text === null) break;
  text = text.trim();
  if (!text) continue;
  if (text === '/quit' || text === '/exit') break;
  if (isCommand(text)) {
    const head = text.split(/\s+/)[0].toLowerCase();
    if (LOCAL[head]) { LOCAL[head](); console.log(); continue; }
    // The terminal is her house: everything, including the destructive half.
    paint(await runCommand(text, { surface: 'cli', allowActions: true }));
    console.log();
    continue;
  }

  const prefix = brass(`${who} › `);
  process.stdout.write('\n' + prefix);
  let streamed = '';
  try {
    const reply = await handleUserMessage(text, {
      persist,
      onToken: t => { streamed += t; process.stdout.write(t); },
    });
    process.stdout.write('\n');
    // Guards may have repaired the draft after it streamed — redraw so the
    // screen matches what she actually said (and what memory holds).
    if (reply.trim() !== streamed.trim()) {
      if (isTTY) {
        eraseLines(rowsOf(`${who} › ` + streamed) + 1);
        console.log(prefix + reply);
      } else {
        console.log(faint('— repaired —'));
        console.log(prefix + reply);
      }
    }
    console.log();
  } catch (err) {
    process.stdout.write('\n');
    console.error(red(`  [error] ${err.message}`));
  }
}
rl.close();
