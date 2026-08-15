// The shared slash-command registry. Exercises the read half and the safety
// rails on the action half — no Ollama, so no command that needs a model is
// actually run here.
//   node test/commands.test.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glashaus-commands-'));
process.env.GLASHAUS_HOME = home;
process.env.GLASHAUS_COMPANION_NAME = 'Testa';
process.env.GLASHAUS_USER_NAME = 'Sam';
process.env.GLASHAUS_TIMEZONE = 'UTC';
process.env.OLLAMA_HOST = 'http://127.0.0.1:1';

const { writeInstanceConfig } = await import('../src/config.js');
writeInstanceConfig({ companion: { name: 'Testa' }, user: { name: 'Sam' }, timezone: 'UTC' });

const { getDb } = await import('../src/db.js');
const db = getDb();
const { runCommand, isCommand, commandList, renderPlain, resolveCommand } = await import('../src/commands.js');
const { addFact, saveMessage } = await import('../src/memory.js');
const { openThread, answerThread } = await import('../src/threads.js');

const text = r => renderPlain(r);

// -- recognition ----------------------------------------------------------------
assert.ok(isCommand('/help'), 'a slash is a command');
assert.ok(!isCommand('what do you know about me?'), 'ordinary speech is not');

// -- reads ------------------------------------------------------------------------
addFact({ category: 'user', content: 'Sam keeps bees on the roof', importance: 6 });
saveMessage('user', 'hello');
saveMessage('assistant', 'hey you');
await openThread({ topic: 'whether to sell the truck' });
const t = await openThread({ topic: 'how the interview went' });
answerThread(t, { note: 'she got it' });

assert.match(text(await runCommand('/facts')), /bees/, '/facts reports what she knows');
assert.match(text(await runCommand('/facts bees')), /bees/, '/facts filters');
assert.match(text(await runCommand('/threads')), /sell the truck/, '/threads lists what is open');
assert.doesNotMatch(text(await runCommand('/threads')), /interview/,
  '/threads hides settled ones by default — the open list is the useful one');
assert.match(text(await runCommand('/threads all')), /interview/, '/threads all shows them');
assert.match(text(await runCommand('/status')), /threads: 1 open · 1 settled/, '/status counts both');
assert.match(text(await runCommand('/status')), /guards \(7d\): none/, '/status reports a clean guard log');
assert.match(text(await runCommand('/why')), /no reply recorded yet/, '/why is honest when there is nothing');
assert.match(text(await runCommand('/help')), /what I know/, '/help lists the read half');

// Telegram sends /cmd@botname — the handle must not break the match.
assert.match(text(await runCommand('/threads@testa_bot')), /sell the truck/, 'the bot handle is stripped');

// -- unknown commands ---------------------------------------------------------------
const unknown = await runCommand('/nonsense');
assert.equal(unknown.unknown, true, 'an unknown command says so');
assert.match(text(unknown), /no such command/, 'and points at /help');

// -- the action gate ------------------------------------------------------------------
const gated = await runCommand('/tidy', { allowActions: false });
assert.equal(gated.ok, false, 'a read-only surface refuses actions');
assert.match(text(gated), /read-only/, 'and explains why');
assert.doesNotMatch(text(await runCommand('/help', { allowActions: false })), /what I do/,
  'a read-only surface does not advertise what it will not run');

// -- destructive commands want the word --------------------------------------------------
const dry = await runCommand('/redact-last');
assert.match(text(dry), /repeat as: \/redact-last confirm/, 'redaction previews before it acts');
assert.equal(db.prepare('SELECT COUNT(*) n FROM messages WHERE redacted = 1').get().n, 0,
  'and nothing was redacted by the preview');
await runCommand('/redact-last confirm');
assert.equal(db.prepare('SELECT COUNT(*) n FROM messages WHERE redacted = 1').get().n, 2,
  'with the word, it acts');

assert.match(text(await runCommand('/soul revert')), /Repeat as/, '/soul revert is guarded too');

// ...and `confirm` is a keyword only for the commands that need it. Stripping
// it from every argument silently breaks searches.
addFact({ category: 'user', content: 'Sam needs to confirm the dentist booking on Friday', importance: 4 });
assert.doesNotMatch(text(await runCommand('/facts confirm')), /bees/,
  '/facts confirm searches for "confirm" instead of dropping the filter');
assert.match(text(await runCommand('/facts confirm')), /dentist/, 'and finds it');
assert.match(text(await runCommand('/facts needs to confirm the')), /dentist/,
  'confirm inside a longer query survives intact');

// -- a thrown error never escapes into the surface -------------------------------------
const { COMMANDS } = await import('../src/commands.js');
COMMANDS['/facts'].run = () => { throw new Error('boom'); };
const thrown = await runCommand('/facts');
assert.equal(thrown.ok, false, 'a throwing command returns a result');
assert.match(text(thrown), /boom/, 'naming the failure');
COMMANDS['/facts'].run = async () => { throw 'not an Error'; };
assert.match(text(await runCommand('/facts')), /not an Error/,
  'and a non-Error rejection does not render as "undefined"');

// -- the menu Telegram publishes ----------------------------------------------------------
const list = commandList();
assert.ok(list.length >= 10, 'the command menu is populated');
// Telegram strips anything outside [a-z0-9_] when publishing the menu, so the
// stripped form of every command has to resolve back to a real command.
for (const c of list) {
  const telegramName = '/' + c.command.replace(/[^a-z0-9_]/g, '');
  assert.ok(resolveCommand(telegramName),
    `${telegramName} (Telegram's rendering of /${c.command}) must resolve`);
}
assert.ok(resolveCommand('/threads@testa_bot'), 'resolution strips the bot handle');
assert.equal(resolveCommand('/nonsense'), null, 'and refuses what does not exist');

// `/dream` reads, `/dream now` acts — the read-only gate has to see the
// difference, which the scope tag alone cannot express.
const dreamRead = await runCommand('/dream', { allowActions: false });
assert.doesNotMatch(text(dreamRead), /read-only/, '/dream still reads on a read-only surface');
assert.match(text(await runCommand('/dream now', { allowActions: false })), /read-only/,
  '/dream now does not');
assert.ok(commandList({ allowActions: false }).every(c => c.scope === 'read'),
  'the read-only menu hides the action half');

// -- a failing command must not throw into the surface ---------------------------------------
const broken = await runCommand('/wander'); // no API key in this instance
assert.equal(typeof broken?.ok, 'boolean', 'a refused action still returns a result');
assert.match(text(broken), /API key/, 'and says what is missing');

fs.rmSync(home, { recursive: true, force: true });
console.log('commands ✓ — shared registry reads, gates actions, and guards the destructive half');
