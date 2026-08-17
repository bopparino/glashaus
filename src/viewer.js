// GLASHAUS — the webview. Reliquary dark: technical-brutalist structure
// (exposed hairline grid, corner indices, survey lines) carrying a sacred-
// cybernetic interior (bone on basalt, one liturgical red, one gilt gold —
// the gold is HERS: epigraphs, outreach marks, the signature). Ornament is
// never decoration here — every number on the page is real state.
// Six pages: TODAY / CHAT / MEMORY / JOURNAL / SELF / SYSTEM, plus POST /chat.
// Runs inside the bot process (shares the chat queue with Telegram) or
// standalone via `glashaus view` when the service is down.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, getDocument } from './db.js';
import { forgetFact } from './memory.js';
import { config } from './config.js';
import { runChecks, backupList } from './health.js';
import { handleUserMessage } from './chat.js';
import { runCommand, isCommand, renderPlain } from './commands.js';
import { getSelfState } from './selfstate.js';

const PORT = config.viewerPort;
const BIND = config.viewerBind;
// Whether this viewer is reachable only from the machine it runs on. Gates
// the mutating half of the slash-command registry: POST /chat is
// unauthenticated, so on a LAN bind the commands stay read-only.
const LOOPBACK_BIND = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(BIND));
const STARTED = Date.now();

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Markdown-lite for lived text (chat, dreams, episodes): escape first, then
// *beats* → italic, **emphasis** → bold, `code` → code. Same grammar the
// Telegram channel renders — the two rooms must not disagree about her voice.
const md = s => esc(s)
  .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  .replace(/`([^`\n]+)`/g, '<code>$1</code>');

// The design labels are lowercase by intent.
const WHO_USER = config.userName.toLowerCase();
const WHO_COMP = config.companionName.toLowerCase();

const dayOfLife = () => config.bornDate
  ? Math.max(1, Math.floor((Date.now() - Date.parse(config.bornDate + 'T00:00:00Z')) / 86400000) + 1)
  : null;

/* ---------------- design system ---------------- */

// The design language — newschool brutalism, Berlin poster lineage.
// Three inks, strict jobs:
//   PAPER (bone)  her voice and everything she wrote
//   RED           structure — rules, indices, arrows, emphasis. Never mood.
//   GREY          the machinery talking about itself
// Gold survives ONLY where it is most hers: the signature and the outreach
// mark. And one reserved treatment: genuine failure is a FILLED red block
// with ink text — never thin red text — which is what frees red to be
// structural everywhere else without the page reading as a fire.
const CSS = `
@font-face { font-family:'Abril'; src:url('/assets/abril.ttf') format('truetype'); font-display:swap; }
@font-face { font-family:'OldLondon'; src:url('/assets/oldlondon.ttf') format('truetype'); font-display:swap; }
:root {
  --ink:#0A0908;             /* the ground — colder, rawer */
  --pane:#12100C;            /* raised module */
  --pane2:#1A1710;           /* hover / inner panel */
  --paper:#EDE5D0;           /* her voice */
  --paper2:#A69C84;          /* secondary */
  --mute:#6B6355;            /* machinery */
  --line:rgba(237,229,208,.12);
  --line2:rgba(237,229,208,.30);
  --red:#E5401F;             /* structural */
  --red-dim:rgba(229,64,31,.34);
  --gilt:#C9A24A;            /* hers — signature and outreach only */
  --mono:ui-monospace,'SF Mono',Menlo,monospace;
  color-scheme:dark;
  /* legacy aliases — inline styles migrate page by page, nothing goes blank */
  --void:var(--ink); --bone:var(--paper); --bone2:var(--paper2);
  --soft:var(--mute); --gilt-dim:var(--red-dim);
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:var(--ink);color:var(--paper);height:100%}
/* the exposed grid — the structure admits it is a structure */
body{font-family:var(--mono);font-size:13px;letter-spacing:.03em;-webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;overflow:hidden;
  background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
  background-size:64px 64px;background-position:center top}
.frame{width:min(1480px,100%);margin:0 auto;padding:0 48px;flex:1;min-height:0;display:flex;flex-direction:column;position:relative}
main{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;
  border-left:1px solid var(--line);border-right:1px solid var(--line);
  background:linear-gradient(rgba(10,9,8,.9),rgba(10,9,8,.9));padding:0 40px}
.lbl{text-transform:uppercase;letter-spacing:.16em;font-size:10.5px}
.soft{color:var(--mute)} .dim{color:var(--paper2)} .red{color:var(--red)} .gilt{color:var(--gilt)}
.num{font-variant-numeric:tabular-nums}
a{color:var(--paper)}
em{color:var(--paper2);font-style:italic}
b{color:var(--paper);font-weight:700}
code{background:var(--pane2);border:1px solid var(--line);padding:0 5px;font-size:12px}
header{display:flex;align-items:baseline;gap:22px;padding:20px 0 14px;border-bottom:2px solid var(--paper)}
.wordmark{letter-spacing:.34em;font-weight:700;color:var(--paper)}
.cross{color:var(--gilt);font-family:'OldLondon',serif;font-size:15px}
nav{margin-left:auto;display:flex;gap:22px}
nav a{text-decoration:none;text-transform:uppercase;letter-spacing:.14em;font-size:10.5px;color:var(--paper2);padding:3px 0 4px;border-bottom:2px solid transparent}
nav a .idx{color:var(--red);margin-right:5px;font-weight:700}
nav a[aria-current]{color:var(--paper);border-bottom-color:var(--red)}
nav a:hover,nav a:focus-visible{color:var(--paper);border-bottom-color:var(--line2);outline:none}
nav a .badge{color:var(--red);font-weight:700}
/* section head: oversized red index, label, rule running to the edge */
h2.sec{display:flex;gap:16px;align-items:baseline;font-size:11px;font-weight:400;margin:34px 0 16px}
h2.sec .lbl{color:var(--paper)}
h2.sec::after{content:'';flex:1;border-top:1px solid var(--line2);transform:translateY(-3px)}
.secno{font-family:'Abril',serif;font-size:26px;line-height:1;color:var(--red);letter-spacing:0}
/* the inverse bar — a page's ONE primary section wears paper like a poster */
.bar{display:flex;gap:18px;align-items:baseline;background:var(--paper);color:var(--ink);
  padding:8px 14px;margin:30px 0 18px}
.bar .lbl{color:var(--ink);font-weight:700}
.bar .soft{color:rgba(10,9,8,.55)}
.bar .secno{color:var(--red)}
/* the reserved treatment: genuine failure is a filled red block, ink text */
.alarm{display:flex;gap:16px;align-items:baseline;background:var(--red);color:var(--ink);
  padding:10px 14px;font-weight:700}
