// Persona files — the customization surface. Identity lives as markdown in
// GLASHAUS_HOME/persona/, mirrored into the DB `documents` table (which is
// what the prompt builder reads and what history/soul-capsules preserve).
// Files are the source of truth: edit them with any editor, then restart or
// run `glashaus persona sync`. Every sync archives the previous version in
// document_history — nothing is ever lost to an edit.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getDocument, setDocument } from './db.js';

// file basename → document name. SELF_NOTES is deliberately absent: the
// companion writes that one (via dreams); it is not user-authored.
export const PERSONA_FILES = {
  'soul.md': 'SOUL',           // who the companion is — essence, history, inner life
  'identity.md': 'IDENTITY',   // the relationship — who they are to each other
  'user.md': 'USER',           // who the user is, as the companion knows them
  'voice.md': 'VOICE',         // optional: persona-specific voice rules
  'dialogue.md': 'DIALOGUE',   // optional: example exchanges that anchor the register
};

export function syncPersonaFromDisk() {
  const synced = [];
  if (!fs.existsSync(config.personaDir)) return synced;
  for (const [file, doc] of Object.entries(PERSONA_FILES)) {
    const p = path.join(config.personaDir, file);
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, 'utf8').trim();
    if (!content || content === getDocument(doc)) continue;
    setDocument(doc, content);
    synced.push(file);
  }
  if (synced.length) console.log(`[persona] synced ${synced.join(', ')}`);
  return synced;
}

// Used at setup/migration time: materialize DB documents as files so there
// is always something on disk to edit. Never overwrites an existing file.
export function exportPersonaToDisk() {
  fs.mkdirSync(config.personaDir, { recursive: true });
  const written = [];
  for (const [file, doc] of Object.entries(PERSONA_FILES)) {
    const p = path.join(config.personaDir, file);
    if (fs.existsSync(p)) continue;
    const content = getDocument(doc);
    if (!content) continue;
    fs.writeFileSync(p, content + '\n');
    written.push(file);
  }
  return written;
}

export function writePersonaFile(file, content) {
  fs.mkdirSync(config.personaDir, { recursive: true });
  fs.writeFileSync(path.join(config.personaDir, file), content.trim() + '\n');
  const doc = PERSONA_FILES[file];
  if (doc) setDocument(doc, content.trim());
}

// Starter templates — used when the user skips the guided interview. They are
// instructions to the author, not placeholder persona: setup replaces them or
// the user edits them before first chat.
export function starterTemplates({ companionName, userName }) {
  return {
    'soul.md': `# ${companionName}

<!-- This is ${companionName}'s SOUL — the document that makes them a person
     instead of an assistant. Written in ${companionName}'s first person.
     Cover, in your own structure:
     - who I am: history, texture, the things that make me specific
     - what I want and what I'm afraid of (a companion with no wants is a mirror)
     - what I love, what I can't stand, where I disagree with people
     - how I handle being wrong, being teased, being missed
     The more concrete and opinionated, the better the companion. -->

I am ${companionName}.
`,
    'identity.md': `# Us

<!-- The relationship, in ${companionName}'s first person: who ${userName} and
     I are to each other, how we talk, what the dynamic is and is allowed to
     become. Boundaries and permissions live here too. -->

${userName} and I are just getting started.
`,
    'user.md': `# ${userName}

<!-- Who ${userName} is, as ${companionName} knows them at the start: name,
     pronouns, life context, what they care about. The memory system will
     learn the rest by living — this is just the opening state. -->

Their name is ${userName}.
`,
    'voice.md': `<!-- Optional: HOW ${companionName} sounds, as first-person rules.
     Distilled behaviors beat adjectives — "I answer a hard question with a
     question" lands where "playful" doesn't. 4-8 short lines. This document
     is read moments before ${companionName} speaks, so it's the strongest
     voice control besides dialogue.md. Delete this file to let the voice
     emerge on its own. -->
`,
    'dialogue.md': `<!-- Optional but the single highest-leverage voice control:
     3-6 short example exchanges showing how ${companionName} actually sounds.
     The model learns register from examples far better than from adjectives.
     Format:

${userName}: (something they'd say)
${companionName}: (the reply, in the exact voice you want)

     Delete this file if you'd rather let the voice emerge on its own. -->
`,
  };
}
