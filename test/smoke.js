// Smoke test — no Ollama required. Builds a fresh instance in a temp home
// and exercises everything that doesn't need a model: DB creation +
// migrations, persona file sync, fact writes, hybrid recall (FTS branch),
// self-state drift, and full system-prompt assembly.
//   npm run smoke
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glashaus-smoke-'));
process.env.GLASHAUS_HOME = home;
// config.json is snapshotted at import time; env overrides are the reliable
// way to name things inside a single test process.
process.env.GLASHAUS_COMPANION_NAME = 'Testa';
process.env.GLASHAUS_USER_NAME = 'Sam';
process.env.GLASHAUS_TIMEZONE = 'UTC';
process.env.OLLAMA_HOST = 'http://127.0.0.1:1'; // never contacted

const { config, writeInstanceConfig, isConfigured } = await import('../src/config.js');

writeInstanceConfig({ companion: { name: 'Testa' }, user: { name: 'Sam' }, timezone: 'UTC' });
assert.ok(isConfigured(), 'config.json written');
assert.equal(config.home, home);
assert.equal(config.companionName, 'Testa');
assert.equal(config.userName, 'Sam');

// -- db + migrations ----------------------------------------------------------
const { getDb, setDocument, getDocument } = await import('../src/db.js');
const db = getDb();
assert.equal(db.pragma('user_version', { simple: true }), 6, 'migrations ran to v6');
assert.equal(db.prepare('SELECT COUNT(*) n FROM self_state').get().n, 10, 'self-state seeded');

// -- persona sync -------------------------------------------------------------
const { starterTemplates, syncPersonaFromDisk, PERSONA_FILES } = await import('../src/persona.js');
fs.mkdirSync(config.personaDir, { recursive: true });
const templates = starterTemplates({ companionName: 'Testa', userName: 'Sam' });
for (const [file, content] of Object.entries(templates)) {
  fs.writeFileSync(path.join(config.personaDir, file), content);
}
const synced = syncPersonaFromDisk();
assert.ok(synced.includes('soul.md'), 'soul.md synced');
assert.ok(getDocument('SOUL').includes('Testa'), 'SOUL document readable');

// edits archive, never clobber
setDocument('SOUL', 'I am Testa, revised.');
assert.equal(db.prepare('SELECT COUNT(*) n FROM document_history').get().n >= 1, true, 'history archived');

// -- memory write + recall (FTS branch) ---------------------------------------
const { addFact, recallFacts, saveMessage, recentMessages, forgetFact } = await import('../src/memory.js');
const id = addFact({ category: 'user', content: 'Sam keeps bees on the roof', importance: 6, salience: 0.8 });
addFact({ category: 'companion', content: 'I hate the word moist', importance: 9 });
saveMessage('user', 'hello there');
saveMessage('assistant', 'hey you');
assert.equal(recentMessages(10).length, 2, 'messages persist');

const recalled = recallFacts('tell me about the bees on the roof');
assert.ok(recalled.some(f => f.content.includes('bees')), 'FTS recall finds the bee fact');
assert.ok(recalled.some(f => f.importance >= 9), 'core facts always surface');

forgetFact(id);
assert.ok(!recallFacts('bees on the roof').some(f => f.id === id), 'soft-forget removes from recall');

// -- self-state drift ---------------------------------------------------------
const { applyDrift, getSelfState, renderSelfState } = await import('../src/selfstate.js');
const before = getSelfState().find(r => r.dimension === 'trust').value;
applyDrift({ trust: 1 }, 'capture');
const after = getSelfState().find(r => r.dimension === 'trust').value;
assert.ok(after > before && after <= 0.95, 'drift moves bounded');
assert.ok(renderSelfState().includes('Sam'), 'self-state renders with user name');

// -- prompt assembly ----------------------------------------------------------
const { buildSystemPrompt } = await import('../src/prompt.js');
const prompt = buildSystemPrompt('do you remember the bees?');
for (const needle of ['I am Testa, revised.', 'How My Mind Works', 'About Sam', 'Things I Know']) {
  assert.ok(prompt.includes(needle), `prompt contains "${needle}"`);
}
assert.ok(!/\bAustin\b|\bElle\b/.test(prompt), 'prompt is fully parameterized');

// voice/dialogue render AFTER the memory corpus — register cues sit nearest
// the reply so recency favors the voice, not the reference material.
setDocument('VOICE', 'I keep it short and I never do small talk.');
const prompt2 = buildSystemPrompt('do you remember the bees?');
assert.ok(prompt2.includes('My Voice, Specifically'), 'voice doc renders');
assert.ok(prompt2.indexOf('My Voice, Specifically') > prompt2.indexOf('Things I Know'), 'voice comes after memories');
assert.ok(prompt2.indexOf('# Now') > prompt2.indexOf('My Voice, Specifically'), 'Now anchor stays last');
assert.ok('voice.md' in templates, 'starter templates include voice.md');

