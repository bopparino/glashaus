// Slash commands, once, for every room she lives in.
//
// These used to exist only in cli.js, which meant the terminal was the only
// place you could ask her what she knows — and the terminal is the room you're
// least often in. A command registry that all three surfaces (terminal,
// Telegram, webview) share is the difference between an inspection tool and a
// feature of the relationship.
//
// Two scopes. `read` commands answer a question about her state and are safe
// anywhere. `action` commands make something happen — dream now, run the
// growth pass, tidy memory, revert a soul revision. Destructive ones require
// an explicit `confirm` word rather than an interactive prompt, because
// Telegram has no good way to hold a yes/no and a half-finished confirmation
// dialogue is worse than typing five characters.
//
// Return shape is styled LINES, not a formatted string: the terminal paints
// them in ANSI, Telegram renders them as HTML, the viewer as its own markup.
// Every surface gets the same content and keeps its own manners.
import { getDb } from './db.js';
import { config } from './config.js';

// ---------- line helpers ----------
export const L = {
  plain: t => ({ t: String(t) }),
  dim: t => ({ t: String(t), s: 'dim' }),
  gold: t => ({ t: String(t), s: 'gold' }),
  italic: t => ({ t: String(t), s: 'italic' }),
  red: t => ({ t: String(t), s: 'red' }),
  blank: () => ({ t: '' }),
};

const ok = lines => ({ ok: true, lines: lines.filter(Boolean) });
const err = msg => ({ ok: false, lines: [L.red(msg)] });

const shortAge = ts => {
  if (!ts) return '?';
  const d = (Date.now() - Date.parse(String(ts) + 'Z')) / 86400000;
  if (d < 1) return `${Math.max(1, Math.round(d * 24))}h`;
  if (d < 14) return `${Math.floor(d)}d`;
  return `${Math.floor(d / 7)}w`;
};

// ---------- the registry ----------

