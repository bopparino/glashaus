// The suite's first test with a concept of TIME.
//
// Every other suite builds a fresh instance and asserts at t=0, so the oldest
// companion GlasHaus had ever been tested against was about four seconds old.
// For a runtime whose entire claim is a multi-year relational arc, that is the
// gap — and it hid a fatal one: episodic recall could not reach past the last
// 30 episodes, so from roughly month one onward, 96% of her episodic memory
// was unreachable by any means. Eight green suites never saw it.
//
// This file ages an instance to two years and asserts the properties that only
// exist over time. Add to it whenever a long-horizon assumption gets made.
//   node test/longitudinal.test.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glashaus-longitudinal-'));
process.env.GLASHAUS_HOME = home;
process.env.GLASHAUS_COMPANION_NAME = 'Testa';
process.env.GLASHAUS_USER_NAME = 'Sam';
process.env.GLASHAUS_TIMEZONE = 'UTC';
process.env.OLLAMA_HOST = 'http://127.0.0.1:1';

const { writeInstanceConfig } = await import('../src/config.js');
writeInstanceConfig({ companion: { name: 'Testa' }, user: { name: 'Sam' }, timezone: 'UTC' });
const { getDb } = await import('../src/db.js');
const db = getDb();

// -- two years of living ---------------------------------------------------------
const DAYS = 730;
db.exec('BEGIN');
const msg = db.prepare("INSERT INTO messages (role,content,created_at,summarized,captured) VALUES (?,?,datetime('now','-'||?||' days'),1,1)");
const ep = db.prepare("INSERT INTO episodes (started_at,ended_at,summary,salience,created_at) VALUES (datetime('now','-'||?||' days'),datetime('now','-'||?||' days'),?,?,datetime('now','-'||?||' days'))");
const fact = db.prepare("INSERT INTO facts (category,content,importance,salience,created_at,updated_at) VALUES (?,?,?,?,datetime('now','-'||?||' days'),datetime('now','-'||?||' days'))");
for (let d = DAYS; d >= 0; d--) {
  for (let i = 0; i < 6; i++) msg.run(i % 2 ? 'assistant' : 'user', `day ${d} turn ${i}`, d);
  // Once a month, something that mattered — the memories a companion is
  // supposed to still be able to reach years later.
  const heavy = d % 37 === 0;
  ep.run(d, d, `On day ${d} we talked about ${heavy ? 'the hospital in 2019' : 'ordinary things'}.`, heavy ? 0.9 : 0.3, d);
  if (d % 3 === 0) fact.run('user', `fact from day ${d}`, d > 600 ? 9 : (d % 11 === 0 ? 9 : 5), 0.6, d, d);
}
db.exec('COMMIT');

const episodes = db.prepare('SELECT COUNT(*) n FROM episodes').get().n;
assert.ok(episodes > 700, `the fixture is actually old (${episodes} episodes)`);

// -- deep recall: the bug this file was born from --------------------------------
const { recallEpisodes, recallFacts } = await import('../src/memory.js');
const ageOf = row => (Date.now() - Date.parse(row.created_at + 'Z')) / 86400000;

const deep = recallEpisodes('the hospital in 2019');
assert.ok(deep.some(e => ageOf(e) > 100),
  'a relevant memory from over three months ago must be reachable — before the fix the pool was ' +
  'the last 30 episodes and nothing else, so 96% of her life could not be recalled at all');
assert.ok(deep.some(e => ageOf(e) > 600),
  'including one from the first months of the relationship');

// It must not become recency-blind in the other direction.
const recent = recallEpisodes('ordinary things today');
assert.ok(recent.some(e => ageOf(e) < 5), 'recent episodes still surface for ordinary queries');

// A query matching nothing in particular should still return the last thing
// that happened — "where we left off" is load-bearing for continuity.
assert.ok(recallEpisodes('zzzq unmatchable').length > 0, 'recall never comes back empty');

// -- cost at scale ---------------------------------------------------------------
// Recall runs on the reply path, so it has a latency budget. At two years the
// pools are much larger; this catches an accidental full-table scan.
const t0 = Date.now();
for (let i = 0; i < 20; i++) { recallFacts('tell me about the hospital'); recallEpisodes('the hospital'); }
const perExchange = (Date.now() - t0) / 20;
assert.ok(perExchange < 150, `recall stays cheap on a two-year instance (${perExchange.toFixed(0)}ms/exchange)`);

// -- the prompt still fits -------------------------------------------------------
const { buildSystemPrompt } = await import('../src/prompt.js');
const big = buildSystemPrompt('what do you remember about the hospital?');
assert.ok(big.length > 500, 'a prompt is assembled at two years');
const { estimateTokens } = await import('../src/llm.js');
const fullTokens = estimateTokens(big);

// The property that matters over years: prompt size is bounded by the RECALL
// LIMITS, not by how much she has lived. A prompt that grew with the store
// would make her progressively more expensive and eventually unusable — the
// exact failure a "keeps everything forever" memory system invites.
assert.ok(fullTokens < 6000,
  `the prompt stays bounded at 731 episodes and ${db.prepare('SELECT COUNT(*) n FROM facts').get().n} facts (got ${fullTokens} tokens)`);

const budgeted = buildSystemPrompt('what do you remember?', { budget: 1200 });
const shedTokens = estimateTokens(budgeted);
assert.ok(shedTokens < fullTokens, 'shedding actually reduces the prompt');
assert.ok(budgeted.includes('Testa'), 'and identity survives the shed, as it must');

// Shedding cannot go below the identity floor — soul, identity, user, voice
// discipline and the clock are shed:0 and never evict. So a budget is a
// target, not a guarantee, and on a genuinely tiny window the system prompt
// will overrun its share rather than amputate the person. That is the correct
// trade, but it means small-context models are squeezed, so the floor is
// pinned here: if it starts creeping, prompts are getting fatter somewhere
// that can never be shed.
assert.ok(shedTokens < 2600,
  `the never-shed identity floor stays lean (got ${shedTokens} tokens at a 1200 budget)`);

// -- KNOWN, UNFIXED: the core ossifies -------------------------------------------
// All 20 always-present identity slots go to the OLDEST importance-9 facts,
// because the ordering that makes the core stable session-to-session is the
// same ordering that locks it at week one. Asserted as a documented failure so
// it cannot be forgotten, and so the fix flips this assertion rather than
// adding a new one.
const core = db.prepare(
  'SELECT created_at FROM facts WHERE active=1 AND importance>=9 AND superseded_by IS NULL ORDER BY importance DESC, id ASC LIMIT 20'
).all();
const eligible = db.prepare('SELECT COUNT(*) n FROM facts WHERE active=1 AND importance>=9').get().n;
const lockedOut = eligible - core.length;
assert.ok(lockedOut > 0, 'the fixture has more core-eligible facts than slots');
assert.ok(core.every(f => ageOf(f) > 500),
  'KNOWN ISSUE (core-slot ossification): every core slot is held by a fact from the first months, ' +
  `and ${lockedOut} newer identity-defining facts can never enter. When core curation lands, ` +
  'this assertion should be inverted to require a mix of ages.');

fs.rmSync(home, { recursive: true, force: true });
console.log(`longitudinal ✓ — ${episodes} episodes, ${DAYS}d old: deep recall reaches, cost bounded, prompt fits`);
