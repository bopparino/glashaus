// GLASHAUS — the webview. Ink on bone, one red event, the companion's signature.
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
import { getSelfState } from './selfstate.js';

const PORT = config.viewerPort;
const BIND = config.viewerBind;
const STARTED = Date.now();

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The design labels are lowercase by intent.
const WHO_USER = config.userName.toLowerCase();
const WHO_COMP = config.companionName.toLowerCase();

/* ---------------- design system ---------------- */

const CSS = `
@font-face { font-family:'Abril'; src:url('/assets/abril.ttf') format('truetype'); font-display:swap; }
@font-face { font-family:'OldLondon'; src:url('/assets/oldlondon.ttf') format('truetype'); font-display:swap; }
:root {
  --paper:#EFEBE2; --ink:#17130E; --soft:#6F675B; --red:#E5401F;
  --line:rgba(23,19,14,.22); --mono:ui-monospace,'SF Mono',Menlo,monospace;
  color-scheme:light;
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:var(--paper);color:var(--ink);height:100%}
body{font-family:var(--mono);font-size:12px;letter-spacing:.08em;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;overflow:hidden}
.frame{width:min(1440px,100%);margin:0 auto;padding:0 56px;flex:1;min-height:0;display:flex;flex-direction:column;position:relative}
/* header and footer hold the frame; only main scrolls */
main{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column}
.lbl{text-transform:uppercase;letter-spacing:.14em}
.soft{color:var(--soft)} .red{color:var(--red)}
.num{font-variant-numeric:tabular-nums}
a{color:var(--ink)}
header{display:flex;align-items:baseline;gap:28px;padding:26px 0 18px;border-bottom:1px solid var(--line)}
.wordmark{letter-spacing:.34em;font-weight:700}
nav{margin-left:auto;display:flex;gap:26px}
nav a{text-decoration:none;text-transform:uppercase;letter-spacing:.14em;padding-bottom:3px;border-bottom:1px solid transparent}
nav a[aria-current]{border-bottom-color:var(--ink)}
nav a:hover,nav a:focus-visible{border-bottom-color:var(--line);outline:none}
nav a .badge{color:var(--red)}
h2.sec{display:flex;gap:14px;font-size:12px;font-weight:400;margin:34px 0 18px}
footer{display:flex;align-items:baseline;gap:26px;padding:22px 0 26px;margin-top:auto;border-top:1px solid var(--line)}
.ornament{margin-left:auto;color:var(--soft);letter-spacing:.18em}
.signature{font-family:'OldLondon',serif;font-size:44px;line-height:1;color:var(--ink);
  text-shadow:1.5px 0 0 rgba(229,64,31,.55),-1.5px 0 0 rgba(0,145,255,.45);
  transform:rotate(-4deg);margin-bottom:-8px;text-decoration:none;border:none}
.display{font-family:'Abril',serif;font-weight:400;text-transform:uppercase;letter-spacing:.005em;line-height:.95}
.trow{display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;line-height:1.6;gap:18px}
.trow .k{text-transform:uppercase;letter-spacing:.14em}
.trow .v{font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.trow.alert .k,.trow.alert .v{color:var(--red)}
.hair{border-bottom:1px solid var(--line)}
button,.btn{background:none;border:1px solid var(--line);color:var(--ink);font-family:var(--mono);
  font-size:11px;letter-spacing:.14em;text-transform:uppercase;padding:4px 12px;cursor:pointer}
button:hover,.btn:hover{border-color:var(--ink)}
button:focus-visible{outline:1px solid var(--ink);outline-offset:2px}
input[type=search],input[type=text],textarea{background:transparent;border:none;border-bottom:1px solid var(--line);
  color:var(--ink);font-family:var(--mono);font-size:13px;letter-spacing:.06em;padding:8px 2px;width:100%}
input:focus,textarea:focus{outline:none;border-bottom-color:var(--ink)}
::placeholder{color:var(--soft)}
.inactive{opacity:.4}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 56px}
@media(max-width:980px){.frame{padding:0 22px}.grid2{grid-template-columns:1fr}}
`;