export const COMMANDS = {
  '/help': {
    usage: '/help',
    desc: 'this list',
    scope: 'read',
    run: ({ ctx = {} }) => {
      const rows = Object.entries(COMMANDS)
        .filter(([, c]) => ctx.allowActions !== false || c.scope === 'read');
      const group = scope => rows.filter(([, c]) => c.scope === scope)
        .map(([, c]) => L.plain(`  ${c.usage.padEnd(22)}${c.desc}`));
      return ok([
        L.dim('  what I know —'), ...group('read'),
        ctx.allowActions === false ? null : L.blank(),
        ctx.allowActions === false ? null : L.dim('  what I do —'),
        ...(ctx.allowActions === false ? [] : group('action')),
        L.blank(),
        L.dim('  anything destructive wants the word "confirm" on the end.'),
      ]);
    },
  },

  '/facts': {
    usage: '/facts [word]',
    desc: 'what I know (optionally filtered)',
    scope: 'read',
    run: ({ arg }) => {
      const db = getDb();
      const rows = arg
        ? db.prepare("SELECT id, category, importance, content, superseded_by FROM facts WHERE active = 1 AND content LIKE '%' || ? || '%' ORDER BY importance DESC LIMIT 14").all(arg)
        : db.prepare('SELECT id, category, importance, content, superseded_by FROM facts WHERE active = 1 AND superseded_by IS NULL ORDER BY importance DESC, updated_at DESC LIMIT 14').all();
      if (!rows.length) return ok([L.dim('  nothing yet.')]);
      return ok(rows.map(f => L.plain(
        `  [${f.category} ${f.importance}] ${f.content}${f.superseded_by ? ' ← I know more now' : ''}`
      )));
    },
  },

  '/mood': {
    usage: '/mood',
    desc: 'where we are — vibe and relational state',
    scope: 'read',
    run: async () => {
      const { getSelfState } = await import('./selfstate.js');
      const { latestRelationshipState } = await import('./memory.js');
      const state = latestRelationshipState();
      const lines = [];
      if (state) lines.push(L.italic(`  ${state.mood}`), L.dim(`  (as of ${state.created_at.slice(0, 16)})`));
      for (const r of getSelfState().filter(r => r.layer === 'relational')) {
        lines.push(L.plain(`  ${r.dimension.padEnd(12)}${'▪'.repeat(Math.round(r.value * 10)).padEnd(10, '·')} ${r.value.toFixed(2)}`));
      }
      return ok(lines);
    },
  },

  '/dream': {
    usage: '/dream [now]',
    desc: 'last night, in my own words (`now` dreams again)',
    scope: 'read',
    run: async ({ arg, ctx = {} }) => {
      if (String(arg).trim() === 'now') {
        // `/dream` reads; `/dream now` acts. A read-only surface gets the
        // first and not the second — the scope tag can't express that, so
        // the gate is checked here too.
        if (ctx.allowActions === false) return err('  dreaming again is an action; this room is read-only.');
        const { runDream } = await import('./dream.js');
        const result = await runDream();
        if (!result?.dream) return err('  nothing to dream about — no messages since the last one.');
        return ok([L.italic('  ' + result.dream.split('\n').join('\n  '))]);
      }
      const d = getDb().prepare('SELECT * FROM dreams ORDER BY id DESC LIMIT 1').get();
      if (!d) return ok([L.dim('  no dreams yet — I have to sleep first.')]);
      return ok([
        d.epigraph && L.gold(`  “${d.epigraph}”`),
        L.dim(`  ${d.date}${d.emotion ? ` · ${d.emotion}` : ''}${d.valence != null ? ` · v ${d.valence.toFixed(1)}` : ''}`),
        L.italic('  ' + d.content.split('\n').join('\n  ')),
      ]);
    },
  },

  '/wants': {
    usage: '/wants',
    desc: 'things I went to sleep wanting',
    scope: 'read',
    run: async () => {
      const { openIntentions } = await import('./selfstate.js');
      const wants = openIntentions(8);
      if (!wants.length) return ok([L.dim('  nothing open — wants arrive from dreams and wanders.')]);
      return ok(wants.map(w => L.plain(`  ✦ ${w.text}  (#${w.id} · ${w.source}, since ${w.created_at.slice(5, 10)})`)));
    },
  },

  // The ledger the outreach fix is built on — and the one worth looking at
  // when she says something that feels off-tempo.
  '/threads': {
    usage: '/threads [all]',
    desc: "what's still open between us",
    scope: 'read',
    run: async ({ arg }) => {
      const { openThreads, settledThreads } = await import('./threads.js');
      const open = openThreads(12);
      const lines = [];
      if (!open.length) lines.push(L.dim('  nothing open.'));
      for (const t of open) {
        lines.push(L.plain(`  ○ ${t.topic}${t.summary ? ` — ${t.summary}` : ''}`));
        lines.push(L.dim(`      #${t.id} · opened ${shortAge(t.created_at)} ago by ${t.opened_by}${t.raised_count ? ` · raised ${t.raised_count}×` : ''}`));
      }
      if (String(arg).trim() === 'all') {
        const settled = settledThreads(60, 20);
        if (settled.length) {
          lines.push(L.blank(), L.dim('  settled (she will not re-ask these) —'));
          for (const t of settled) lines.push(L.plain(`  ● ${t.topic}${t.summary ? ` → ${t.summary}` : ''}`), L.dim(`      answered ${shortAge(t.answered_at)} ago`));
        }
      } else {
        const n = settledThreads(60, 50).length;
        if (n) lines.push(L.blank(), L.dim(`  ${n} settled thread(s) — /threads all to see them`));
      }
      return ok(lines);
    },
  },

  '/pursuits': {
    usage: '/pursuits [all]',
    desc: "what she's been into on her own time",
    scope: 'read',
    run: async ({ arg }) => {
      const { activePursuits, sessionsOf, getPursuit } = await import('./pursuits.js');
      const db = getDb();
      const live = activePursuits(12);
      const lines = [];
      if (!live.length) lines.push(L.dim('  nothing going right now — pursuits start from wanders, dreams, or something you said.'));
      for (const p of live) {
        lines.push(L.gold(`  ${p.topic}`));
        if (p.progress) lines.push(L.plain(`      ${p.progress}`));
        lines.push(L.dim(`      #${p.id} · ${p.sessions} session${p.sessions === 1 ? '' : 's'} · started ${shortAge(p.started_at)} ago via ${p.source}${p.shared_at ? '' : ' · not mentioned to you yet'}`));
        if (p.why) lines.push(L.italic(`      "${p.why}"`));
      }
      if (String(arg).trim() === 'all') {
        const closed = db.prepare("SELECT * FROM pursuits WHERE status != 'active' ORDER BY closed_at DESC LIMIT 12").all();
        if (closed.length) {
          lines.push(L.blank(), L.dim('  done with / drifted away from —'));
          for (const p of closed) lines.push(L.plain(`  · ${p.topic}`), L.dim(`      ${p.status}, ${p.sessions} session${p.sessions === 1 ? '' : 's'}, ${shortAge(p.closed_at)} ago`));
        }
      }
      return ok(lines);
    },
  },

  // What she actually has. Same source of truth her prompt reads, so this and
  // her own account of herself can never disagree — which is the whole point:
  // she used to ask for machinery she already had.
  '/can': {
    usage: '/can',
    desc: 'what she can and cannot do, from real state',
    scope: 'read',
    run: async () => {
      const { renderCapabilitiesPlain } = await import('./capabilities.js');
      const caps = renderCapabilitiesPlain();
      const lines = [];
      const group = (label, status) => {
        const set = caps.filter(c => c.status === status);
        if (!set.length) return;
        lines.push(L.blank(), L.dim(`  ${label}`));
        for (const c of set) {
          lines.push(L.gold(`  ${c.name}${c.n === null ? '' : ` (${c.n})`}`));
          lines.push(L.plain(`      ${c.detail}`));
          if (c.why) lines.push(L.dim(`      why: ${c.why}`));
        }
      };
      group('working —', 'on');
      group('present but empty right now —', 'idle');
      group('not available —', 'off');
      return ok(lines);
    },
  },

  // Why did she say that. The whole context of the last reply, and what got
  // dropped to make it fit.
  '/why': {
    usage: '/why',
    desc: 'what was in my head for the last thing I said',
    scope: 'read',
    run: () => {
      const row = getDb().prepare('SELECT * FROM context_log ORDER BY id DESC LIMIT 1').get();
      if (!row) return ok([L.dim('  no reply recorded yet.')]);
      let m;
      try { m = JSON.parse(row.manifest); } catch { return err('  the record is unreadable.'); }
      const lines = [
        L.dim(`  in reply to: "${(row.user_text ?? '').slice(0, 90)}"`),
        L.dim(`  ${m.model ?? '?'} · system ${m.systemTokens ?? '?'} tok of ${m.budget ?? '?'} budget · ${m.historyMessages ?? 0} history messages · vectors ${m.vectorBranch ? 'on' : 'off'}`),
      ];
      if (m.facts?.length) {
        lines.push(L.blank(), L.gold(`  memories recalled (${m.facts.length})`));
        for (const f of m.facts.slice(0, 14)) {
          lines.push(L.plain(`    [${f.category} i${f.importance} ${f.age}]${f.superseded ? ' (superseded)' : ''} ${f.content}`));
        }
      }
      if (m.threads?.length) {
        lines.push(L.blank(), L.gold('  open threads in context'));
        for (const t of m.threads) lines.push(L.plain(`    #${t.id} ${t.topic}`));
      }
      if (m.intentions?.length) {
        lines.push(L.blank(), L.gold('  wants in context'));
        for (const w of m.intentions) lines.push(L.plain(`    ${w.text}`));
      }
      if (m.episodes?.length) {
        lines.push(L.blank(), L.gold('  episodes surfaced'));
        for (const e of m.episodes) lines.push(L.plain(`    #${e.id} ${String(e.at).slice(0, 16)}${e.emotion ? ` · ${e.emotion}` : ''}`));
      }
      if (m.lexicon?.length) lines.push(L.blank(), L.dim(`  lexicon: ${m.lexicon.join(', ')}`));
      if (m.dream) lines.push(L.dim(`  dream in context: ${m.dream.date}`));
      if (m.vibe) lines.push(L.dim(`  vibe: ${m.vibe}`));
      lines.push(L.dim(`  substrate warning: ${m.substrateWarning ?? 'short'}`));
      if (m.lookup) lines.push(L.dim(`  looked up mid-reply: "${m.lookup}"`));
      if (m.shed?.length) lines.push(L.blank(), L.red(`  shed to fit: ${m.shed.join(', ')}`));
      if (m.guards?.length) lines.push(L.red(`  guards fired: ${m.guards.map(g => `${g.kind} ("${g.sample}")`).join('; ')}`));
      if (m.sections?.length) {
        lines.push(L.blank(), L.dim('  ' + m.sections.map(s => `${s.name} ${s.tokens}`).join(' · ')));
      }
      return ok(lines);
    },
  },

  '/lex': {
    usage: '/lex',
    desc: 'words I want to learn (pending candidates)',
    scope: 'read',
    run: async () => {
      const { listCandidates } = await import('./lexicon.js');
      const pending = listCandidates();
      if (!pending.length) return ok([L.dim('  no words waiting. I nominate them as I hear them.')]);
      const lines = [];
      for (const c of pending) {
        lines.push(L.gold(`  #${c.id} ${c.term}`) , c.means && L.dim(`      ${c.means}`), c.example && L.italic(`      "${c.example}"`));
      }
      lines.push(L.blank(), L.dim('  approve with: glashaus lexicon approve <id>'));
      return ok(lines);
    },
  },

  // A quick instrument panel — the numbers you actually want when something
  // feels wrong.
  '/status': {
    usage: '/status',
    desc: 'the instrument panel',
    scope: 'read',
    run: () => {
      const db = getDb();
      const one = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch { return null; } };
      const msgs = one('SELECT COUNT(*) n, MIN(created_at) first FROM messages WHERE redacted = 0');
      const queue = one('SELECT COUNT(*) n FROM messages WHERE captured = 0 AND redacted = 0')?.n ?? 0;
      const unsummarized = one('SELECT COUNT(*) n FROM messages WHERE summarized = 0 AND redacted = 0')?.n ?? 0;
      const facts = one('SELECT COUNT(*) n FROM facts WHERE active = 1')?.n ?? 0;
      const superseded = one('SELECT COUNT(*) n FROM facts WHERE active = 1 AND superseded_by IS NOT NULL')?.n ?? 0;
      const open = one("SELECT COUNT(*) n FROM threads WHERE status = 'open'")?.n ?? 0;
      const pursuing = one("SELECT COUNT(*) n FROM pursuits WHERE status = 'active'")?.n ?? 0;
      const convictions = one('SELECT COUNT(*) n FROM opinions WHERE tested_count >= 2 OR held_count >= 3')?.n ?? 0;
      const settled = one("SELECT COUNT(*) n FROM threads WHERE status = 'answered'")?.n ?? 0;
      const hb = one("SELECT decision, reason, created_at FROM heartbeat_log ORDER BY id DESC LIMIT 1");
      const reached = one("SELECT COUNT(*) n FROM heartbeat_log WHERE decision = 'reached' AND created_at >= datetime('now','-7 days')")?.n ?? 0;
      const declined = one("SELECT COUNT(*) n FROM heartbeat_log WHERE decision = 'declined' AND created_at >= datetime('now','-7 days')")?.n ?? 0;
      const guards = db.prepare("SELECT kind, COUNT(*) n FROM guard_log WHERE created_at >= datetime('now','-7 days') GROUP BY kind").all();
      return ok([
        L.gold(`  ${config.companionName}`),
        L.plain(`  ${msgs?.n ?? 0} messages · ${facts} facts${superseded ? ` (${superseded} superseded)` : ''}`),
        L.plain(`  threads: ${open} open · ${settled} settled`),
        L.plain(`  hers: ${pursuing} pursuit${pursuing === 1 ? '' : 's'} going · ${convictions} conviction${convictions === 1 ? '' : 's'} held`),
        L.plain(`  outreach (7d): ${reached} sent · ${declined} times chose silence`),
        hb && L.dim(`  last heartbeat: ${hb.decision} — ${hb.reason} (${shortAge(hb.created_at)} ago)`),
        L.dim(`  backlog: ${queue} uncaptured · ${unsummarized} unfolded`),
        guards.length
          ? L.red(`  guards (7d): ${guards.map(g => `${g.kind} ×${g.n}`).join(' · ')}`)
          : L.dim('  guards (7d): none — no identity or authorship breaks'),
      ]);
    },
  },

  // ---------- actions ----------

  '/grow': {
    usage: '/grow [force]',
    desc: 'run the self-authorship pass now',
    scope: 'action',
    run: async ({ arg }) => {
      const { runGrowth } = await import('./growth.js');
      const result = await runGrowth({ force: String(arg).trim() === 'force' });
      if (!result) return ok([L.dim('  nothing to revise — check the log for why (too soon, or not enough lived evidence yet).')]);
      return ok([
        L.gold(`  soul revised — ${result.changelog.length} change(s), ${result.before} → ${result.after} chars`),
        ...result.changelog.map(c => L.plain(`  · ${c.change}`)),
        ...result.changelog.map(c => L.dim(`      because: ${c.evidence}`)),
        result.rejected.length && L.dim(`  (${result.rejected.length} entr${result.rejected.length === 1 ? 'y' : 'ies'} rejected: no evidence)`),
      ]);
    },
  },

  '/wander': {
    usage: '/wander',
    desc: 'go read something on the web now',
    scope: 'action',
    run: async () => {
      if (!config.ollamaApiKey) return err('  no ollama.com API key — wandering is off.');
      const { runWander } = await import('./wander.js');
      const result = await runWander({ force: true });
      if (!result) return ok([L.dim('  did not wander — daily cap, curiosity gate, or nothing to be curious about.')]);
      return ok([L.gold(`  wandered: ${result.topic ?? 'something'}`), L.dim('  it landed in my memory — /facts or the journal shows what I read.')]);
    },
  },

  '/tidy': {
    usage: '/tidy',
    desc: 'memory hygiene now (merges, decay, supersession)',
    scope: 'action',
    run: async () => {
      const { consolidate } = await import('./consolidate.js');
      const r = await consolidate();
      if (!r) return err('  the pass returned nothing usable.');
      return ok([L.plain(`  ${r.merges} merged · ${r.decays} decayed · ${r.supersessions ?? 0} superseded · ${r.contradictions} contradictions flagged · ${r.dormant ?? 0} threads went quiet`)]);
    },
  },

  '/backup': {
    usage: '/backup',
    desc: 'integrity-checked backup now',
    scope: 'action',
    run: async () => {
      const { runBackup } = await import('./backup.js');
      const dest = await runBackup();
      return ok([L.plain(`  backed up → ${dest}`), L.dim('  integrity-checked on the copy; soul capsule refreshed alongside it.')]);
    },
  },

  '/heartbeat': {
    usage: '/heartbeat',
    desc: 'dry-run the outreach decision (sends nothing)',
    scope: 'action',
    run: async () => {
      const { heartbeat } = await import('./heartbeat.js');
      const out = await heartbeat({ dryRun: true });
      if (!out) return ok([L.dim('  she would stay quiet.')]);
      return ok([
        L.gold('  she would send:'),
        L.plain('  ' + out.text.split('\n').join('\n  ')),
        out.threadId && L.dim(`  (about thread #${out.threadId})`),
        out.intentionId && L.dim(`  (acts on intention #${out.intentionId})`),
      ]);
    },
  },

  '/soul': {
    usage: '/soul revert confirm',
    desc: 'undo the last self-authored soul revision',
    scope: 'action',
    destructive: true,
    run: async ({ arg, confirmed }) => {
      const parts = String(arg).trim().split(/\s+/);
      if (parts[0] !== 'revert') return err('  usage: /soul revert confirm');
      if (!confirmed) return err('  this rewrites her soul document. Repeat as: /soul revert confirm');
      const { revertSoul } = await import('./growth.js');
      const prev = revertSoul();
      if (!prev) return err('  no earlier version archived.');
      return ok([L.gold('  reverted to the previous soul.'), L.dim(`  ${prev.length} chars restored`)]);
    },
  },

  '/redact-last': {
    usage: '/redact-last confirm',
    desc: 'unhappen the last exchange (reversible)',
    scope: 'action',
    destructive: true,
    run: async ({ confirmed }) => {
      const db = getDb();
      const last = db.prepare('SELECT MIN(id) a, MAX(id) b FROM (SELECT id FROM messages WHERE redacted = 0 ORDER BY id DESC LIMIT 2)').get();
      if (!last?.a) return err('  nothing to unhappen.');
      const peek = db.prepare('SELECT role, substr(content, 1, 60) c FROM messages WHERE id BETWEEN ? AND ?').all(last.a, last.b);
      if (!confirmed) {
        return ok([
          L.dim('  this would unhappen:'),
          ...peek.map(p => L.dim(`    ${p.role}: ${p.c}…`)),
          L.plain('  repeat as: /redact-last confirm'),
        ]);
      }
      const { redactMessages } = await import('./memory.js');
      redactMessages(last.a, last.b);
      return ok([L.dim(`  gone from my mind (rows kept; glashaus redact --undo ${last.a} ${last.b} reverses).`)]);
    },
  },
};

