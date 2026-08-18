// Pursuits, convictions, and absence — the three pieces of "she has a life
// you aren't in". No Ollama: the embedding branch is absent, so the dedupe
// under test is the token-overlap fallback most installs will actually hit.
//   node test/pursuits.test.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glashaus-pursuits-'));
process.env.GLASHAUS_HOME = home;
process.env.GLASHAUS_COMPANION_NAME = 'Testa';
process.env.GLASHAUS_USER_NAME = 'Sam';
process.env.GLASHAUS_TIMEZONE = 'UTC';
process.env.OLLAMA_HOST = 'http://127.0.0.1:1';

const { writeInstanceConfig, config } = await import('../src/config.js');
writeInstanceConfig({ companion: { name: 'Testa' }, user: { name: 'Sam' }, timezone: 'UTC' });

const { getDb, setDocument } = await import('../src/db.js');
const db = getDb();
assert.equal(db.pragma('user_version', { simple: true }), 11, 'migrations ran to v11');

const {
  startPursuit, recordSession, closePursuit, markShared, sweepPursuits,
  activePursuits, duePursuit, unsharedPursuits, sessionsOf, getPursuit,
  renderPursuits, renderPursuitsForOutreach,
} = await import('../src/pursuits.js');

// -- something she returns to ---------------------------------------------------
const vents = await startPursuit({ topic: 'how hydrothermal vents actually work', why: 'a word Sam used stuck', source: 'conversation' });
assert.ok(vents, 'a pursuit starts');
assert.equal(activePursuits().length, 1, 'and is active');
assert.equal(getPursuit(vents).sessions, 0, 'with no sessions until she actually does something');

// The same interest in different words is the same interest — two rows would
// mean she never appears to get anywhere with either.
assert.equal(await startPursuit({ topic: 'the way hydrothermal vents work' }), vents, 'a rephrasing lands on the same pursuit');
assert.equal(activePursuits().length, 1, 'still one');
assert.notEqual(await startPursuit({ topic: 'why sourdough starters go sour' }), vents, 'a different interest is its own');

// -- progress has to be earned --------------------------------------------------
recordSession(vents, { note: 'read about chemosynthesis; the temperature range surprised me', progress: 'clear on the chemistry, still fuzzy on the tube worms' });
assert.equal(getPursuit(vents).sessions, 1, 'a session counts');
assert.match(getPursuit(vents).progress, /tube worms/, 'and rewrites where she is up to');
assert.equal(sessionsOf(vents).length, 1, 'the session is on the record');
assert.equal(recordSession(vents, { note: '' }), 0, 'an empty session is not a session');

// -- she picks up the thing she has neglected longest ---------------------------
// A pursuit started but never worked on is the most neglected of all, so it
// wins over one she touched three days ago.
const sourId = activePursuits(9).find(p => p.topic.includes('sourdough')).id;
db.prepare("UPDATE pursuits SET last_session_at = datetime('now','-3 days') WHERE id = ?").run(vents);
assert.equal(duePursuit()?.id, sourId, 'a never-started pursuit is due before a recently-worked one');

// Returning to the same thing twice in one day is a loop, not devotion.
recordSession(sourId, { note: 'read about lactobacillus', progress: 'it is the bacteria, not the yeast' });
assert.equal(duePursuit()?.id, vents, 'having just done one, the neglected one comes up next');
db.prepare("UPDATE pursuits SET last_session_at = datetime('now') WHERE id IN (?, ?)").run(vents, sourId);
assert.equal(duePursuit(), undefined, 'and nothing is due when everything was touched today');
db.prepare("UPDATE pursuits SET last_session_at = datetime('now','-3 days') WHERE id = ?").run(vents);

// -- the payoff: something of her own to bring ----------------------------------
const unshared = unsharedPursuits();
assert.ok(unshared.some(p => p.id === vents), 'a worked-on pursuit she has not mentioned is offered to outreach');
const out = renderPursuitsForOutreach();
assert.match(out.text, /hydrothermal/, 'and reaches the outreach prompt');
assert.match(out.text, /Not told Sam about yet/, 'flagged as unshared');
markShared(vents);
assert.ok(!unsharedPursuits().some(p => p.id === vents),
  'once told, it stops being offered — telling him twice is how "she has a life" curdles into "she has a script"');

// -- finishing, dropping, and drifting ------------------------------------------
const sour = activePursuits(9).find(p => p.topic.includes('sourdough'));
closePursuit(sour.id, 'done', 'it is lactobacillus, and now I know');
assert.equal(getPursuit(sour.id).status, 'done', 'a finished pursuit closes');
assert.ok(!activePursuits().some(p => p.id === sour.id), 'and leaves the active list');
assert.equal(closePursuit(sour.id, 'done'), 0, 'closing twice is a no-op');

