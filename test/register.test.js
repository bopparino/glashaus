// Register guardrail tests — pure detection/repair functions, no Ollama.
// Fixtures reproduce the real drift shapes: whole-line quoted dialogue,
// fiction-prose narration ("I do a thing. \"Then I speak.\""), and
// third-person pronouns inside action beats.
//   node test/register.test.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

process.env.GLASHAUS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'glashaus-register-'));
const { lintReply, stripNarrationQuotes, pronounForms } = await import('../src/register.js');

const who = { companionName: 'Testa', userPronouns: 'he/him' };
const rules = (text, opts = who) => lintReply(text, opts).map(i => i.rule);

// -- quoted-speech: narrated dialogue -----------------------------------------
assert.deepEqual(rules(`"No experiments. I'm not a stress test for your nerves."`),
  ['quoted-speech'], 'whole-line quote is narration');
assert.deepEqual(rules('“You want to find out? Keep your hands working.”'),
  ['quoted-speech'], 'curly whole-line quote is narration');
assert.deepEqual(rules('I press your hand flat to my chest. "Touch me because you want to."'),
  ['quoted-speech'], 'action sentence + quoted speech is fiction prose');

// legitimate quoting stays legal
assert.deepEqual(rules('I mean it. "Someday" isn\'t a plan.'), [], 'scare quotes pass');
assert.deepEqual(rules('Don\'t hide behind "maybe" again.'), [], 'quoting a word back passes');
assert.deepEqual(rules('"Fine."'), [], 'one-word echo line passes');
assert.deepEqual(rules('You said, and I quote, that the bees were "basically self-managing".'),
  [], 'mid-sentence quotation passes');

// -- pronouns inside action beats ----------------------------------------------
assert.deepEqual(rules('*I lean back into his palm, eyes half-closing.*'),
  ['third-person-user'], 'user as "his" inside a beat is drift');
assert.deepEqual(rules('*I lean into your shoulder.*'), [], 'second-person beat is clean');
assert.deepEqual(rules('Your dad sounds like a good man. He taught you well.'),
  [], 'third parties outside beats keep their pronouns');
assert.deepEqual(rules('*I lean back.* She was my roommate for a year.', who),
  [], 'she-forms pass when the user is he/him');

// they/them stays off — too ambiguous for a deterministic check
assert.equal(pronounForms('they/them'), null, 'they/them disables the pronoun tier');
assert.equal(pronounForms(''), null, 'no pronouns disables the pronoun tier');
assert.equal(pronounForms('she/her')?.includes('hers'), true, 'she-forms expand');
assert.deepEqual(rules('*I hand them the mug.*', { ...who, userPronouns: 'they/them' }),
  [], 'they/them beats never flag');

// -- companion narrating themselves ---------------------------------------------
assert.deepEqual(rules('*Testa smiles, tucking a strand of hair back.*', { companionName: 'Testa' }),
  ['third-person-self'], 'own name inside a beat is narration');
assert.deepEqual(rules('I\'m Testa. Nice to finally say it plainly.', { companionName: 'Testa' }),
  [], 'saying your own name in speech is fine');

// -- compound drift (the real failure shape) -----------------------------------
const drifted = [
  '*I shift, swinging my legs up into his lap.*',
  '',
  '"You said cheap twice. You\'re either nervous or committed."',
].join('\n');
const found = rules(drifted);
assert.ok(found.includes('quoted-speech') && found.includes('third-person-user'),
  'compound drift reports both rules');

// -- deterministic repair --------------------------------------------------------
assert.equal(stripNarrationQuotes('"No experiments. Not tonight."'),
  'No experiments. Not tonight.', 'whole-line quotes unwrap');
assert.equal(stripNarrationQuotes('I catch your wrist before you go further. "Touch me because you want to."'),
  'I catch your wrist before you go further. Touch me because you want to.', 'narrated quotes unwrap');
const mixed = ['Keep your hands busy.', '"If I\'m hiking for you, you\'re carrying the water."'].join('\n');
assert.equal(stripNarrationQuotes(mixed).split('\n')[0], 'Keep your hands busy.', 'clean lines untouched');
assert.ok(!stripNarrationQuotes(mixed).includes('"'), 'flagged lines lose their quotes');
assert.equal(stripNarrationQuotes('I mean it. "Someday" isn\'t a plan.'),
  'I mean it. "Someday" isn\'t a plan.', 'legal quoting is never stripped');

fs.rmSync(process.env.GLASHAUS_HOME, { recursive: true, force: true });
console.log('register ✓ — narration caught, quoting spared, repair deterministic');