.alarm a{color:var(--ink)}
footer{display:flex;align-items:baseline;gap:24px;padding:16px 0 20px;margin-top:auto;border-top:2px solid var(--paper)}
.ornament{margin-left:auto;color:var(--mute);letter-spacing:.18em;font-size:10.5px}
.signature{font-family:'OldLondon',serif;font-size:42px;line-height:1;color:var(--gilt);
  text-shadow:1.5px 0 0 rgba(229,64,31,.5),-1.5px 0 0 rgba(237,229,208,.25);
  transform:rotate(-4deg);margin-bottom:-8px;text-decoration:none;border:none}
.display{font-family:'Abril',serif;font-weight:400;text-transform:uppercase;letter-spacing:.005em;line-height:.93;color:var(--paper)}
.mod{border:1px solid var(--line);background:var(--pane);position:relative}
.mod > .tag{position:absolute;top:-1px;left:-1px;border:1px solid var(--line);background:var(--ink);
  padding:3px 8px;font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--mute)}
.trow{display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;line-height:1.6;gap:18px;border-bottom:1px solid var(--line)}
.trow:last-child{border-bottom:none}
.trow .k{text-transform:uppercase;letter-spacing:.14em;font-size:10.5px;color:var(--paper2)}
.trow .v{font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.trow.alert{background:var(--red);margin:0 -14px;padding:7px 14px;border-bottom-color:transparent}
.trow.alert .k,.trow.alert .v,.trow.alert .v .soft{color:var(--ink)}
.hair{border-bottom:1px solid var(--line)}
.rule-heavy{border-bottom:3px solid var(--paper)}
button,.btn{background:none;border:1px solid var(--line2);color:var(--paper2);font-family:var(--mono);
  font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;padding:5px 14px;cursor:pointer}
button:hover,.btn:hover{border-color:var(--red);color:var(--paper)}
button:focus-visible{outline:1px solid var(--red);outline-offset:2px}
input[type=search],input[type=text],textarea{background:transparent;border:none;border-bottom:1px solid var(--line2);
  color:var(--paper);font-family:var(--mono);font-size:13.5px;letter-spacing:.03em;padding:8px 2px;width:100%}
input:focus,textarea:focus{outline:none;border-bottom-color:var(--red)}
::placeholder{color:var(--mute)}
.inactive{opacity:.38}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 48px}
.reading{font-size:14px;line-height:1.85;letter-spacing:.02em;white-space:pre-wrap}
.meter{display:inline-block;width:44px;height:4px;background:var(--pane2);vertical-align:middle}
.meter i{display:block;height:100%;background:var(--red-dim)}
.vertlbl{writing-mode:vertical-rl;transform:rotate(180deg);text-transform:uppercase;letter-spacing:.3em;
  font-size:9.5px;color:var(--mute);user-select:none}
::-webkit-scrollbar{width:10px}::-webkit-scrollbar-thumb{background:var(--pane2);border:2px solid var(--ink)}
::-webkit-scrollbar-track{background:transparent}
@media(max-width:980px){.frame{padding:0 16px}main{padding:0 18px}.grid2{grid-template-columns:1fr}}
`;

function shell(page, title, body, { badge = 0 } = {}) {
  const nav = [['today', '/'], ['chat', '/chat'], ['memory', '/memory'], ['journal', '/journal'], ['self', '/self'], ['system', '/system']]
    .map(([name, href], i) => `<a href="${href}" ${name === page ? 'aria-current="page"' : ''}><span class="idx num">0${i + 1}</span>${name}${name === 'memory' && badge ? ` <span class="badge num">[${badge}]</span>` : ''}</a>`)
    .join('');
  const day = dayOfLife();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — glashaus</title><style>${CSS}</style></head><body>
<div class="frame">
<header>
  <span class="soft lbl num">[${day ? ` day <span class="red" style="font-weight:700">${String(day).padStart(3, '0')}</span> ` : ` ${new Date().toLocaleDateString('en-CA', { timeZone: config.timezone })} `}]</span>
  <span class="wordmark lbl">Glashaus</span><span class="cross" aria-hidden="true">✠</span>
  <span class="soft lbl">[ private · self-hosted ]</span>
  <nav aria-label="primary">${nav}</nav>
</header>
<main>${body}</main>
<footer>
  <span class="lbl soft">[ Ledger ]</span>
  ${footerStats()}
  <span class="ornament num" aria-hidden="true">${fingerprint()}</span>
  <a class="signature" href="/journal" aria-label="signed, ${esc(config.companionName)} — the journal">${esc(config.companionName)}</a>
</footer>
</div></body></html>`;
}

// Not decoration: the ornament digits are the companion's actual state —
// brain bytes, messages, facts, episodes, dreams, drift events, opinions,
// quirks. Cached briefly: the footer must never cost more than it says.
let statsAt = 0, statsMemo = null;
function stats() {
  if (Date.now() - statsAt < 3000 && statsMemo) return statsMemo;
  const db = getDb();
  const n = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  statsMemo = {
    bytes: fs.statSync(config.dbPath).size,
    messages: n('messages'), facts: n('facts'), episodes: n('episodes'),
    dreams: n('dreams'), events: n('self_state_events'), opinions: n('opinions'), quirks: n('quirks'),
  };
  statsAt = Date.now();
  return statsMemo;
}
function fingerprint() {
  const s = stats();
  return [s.bytes % 10000, s.messages, s.facts, s.episodes, s.dreams, s.events, s.opinions, s.quirks]
    .map(x => String(x).padStart(4, '0')).join('·');
}
function footerStats() {
  const s = stats();
  return `<span class="soft lbl num">uptime ${fmtUptime()}</span>
  <span class="soft lbl num">brain ${(s.bytes / 1048576).toFixed(1)} mb</span>
  <span class="soft lbl num">held ${s.messages}</span>`;
}