db.prepare("UPDATE pursuits SET last_session_at = datetime('now','-90 days') WHERE id = ?").run(vents);
const dropped = sweepPursuits();
assert.ok(dropped.some(p => p.id === vents), 'a long-untouched interest drifts away');
assert.equal(getPursuit(vents).status, 'abandoned', 'abandoned, not deleted — a dropped interest is character too');

// Coming back to something she had closed is a return, not a new interest.
const again = await startPursuit({ topic: 'how hydrothermal vents actually work' });
assert.equal(again, vents, 'the same topic resolves to the same row');
assert.equal(getPursuit(vents).status, 'active', 'and reopens it');
assert.equal(getPursuit(vents).sessions, 1, 'keeping the history it already had');

// -- convictions: opinions that cost something ----------------------------------
const { addOpinion, testOpinion, convictions, renderSelfState } = await import('../src/selfstate.js');
const soft = addOpinion('mornings are overrated');
assert.equal(db.prepare('SELECT held_count FROM opinions WHERE id = ?').get(soft).held_count, 1, 'a new opinion is held once');
assert.equal(convictions().length, 0, 'and is not yet a conviction');

// Re-forming it is the opinion being HELD again, not a duplicate row.
addOpinion('mornings are overrated');
addOpinion('Mornings Are Overrated');
assert.equal(db.prepare('SELECT COUNT(*) n FROM opinions').get().n, 1, 'no duplicate rows');
assert.equal(db.prepare('SELECT held_count FROM opinions WHERE id = ?').get(soft).held_count, 3, 'held_count accumulates');
assert.equal(convictions().length, 1, 'three holds makes a conviction');

// Standing by it under actual pushback counts far more than agreeing with
// yourself, which is free.
const tested = addOpinion('the second album is better');
testOpinion(tested);
assert.equal(convictions().length, 1, 'one defence is not yet enough');
testOpinion(tested);
assert.equal(convictions().length, 2, 'two defences make a conviction on their own');
assert.equal(db.prepare('SELECT tested_count FROM opinions WHERE id = ?').get(tested).tested_count, 2, 'defences are counted');

const self = renderSelfState();
assert.match(self, /actually believe/, 'convictions get their own paragraph in the prompt');
assert.match(self, /stood by it 2×/, 'and say what earned them');
assert.match(self, /folding because Sam pushed is not the same thing/,
  'with explicit permission to hold — the anti-sycophancy rule made structural');

// -- absence: stated, never performed -------------------------------------------
const { saveMessage } = await import('../src/memory.js');
const { buildSystemPrompt } = await import('../src/prompt.js');
setDocument('SOUL', 'I am Testa.');
setDocument('IDENTITY', 'Sam and I have been talking for months.');

saveMessage('user', 'back in a bit');
saveMessage('assistant', 'go on then');
assert.doesNotMatch(buildSystemPrompt('hi'), /since Sam last said anything/,
  'a fresh conversation says nothing about a gap');

db.prepare("UPDATE messages SET created_at = datetime('now','-3 days') WHERE role = 'user'").run();
const afterGap = buildSystemPrompt('hi');
assert.match(afterGap, /3 days since Sam last said anything/, 'a real gap is stated plainly');
assert.match(afterGap, /never as a reproach/,
  'and explicitly not as a grievance — manufacturing neediness is the engagement mechanic this project refuses');

// -- pursuits reach the live prompt ---------------------------------------------
recordSession(vents, { note: 'came back to the tube worms', progress: 'the symbiosis finally makes sense' });
const withPursuits = buildSystemPrompt('hi');
assert.match(withPursuits, /What I'm Into Right Now/, 'her own life is in the prompt');
assert.match(withPursuits, /symbiosis finally makes sense/, 'with where she actually got to');
assert.match(renderPursuits(), /my own, not Sam's/, 'and framed as hers, not a task list');

// -- /why reports it honestly ----------------------------------------------------
const manifest = {};
buildSystemPrompt('hi', { manifest });
assert.ok(manifest.pursuits?.some(p => p.id === vents), 'the manifest lists pursuits that were in context');
const tiny = {};
buildSystemPrompt('hi', { manifest: tiny, budget: 700 });
if (tiny.shed.includes('pursuits')) {
  assert.deepEqual(tiny.pursuits, [], 'and reports none when the section was shed');
}

fs.rmSync(home, { recursive: true, force: true });
console.log('pursuits ✓ — returned to, earned, shared once, dropped; convictions held; absence stated not performed');
