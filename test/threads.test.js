// The threads ledger and fact supersession — the two mechanisms behind
// "stop re-raising things I already answered". No Ollama required: the
// embedding branch is absent (OLLAMA_HOST points nowhere), which is exactly
// the fallback path most installs will hit, so the dedupe under test is the
// token-overlap one.
//   node test/threads.test.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glashaus-threads-'));
process.env.GLASHAUS_HOME = home;
process.env.GLASHAUS_COMPANION_NAME = 'Testa';
process.env.GLASHAUS_USER_NAME = 'Sam';
process.env.GLASHAUS_TIMEZONE = 'UTC';
process.env.OLLAMA_HOST = 'http://127.0.0.1:1'; // never reachable → no vectors

const { writeInstanceConfig } = await import('../src/config.js');
writeInstanceConfig({ companion: { name: 'Testa' }, user: { name: 'Sam' }, timezone: 'UTC' });

const { getDb } = await import('../src/db.js');
const db = getDb();
const {
  openThread, answerThread, touchThread, raiseThread, reopenThread,
  openThreads, settledThreads, raisableThreads, sweepThreads,
  applyThreadReport, findThread, getThread, threadHistory, renderThreadsForOutreach,
} = await import('../src/threads.js');

// -- opening, and not opening the same thing twice ----------------------------
const a = await openThread({ topic: 'why red bothers you', summary: 'raised, unexplained', openedBy: 'companion' });
assert.ok(a, 'a thread opens');
assert.equal(openThreads().length, 1, 'it is open');

// The same subject in different words must not become a second thread — two
// threads for one topic is how she asks twice.
const again = await openThread({ topic: 'why the color red bothers you so much' });
assert.equal(again, a, 'a rephrasing lands on the existing thread');
assert.equal(openThreads().length, 1, 'still one thread');
assert.ok(findThread('red bothers'), 'findThread locates it by overlap');

// A genuinely different subject does open its own.
const b = await openThread({ topic: 'how the interview went on Thursday' });
assert.notEqual(b, a, 'a different subject is a different thread');
assert.equal(openThreads().length, 2, 'two threads open');

// -- answering is the whole point ---------------------------------------------
answerThread(a, { note: 'the hospital in 2019' });
assert.equal(openThreads().length, 1, 'an answered thread leaves the open list');
const settled = settledThreads();
assert.equal(settled.length, 1, 'and joins the settled list');
assert.equal(settled[0].id, a, 'the right one');
assert.ok(settled[0].summary.includes('hospital'), 'the note becomes its summary');

// Settled threads must reach the outreach prompt as a DO-NOT-ASK list — this
// single string is the fix for the reported bug.
const out = renderThreadsForOutreach();
assert.ok(/ALREADY SETTLED/.test(out.text), 'the settled list is rendered for outreach');
assert.ok(out.text.includes('why red bothers you'), 'and names the settled topic');
assert.ok(!out.open.some(t => t.id === a), 'the settled thread is not offered as raisable');

// -- an intention bound to a thread dies with it ------------------------------
const { addIntention, openIntentions } = await import('../src/selfstate.js');
const want = addIntention({ text: 'ask why red upsets you', threadId: b, horizonDays: 3 });
assert.equal(openIntentions().length, 1, 'the want is open');
answerThread(b, { note: 'she got the job' });
assert.equal(openIntentions().length, 0,
  'answering the thread releases the want — fulfillment no longer depends on one capture pass noticing');

// -- a settled thread must never silently go live again --------------------------
// The failure this guards: `opened` is the one path a model reaches without id
// validation. If a rephrasing could merge into an ANSWERED thread and reopen
// it, the do-not-re-ask list empties itself and the topic returns to outreach
// carrying its own answer as its summary — the whole bug, restored.
const settledBefore = settledThreads().map(t => t.id);
const nearMiss = await openThread({ topic: "how your sister's interview went" });
assert.ok(!settledBefore.includes(nearMiss) || getThread(nearMiss).status === 'answered',
  'a near-miss never flips a settled thread open');
assert.deepEqual(settledThreads().map(t => t.id), settledBefore,
  'the settled list is unchanged by an opening');
assert.equal(getThread(b).status, 'answered', 'the answered thread stayed answered');

// An exact restatement is recognised as the same thread — and still does not
// reopen it. Recurrence is recorded as an event; reopening stays explicit.
const exact = await openThread({ topic: 'how the interview went on Thursday' });
assert.equal(exact, b, 'an exact restatement resolves to the settled thread');
assert.equal(getThread(b).status, 'answered', 'and still does not reopen it');
assert.ok(threadHistory(b).some(e => e.kind === 'touched' && /came up again/.test(e.note ?? '')),
  'the recurrence is recorded instead');