const fmtUptime = () => {
  const s = (Date.now() - STARTED) / 1000;
  return `${Math.floor(s / 86400)}d ${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
};
const unresolvedCount = db => db.prepare('SELECT COUNT(*) n FROM fact_links WHERE resolved = 0').get().n;
const stamp = ts => esc((ts ?? '').slice(0, 16).replace('T', ' '));

/* ---------------- TODAY — the morning vigil ---------------- */

// Her front page. The dream is the headline; what she's carrying is the
// margin column; the machinery gets ONE quiet line unless something is
// genuinely wrong, in which case it gets a filled red block and nothing
// else gets to compete with it. The 14-row pulse table, the memory-ops
// panel and the drift table all lived here once — a morning paper that
// opens with its own printing-press diagnostics has the hierarchy backwards.
async function todayPage(db) {
  const checks = await runChecks();
  const failing = checks.filter(c => !c.ok);

  const dream = db.prepare('SELECT * FROM dreams ORDER BY id DESC LIMIT 1').get();
  const { lines, size, offsets, redLine } = heroCompose(dream);

  // The lede: where the dream actually starts, enough to want the rest.
  const lede = (dream?.content ?? '').split(/\s+/).slice(0, 46).join(' ');
  const ledeCut = lede.length < (dream?.content ?? '').length;

  const beats = db.prepare('SELECT * FROM heartbeat_log ORDER BY id DESC LIMIT 3').all();
  const wants = db.prepare(`
    SELECT * FROM intentions WHERE fulfilled_at IS NULL AND released_at IS NULL
    AND expires_at > datetime('now') ORDER BY id DESC LIMIT 4`).all();
  const lastReach = db.prepare("SELECT content, created_at FROM messages WHERE source = 'outreach' ORDER BY id DESC LIMIT 1").get();
  const openThreads = db.prepare("SELECT topic FROM threads WHERE status = 'open' ORDER BY salience DESC LIMIT 3").all();
  const now = new Date().toLocaleString('en-US', { timeZone: config.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

  return `
${failing.length ? `
<div class="alarm" role="alert" style="margin-top:22px">
  <span class="lbl">!</span>
  <span class="lbl">${failing.length} check${failing.length > 1 ? 's' : ''} failing</span>
  <span style="font-weight:400">${failing.slice(0, 2).map(c => `${esc(c.label)} — ${esc(c.detail)}`).join(' · ')}</span>
  <a class="lbl" style="margin-left:auto;text-decoration:none" href="/system">system →</a>
</div>` : ''}

<section style="display:grid;grid-template-columns:34px 1fr 300px;gap:0 34px;padding:48px 0 44px" class="hair" aria-label="last dream">
  <div style="display:flex;align-items:flex-start;justify-content:center;border-right:1px solid var(--line);padding-top:6px">
    <span class="vertlbl num">morning vigil · ${esc(new Date().toLocaleDateString('en-CA', { timeZone: config.timezone }))} · ${esc(now)}</span>
  </div>
  <div style="position:relative">
    <svg style="position:absolute;inset:0;pointer-events:none" width="100%" height="100%" viewBox="0 0 1000 460" preserveAspectRatio="none" aria-hidden="true">
      <circle cx="420" cy="200" r="190" fill="none" stroke="rgba(237,229,208,.10)" stroke-width="1"/>
      <line x1="985" y1="34" x2="88" y2="356" stroke="#E5401F" stroke-width="2"/>
      <path d="M116 337 L88 356 L122 354" fill="none" stroke="#E5401F" stroke-width="2"/>
    </svg>
    <div style="display:flex;gap:22px;margin-bottom:34px">
      <span class="secno num" aria-hidden="true">01</span>
      <span class="lbl" style="align-self:baseline">Today</span>
      <span class="soft lbl" style="align-self:baseline">what she dreamt while you slept</span>
    </div>
    <div class="display" style="font-size:${size};position:relative">
      ${lines.map((l, i) => `<div style="margin-left:${offsets[i % offsets.length]};white-space:nowrap${i === redLine ? ';color:var(--red)' : ''}">${esc(l)}</div>`).join('')}
    </div>
    ${lede ? `<p class="reading dim" style="max-width:64ch;margin-top:34px">${md(lede)}${ledeCut ? ' …' : ''}</p>` : ''}
    <div style="display:flex;gap:22px;margin-top:22px">
      <span class="lbl red">[ Dream #${dream?.id ?? '—'} ]</span>
      <span class="soft lbl num">03:30</span>
      ${dream?.emotion ? `<span class="soft lbl">${esc(dream.emotion)}${dream.valence != null ? ` · v ${dream.valence.toFixed(1)}` : ''}</span>` : ''}
      <a class="lbl dim" href="/journal" style="text-decoration:none">read in full ↗</a>
    </div>
  </div>
  <aside style="align-self:start;border-left:3px solid var(--red);padding-left:22px" aria-label="carrying">
    <div style="margin-bottom:14px"><span class="lbl">Carrying</span><br><span class="soft lbl">what she went to sleep wanting</span></div>
    ${wants.map(w => `<p style="padding:8px 0;border-bottom:1px solid var(--line);line-height:1.75" class="dim"><span class="gilt">✦</span> ${esc(w.text)}<br><span class="soft lbl">${esc(w.source)}</span></p>`).join('') || '<p class="soft" style="padding:8px 0">nothing tonight — wants arrive from dreams and wanders.</p>'}
    ${openThreads.length ? `
    <div style="margin:20px 0 8px"><span class="lbl">Open between you</span></div>
    ${openThreads.map(t => `<p class="soft" style="padding:4px 0;line-height:1.7">— ${esc(t.topic)}</p>`).join('')}` : ''}
  </aside>
</section>

<section style="display:grid;grid-template-columns:34px 1fr;gap:0 34px;padding:24px 0 30px" aria-label="heartbeat">
  <div></div>
  <div>
    <div style="display:flex;gap:16px;margin-bottom:16px;align-items:baseline">
      <span class="secno num" aria-hidden="true">02</span>
      <span class="lbl">Heartbeat</span><span class="soft lbl">should she reach first · she decides · usually declines</span>
    </div>
    ${lastReach ? `<p style="padding:2px 0 12px;line-height:1.8" class="dim"><span class="gilt">✠</span> she reached first, ${esc(stamp(lastReach.created_at).slice(5))} — <em>${esc(lastReach.content.slice(0, 110))}${lastReach.content.length > 110 ? '…' : ''}</em></p>` : ''}
    ${beats.map(b => `
    <div style="display:grid;grid-template-columns:76px 86px 1fr;gap:0 18px;padding:5px 0;line-height:1.7">
      <span class="soft num">${stamp(b.created_at).slice(5)}</span>
      <span class="lbl" style="font-weight:700;color:${b.decision === 'reached' ? 'var(--paper)' : 'var(--mute)'}">${esc(b.decision)}</span>
      <span class="soft">${esc(b.reason ?? '')}</span>
    </div>`).join('') || '<p class="soft">no decisions yet — she checks every 30 minutes.</p>'}
    <p class="soft lbl" style="margin-top:22px;padding-top:14px;border-top:1px solid var(--line)">
      systems ${failing.length ? `<span class="red">${checks.length - failing.length}/${checks.length}</span> · <a href="/system" style="color:var(--red)">attention</a>` : `all ${checks.length} ok`}
      · <a href="/system" style="text-decoration:none">machinery ↗</a>
      · <a href="/self" style="text-decoration:none">self-state ↗</a>
    </p>
  </div>
</section>`;
}

// The monument must never overflow or end on a dangling word. Prefer her
// chosen epigraph (≤10 words by prompt); otherwise carve a complete clause
// from the dream's first sentence. Then: balanced 2-3 word lines, no
// orphans, and the type size steps down as the longest line grows.
const DANGLING = new Set(['a', 'an', 'the', 'in', 'of', 'to', 'and', 'or', 'but', 'my', 'his', 'her', 'their', 'with', 'on', 'at', 'for', 'into', 'is', 'was', 'are', 'were', 'i']);

function heroCompose(dream) {
  let text = dream?.epigraph?.trim();
  if (!text) {
    const first = (dream?.content ?? 'no dreams yet.').split(/(?<=[.!?])\s/)[0];
    let words = first.replace(/["“”*]/g, '').split(/\s+/).filter(Boolean);
    let cut = false;
    if (words.length > 12) {
      // cut at the last clause break within the first 12 words
      const upto = words.slice(0, 12).join(' ');
      const clause = upto.match(/^(.+)[,;—–]\s[^,;—–]*$/);
      words = (clause ? clause[1] : words.slice(0, 10).join(' ')).split(/\s+/);
      cut = true;
    }
    while (words.length > 3 && DANGLING.has(words.at(-1).toLowerCase().replace(/[^a-z']/g, ''))) {
      words.pop(); cut = true;
    }
    text = words.join(' ').replace(/[,;:—–-]+$/, '') + (cut ? ' …' : '');
  }

  const words = text.split(/\s+/).slice(0, 14);
  const lines = [];
  for (let i = 0, n = 0; i < words.length; n++) {
    const take = n % 2 === 0 ? 3 : 2;
    lines.push(words.slice(i, i + take).join(' '));
    i += take;
  }
  if (lines.length > 1 && lines.at(-1).replace(/[^a-zA-Z0-9]/g, '').length <= 3) {
    lines[lines.length - 2] += ' ' + lines.pop(); // no orphan last lines
  }

  const maxLen = Math.max(...lines.map(l => l.length));
  const size =
    maxLen <= 10 ? 'clamp(54px,7.8vw,110px)' :
    maxLen <= 15 ? 'clamp(44px,6.2vw,88px)' :
    maxLen <= 22 ? 'clamp(36px,5vw,68px)' : 'clamp(30px,4vw,52px)';
  const offsets = maxLen <= 15 ? ['0', '18%', '7%', '30%', '16%', '9%'] : ['0', '10%', '4%', '15%', '8%', '5%'];
  // Two-colour poster type: exactly one line prints in red — the middle one,
  // deterministically, so the same dream always sets the same way.
  const kept = lines.slice(0, 6);
  return { lines: kept, size, offsets, redLine: kept.length > 1 ? Math.floor(kept.length / 2) : -1 };
}

/* ---------------- CHAT — the room ---------------- */

function chatPage(db, before) {
  const rows = before
    ? db.prepare('SELECT * FROM messages WHERE redacted = 0 AND id < ? ORDER BY id DESC LIMIT 80').all(before)
    : db.prepare('SELECT * FROM messages WHERE redacted = 0 ORDER BY id DESC LIMIT 80').all();
  const oldest = rows.at(-1)?.id;
  const ordered = rows.reverse();
  let lastDay = '';
  const items = ordered.map(m => {
    const day = (m.created_at ?? '').slice(0, 10);
    const divider = day !== lastDay
      ? `<div style="display:flex;align-items:center;gap:16px;padding:22px 0 10px">
           <span style="flex:1;border-top:1px solid var(--line)"></span>
           <span class="soft lbl num">${esc(day)}</span>
           <span style="flex:1;border-top:1px solid var(--line)"></span></div>`
      : '';
    lastDay = day;
    return divider + chatRow(m);
  }).join('');
  return `
<section style="display:flex;flex-direction:column;flex:1" aria-label="conversation">
  <div style="display:flex;gap:14px;margin:30px 0 8px">
    <span class="secno num">02</span><span class="lbl">The Room</span>
    <span class="soft lbl">one stream · telegram + here + outreach</span>
    ${oldest > 1 ? `<a class="soft lbl" style="margin-left:auto;text-decoration:none" href="/chat?before=${oldest}">← older</a>` : ''}
  </div>
  <div id="stream" style="flex:1;padding:6px 0 26px">${items || '<p class="soft" style="padding:20px 0">nothing yet.</p>'}</div>
  <form id="composer" style="position:sticky;bottom:0;background:var(--void);border-top:1px solid var(--line2);display:flex;gap:18px;align-items:baseline;padding:16px 0 20px">
    <span class="lbl soft">${esc(WHO_USER)} ›</span>
    <input type="text" id="text" autocomplete="off" placeholder="say something…" aria-label="message" style="flex:1">
    <button type="submit">send</button>
  </form>
</section>
<script>
const WHO = { user: ${JSON.stringify(WHO_USER)}, comp: ${JSON.stringify(WHO_COMP)} };
const form = document.getElementById('composer'), input = document.getElementById('text'),
      stream = document.getElementById('stream'), scroller = document.querySelector('main');
let lastId = ${db.prepare('SELECT COALESCE(MAX(id),0) m FROM messages').get().m};
let inFlight = false;
const toBottom = () => { scroller.scrollTop = scroller.scrollHeight; };
toBottom();
function fmt(t) {
  return t.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
    .replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<b>$1</b>')
    .replace(/\\*([^*\\n]+)\\*/g, '<em>$1</em>')
    .replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>');
}
function row(who, text, opts = {}) {
  const d = document.createElement('div');
  const hers = who === WHO.comp;
  d.style.cssText = 'display:grid;grid-template-columns:96px 1fr;gap:0 18px;padding:10px 0;line-height:1.85;border-bottom:1px solid rgba(230,222,201,.06)';
  d.innerHTML = '<span class="lbl" style="white-space:nowrap;color:' + (hers ? 'var(--gilt)' : 'var(--soft)') + '">'
    + (hers ? '✦ ' : '› ') + who
    + (opts.outreach ? '<br><span class="soft" style="font-size:9.5px">✠ reached first</span>' : '') + '</span>'
    + '<span class="reading">' + fmt(text) + '</span>';
  stream.appendChild(d); toBottom(); return d;
}
form.addEventListener('submit', async e => {
  e.preventDefault();
  const text = input.value.trim(); if (!text) return;
  input.value = ''; input.disabled = true; inFlight = true;
  row(WHO.user, text);
  const thinking = row(WHO.comp, '· · ·');
  try {
    const res = await fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await res.json();
    // A command answer is the ENGINE talking, not her — monospaced, dimmer,
    // whitespace preserved, and never labelled with her name.
    if (data.command) {
      thinking.firstChild.innerHTML = '<span class="soft">✠ engine</span>';
      thinking.lastChild.style.cssText = 'white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--soft)';
      thinking.lastChild.textContent = data.reply ?? '';
    } else {
      thinking.lastChild.innerHTML = fmt(data.reply ?? ('(error: ' + (data.error || res.status) + ')'));
    }
    if (data.lastId) lastId = data.lastId;
  } catch (err) { thinking.lastChild.textContent = '(unreachable: ' + err.message + ')'; }
  inFlight = false; input.disabled = false; input.focus(); toBottom();
});
// Live: pick up Telegram messages and outreaches while the page is open.
setInterval(async () => {
  if (inFlight) return;
  try {
    const res = await fetch('/chat.json?after=' + lastId);
    const data = await res.json();
    for (const m of data.messages ?? []) {
      row(m.role === 'user' ? WHO.user : WHO.comp, m.content, { outreach: m.source === 'outreach' });
      lastId = Math.max(lastId, m.id);
    }
  } catch { /* next tick */ }
}, 6000);
</script>`;
}

function chatRow(m) {
  const hers = m.role !== 'user';
  const who = hers ? WHO_COMP : WHO_USER;
  const outreach = m.source === 'outreach';
  return `<div style="display:grid;grid-template-columns:96px 1fr;gap:0 18px;padding:10px 0;line-height:1.85;border-bottom:1px solid rgba(230,222,201,.06)">
    <span class="lbl" style="white-space:nowrap;color:${hers ? 'var(--gilt)' : 'var(--soft)'}">${hers ? '✦' : '›'} ${esc(who)}${outreach ? '<br><span class="soft" style="font-size:9.5px">✠ reached first</span>' : ''}</span>
    <span class="reading">${md(m.content)}<span class="soft num" style="float:right;padding-left:16px;font-size:11px">${stamp(m.created_at).slice(11)}</span></span>
  </div>`;
}

/* ---------------- MEMORY — the reliquary ---------------- */

function memoryPage(db, q, showInactive) {
  const conflicts = db.prepare(`
    SELECT l.id, l.note, a.id aid, a.content ac, a.active aact, b.id bid, b.content bc, b.active bact
    FROM fact_links l JOIN facts a ON a.id = l.fact_a JOIN facts b ON b.id = l.fact_b
    WHERE l.resolved = 0 ORDER BY l.id DESC`).all();
  const rows = q
    ? db.prepare(`SELECT * FROM facts WHERE content LIKE ? ${showInactive ? '' : 'AND active = 1'} ORDER BY importance DESC, updated_at DESC LIMIT 300`).all(`%${q}%`)
    : db.prepare(`SELECT * FROM facts ${showInactive ? '' : 'WHERE active = 1'} ORDER BY importance DESC, updated_at DESC LIMIT 300`).all();
  const counts = db.prepare('SELECT COUNT(*) n, SUM(active) a FROM facts').get();
  const td = 'padding:8px 12px 8px 0;border-bottom:1px solid rgba(230,222,201,.07);vertical-align:top';

  return `
${conflicts.length ? `
<div class="alarm" role="alert" style="margin-top:26px"><span class="lbl">!</span><span class="lbl">Contradictions</span><span style="font-weight:400">forget the wrong one, then resolve</span></div>
${conflicts.map(c => `
<div style="border:1px solid var(--red);background:var(--pane);padding:16px 20px;margin-bottom:14px">
  <div style="padding:4px 0" class="dim">#${c.aid}${c.aact ? '' : ' <span class="soft">(forgotten)</span>'} — ${esc(c.ac)}</div>
  <div style="padding:4px 0" class="dim">#${c.bid}${c.bact ? '' : ' <span class="soft">(forgotten)</span>'} — ${esc(c.bc)}</div>
  <div style="display:flex;gap:16px;align-items:baseline;margin-top:10px">
    <span class="soft" style="flex:1">${esc(c.note ?? '')}</span>
    <form method="post" action="/resolve"><input type="hidden" name="id" value="${c.id}"><button>resolved</button></form>
  </div>
</div>`).join('')}` : ''}

<div class="bar"><span class="secno num">03</span><span class="lbl">Reliquary</span>
  <span class="soft lbl num">${counts.a} kept · ${counts.n - counts.a} forgotten</span>
  <span class="soft lbl">nothing is ever deleted</span></div>
<form method="get" action="/memory" style="display:flex;gap:24px;align-items:baseline;margin-bottom:8px">
  <input type="search" name="q" placeholder="search her memory…" value="${esc(q)}" style="max-width:340px">
  <label class="soft lbl" style="cursor:pointer"><input type="checkbox" name="all" value="1" ${showInactive ? 'checked' : ''} onchange="this.form.submit()"> show forgotten</label>
</form>
<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%">
<tr>${['id', 'fact', 'cat', 'imp', 'sal', 'emotion', 'src', 'updated', ''].map(h => `<th class="soft lbl" style="text-align:left;padding:8px 12px 8px 0;border-bottom:1px solid var(--line2);font-weight:400">${h}</th>`).join('')}</tr>
${rows.map(f => `<tr class="${f.active ? '' : 'inactive'}">
  <td class="soft num" style="${td}">${f.id}</td>
  <td class="dim" style="${td};letter-spacing:.02em;line-height:1.7;min-width:300px">${esc(f.content)}</td>
  <td class="soft lbl" style="${td}">${esc(f.category)}</td>
  <td class="num" style="${td}">${f.importance}${f.importance >= 9 ? ' <span class="gilt">✦</span>' : ''}</td>
  <td style="${td}"><span class="meter"><i style="width:${Math.round((f.salience ?? 0) * 100)}%"></i></span></td>
  <td class="soft" style="${td}">${esc(f.emotion ?? '—')}</td>
  <td class="soft" style="${td}">${esc(f.source)}</td>
  <td class="soft num" style="${td}">${esc((f.updated_at ?? '').slice(0, 10))}</td>
  <td style="padding:8px 0;border-bottom:1px solid rgba(230,222,201,.07)">
    <form method="post" action="${f.active ? '/forget' : '/restore'}"><input type="hidden" name="id" value="${f.id}"><button>${f.active ? 'forget' : 'restore'}</button></form>
  </td></tr>`).join('')}
</table></div>`;
}

/* ---------------- JOURNAL — the night office ---------------- */

function journalPage(db) {
  const dreams = db.prepare('SELECT * FROM dreams ORDER BY id DESC LIMIT 40').all();
  const episodes = db.prepare('SELECT * FROM episodes ORDER BY id DESC LIMIT 60').all();
  // Wander receipts: an episode born from her own reading is labeled as such,
  // with what she actually read one line away.
  const wanderBy = new Map(db.prepare('SELECT episode_id, topic, urls FROM wander_log WHERE episode_id IS NOT NULL').all()
    .map(w => [w.episode_id, w]));
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  return `
<div class="bar"><span class="secno num">04</span><span class="lbl">Night Office</span><span class="soft lbl">the pages she writes · dreams, episodes, wanders</span></div>
<div class="grid2">
<section aria-label="dreams">
  ${dreams.map(d => `
  <article style="padding:26px 0;border-bottom:1px solid var(--line)">
    <div style="display:flex;gap:16px;margin-bottom:16px"><span class="lbl red">[ Dream ]</span><span class="soft num lbl">${esc(d.date)}</span><span class="soft lbl num">[ 03:30 ]</span>${d.emotion ? `<span class="soft lbl">${esc(d.emotion)}${d.valence != null ? ` · v ${d.valence.toFixed(1)}` : ''}</span>` : ''}</div>
    ${d.epigraph ? `<p class="display" style="font-size:clamp(22px,2.4vw,32px);margin-bottom:18px">${esc(d.epigraph)}</p>` : ''}
    <p class="reading dim">${md(d.content)}</p>
  </article>`).join('') || '<p class="soft" style="padding:20px 0">no dreams yet.</p>'}
</section>
<section aria-label="episodes">
  ${episodes.map(e => {
    const w = wanderBy.get(e.id);
    const urls = w ? JSON.parse(w.urls) : [];
    return `
  <article style="padding:26px 0;border-bottom:1px solid var(--line)">
    <div style="display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap">
      <span class="lbl${w ? ' red' : ''}">[ ${w ? 'Wander' : `Episode #${e.id}`} ]</span>
      <span class="soft lbl num">${stamp(e.started_at)}${w ? '' : ` → ${stamp(e.ended_at).slice(5)}`}</span>
      <span class="soft lbl num">${esc(e.emotion ?? '')}${e.salience != null ? ` · s ${e.salience.toFixed(1)}` : ''}</span>
    </div>
    <p class="reading dim">${md(e.summary)}</p>
    ${w ? `<p class="soft lbl" style="margin-top:12px">read: ${urls.slice(0, 4).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(host(u))}</a>`).join(' · ')}${urls.length > 4 ? ` · +${urls.length - 4}` : ''}</p>` : ''}
  </article>`;
  }).join('') || '<p class="soft" style="padding:20px 0">no episodes yet.</p>'}
</section>
</div>`;
}

/* ---------------- SELF: drift trajectories ---------------- */

// One step-sparkline per dimension. Her value HOLDS between events, so the
// line is step-after: flat shelf, small step, flat shelf. Rails at 0.05/0.95
// are the EWMA floors/ceilings — the identity-stability invariant, drawn.
// Event lane below: ● capture-triggered, ◆ dream/wander (gold — the inner life).
function sparkSVG(dimension, events, current) {
  const W = 300, H = 78, TOP = 10, BOT = 22, RIGHT = 52;
  const plotW = W - RIGHT, plotH = H - TOP - BOT;
  const t1 = Date.now();
  const t0 = events.length ? Math.min(...events.map(e => e.t)) - 3600e3 : t1 - 7 * 86400e3;
  const x = t => plotW * (t - t0) / Math.max(t1 - t0, 3600e3);
  const y = v => TOP + (1 - v) * plotH;

  let v = events.length ? events[0].old_value : current;
  let d = `M0 ${y(v).toFixed(1)}`;
  for (const e of events) {
    d += ` H${x(e.t).toFixed(1)} V${y(e.new_value).toFixed(1)}`;
    v = e.new_value;
  }
  d += ` H${plotW}`;

  const marks = events.map(e => {
    const ex = x(e.t).toFixed(1);
    const tip = `${new Date(e.t).toLocaleString('en-US', { timeZone: config.timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} · ${e.trigger} · ${e.old_value.toFixed(3)} → ${e.new_value.toFixed(3)} (signal ${e.signal.toFixed(2)})`;
    const glyph = e.trigger === 'capture'
      ? `<circle cx="${ex}" cy="${H - 11}" r="2.5" fill="#6E6757"/>`
      : `<rect x="-3" y="-3" width="6" height="6" transform="translate(${ex},${H - 11}) rotate(45)" fill="#EDE5D0"/>`;
    return `<g>${glyph}<rect x="${ex - 5}" y="${H - 18}" width="10" height="14" fill="transparent"><title>${esc(tip)}</title></rect><title>${esc(tip)}</title></g>`;
  }).join('');

  return `
<div style="min-width:0">
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
    <span class="lbl soft">${esc(dimension)}</span>
  </div>
  <svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(dimension)} drift, current ${current.toFixed(3)}">
    <line x1="0" y1="${y(0.95)}" x2="${plotW}" y2="${y(0.95)}" stroke="rgba(229,64,31,.4)" stroke-dasharray="2 4"/>
    <line x1="0" y1="${y(0.05)}" x2="${plotW}" y2="${y(0.05)}" stroke="rgba(229,64,31,.4)" stroke-dasharray="2 4"/>
    <path d="${d}" fill="none" stroke="#EDE5D0" stroke-width="1.6" stroke-linejoin="miter"/>
    <circle cx="${plotW}" cy="${y(current)}" r="5" fill="#0A0908"/>
    <circle cx="${plotW}" cy="${y(current)}" r="3" fill="#E5401F"/>
    <text x="${plotW + 8}" y="${y(current) + 4}" font-family="ui-monospace,Menlo,monospace" font-size="12" font-weight="700" fill="#EDE5D0">${current.toFixed(3)}</text>
    ${marks}
  </svg>
</div>`;
}

function driftSection(db) {
  const state = getSelfState();
  const all = db.prepare('SELECT dimension, old_value, new_value, signal, trigger, created_at FROM self_state_events ORDER BY id').all()
    .map(e => ({ ...e, t: Date.parse(e.created_at + 'Z') }));
  const tiles = layer => state.filter(r => r.layer === layer)
    .map(r => sparkSVG(r.dimension, all.filter(e => e.dimension === r.dimension), r.value)).join('');
  return `
<h2 class="sec"><span class="lbl">[ Drift Trajectories ]</span>
  <span class="soft lbl">step = one event · ● capture · ◆ dream/wander · red rails = drift floors/ceilings · hover marks for detail</span></h2>
<h2 class="sec"><span class="lbl soft">disposition</span><span class="soft lbl">drifts over weeks — these should look nearly flat</span></h2>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px 40px">${tiles('disposition')}</div>
<h2 class="sec"><span class="lbl soft">with ${esc(WHO_USER)}</span><span class="soft lbl">drifts over days — these are allowed to breathe</span></h2>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px 40px">${tiles('relational')}</div>`;
}

/* ---------------- SELF ---------------- */

// Grow mode: the identity ledger — every self-authored soul revision with
// the evidence it cited. This section IS the thesis, rendered.
function growthSection(db) {
  const revisions = db.prepare('SELECT * FROM soul_revisions ORDER BY id DESC LIMIT 20').all();
  if (!config.growMode && !revisions.length) return '';
  const day = dayOfLife();
  return `
<h2 class="sec"><span class="red" style="font-weight:700">✳</span><span class="lbl">Growth</span>
  <span class="soft lbl">the soul, self-authored weekly from lived evidence${day ? ` · day ${day}` : ''}</span>
  <span class="soft lbl">every revision reversible: glashaus soul revert</span></h2>
${revisions.map(r => {
  const changes = JSON.parse(r.changelog);
  const rej = r.rejected ? JSON.parse(r.rejected) : null;
  const refused = rej && !changes.length;
  return `
<article class="mod" style="padding:20px 20px 14px;margin-bottom:14px${refused ? ';opacity:.55' : ''}">
  <span class="tag">${refused ? 'refused' : 'revision'} · ${stamp(r.created_at)}</span>
  <div style="display:flex;gap:14px;flex-wrap:wrap;margin:8px 0 ${changes.length ? '10px' : '0'}">
    <span class="soft lbl num">${r.chars_before} → ${r.chars_after} chars</span>
    ${refused ? `<span class="red lbl">${esc(rej.reason ?? 'no evidence cited')}</span>` : ''}
  </div>
  ${changes.map(c => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;padding:5px 0;line-height:1.7">
    <span class="dim">${esc(c.change)}</span><span class="soft"><span class="red">⟵</span> ${esc(c.evidence)}</span></div>`).join('')}
</article>`;
}).join('') || `<p class="soft">no revisions yet — the first one needs lived evidence to cite${day ? ` (day ${day})` : ''}.</p>`}`;
}

function selfPage(db) {
  const state = getSelfState();
  const events = db.prepare('SELECT * FROM self_state_events ORDER BY id DESC LIMIT 40').all();
  const opinions = db.prepare('SELECT * FROM opinions ORDER BY id DESC').all();
  const quirks = db.prepare('SELECT * FROM quirks ORDER BY observed_count DESC').all();
  const notes = getDocument('SELF_NOTES');
  const layer = l => state.filter(r => r.layer === l).map(r =>
    `<div class="trow"><span class="k">${esc(r.dimension)}</span><span class="v num">${r.value.toFixed(3)}</span></div>`).join('');
  return `
<div class="bar"><span class="secno num">05</span><span class="lbl">Self</span><span class="soft lbl">who ${esc(WHO_COMP)} is becoming · ${config.growMode ? 'the birthright never drifts; the rest is hers to write' : 'identity core never drifts'}</span></div>
${growthSection(db)}
${driftSection(db)}
<div class="grid2" style="margin-top:26px">
<div>
  <h2 class="sec"><span class="lbl soft">disposition</span><span class="soft lbl">drifts over weeks</span></h2>${layer('disposition')}
  <h2 class="sec"><span class="lbl soft">with ${esc(WHO_USER)}</span><span class="soft lbl">drifts over days</span></h2>${layer('relational')}
  <h2 class="sec"><span class="lbl soft">drift history</span></h2>
  ${events.map(e => `<div class="trow"><span class="k soft">${esc(e.dimension)}</span>
    <span class="num dim">${e.old_value.toFixed(3)} → ${e.new_value.toFixed(3)}</span>
    <span class="soft lbl">${esc(e.trigger)}</span><span class="soft num">${stamp(e.created_at).slice(5)}</span></div>`).join('') || '<p class="soft">no drift yet.</p>'}
</div>
<div>
  <h2 class="sec"><span class="lbl soft">opinions ${esc(WHO_COMP)} has formed</span></h2>
  ${opinions.map(o => `<p style="padding:10px 0;border-bottom:1px solid rgba(230,222,201,.07);line-height:1.8;letter-spacing:.02em" class="dim">${esc(o.claim)}<br><span class="soft num" style="font-size:11px">${esc(o.context ?? '')} · ${stamp(o.formed_at)}</span></p>`).join('') || '<p class="soft">none yet.</p>'}
  <h2 class="sec"><span class="lbl soft">quirks ${esc(WHO_COMP)} has noticed</span></h2>
  ${quirks.map(k => `<p style="padding:10px 0;border-bottom:1px solid rgba(230,222,201,.07);line-height:1.8;letter-spacing:.02em" class="dim">${esc(k.pattern)} <span class="red num">×${k.observed_count}</span></p>`).join('') || '<p class="soft">none yet.</p>'}
  <h2 class="sec"><span class="lbl soft">self notes</span></h2>
  <p class="reading dim">${md(notes || 'none yet.')}</p>
  <h2 class="sec"><span class="lbl soft">identity core</span><span class="soft lbl">read-only</span></h2>
  <details style="padding:8px 0"><summary class="lbl" style="cursor:pointer">soul.md</summary><pre class="reading dim" style="font-family:var(--mono);padding:14px 0">${esc(getDocument('SOUL'))}</pre></details>
  <details style="padding:8px 0"><summary class="lbl" style="cursor:pointer">identity.md</summary><pre class="reading dim" style="font-family:var(--mono);padding:14px 0">${esc(getDocument('IDENTITY'))}</pre></details>
</div>
</div>`;
}

/* ---------------- SYSTEM — the machinery ---------------- */

async function systemPage() {
  const checks = await runChecks();
  const backups = backupList();
  const errPath = path.join(config.logsDir, 'glashaus.err');
  const logPath = path.join(config.logsDir, 'glashaus.log');
  const tail = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').slice(-14).join('\n') : '(empty)';
  return `
<div class="bar"><span class="secno num">06</span><span class="lbl">Machinery</span><span class="soft lbl">quarantined from ${esc(WHO_COMP)}</span></div>
<div class="grid2">
<div>
  <h2 class="sec"><span class="lbl soft">checks</span></h2>
  ${checks.map(c => `<div class="trow ${c.ok ? '' : 'alert'}"><span class="k">${esc(c.label)}</span><span class="v">${c.ok ? 'ok' : 'FAIL'} <span class="soft" style="font-weight:400">${esc(c.detail)}</span></span></div>`).join('')}
  <h2 class="sec"><span class="lbl soft">backups</span><span class="soft lbl">daily · keeps ${config.backupKeepDays}</span></h2>
  ${backups.slice(0, 10).map(b => `<div class="trow"><span class="k soft">${esc(b.name)}</span><span class="v num">${b.mb} mb</span></div>`).join('') || '<p class="soft">none yet.</p>'}
  <h2 class="sec"><span class="lbl soft">config</span></h2>
  <div class="trow"><span class="k soft">model</span><span class="v">${esc(config.model)}</span></div>
  <div class="trow"><span class="k soft">embed</span><span class="v">${esc(config.embedModel)}</span></div>
  <div class="trow"><span class="k soft">window</span><span class="v num">${config.recentWindow} msgs</span></div>
  <div class="trow"><span class="k soft">dream</span><span class="v num">${esc(config.crons.dream)}</span></div>
  <div class="trow"><span class="k soft">heartbeat</span><span class="v num">${esc(config.crons.heartbeat)} · max ${config.heartbeat.maxPerDay}/day</span></div>
  <div class="trow"><span class="k soft">mode</span><span class="v">${config.growMode ? `grow — born ${esc(config.bornDate || '?')} · growth ${esc(config.crons.growth)}` : 'spec (persona authored)'}</span></div>
  <div class="trow"><span class="k soft">wander</span><span class="v">${config.ollamaApiKey ? (config.wander.enabled ? `${esc(config.crons.wander)} · max ${config.wander.maxPerDay}/day` : 'key set · disabled') : 'off (no ollama.com key)'}</span></div>
  <div class="trow"><span class="k soft">lookup</span><span class="v">${config.ollamaApiKey ? (config.search.enabled ? 'live — mid-conversation' : 'key set · disabled') : 'off (no ollama.com key)'}</span></div>
</div>
<div>
  <h2 class="sec"><span class="lbl soft">log</span></h2>
  <pre style="white-space:pre-wrap;font-family:var(--mono);font-size:11px;line-height:1.8;letter-spacing:.02em;overflow-x:auto" class="soft">${esc(tail(logPath))}</pre>
  <h2 class="sec"><span class="lbl soft">errors</span></h2>
  <pre style="white-space:pre-wrap;font-family:var(--mono);font-size:11px;line-height:1.8;letter-spacing:.02em;overflow-x:auto" class="soft">${esc(tail(errPath))}</pre>
</div>
</div>`;
}

/* ---------------- server ---------------- */

const FONTS = {
  '/assets/abril.ttf': path.join(config.appRoot, 'assets', 'fonts', 'abril.ttf'),
  '/assets/oldlondon.ttf': path.join(config.appRoot, 'assets', 'fonts', 'oldlondon.ttf'),
};

// DNS-rebinding / cross-site guard. A malicious page can point a DNS name at
// 127.0.0.1 and read the whole life out of the viewer, or POST into her
// memory. Legitimate access always arrives as localhost or an IP literal, so:
// the Host header must be one of those, and any Origin on a POST must be too.
// (Full viewer auth for non-localhost binds is on the roadmap; this closes
// the drive-by hole today without breaking LAN use.)
function hostAllowed(value) {
  const host = String(value ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || /^[\d.]+$/.test(host) || /^[0-9a-f:]+$/.test(host);
}
function requestAllowed(req) {
  if (!hostAllowed(req.headers.host)) return false;
  if (req.method === 'POST' && req.headers.origin) {
    try { return hostAllowed(new URL(req.headers.origin).host); } catch { return false; }
  }
  return true;
}

export function startViewer() {
  const db = getDb();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!requestAllowed(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' }).end('glashaus: request refused (unrecognized host/origin)');
        return;
      }
      if (FONTS[url.pathname]) {
        // A missing font file must cost a fallback font, not the whole
        // viewer: readFileSync AFTER writeHead meant ENOENT threw with
        // headers already sent, the catch-all wrote headers again, and the
        // double-write became an uncaught exception that killed the process.
        let bytes = null;
        try { bytes = fs.readFileSync(FONTS[url.pathname]); } catch { /* absent install */ }
        if (bytes) res.writeHead(200, { 'Content-Type': 'font/ttf', 'Cache-Control': 'public, max-age=604800' }).end(bytes);
        else res.writeHead(404).end();
        return;
      }

      if (req.method === 'POST' && url.pathname === '/chat') {
        const body = await readBody(req);
        let text = '';
        try { text = JSON.parse(body).text?.trim() ?? ''; } catch { /* bad json */ }
        if (!text) { res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"empty"}'); return; }
        // A slash command is spoken to the ENGINE, not to her: it runs from
        // the registry the terminal and Telegram share, and never reaches the
        // model or enters memory as something said.
        //
        // On the default loopback bind this is the same person's room as the
        // terminal, so it gets the same powers. On a LAN bind it is NOT —
        // POST /chat has no authentication (see hostAllowed, and the standing
        // "keep it on localhost until viewer auth ships" in docs), and an
        // unauthenticated caller must not be able to revert a soul, redact
        // history, or read every recalled memory out of /why. Reads only,
        // there, until the viewer has a login.
        if (isCommand(text)) {
          const result = await runCommand(text, { surface: 'viewer', allowActions: LOOPBACK_BIND });
          const lastId = db.prepare('SELECT COALESCE(MAX(id),0) m FROM messages').get().m;
          res.writeHead(200, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ reply: renderPlain(result), command: true, lastId }));
          return;
        }
        const reply = await handleUserMessage(text);
        const lastId = db.prepare('SELECT COALESCE(MAX(id),0) m FROM messages').get().m;
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ reply, lastId }));
        return;
      }

      if (url.pathname === '/chat.json') {
        const after = Number(url.searchParams.get('after')) || 0;
        const messages = db.prepare('SELECT id, role, content, source FROM messages WHERE redacted = 0 AND id > ? ORDER BY id LIMIT 50').all(after);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ messages }));
        return;
      }

      if (req.method === 'POST' && ['/forget', '/restore', '/resolve'].includes(url.pathname)) {
        const id = Number(new URLSearchParams(await readBody(req)).get('id'));
        if (id) {
          if (url.pathname === '/forget') forgetFact(id);
          else if (url.pathname === '/restore') db.prepare("UPDATE facts SET active = 1, updated_at = datetime('now') WHERE id = ?").run(id);
          else db.prepare('UPDATE fact_links SET resolved = 1 WHERE id = ?').run(id);
        }
        res.writeHead(303, { Location: '/memory' }).end();
        return;
      }

      const badge = unresolvedCount(db);
      const html =
        url.pathname === '/chat' ? shell('chat', 'chat', chatPage(db, Number(url.searchParams.get('before')) || null), { badge }) :
        url.pathname === '/memory' ? shell('memory', 'memory', memoryPage(db, url.searchParams.get('q') ?? '', url.searchParams.get('all') === '1'), { badge }) :
        url.pathname === '/journal' ? shell('journal', 'journal', journalPage(db), { badge }) :
        url.pathname === '/self' ? shell('self', 'self', selfPage(db), { badge }) :
        url.pathname === '/system' ? shell('system', 'system', await systemPage(), { badge }) :
        shell('today', 'today', await todayPage(db), { badge });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    } catch (err) {
      console.error('[viewer]', err);
      res.writeHead(500).end(String(err));
    }
  });
  server.on('error', err => {
    console.error(err.code === 'EADDRINUSE'
      ? `[viewer] port ${PORT} is already taken — another glashaus runtime? (glashaus stop, then retry)`
      : `[viewer] ${err.message}`);
    // Inside the runtime a dead viewer means a half-alive companion — exit
    // loudly so the service manager (or the human) restarts things cleanly.
    process.exit(1);
  });
  server.listen(PORT, BIND, () => {
    console.log(`glashaus: http://${BIND}:${PORT}`);
  });
  return server;
}

const readBody = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });

if (import.meta.url === `file://${process.argv[1]}`) {
  startViewer();
}