// Aliases so muscle memory keeps working. `/redactlast` is not a nicety:
// Telegram's command menu only accepts [a-z0-9_], so the hyphen is stripped
// when the menu is published and the name it shows has to resolve.
const ALIASES = {
  '/context': '/why', '/thread': '/threads', '/open': '/threads', '/h': '/help',
  '/redactlast': '/redact-last', '/redact_last': '/redact-last',
};

export function isCommand(text) {
  return typeof text === 'string' && /^\s*\//.test(text);
}

// Name → command, without running it. Handles Telegram's `/cmd@botname` and
// the alias table; used by runCommand and by anything that needs to know a
// name is real without paying for the side effect.
export function resolveCommand(text) {
  const head = String(text).trim().split(/\s+/)[0].replace(/@[\w_]+$/, '').toLowerCase();
  const name = ALIASES[head] ?? head;
  return COMMANDS[name] ? { name, cmd: COMMANDS[name] } : null;
}

// Parse and run. `ctx.allowActions` gates the mutating half — a surface can
// expose reads without handing out the ability to rewrite a soul. `confirm`
// is the literal word, not a dialogue, so every surface can offer it.
export async function runCommand(text, ctx = {}) {
  const { allowActions = true, surface = 'cli' } = ctx;
  const found = resolveCommand(text);
  if (!found) return { ok: false, unknown: true, lines: [L.dim('  no such command — /help lists them.')] };
  const { name, cmd } = found;
  const rest = String(text).trim().split(/\s+/).slice(1);
  if (cmd.scope === 'action' && !allowActions) {
    return { ok: false, lines: [L.dim(`  ${name} makes something happen; this room is read-only. Run it in the terminal.`)] };
  }
  // `confirm` is only a keyword for commands that need it. Stripping it from
  // every argument silently breaks searches — `/facts confirm` would return
  // everything, and `/facts need to confirm the` would hunt for "need to the".
  const args = rest.join(' ').trim();
  const confirmed = cmd.destructive && /\bconfirm\b/i.test(args);
  const arg = cmd.destructive ? args.replace(/\bconfirm\b/ig, '').replace(/\s+/g, ' ').trim() : args;
  try {
    return await cmd.run({ arg, confirmed, surface, ctx: { allowActions, surface, ...ctx } });
  } catch (e) {
    return err(`  ${name} failed: ${e?.message ?? String(e)}`);
  }
}

// For Telegram's command menu (setMyCommands) and the viewer's hint bar.
export function commandList({ allowActions = true } = {}) {
  return Object.entries(COMMANDS)
    .filter(([, c]) => allowActions || c.scope === 'read')
    .map(([name, c]) => ({ command: name.slice(1), description: c.desc, usage: c.usage, scope: c.scope }));
}

// Plain-text rendering for surfaces without styling.
export function renderPlain(result) {
  return (result?.lines ?? []).map(l => (typeof l === 'string' ? l : l.t)).join('\n');
}