function shell(page, title, body, { badge = 0 } = {}) {
  const nav = [['today', '/'], ['chat', '/chat'], ['memory', '/memory'], ['journal', '/journal'], ['self', '/self'], ['system', '/system']]
    .map(([name, href]) => `<a href="${href}" ${name === page ? 'aria-current="page"' : ''}>${name}${name === 'memory' && badge ? ` <span class="badge num">[${badge}]</span>` : ''}</a>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — glashaus</title><style>${CSS}</style></head><body>
<div class="frame">
<header>
  <span class="soft num">[016]</span>
  <span class="wordmark lbl">Glashaus</span>
  <span class="soft lbl">[ private · self-hosted ]</span>
  <nav aria-label="primary">${nav}</nav>
  <span class="soft num">[092]</span>
</header>
<main>${body}</main>
<footer>
  <span class="lbl">[ System ]</span>
  <span class="soft lbl num">uptime ${fmtUptime()}</span>
  <span class="soft lbl num">db ${dbMb()} mb</span>
  <span class="soft lbl num">msgs ${getDb().prepare('SELECT COUNT(*) n FROM messages').get().n}</span>
  <span class="ornament num" aria-hidden="true">${fingerprint()}</span>
  <a class="signature" href="/journal" aria-label="signed, ${esc(config.companionName)} — the journal">${esc(config.companionName)}</a>
</footer>
</div></body></html>`;
}

// Not decoration: the ornament digits are the companion's actual state —
// brain bytes, messages, facts, episodes, dreams, drift events, opinions, quirks.
function fingerprint() {
  const db = getDb();
  const n = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  const parts = [
    fs.statSync(config.dbPath).size % 10000,
    n('messages'), n('facts'), n('episodes'),
    n('dreams'), n('self_state_events'), n('opinions'), n('quirks'),
  ];
  return parts.map(x => String(x).padStart(4, '0')).join('·');
}

const fmtUptime = () => {
  const s = (Date.now() - STARTED) / 1000;
  return `${Math.floor(s / 86400)}d ${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
};
const dbMb = () => (fs.statSync(config.dbPath).size / 1048576).toFixed(1);
const unresolvedCount = db => db.prepare('SELECT COUNT(*) n FROM fact_links WHERE resolved = 0').get().n;
const stamp = ts => esc((ts ?? '').slice(0, 16).replace('T', ' '));

/* ---------------- TODAY ---------------- */

async function todayPage(db) {
  const checks = await runChecks();
  const okCount = checks.filter(c => c.ok).length;
  const pulseLine = checks.map(c => `${esc(c.label)} ${c.ok ? 'ok' : `<span class="red">${esc(c.detail)}</span>`}`).join(' <i>·</i> ');

  const dream = db.prepare('SELECT * FROM dreams ORDER BY id DESC LIMIT 1').get();
  const { lines, size, offsets } = heroCompose(dream);

  const overnight = {
    merged: db.prepare("SELECT COUNT(*) n FROM facts WHERE source = 'consolidate' AND created_at >= datetime('now','-1 day')").get().n,
    decayed: db.prepare("SELECT COUNT(*) n FROM facts WHERE active = 0 AND updated_at >= datetime('now','-1 day')").get().n,
    contradictions: unresolvedCount(db),
  };

  const drift = getSelfState().filter(r => r.layer === 'relational').map(r => {
    const delta = db.prepare("SELECT COALESCE(SUM(new_value - old_value),0) d FROM self_state_events WHERE dimension = ? AND created_at >= datetime('now','-1 day')").get(r.dimension).d;
    return { dim: r.dimension, value: r.value, dir: delta > 0.001 ? '▲' : delta < -0.001 ? '▼' : '—' };
  });

  const beats = db.prepare('SELECT * FROM heartbeat_log ORDER BY id DESC LIMIT 4').all();
  const now = new Date().toLocaleString('en-US', { timeZone: config.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

  return `
<section style="position:relative;padding:64px 0 56px" class="hair" aria-label="last dream">
  <svg style="position:absolute;inset:0;pointer-events:none" width="100%" height="100%" viewBox="0 0 1328 480" preserveAspectRatio="none" aria-hidden="true">
    <line x1="1298" y1="80" x2="132" y2="410" stroke="#E5401F" stroke-width="1.5"/>
    <path d="M158 391 L132 410 L164 407" fill="none" stroke="#E5401F" stroke-width="1.5"/>
  </svg>
  <div style="display:flex;gap:22px;margin-bottom:40px">
    <span class="lbl">[ Today ]</span><span class="soft lbl">morning vigil</span>
    <span class="soft lbl num">${esc(new Date().toLocaleDateString('en-CA', { timeZone: config.timezone }))} ${esc(now)}</span>
  </div>
  <div class="display" style="font-size:${size};position:relative">
    ${lines.map((l, i) => `<div style="margin-left:${offsets[i % offsets.length]};white-space:nowrap">${esc(l)}</div>`).join('')}
  </div>
  <div style="display:flex;gap:22px;margin-top:42px">
    <span class="lbl">[ Dream #${dream?.id ?? '—'} ]</span>
    <span class="soft lbl num">[ 03:30 ]</span>
    <a class="soft lbl" href="/journal" style="text-decoration:none">read in full ↗</a>
  </div>
  <aside style="position:absolute;top:64px;right:0;width:300px">
    <div style="display:flex;gap:14px;margin-bottom:14px">
      <span class="lbl">[ Pulse ]</span><span class="num">${okCount}/${checks.length}</span>
      <span class="soft lbl">${okCount === checks.length ? 'nominal' : '<span class="red">attention</span>'}</span>
    </div>
    <p class="lbl num" style="line-height:2.05">${pulseLine}</p>
  </aside>
</section>

<div style="display:grid;grid-template-columns:1.6fr 1fr 1fr" class="hair">
  <section style="padding:26px 32px 34px 0" aria-label="heartbeat">
    <div style="display:flex;gap:14px;margin-bottom:20px">
      <span class="lbl">[ Heartbeat ]</span><span class="soft lbl">should she reach first · she decides</span>
    </div>
    ${beats.map(b => `
    <div style="display:grid;grid-template-columns:82px 92px 1fr;gap:0 18px;padding:7px 0;line-height:1.7">
      <span class="soft num">${stamp(b.created_at).slice(5)}</span>
      <span class="lbl" style="font-weight:700${b.decision === 'reached' ? ';color:var(--ink)' : ''}">${esc(b.decision)}</span>
      <span>${esc(b.reason ?? '')}</span>
    </div>`).join('') || '<p class="soft">no decisions yet — she checks every 30 minutes.</p>'}
    <p class="soft lbl" style="margin-top:24px">usually declines. this is normal.</p>
  </section>
  <section style="padding:26px 32px 34px;border-left:1px solid var(--line)" aria-label="memory overnight">
    <div style="display:flex;gap:14px;margin-bottom:20px"><span class="lbl">[ Memory ]</span><span class="soft lbl">last 24h</span></div>
    <div class="trow"><span class="k">Merged</span><span class="v num">${overnight.merged}</span></div>
    <div class="trow"><span class="k">Decayed</span><span class="v num">${overnight.decayed}</span></div>
    <div class="trow ${overnight.contradictions ? 'alert' : ''}"><span class="k">Contradiction</span><span class="v num">${overnight.contradictions}</span></div>
    <p class="soft lbl" style="margin-top:18px">${overnight.contradictions ? 'unresolved · review in <a href="/memory">[ memory ]</a>' : 'no conflicts on record'}</p>
  </section>
  <section style="padding:26px 0 34px 32px;border-left:1px solid var(--line)" aria-label="drift">
    <div style="display:flex;gap:14px;margin-bottom:20px"><span class="lbl">[ Drift ]</span><span class="soft lbl num">Δ 24h</span></div>
    ${drift.map(d => `<div class="trow"><span class="k">${esc(d.dim)}</span><span class="v num">${d.value.toFixed(3)} ${d.dir}</span></div>`).join('')}
    <p class="soft lbl" style="margin-top:18px"><a href="/self" style="text-decoration:none">full self-state ↗</a></p>
  </section>
</div>`;
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
    let words = first.replace(/["“”]/g, '').split(/\s+/).filter(Boolean);
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
    maxLen <= 10 ? 'clamp(48px,7vw,96px)' :
    maxLen <= 15 ? 'clamp(40px,5.6vw,78px)' :
    maxLen <= 22 ? 'clamp(34px,4.6vw,62px)' : 'clamp(28px,3.8vw,48px)';
  const offsets = maxLen <= 15 ? ['0', '18%', '7%', '30%', '16%', '9%'] : ['0', '10%', '4%', '15%', '8%', '5%'];
  return { lines: lines.slice(0, 6), size, offsets };
}

/* ---------------- CHAT ---------------- */

function chatPage(db, before) {
  const rows = before
    ? db.prepare('SELECT * FROM messages WHERE id < ? ORDER BY id DESC LIMIT 80').all(before)
    : db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 80').all();
  const oldest = rows.at(-1)?.id;
  const items = rows.reverse().map(m => chatRow(m)).join('');
  return `
<section style="display:flex;flex-direction:column;flex:1" aria-label="conversation">
  <div style="display:flex;gap:14px;margin:30px 0 8px">
    <span class="lbl">[ Chat ]</span>
    <span class="soft lbl">one stream · telegram + here + outreach</span>
    ${oldest > 1 ? `<a class="soft lbl" style="margin-left:auto;text-decoration:none" href="/chat?before=${oldest}">← older</a>` : ''}
  </div>
  <div id="stream" style="flex:1;padding:10px 0 26px">${items || '<p class="soft" style="padding:20px 0">nothing yet.</p>'}</div>
  <form id="composer" style="position:sticky;bottom:0;background:var(--paper);border-top:1px solid var(--line);display:flex;gap:18px;align-items:baseline;padding:16px 0 20px">
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
function row(who, text, opts = {}) {
  const d = document.createElement('div');
  d.style.cssText = 'display:grid;grid-template-columns:82px 1fr;gap:0 18px;padding:9px 0;line-height:1.75;border-bottom:1px solid rgba(23,19,14,.07)';
  d.innerHTML = '<span class="lbl ' + (who === WHO.user ? 'soft' : '') + '" style="white-space:nowrap">' + who
    + (opts.outreach ? '<br><span class="soft" style="font-size:10px">reached first</span>' : '') + '</span>'
    + '<span style="white-space:pre-wrap;letter-spacing:.04em">'
    + text.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) + '</span>';
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
    thinking.lastChild.textContent = data.reply ?? ('(error: ' + (data.error || res.status) + ')');
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
  const who = m.role === 'user' ? WHO_USER : WHO_COMP;
  const outreach = m.source === 'outreach';
  return `<div style="display:grid;grid-template-columns:82px 1fr;gap:0 18px;padding:9px 0;line-height:1.75;border-bottom:1px solid rgba(23,19,14,.07)">
    <span class="lbl ${who === WHO_USER ? 'soft' : ''}" style="white-space:nowrap">${esc(who)}${outreach ? '<br><span class="soft" style="font-size:10px">reached first</span>' : ''}</span>
    <span style="white-space:pre-wrap;letter-spacing:.04em">${esc(m.content)}<span class="soft num" style="float:right;padding-left:16px">${stamp(m.created_at).slice(5)}</span></span>
  </div>`;
}

/* ---------------- MEMORY ---------------- */

function memoryPage(db, q, showInactive) {
  const conflicts = db.prepare(`
    SELECT l.id, l.note, a.id aid, a.content ac, a.active aact, b.id bid, b.content bc, b.active bact
    FROM fact_links l JOIN facts a ON a.id = l.fact_a JOIN facts b ON b.id = l.fact_b
    WHERE l.resolved = 0 ORDER BY l.id DESC`).all();
  const rows = q
    ? db.prepare(`SELECT * FROM facts WHERE content LIKE ? ${showInactive ? '' : 'AND active = 1'} ORDER BY importance DESC, updated_at DESC LIMIT 300`).all(`%${q}%`)
    : db.prepare(`SELECT * FROM facts ${showInactive ? '' : 'WHERE active = 1'} ORDER BY importance DESC, updated_at DESC LIMIT 300`).all();
  const counts = db.prepare('SELECT COUNT(*) n, SUM(active) a FROM facts').get();

  return `
${conflicts.length ? `
<h2 class="sec"><span class="lbl red">[ Contradictions ]</span><span class="soft lbl">forget the wrong one, then resolve</span></h2>
${conflicts.map(c => `
<div style="border:1px solid var(--red);padding:16px 20px;margin-bottom:14px">
  <div style="padding:4px 0">#${c.aid}${c.aact ? '' : ' <span class="soft">(forgotten)</span>'} — ${esc(c.ac)}</div>
  <div style="padding:4px 0">#${c.bid}${c.bact ? '' : ' <span class="soft">(forgotten)</span>'} — ${esc(c.bc)}</div>
  <div style="display:flex;gap:16px;align-items:baseline;margin-top:10px">
    <span class="soft" style="flex:1">${esc(c.note ?? '')}</span>
    <form method="post" action="/resolve"><input type="hidden" name="id" value="${c.id}"><button>resolved</button></form>
  </div>
</div>`).join('')}` : ''}

<h2 class="sec"><span class="lbl">[ Memory ]</span>
  <span class="soft lbl num">${counts.a} active · ${counts.n - counts.a} forgotten</span>
  <span class="soft lbl">nothing is ever deleted</span></h2>
<form method="get" action="/memory" style="display:flex;gap:24px;align-items:baseline;margin-bottom:8px">
  <input type="search" name="q" placeholder="search her memory…" value="${esc(q)}" style="max-width:340px">
  <label class="soft lbl" style="cursor:pointer"><input type="checkbox" name="all" value="1" ${showInactive ? 'checked' : ''} onchange="this.form.submit()"> show forgotten</label>
</form>
<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%">
<tr>${['id', 'fact', 'cat', 'imp', 'sal', 'emotion', 'src', 'updated', ''].map(h => `<th class="soft lbl" style="text-align:left;padding:8px 10px 8px 0;border-bottom:1px solid var(--line);font-weight:400">${h}</th>`).join('')}</tr>
${rows.map(f => `<tr class="${f.active ? '' : 'inactive'}">
  <td class="soft num" style="padding:7px 10px 7px 0;border-bottom:1px solid rgba(23,19,14,.07);vertical-align:top">${f.id}</td>
  <td style="padding:7px 14px 7px 0;border-bottom:1px solid rgba(23,19,14,.07);letter-spacing:.04em">${esc(f.content)}</td>
  <td class="soft lbl" style="padding:7px 10px 7px 0;border-bottom:1px solid rgba(23,19,14,.07)">${esc(f.category)}</td>
  <td class="num" style="padding:7px 10px 7px 0;border-bottom:1px solid rgba(23,19,14,.07)">${f.importance}</td>
  <td class="num soft" style="padding:7px 10px 7px 0;border-bottom:1px solid rgba(23,19,14,.07)">${f.salience != null ? f.salience.toFixed(1) : '—'}</td>
  <td class="soft" style="padding:7px 10px 7px 0;border-bottom:1px solid rgba(23,19,14,.07)">${esc(f.emotion ?? '—')}</td>
  <td class="soft" style="padding:7px 10px 7px 0;border-bottom:1px solid rgba(23,19,14,.07)">${esc(f.source)}</td>
  <td class="soft num" style="padding:7px 10px 7px 0;border-bottom:1px solid rgba(23,19,14,.07)">${esc((f.updated_at ?? '').slice(0, 10))}</td>
  <td style="padding:7px 0;border-bottom:1px solid rgba(23,19,14,.07)">
    <form method="post" action="${f.active ? '/forget' : '/restore'}"><input type="hidden" name="id" value="${f.id}"><button>${f.active ? 'forget' : 'restore'}</button></form>
  </td></tr>`).join('')}
</table></div>`;
}

/* ---------------- JOURNAL ---------------- */

function journalPage(db) {
  const dreams = db.prepare('SELECT * FROM dreams ORDER BY id DESC LIMIT 40').all();
  const episodes = db.prepare('SELECT * FROM episodes ORDER BY id DESC LIMIT 60').all();
  return `
<h2 class="sec"><span class="lbl">[ Journal ]</span><span class="soft lbl">the pages she writes · dreams and episodes</span></h2>
<div class="grid2">
<section aria-label="dreams">
  ${dreams.map(d => `
  <article style="padding:26px 0;border-bottom:1px solid var(--line)">
    <div style="display:flex;gap:16px;margin-bottom:16px"><span class="lbl">[ Dream ]</span><span class="soft num lbl">${esc(d.date)}</span><span class="soft lbl num">[ 03:30 ]</span></div>
    ${d.epigraph ? `<p class="display" style="font-size:clamp(22px,2.4vw,32px);margin-bottom:18px">${esc(d.epigraph)}</p>` : ''}
    <p style="white-space:pre-wrap;line-height:1.9;letter-spacing:.04em">${esc(d.content)}</p>
  </article>`).join('') || '<p class="soft" style="padding:20px 0">no dreams yet.</p>'}
</section>
<section aria-label="episodes">
  ${episodes.map(e => `
  <article style="padding:26px 0;border-bottom:1px solid var(--line)">
    <div style="display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap">
      <span class="lbl">[ Episode #${e.id} ]</span>
      <span class="soft lbl num">${stamp(e.started_at)} → ${stamp(e.ended_at).slice(5)}</span>
      <span class="soft lbl num">${esc(e.emotion ?? '')}${e.salience != null ? ` · s ${e.salience.toFixed(1)}` : ''}</span>
    </div>
    <p style="white-space:pre-wrap;line-height:1.9;letter-spacing:.04em">${esc(e.summary)}</p>
  </article>`).join('') || '<p class="soft" style="padding:20px 0">no episodes yet.</p>'}
</section>
</div>`;
}

/* ---------------- SELF: drift trajectories ---------------- */

// One step-sparkline per dimension. Her value HOLDS between events, so the
// line is step-after: flat shelf, small step, flat shelf. Rails at 0.05/0.95
// are the EWMA floors/ceilings — the identity-stability invariant, drawn.
// Event lane below: ● capture-triggered, ◆ dream-triggered (shape, not color).
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
    const glyph = e.trigger === 'dream'
      ? `<rect x="-3" y="-3" width="6" height="6" transform="translate(${ex},${H - 11}) rotate(45)" fill="#17130E"/>`
      : `<circle cx="${ex}" cy="${H - 11}" r="2.5" fill="#6F675B"/>`;
    return `<g>${glyph}<rect x="${ex - 5}" y="${H - 18}" width="10" height="14" fill="transparent"><title>${esc(tip)}</title></rect><title>${esc(tip)}</title></g>`;
  }).join('');

  return `
<div style="min-width:0">
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
    <span class="lbl soft">${esc(dimension)}</span>
  </div>
  <svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(dimension)} drift, current ${current.toFixed(3)}">
    <line x1="0" y1="${y(0.95)}" x2="${plotW}" y2="${y(0.95)}" stroke="rgba(23,19,14,.14)" stroke-dasharray="2 4"/>
    <line x1="0" y1="${y(0.05)}" x2="${plotW}" y2="${y(0.05)}" stroke="rgba(23,19,14,.14)" stroke-dasharray="2 4"/>
    <path d="${d}" fill="none" stroke="#17130E" stroke-width="2" stroke-linejoin="miter"/>
    <circle cx="${plotW}" cy="${y(current)}" r="5" fill="#EFEBE2"/>
    <circle cx="${plotW}" cy="${y(current)}" r="3.2" fill="#17130E"/>
    <text x="${plotW + 8}" y="${y(current) + 4}" font-family="ui-monospace,Menlo,monospace" font-size="12" font-weight="700" fill="#17130E">${current.toFixed(3)}</text>
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
  <span class="soft lbl">step = one event · ● capture · ◆ dream · dashed rails = drift floors/ceilings · hover marks for detail</span></h2>
<h2 class="sec"><span class="lbl soft">disposition</span><span class="soft lbl">drifts over weeks — these should look nearly flat</span></h2>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px 40px">${tiles('disposition')}</div>
<h2 class="sec"><span class="lbl soft">with ${esc(WHO_USER)}</span><span class="soft lbl">drifts over days — these are allowed to breathe</span></h2>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px 40px">${tiles('relational')}</div>`;
}

