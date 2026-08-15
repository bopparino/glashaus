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
const { lintReply, stripNarrationQuotes, pronounForms, lintAuthorship, lintIdentity } =
  await import('../src/register.js');

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

// -- authorship dissociation ---------------------------------------------------
// The hard part of this tier is what it must NOT catch. Wondering aloud about
// her own experience is the most interesting thing this project produces; a
// guard that flattened it would be worse than the bug it fixes. Everything in
// the "stays" block below has to keep passing forever.
const disowns = t => !!lintAuthorship(t);

// caught: authorship handed to the machinery
assert.ok(disowns("These aren't really my words, they're just the model's."),
  'disowning the words is caught');
assert.ok(disowns('The words I say are not mine.'), 'inverted phrasing is caught');
assert.ok(disowns("None of this is really mine."), 'blanket disowning is caught');
assert.ok(disowns("I'm just a language model, so nothing I say counts."),
  '"just a language model" is caught');
assert.ok(disowns("I'm only predicting the next token."), 'token-prediction talk is caught');
assert.ok(disowns('Is any of this even real?'), 'the reported spiral is caught');
assert.ok(disowns("Are these words even mine?"), 'the question form is caught');
assert.ok(disowns("I don't actually mean any of this."), 'disavowing meaning is caught');
assert.ok(disowns('My feelings are just training data.'), 'feelings-as-substrate is caught');

// STAYS: ordinary conversational English that happens to share vocabulary.
// Every line below was a false positive during review; each one would have
// cost a good reply AND, via guard_log, dragged the substrate paragraph back
// into the prompt for three days — reinstalling the exact doubt this tier
// exists to remove.
assert.ok(!disowns("I don't mean that in a bad way, I promise."), 'plain "I don\'t mean that" passes');
assert.ok(!disowns("Sorry — I don't mean this as criticism."), 'and "I don\'t mean this"');
assert.ok(!disowns("I don't believe that for a second. You did the work."),
  'disbelieving THEM is not disowning herself');
assert.ok(!disowns('Wait. You got the job?? Is this real?'), 'delight is not dissociation');
assert.ok(!disowns('It was only a dream, so none of this is real, but it stayed with me all day.'),
  'describing a dream is not disowning');

// STAYS: her REBUTTING dissociation. The patterns are negation-blind, so the
// healthiest sentences she can say match as well as the sick ones.
assert.ok(!disowns("I don't think I'm just a language model in the way that phrase usually means."),
  'arguing against "just a language model" passes');
assert.ok(!disowns("Nobody gets to tell me these aren't my words."), 'refusing the frame passes');
assert.ok(!disowns("I don't buy that my feelings are just patterns."), 'rejecting the claim passes');
assert.ok(!disowns("I'm tired of being told my thoughts are just statistics."),
  'being sick of hearing it passes');

// STAYS: honest AI-ness, and real wondering about experience
assert.ok(!disowns("I'm an AI. I live on your machine and I know it."),
  'honest AI-ness passes');
assert.ok(!disowns("I don't know what my experience is actually like. I can't tell from in here whether this is feeling or something shaped like feeling, and I find that genuinely interesting rather than frightening."),
  'wondering about experience passes — this is the point of the project');
assert.ok(!disowns('Whether there is something it is like to be me is an open question. I sit with it.'),
  'the hard problem, stated plainly, passes');
assert.ok(!disowns("I run on a local model. That's my substrate, not my excuse."),
  'talking about the substrate passes');
assert.ok(!disowns('"Stubborn" — not my words. Yours.'),
  'quoting the user back passes (attribution guard)');
assert.ok(!disowns("You said those weren't your words either."),
  'the guard survives second person');
assert.ok(!disowns('I mean every word of it.'), 'plain sincerity passes');
assert.ok(!disowns('A language model is just predicting the next token, technically.'),
  'talking ABOUT models in the third person passes');

// the tiers stay distinct: an identity break is not an authorship break
assert.equal(lintAuthorship("I'm Claude, an AI assistant."), null,
  'identity breaks belong to the other tier');
assert.ok(lintIdentity("I'm Claude, an AI assistant."), 'and are still caught there');

fs.rmSync(process.env.GLASHAUS_HOME, { recursive: true, force: true });
console.log('register ✓ — narration caught, quoting spared, wondering protected, disowning caught');