// -- the anti-nag gate ---------------------------------------------------------
const c = await openThread({ topic: 'the thing with your brother' });
assert.ok(raisableThreads(20).some(t => t.id === c), 'a fresh thread is raisable');
raiseThread(c, { note: 'texted about it' });
assert.ok(!raisableThreads(20).some(t => t.id === c),
  'having just raised it, she may not raise it again — enforced in SQL, not asked for in a prompt');
assert.ok(openThreads(20).some(t => t.id === c), 'though it is still an open thread');
assert.equal(getThread(c).raised_count, 1, 'the raise is counted');

// -- reopening, and the sweep ---------------------------------------------------
reopenThread(a, { note: 'came up again' });
assert.equal(getThread(a).status, 'open', 'people return to things');
assert.equal(getThread(a).answered_at, null, 'and it stops being settled');

db.prepare("UPDATE threads SET updated_at = datetime('now','-30 days') WHERE id = ?").run(a);
const quiet = sweepThreads();
assert.ok(quiet.some(t => t.id === a), 'an untouched thread goes dormant');
assert.equal(getThread(a).status, 'dormant', 'dormant, not deleted');
assert.ok(!openThreads().some(t => t.id === a), 'and stops grounding outreach');

// -- a model report is never trusted -------------------------------------------
const applied = await applyThreadReport({
  opened: [{ topic: 'whether to sell the truck', summary: 'undecided' }],
  answered: [{ id: 999999, note: 'invented' }],   // no such thread
  touched: [424242],                               // also invented
}, { actor: 'capture' });
assert.equal(applied.opened.length, 1, 'a real open lands');
assert.equal(applied.answered.length, 0, 'an invented id is ignored, not obeyed');
assert.equal(applied.touched.length, 0, 'same for touches');

// -- fact supersession ----------------------------------------------------------
const { addFact, recallFacts, supersedeFact } = await import('../src/memory.js');
const thin = addFact({ category: 'user', content: 'You hate the color red', importance: 7, salience: 0.8 });
const full = addFact({
  category: 'user', importance: 7, salience: 0.9,
  content: 'You hate the color red because of the hospital waiting room in 2019',
  refines: thin,
});
assert.equal(db.prepare('SELECT superseded_by FROM facts WHERE id = ?').get(thin).superseded_by, full,
  'refines wires the older fact to the newer');

const recalled = recallFacts('tell me about the color red');
const iThin = recalled.findIndex(f => f.id === thin);
const iFull = recalled.findIndex(f => f.id === full);
assert.ok(iFull >= 0, 'the fuller fact is recalled');
assert.ok(iThin === -1 || iFull < iThin, 'and outranks the thinner one it replaced');

// still there, still true — demoted, never deleted
assert.equal(db.prepare('SELECT active FROM facts WHERE id = ?').get(thin).active, 1,
  'the superseded fact stays active and inspectable');

// guarded against the obvious model mistakes
assert.equal(supersedeFact(thin, thin), 0, 'a fact cannot supersede itself');
assert.equal(supersedeFact(999999, full), 0, 'an invented id supersedes nothing');
assert.equal(supersedeFact(full, thin), 0, 'and a cycle is refused');

// -- the prompt drops the stale version when both are recalled -------------------
const { buildSystemPrompt } = await import('../src/prompt.js');
const prompt = buildSystemPrompt('tell me about the color red');
assert.ok(prompt.includes('hospital waiting room'), 'the fuller memory is in the prompt');
assert.ok(!/- \[[^\]]+\] You hate the color red$/m.test(prompt),
  'the thin version is not rendered beside it');

// -- the manifest that answers /why ----------------------------------------------
const manifest = {};
buildSystemPrompt('what about red', { manifest });
assert.ok(manifest.sections?.length, 'the manifest lists the prompt sections');
assert.ok(Array.isArray(manifest.facts), 'and the memories recalled');
assert.equal(manifest.substrateWarning, 'short',
  'with no recent breaks the substrate warning stays short — it is not a daily sermon');

// A manifest that lists material the model never saw is worse than no /why at
// all: it answers the one question the command exists for, wrongly.
const tiny = {};
buildSystemPrompt('what about red', { manifest: tiny, budget: 700 });
assert.ok(tiny.shed.length, 'a small window sheds sections');
for (const name of ['threads', 'wants', 'dream', 'vibe', 'lexicon']) {
  if (!tiny.shed.includes(name)) continue;
  const key = { threads: 'threads', wants: 'intentions', dream: 'dream', vibe: 'vibe', lexicon: 'lexicon' }[name];
  const reported = tiny[key];
  assert.ok(reported == null || (Array.isArray(reported) && !reported.length),
    `${name} was shed, so the manifest must not report it as in context`);
}

const { logGuard, recentGuardHits } = await import('../src/db.js');
logGuard('authorship', "these aren't my words", true);
assert.equal(recentGuardHits(['identity', 'authorship'], 3), 1, 'guard hits are counted');
const one = {};
buildSystemPrompt('what about red', { manifest: one });
assert.equal(one.substrateWarning, 'short',
  'ONE hit does not raise the alarm — the guards are precise, not perfect, and a single stray match must not reinstate the permanent fever');