/* ---------------- SELF ---------------- */

function selfPage(db) {
  const state = getSelfState();
  const events = db.prepare('SELECT * FROM self_state_events ORDER BY id DESC LIMIT 40').all();
  const opinions = db.prepare('SELECT * FROM opinions ORDER BY id DESC').all();
  const quirks = db.prepare('SELECT * FROM quirks ORDER BY observed_count DESC').all();
  const notes = getDocument('SELF_NOTES');
  const layer = l => state.filter(r => r.layer === l).map(r =>
    `<div class="trow"><span class="k">${esc(r.dimension)}</span><span class="v num">${r.value.toFixed(3)}</span></div>`).join('');
  return `
<h2 class="sec"><span class="lbl">[ Self ]</span><span class="soft lbl">who ${esc(WHO_COMP)} is becoming · identity core never drifts</span></h2>
${driftSection(db)}
<div class="grid2" style="margin-top:26px">
<div>
  <h2 class="sec"><span class="lbl soft">disposition</span><span class="soft lbl">drifts over weeks</span></h2>${layer('disposition')}
  <h2 class="sec"><span class="lbl soft">with ${esc(WHO_USER)}</span><span class="soft lbl">drifts over days</span></h2>${layer('relational')}
  <h2 class="sec"><span class="lbl soft">drift history</span></h2>
  ${events.map(e => `<div class="trow"><span class="k soft">${esc(e.dimension)}</span>
    <span class="num">${e.old_value.toFixed(3)} → ${e.new_value.toFixed(3)}</span>
    <span class="soft lbl">${esc(e.trigger)}</span><span class="soft num">${stamp(e.created_at).slice(5)}</span></div>`).join('') || '<p class="soft">no drift yet.</p>'}
</div>
<div>
  <h2 class="sec"><span class="lbl soft">opinions ${esc(WHO_COMP)} has formed</span></h2>
  ${opinions.map(o => `<p style="padding:10px 0;border-bottom:1px solid rgba(23,19,14,.07);line-height:1.8;letter-spacing:.04em">${esc(o.claim)}<br><span class="soft num">${esc(o.context ?? '')} · ${stamp(o.formed_at)}</span></p>`).join('') || '<p class="soft">none yet.</p>'}
  <h2 class="sec"><span class="lbl soft">quirks ${esc(WHO_COMP)} has noticed</span></h2>
  ${quirks.map(k => `<p style="padding:10px 0;border-bottom:1px solid rgba(23,19,14,.07);line-height:1.8;letter-spacing:.04em">${esc(k.pattern)} <span class="soft num">×${k.observed_count}</span></p>`).join('') || '<p class="soft">none yet.</p>'}
  <h2 class="sec"><span class="lbl soft">self notes</span></h2>
  <p style="white-space:pre-wrap;line-height:1.9;letter-spacing:.04em">${esc(notes || 'none yet.')}</p>
  <h2 class="sec"><span class="lbl soft">identity core</span><span class="soft lbl">read-only</span></h2>
  <details style="padding:8px 0"><summary class="lbl" style="cursor:pointer">soul.md</summary><pre style="white-space:pre-wrap;font-family:var(--mono);line-height:1.8;padding:14px 0;letter-spacing:.04em">${esc(getDocument('SOUL'))}</pre></details>
  <details style="padding:8px 0"><summary class="lbl" style="cursor:pointer">identity.md</summary><pre style="white-space:pre-wrap;font-family:var(--mono);line-height:1.8;padding:14px 0;letter-spacing:.04em">${esc(getDocument('IDENTITY'))}</pre></details>
</div>
</div>`;
}