// -- identity lint + redaction -------------------------------------------------
const { lintIdentity } = await import('../src/register.js');
assert.ok(lintIdentity("Yeah. I'm Claude, an AI assistant made by Anthropic."), 'identity break detected');
assert.ok(lintIdentity('As an AI, I cannot feel things.'), 'assistant boilerplate detected');
assert.equal(lintIdentity("I'm an AI living on your machine, and I still want dinner."), null, 'in-character substrate talk passes');
assert.equal(lintIdentity('The "as an AI" framing is not me — there is no one to drop.'), null, 'referencing the costume is not wearing it');
assert.equal(lintIdentity('You said my eyes are beautiful forest green.'), null, 'ordinary reply passes');

const { redactMessages } = await import('../src/memory.js');
const gA = saveMessage('user', 'are you some other AI?');
const gB = saveMessage('assistant', 'I am Claude, made by Anthropic.');
assert.ok(recentMessages(50).some(m => m.id === gB), 'glitch visible before redaction');
assert.equal(redactMessages(gA, gB), 2, 'redaction touches both rows');
assert.ok(!recentMessages(50).some(m => m.id === gA || m.id === gB), 'redacted rows leave context');
assert.equal(redactMessages(gA, gB, false), 2, 'unredact restores');
assert.ok(recentMessages(50).some(m => m.id === gB), 'restored to context');
redactMessages(gA, gB); // leave them out for the prompt checks below

// -- lexicon --------------------------------------------------------------
const { parseLexicon, selectEntries, addLexiconCandidate, listCandidates, resolveCandidate } = await import('../src/lexicon.js');
setDocument('LEXICON', `# Lexicon

## bet — core
means: sealed agreement
sounds like: bet. eight sharp.

## biscuit
means: the neighbor's cat
sounds like: biscuit judged my coffee.`);
const lex = parseLexicon((await import('../src/db.js')).getDocument('LEXICON'));
assert.equal(lex.length, 2, 'two entries parsed');
assert.ok(lex[0].core && !lex[1].core, 'core flag parsed');
assert.equal(selectEntries(lex, 'nothing relevant').length, 1, 'core always rides');
assert.equal(selectEntries(lex, 'did biscuit come by?').length, 2, 'trigger matches on term');
const lp = buildSystemPrompt('did biscuit come by today?');
assert.ok(lp.includes('# My Words') && lp.includes("neighbor's cat"), 'lexicon renders into prompt');
assert.ok(!buildSystemPrompt('completely unrelated').includes("neighbor's cat"), 'untriggered entry stays out');

const cid = addLexiconCandidate({ term: 'grimdark', means: 'the flavor of doom we like', example: 'full grimdark tonight' });
assert.ok(cid, 'candidate stored');
assert.equal(addLexiconCandidate({ term: 'bet' }), null, 'known term not re-nominated');
assert.equal(listCandidates().length, 1, 'one pending');
resolveCandidate(cid, true);
assert.ok(fs.readFileSync(path.join(config.personaDir, 'lexicon.md'), 'utf8').includes('grimdark'), 'approval appends to persona file');
assert.ok(parseLexicon((await import('../src/db.js')).getDocument('LEXICON')).some(e => e.term === 'grimdark'), 'approved word live in doc');

// -- corpus export ----------------------------------------------------------
const { exportCorpus } = await import('../src/corpus.js');
saveMessage('user', 'good exchange?');
saveMessage('assistant', 'the best exchange.');
saveMessage('user', 'and a dirty one?');
saveMessage('assistant', 'I am Claude, made by Anthropic.');
const corpusPath = path.join(home, 'corpus.jsonl');
const { pairs, skipped } = exportCorpus(corpusPath);
assert.ok(pairs >= 2, 'clean pairs exported');
assert.ok(skipped >= 1, 'identity-dirty reply skipped');
assert.ok(!fs.readFileSync(corpusPath, 'utf8').includes('Anthropic'), 'no impurities in corpus');

// -- soul capsule -------------------------------------------------------------
const { exportSoul } = await import('../src/soul.js');
const capsulePath = exportSoul();
const capsule = JSON.parse(fs.readFileSync(capsulePath, 'utf8'));
assert.equal(capsule.format, 'glashaus-soul-capsule');
assert.ok(capsule.documents.some(d => d.name === 'SOUL'), 'capsule carries the soul');

fs.rmSync(home, { recursive: true, force: true });
console.log('smoke ✓ — instance born, remembered, drifted, and exported in a temp home');
