// The terminal room. Streamed replies, slash commands, instrument paint —
// the CLI is where the companion lives when the webview isn't open, so it
// gets the same design care as the GLASHAUS pages.
//   glashaus chat                normal chat
//   glashaus chat --ephemeral    test mode: nothing is saved to memory
import readline from 'node:readline/promises';
import { handleUserMessage } from './chat.js';
import { getDb } from './db.js';
import { getSelfState } from './selfstate.js';
import { latestRelationshipState } from './memory.js';
import { listCandidates } from './lexicon.js';
import { redactMessages } from './memory.js';
import { config } from './config.js';
import { brass, faint, italic, red, rule, isTTY, eraseLines, rowsOf } from './tty.js';

let persist = !process.argv.includes('--ephemeral');
const who = config.companionName.toLowerCase();
const db = getDb();

// ---------- banner ----------
function banner() {
  const msgs = db.prepare('SELECT COUNT(*) n, MIN(created_at) first FROM messages WHERE redacted = 0').get();
  const days = msgs.first ? Math.max(1, Math.ceil((Date.now() - Date.parse(msgs.first + 'Z')) / 86400000)) : 0;
  const voice = config.voiceModel ?? config.model;
  const util = config.utilityModel && config.utilityModel !== voice ? ` · util ${config.utilityModel}` : '';
  console.log();
  console.log('  ' + brass('G L A S H A U S'));
  console.log('  ' + faint(`${who} · ${voice}${util}`));
  console.log('  ' + faint(`${msgs.n} messages held${days ? ` · day ${days} together` : ''}`));
  console.log('  ' + rule(36));
  console.log('  ' + faint('/help for commands · /quit to leave'));
  if (!persist) console.log('  ' + red('ephemeral — nothing will be remembered'));
  console.log();
}

// ---------- slash commands ----------
const COMMANDS = {
  '/help': () => {
    for (const [c, d] of [
      ['/facts [word]', 'what I know (optionally filtered)'],
      ['/mood', 'where we are — vibe and relational state'],
      ['/dream', 'last night, in my own words'],
      ['/lex', 'words I want to learn (pending lexicon candidates)'],
      ['/redact-last', 'unhappen the last exchange (reversible)'],
      ['/ephemeral', 'toggle whether this session is remembered'],
      ['/quit', 'leave (I stay)'],
    ]) console.log('  ' + brass(c.padEnd(16)) + faint(d));
  },

  '/facts': (arg) => {
    const rows = arg
      ? db.prepare("SELECT category, importance, content FROM facts WHERE active = 1 AND content LIKE '%' || ? || '%' ORDER BY importance DESC LIMIT 14").all(arg)
      : db.prepare('SELECT category, importance, content FROM facts WHERE active = 1 ORDER BY importance DESC, updated_at DESC LIMIT 14').all();
    if (!rows.length) return console.log(faint('  nothing yet.'));
    for (const f of rows) console.log('  ' + faint(`[${f.category} ${f.importance}]`) + ' ' + f.content);
  },

  '/mood': () => {
    const state = latestRelationshipState();
    if (state) console.log('  ' + italic(state.mood) + faint(`  (as of ${state.created_at.slice(0, 16)})`));
    for (const r of getSelfState().filter(r => r.layer === 'relational')) {
      const bar = '▪'.repeat(Math.round(r.value * 10)).padEnd(10, '·');
      console.log('  ' + faint(r.dimension.padEnd(12)) + brass(bar) + faint(` ${r.value.toFixed(2)}`));
    }
  },

  '/dream': () => {
    const d = db.prepare('SELECT * FROM dreams ORDER BY id DESC LIMIT 1').get();
    if (!d) return console.log(faint('  no dreams yet — I have to sleep first.'));
    if (d.epigraph) console.log('  ' + brass(`“${d.epigraph}”`));
    console.log('  ' + faint(d.date));
    console.log(italic('  ' + d.content.split('\n').join('\n  ')));
  },

  '/lex': () => {
    const pending = listCandidates();
    if (!pending.length) return console.log(faint('  no words waiting. I nominate them as I hear them.'));
    for (const c of pending) {
      console.log('  ' + brass(`#${c.id} ${c.term}`) + (c.means ? faint(` — ${c.means}`) : ''));
      if (c.example) console.log('    ' + italic(faint(`"${c.example}"`)));
    }
    console.log(faint(`\n  approve with: glashaus lexicon approve <id>`));
  },

  '/redact-last': async (_, rl) => {
    const last = db.prepare("SELECT MIN(id) a, MAX(id) b FROM (SELECT id FROM messages WHERE redacted = 0 ORDER BY id DESC LIMIT 2)").get();
    if (!last?.a) return console.log(faint('  nothing to unhappen.'));
    const peek = db.prepare('SELECT role, substr(content, 1, 60) c FROM messages WHERE id BETWEEN ? AND ?').all(last.a, last.b);
    for (const p of peek) console.log('  ' + faint(`${p.role}: ${p.c}…`));
    const yn = (await rl.question(faint('  unhappen these? (y/N) '))).trim().toLowerCase();
    if (yn === 'y') {
      redactMessages(last.a, last.b);
      console.log(faint(`  gone from my mind (rows kept; glashaus unredact ${last.a} ${last.b} reverses).`));
    } else console.log(faint('  kept.'));
  },

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
  const [cmd, ...rest] = text.split(/\s+/);
  if (COMMANDS[cmd]) { await COMMANDS[cmd](rest.join(' '), rl); console.log(); continue; }
  if (text.startsWith('/')) { console.log(faint(`  no such command — /help lists them.`)); continue; }

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