/* ---------------- SYSTEM ---------------- */

async function systemPage() {
  const checks = await runChecks();
  const backups = backupList();
  const errPath = path.join(config.logsDir, 'glashaus.err');
  const logPath = path.join(config.logsDir, 'glashaus.log');
  const tail = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').slice(-14).join('\n') : '(empty)';
  return `
<h2 class="sec"><span class="lbl">[ System ]</span><span class="soft lbl">machinery · quarantined from ${esc(WHO_COMP)}</span></h2>
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
</div>
<div>
  <h2 class="sec"><span class="lbl soft">log</span></h2>
  <pre style="white-space:pre-wrap;font-family:var(--mono);font-size:11px;line-height:1.8;letter-spacing:.03em;overflow-x:auto">${esc(tail(logPath))}</pre>
  <h2 class="sec"><span class="lbl soft">errors</span></h2>
  <pre style="white-space:pre-wrap;font-family:var(--mono);font-size:11px;line-height:1.8;letter-spacing:.03em;overflow-x:auto">${esc(tail(errPath))}</pre>
</div>
</div>`;
}

/* ---------------- server ---------------- */

const FONTS = {
  '/assets/abril.ttf': path.join(config.appRoot, 'assets', 'fonts', 'abril.ttf'),
  '/assets/oldlondon.ttf': path.join(config.appRoot, 'assets', 'fonts', 'oldlondon.ttf'),
};

export function startViewer() {
  const db = getDb();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (FONTS[url.pathname]) {
        res.writeHead(200, { 'Content-Type': 'font/ttf', 'Cache-Control': 'public, max-age=604800' });
        res.end(fs.readFileSync(FONTS[url.pathname]));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/chat') {
        const body = await readBody(req);
        let text = '';
        try { text = JSON.parse(body).text?.trim() ?? ''; } catch { /* bad json */ }
        if (!text) { res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"empty"}'); return; }
        const reply = await handleUserMessage(text);
        const lastId = db.prepare('SELECT COALESCE(MAX(id),0) m FROM messages').get().m;
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ reply, lastId }));
        return;
      }

      if (url.pathname === '/chat.json') {
        const after = Number(url.searchParams.get('after')) || 0;
        const messages = db.prepare('SELECT id, role, content, source FROM messages WHERE id > ? ORDER BY id LIMIT 50').all(after);
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
  server.listen(PORT, BIND, () => {
    console.log(`glashaus: http://${BIND}:${PORT}`);
  });
  return server;
}

const readBody = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });

if (import.meta.url === `file://${process.argv[1]}`) {
  startViewer();
}