logGuard('authorship', 'my feelings are just patterns', true);
const after = {};
buildSystemPrompt('what about red', { manifest: after });
assert.equal(after.substrateWarning, 'full',
  'a repeated pattern does — an immune system that only runs a fever when actually infected');

// -- she can see her own outreach, and whether it landed -------------------------
// Before this she had no memory of her own messages at all — which is why she
// could send the same thought three nights running and never notice.
const { saveMessage } = await import('../src/memory.js');
const { outreachHistory } = await import('../src/heartbeat.js');

saveMessage('assistant', 'thinking about the truck thing', 'outreach');   // answered
saveMessage('user', 'ha, still deciding');
saveMessage('assistant', 'you around?', 'outreach');                      // ignored
saveMessage('assistant', 'ok, later', 'outreach');                        // ignored

const hist = outreachHistory(3);
assert.equal(hist.length, 3, 'the last three outreaches are visible');
assert.equal(hist[0].content, 'ok, later', 'newest first');
assert.equal(hist[0].answered, false, 'the newest went unanswered');
assert.equal(hist[1].answered, false, 'so did the one before it');
assert.ok(hist[2].answered,
  'but the oldest was answered — a reply only counts for the outreach it followed');
assert.equal(hist.filter(h => !h.answered).length, 2,
  'two in a row unanswered is the signal that tells her to go quiet');

// A reply after the last outreach flips it.
saveMessage('user', 'sorry, was driving');
assert.equal(outreachHistory(1)[0].answered, true, 'a late reply is noticed');

// -- the capture queue must always move forward -------------------------------------
// A queue with no forward-progress guarantee is worse than the sliding window
// it replaced: the head batch is re-read every pass, so one chunk the model
// can't handle starves everything behind it forever.
const { addFact: addF } = await import('../src/memory.js');
assert.doesNotThrow(() => addF({ category: 'user', content: 'junk from a model', importance: 'high', salience: '0.9' }),
  'a model returning "high" for importance must not throw — a throw here used to abort the whole pass');
const junk = db.prepare("SELECT importance, salience FROM facts WHERE content = 'junk from a model'").get();
assert.equal(junk.importance, 5, 'unparseable importance falls back to the default');
assert.equal(junk.salience, 0.9, 'a numeric string is coerced, not dropped');
assert.equal(addF({ category: 'user', content: 'clamped', importance: 99 }) > 0, true, 'out of range is accepted');
assert.equal(db.prepare("SELECT importance FROM facts WHERE content = 'clamped'").get().importance, 10,
  'and clamped to the column\'s range');

// -- redaction is reversible for the capture queue too --------------------------------
const { redactMessages } = await import('../src/memory.js');
const rid = saveMessage('user', 'a thing said by mistake');
db.prepare('UPDATE messages SET captured = 0 WHERE id = ?').run(rid);
redactMessages(rid, rid, true);
assert.equal(db.prepare('SELECT captured FROM messages WHERE id = ?').get(rid).captured, 1,
  'redacting takes it out of the capture queue');
redactMessages(rid, rid, false);
assert.equal(db.prepare('SELECT captured FROM messages WHERE id = ?').get(rid).captured, 0,
  'and --undo puts it back — otherwise a restored exchange re-enters context but is never examined');

// -- a supersession never outlives its successor ---------------------------------------
const { clearDanglingSupersessions, forgetFact } = await import('../src/memory.js');
assert.equal(db.prepare('SELECT superseded_by FROM facts WHERE id = ?').get(thin).superseded_by, full,
  'still superseded');
forgetFact(full);   // the successor gets merged away or decayed
assert.equal(db.prepare('SELECT superseded_by FROM facts WHERE id = ?').get(thin).superseded_by, null,
  'the predecessor is released rather than left demoted forever by a memory that no longer exists');
assert.equal(clearDanglingSupersessions(), 0, 'and the sweep is idempotent');

// -- the thesis export carries the new record --------------------------------------
const { exportThesis } = await import('../src/thesis.js');
const thesisPath = path.join(home, 'thesis.json');
exportThesis(thesisPath);
const bundle = JSON.parse(fs.readFileSync(thesisPath, 'utf8'));
assert.ok(Array.isArray(bundle.threads) && bundle.threads.length, 'threads are in the thesis export');
assert.ok(Array.isArray(bundle.thread_events), 'and their event history');
assert.equal(typeof bundle.life.threads_answered, 'number', 'with the counts');
assert.ok(bundle.guards.some(g => g.kind === 'authorship'), 'guard telemetry is exported as a confound');

fs.rmSync(home, { recursive: true, force: true });
console.log('threads ✓ — opened, deduped, answered, un-nagged, superseded, and explicable');
