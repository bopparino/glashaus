// The lexicon — vocabulary as a first-class persona surface. Lorebooks
// inject facts; this injects WORDS: slang, inside jokes, named creatures,
// shared shorthand, how the companion actually swears. Voice lives in
// vocabulary more than adjectives.
//
// Source of truth is persona/lexicon.md (synced to the LEXICON document like
// every persona file). Entry format, forgiving by design:
//
//   ## bet — core
//   means: enthusiastic yes; sealed agreement
//   sounds like: bet. eight o'clock, don't be late.
//
// "— core" marks an always-in-context entry (the companion's signature
// vocabulary, cap ~10). Everything else is retrieval-triggered: an entry
// rides into the prompt only when its term surfaces in the user's message
// or in a recalled memory — so the lexicon can grow to hundreds of entries
// without bloating a single prompt.
//
// The companion also LEARNS words: fact capture may nominate candidates from
// live conversation. Candidates are never injected automatically — they wait
// in lexicon_candidates for approval (`glashaus lexicon approve <id>`), which
// appends them to the persona file. Human-in-the-loop, because auto-learned
// vocabulary is how a companion picks up words nobody actually uses.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getDb, getDocument, setDocument } from './db.js';

const CORE_FLAG = /\s*[—–-]\s*core\s*$/i;

export function parseLexicon(text) {
  if (!text?.trim()) return [];
  const entries = [];
  // Guidance comments may contain example entries — they are not vocabulary.
  const live = String(text).replace(/<!--[\s\S]*?-->/g, '');
  for (const block of live.split(/^##\s+/m).slice(1)) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    const head = lines[0].trim();
    if (!head) continue;
    const core = CORE_FLAG.test(head);
    const term = head.replace(CORE_FLAG, '').trim();
    let means = '', sound = '';
    for (const raw of lines.slice(1)) {
      const l = raw.replace(/^\s*[*_]*/, '').replace(/[*_]*\s*$/, '');
      const m = l.match(/^means:\s*(.+)$/i);
      const s = l.match(/^sounds like:\s*(.+)$/i);
      if (m) means = m[1].trim();
      else if (s) sound = s[1].trim();
    }
    if (term && (means || sound)) entries.push({ term, means, sound, core });
  }
  return entries;
}

export const loadLexicon = () => parseLexicon(getDocument('LEXICON'));

// Word-boundary match, case-insensitive; multiword terms match as phrases.
const termRx = term => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

export function selectEntries(entries, contextText, { coreCap = 10, triggerCap = 8 } = {}) {
  const core = entries.filter(e => e.core).slice(0, coreCap);
  const ctx = String(contextText ?? '');
  const triggered = entries
    .filter(e => !e.core && termRx(e.term).test(ctx))
    .slice(0, triggerCap);
  return [...core, ...triggered];
}

export function renderLexicon(selected) {
  if (!selected.length) return '';
  const rows = selected.map(e => {
    const parts = [`**${e.term}**`];
    if (e.means) parts.push(`— ${e.means}`);
    if (e.sound) parts.push(`(in my mouth: "${e.sound}")`);
    return `- ${parts.join(' ')}`;
  });
  return `# My Words\n\n(vocabulary that's mine — I use these naturally, in my own sentences, without defining them at ${config.userName} unless asked. They're seasoning, not a checklist.)\n\n${rows.join('\n')}`;
}

// ---------- learned candidates (human-in-the-loop) ----------

export function addLexiconCandidate({ term, means = '', example = '' }) {
  if (!term?.trim()) return null;
  const db = getDb();
  const t = term.trim();
  // Already in the lexicon or already waiting → skip quietly.
  if (loadLexicon().some(e => e.term.toLowerCase() === t.toLowerCase())) return null;
  const dup = db.prepare("SELECT id FROM lexicon_candidates WHERE lower(term) = lower(?) AND status = 'pending'").get(t);
  if (dup) return dup.id;
  return db.prepare('INSERT INTO lexicon_candidates (term, means, example) VALUES (?, ?, ?)')
    .run(t, means.trim(), example.trim()).lastInsertRowid;
}

export const listCandidates = (status = 'pending') =>
  getDb().prepare('SELECT * FROM lexicon_candidates WHERE status = ? ORDER BY id').all(status);

// Approving appends to persona/lexicon.md (creating it if needed) and
// re-syncs the LEXICON document — the file stays the source of truth.
export function resolveCandidate(id, approve) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM lexicon_candidates WHERE id = ?').get(id);
  if (!c || c.status !== 'pending') return null;
  if (approve) {
    const p = path.join(config.personaDir, 'lexicon.md');
    fs.mkdirSync(config.personaDir, { recursive: true });
    const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\s+$/, '') : '# Lexicon';
    const entry = `\n\n## ${c.term}\nmeans: ${c.means || '(fill in)'}\nsounds like: ${c.example || '(fill in)'}`;
    fs.writeFileSync(p, existing + entry + '\n');
    setDocument('LEXICON', fs.readFileSync(p, 'utf8').trim());
  }
  db.prepare("UPDATE lexicon_candidates SET status = ? WHERE id = ?").run(approve ? 'approved' : 'rejected', id);
  return c;
}
