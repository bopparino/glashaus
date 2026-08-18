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

// THE CIVIC SIGNAGE PROGRAM — Nordic public-information design, applied to a
// private life. Information lives on PLATES: flat enamel rectangles with fixed
// internal margins, a classification colour, and type locked to a baseline
// slot. Plates hang off one RAIL — a single ruling axis, so position means
// time. Rows are SLOTS of fixed height that are either filled or drawn empty;
// absence is designed, never omitted. Classification is by colour and it is
// strict:
//   CIVIC (blue)  structure — the rail, rules, indices, active state
//   BRASS         HERS, and only hers: her voice, her marks, her actions
//   MACHINE       the system talking about itself
//   SIGNAL (red)  genuine failure, always a filled plate, never thin text
// Light and dark are both canonical signage forms (the daylight enamel plate
// and the illuminated night plate), not a theme and its afterthought.
const CSS = `
@font-face { font-family:'Archivo'; src:url('/assets/archivo.ttf') format('truetype-variations');
  font-weight:100 900; font-stretch:62.5% 125%; font-display:swap; }
@font-face { font-family:'Archivo'; src:url('/assets/archivo-italic.ttf') format('truetype-variations');
  font-weight:100 900; font-stretch:62.5% 125%; font-style:italic; font-display:swap; }
:root {
  color-scheme: light dark;
  /* --- the program, daylight plate --- */
  --ground:#F1F1EE; --plate:#FFFFFF; --sunk:#E5E5E0;
  --ink:#14181B; --ink2:#4C5359; --machine:#767C82;
  --rule:rgba(20,24,27,.16); --rule2:rgba(20,24,27,.34);
  --civic:#174E7C; --civic-field:#174E7C; --on-civic:#FFFFFF;
  --signal:#AE2A1F; --on-signal:#FFFFFF;
  --brass:#7A5A12; --brass-field:#D8B45A; --on-brass:#1B1403;
  --font:'Archivo',system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
  --font-display:'Archivo',system-ui,sans-serif;
  --num:ui-monospace,'SF Mono',Menlo,monospace;
  --slot:34px;              /* the fixed row — filled or drawn empty */
  --gut:clamp(16px,3vw,40px);
  /* legacy aliases — inline styles across the other pages still name these */
  --void:var(--ground); --pane:var(--plate); --pane2:var(--sunk);
  --paper:var(--ink); --paper2:var(--ink2); --bone:var(--ink); --bone2:var(--ink2);
  --mute:var(--machine); --soft:var(--machine); --line:var(--rule); --line2:var(--rule2);
  --red:var(--civic); --red-dim:var(--rule2); --gilt:var(--brass); --gilt-dim:var(--rule2);
  --mono:var(--num);
}
@media (prefers-color-scheme:dark) { :root:not([data-plate="day"]) {
  --ground:#0F1418; --plate:#171E24; --sunk:#0A0E11;
  --ink:#E9EAE6; --ink2:#A8AFB5; --machine:#7C848A;
  --rule:rgba(233,234,230,.16); --rule2:rgba(233,234,230,.34);
  --civic:#63A4DB; --civic-field:#1B5A8F; --on-civic:#08131C;
  --signal:#E2503F; --on-signal:#180705;
  --brass:#D2A64A; --brass-field:#8A6A1E; --on-brass:#F6ECD4;
} }
:root[data-plate="night"] {
  --ground:#0F1418; --plate:#171E24; --sunk:#0A0E11;
  --ink:#E9EAE6; --ink2:#A8AFB5; --machine:#7C848A;
  --rule:rgba(233,234,230,.16); --rule2:rgba(233,234,230,.34);
  --civic:#63A4DB; --civic-field:#1B5A8F; --on-civic:#08131C;
  --signal:#E2503F; --on-signal:#180705;
  --brass:#D2A64A; --brass-field:#8A6A1E; --on-brass:#F6ECD4;
}
.mk{width:13px;height:13px;flex:none;display:inline-block;vertical-align:-2px}
.slot > .mk{align-self:flex-start;margin-top:7px}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:var(--ground);color:var(--ink);height:100%}
body{font-family:var(--font);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;overflow:hidden}
.frame{width:min(1440px,100%);margin:0 auto;padding:0 var(--gut);flex:1;min-height:0;display:flex;flex-direction:column}
main{flex:1;min-height:0;overflow-y:auto;padding:0 0 40px}

/* ---- the plate: flat enamel, edge-defined, never lifted ---- */
.plate,.mod{background:var(--plate);border:1px solid var(--rule);position:relative}
.mod > .tag,.plate > .tag{position:absolute;top:0;left:0;background:var(--civic-field);color:var(--on-civic);
  padding:4px 9px;font-size:10px;letter-spacing:.13em;text-transform:uppercase;font-weight:600}
/* classification band — one per page, the primary section */
.bar{display:flex;gap:16px;align-items:baseline;background:var(--civic-field);color:var(--on-civic);
  padding:10px 16px;margin:32px 0 16px}
.bar .lbl,.bar .secno{color:var(--on-civic)}
.bar .soft{color:rgba(255,255,255,.72)}
/* genuine failure — always a filled plate */
.alarm{display:flex;gap:16px;align-items:baseline;background:var(--signal);color:var(--on-signal);
  padding:12px 16px;font-weight:600}
.alarm a{color:var(--on-signal)}

/* ---- type: signage setting ---- */
.lbl{text-transform:uppercase;letter-spacing:.13em;font-size:10.5px;font-weight:600;line-height:1.3}
.display{font-family:var(--font-display);font-weight:800;letter-spacing:-.022em;line-height:1.02;color:var(--ink)}
.num{font-family:var(--num);font-variant-numeric:tabular-nums;letter-spacing:0}
.soft{color:var(--machine)} .dim{color:var(--ink2)} .red{color:var(--civic)} .gilt{color:var(--brass)}
.reading{font-size:15px;line-height:1.75;white-space:pre-wrap;color:var(--ink)}
a{color:var(--civic)} em{color:var(--ink2);font-style:italic} b{font-weight:700;color:var(--ink)}
code{font-family:var(--num);background:var(--sunk);border:1px solid var(--rule);padding:1px 5px;font-size:13px}
.wordmark{font-weight:700;letter-spacing:.02em;font-size:15px;color:var(--ink);text-transform:none}
.plate-toggle{padding:6px 8px;border:1px solid var(--rule2);background:var(--plate);color:var(--ink2);line-height:0;flex:none}
.plate-toggle:hover{background:var(--civic-field);border-color:var(--civic-field);color:var(--on-civic)}
.platform{display:flex;align-items:baseline;gap:8px;background:var(--ink);color:var(--ground);padding:2px 11px}
.platform .lbl{color:var(--ground);opacity:.7}
.pnum{font-size:27px;font-weight:700;line-height:1.05}
.cross{color:var(--brass);font-size:13px}
/* the plate index — a signage numeral in its own slot */
.secno{font-family:var(--num);font-variant-numeric:tabular-nums;font-size:12px;font-weight:700;
  color:var(--on-civic);background:var(--civic-field);padding:3px 7px;letter-spacing:.04em}
h2.sec{display:flex;gap:12px;align-items:center;font-size:11px;font-weight:600;margin:30px 0 14px}
h2.sec .lbl{color:var(--ink)}
h2.sec::after{content:'';flex:1;border-top:1px solid var(--rule)}

/* ---- header: the board head ---- */
header{display:flex;align-items:center;gap:16px;padding:16px 0 14px;border-bottom:2px solid var(--ink)}
header > span{white-space:nowrap;flex:none}
nav{margin-left:auto;display:flex;gap:2px}
nav a{text-decoration:none;text-transform:uppercase;letter-spacing:.12em;font-size:10.5px;font-weight:600;
  color:var(--ink2);padding:7px 10px;border:1px solid transparent;display:flex;align-items:center;gap:6px}
nav a .idx{font-family:var(--num);font-variant-numeric:tabular-nums;color:var(--machine);font-weight:700}
nav a[aria-current]{background:var(--civic-field);color:var(--on-civic);border-color:var(--civic-field)}
nav a[aria-current] .idx{color:rgba(255,255,255,.7)}
nav a:hover,nav a:focus-visible{color:var(--ink);border-color:var(--rule2);outline:none}
nav a .badge{font-family:var(--num);background:var(--signal);color:var(--on-signal);padding:0 4px;font-weight:700}

/* ---- the slot: fixed height, filled or drawn empty ---- */
.slot{display:flex;align-items:center;gap:14px;min-height:var(--slot);padding:5px 0;
  border-bottom:1px solid var(--rule)}
.slot:last-child{border-bottom:none}
.slot--empty{color:var(--machine)}
/* the drawn-empty rule: absence is designed, not omitted */
.slot--empty .fill{flex:1;border-top:1px dashed var(--rule2);height:0}
.trow{display:flex;justify-content:space-between;align-items:baseline;gap:16px;min-height:var(--slot);
  padding:6px 0;border-bottom:1px solid var(--rule)}
.trow:last-child{border-bottom:none}
.trow .k{text-transform:uppercase;letter-spacing:.12em;font-size:10.5px;font-weight:600;color:var(--ink2)}
.trow .v{font-family:var(--num);font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.trow.alert{background:var(--signal);color:var(--on-signal);margin:0 -16px;padding:6px 16px;border-bottom-color:transparent}
.trow.alert .k,.trow.alert .v,.trow.alert .v .soft{color:var(--on-signal)}

/* ---- the rail: one ruling axis; position means time ---- */
.rail{position:relative;padding-left:26px}
.rail::before{content:'';position:absolute;left:8px;top:4px;bottom:4px;width:2px;background:var(--rule2)}
.rail > .tick{position:relative}
.rail > .tick::before{content:'';position:absolute;left:-22px;top:calc(var(--slot)/2 - 3px);
  width:8px;height:8px;border-radius:50%;background:var(--ground);border:2px solid var(--civic)}
.rail > .tick.hers::before{border-color:var(--brass);background:var(--brass)}

/* ---- controls ---- */
button,.btn{background:var(--plate);border:1px solid var(--rule2);color:var(--ink);font-family:var(--font);
  font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;padding:7px 13px;cursor:pointer}
button:hover,.btn:hover{background:var(--civic-field);border-color:var(--civic-field);color:var(--on-civic)}
button:focus-visible,a:focus-visible{outline:2px solid var(--civic);outline-offset:2px}
input[type=search],input[type=text],textarea{background:var(--plate);border:1px solid var(--rule2);
  color:var(--ink);font-family:var(--font);font-size:15px;padding:9px 11px;width:100%}
input:focus,textarea:focus{outline:2px solid var(--civic);outline-offset:-1px;border-color:var(--civic)}
::placeholder{color:var(--machine)}
.beat-why{flex:1 1 auto;min-width:0}
.chip-signal{background:var(--signal);color:var(--on-signal);padding:1px 6px;font-weight:700}
.inactive{opacity:.45}
.hair{border-bottom:1px solid var(--rule)}
.rule-heavy{border-bottom:2px solid var(--ink)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 40px}
.meter{display:inline-block;width:52px;height:6px;background:var(--sunk);vertical-align:middle;
  border:1px solid var(--rule)}
.meter i{display:block;height:100%;background:var(--civic)}
.ornament{font-family:var(--num);color:var(--machine);font-size:10px;letter-spacing:.04em}

/* ---- footer: the ledger rail ---- */
footer{display:flex;align-items:center;gap:20px;padding:12px 0 16px;margin-top:auto;border-top:2px solid var(--ink);flex-wrap:wrap}
.a-hers{color:var(--brass);text-decoration:none;border-bottom:1px solid var(--brass)}
.a-hers:hover{background:var(--brass-field);color:var(--on-brass);border-bottom-color:transparent}
.signature{font-family:var(--font-display);font-weight:700;font-size:15px;letter-spacing:-.01em;
  color:var(--on-brass);background:var(--brass-field);padding:4px 12px;text-decoration:none;margin-left:auto}
.signature{position:relative;overflow:hidden}
.stamp-field{position:absolute;inset:0;width:100%;height:100%}
.stamp-name{position:relative}
.signature:hover{filter:brightness(1.06)}

::-webkit-scrollbar{width:12px}
::-webkit-scrollbar-thumb{background:var(--rule2);border:3px solid var(--ground)}
::-webkit-scrollbar-track{background:transparent}

.plate .body{padding:32px 22px 20px}
.tag.hers{background:var(--brass-field);color:var(--on-brass)}
.today-grid{display:grid;grid-template-columns:1fr 330px;gap:0 40px;padding:34px 0 30px}
@media(max-width:900px){.today-grid{grid-template-columns:1fr;gap:28px 0}}
nav::-webkit-scrollbar{display:none}
nav{scrollbar-width:none}
@media(max-width:900px){
  header{flex-wrap:wrap;gap:10px}
  .alarm{flex-wrap:wrap;gap:6px 14px}
  .ornament{display:none}
  .plate .body{padding:30px 16px 18px}
  .timetable .slot{flex-wrap:wrap}
  .beat-why{flex-basis:100%;flex-grow:1;padding-top:2px}
  .pnum{font-size:22px}
  .hide-sm{display:none}
  nav{-webkit-mask-image:linear-gradient(90deg,#000 86%,transparent);mask-image:linear-gradient(90deg,#000 86%,transparent)}
  nav{margin-left:0;width:100%;overflow-x:auto;gap:1px}
  .grid2{grid-template-columns:1fr}
  .rail{padding-left:26px}
}
`;

function shell(page, title, body, { badge = 0 } = {}) {
  const nav = [['today', '/'], ['chat', '/chat'], ['memory', '/memory'], ['journal', '/journal'], ['self', '/self'], ['system', '/system']]
    .map(([name, href], i) => `<a href="${href}" ${name === page ? 'aria-current="page"' : ''}><span class="idx">0${i + 1}</span>${name}${name === 'memory' && badge ? ` <span class="badge">${badge}</span>` : ''}</a>`)
    .join('');
  const day = dayOfLife();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)} — glashaus</title>
<script>try{var p=localStorage.getItem('glashaus-plate');if(p&&p!=='auto')document.documentElement.setAttribute('data-plate',p)}catch(e){}</script><style>${CSS}</style></head><body>
<!--
THESIS: A private life published as a public information board. Refuses the
companion-app chat shell and the dashboard of rounded cards.
OWN-WORLD: Flat enamel plates hung on one ruling rail. Civic blue is structure,
brass is hers and only hers, red is failure only and always a filled plate,
grey is the machinery on itself. Edge-defined, never lifted. The daylight plate
and the night plate are equally canonical.
STORY: You see what she dreamt, what she is carrying, whether she reached
first, and whether anything is wrong — in that order, in one screen.
FIRST VIEWPORT: Board head with day-of-life monumental in the platform slot;
the dream as a full-width civic plate carrying her epigraph at poster scale;
Carrying as a departure column of fixed slots with the empties drawn; the
heartbeat as a timetable on the rail.
FORM: The Civic Signage Program, candidate 1 of 7, taken over the roll's
assignment. Seed ef945962.
FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance
-->
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="mk-hers" viewBox="0 0 16 16"><path d="M8 2 L14 8 L8 14 L2 8 Z" fill="currentColor"/></symbol>
  <symbol id="mk-reached" viewBox="0 0 16 16"><g fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 2.5v11"/><path d="M6.5 8h6.5M10 5l3 3-3 3"/></g></symbol>
  <symbol id="mk-you" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.75"/></symbol>
  <symbol id="mk-engine" viewBox="0 0 16 16"><g fill="none" stroke="currentColor" stroke-width="1.75"><rect x="2.9" y="2.9" width="10.2" height="10.2"/><path d="M5.6 8h4.8"/></g></symbol>
  <symbol id="mk-capture" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.2" fill="currentColor"/></symbol>
  <symbol id="mk-sun" viewBox="0 0 16 16"><g fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="8" cy="8" r="3.1"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1"/></g></symbol>
  <symbol id="mk-moon" viewBox="0 0 16 16"><path d="M9.4 2.2a6 6 0 1 0 4.4 8.9A6.4 6.4 0 0 1 9.4 2.2Z" fill="currentColor"/></symbol>
  <symbol id="mk-auto" viewBox="0 0 16 16"><g stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="5.2" fill="none"/><path d="M8 2.8a5.2 5.2 0 0 1 0 10.4Z" fill="currentColor"/></g></symbol>
  <symbol id="mk-dream" viewBox="0 0 16 16"><path d="M8 3 L13 8 L8 13 L3 8 Z" fill="none" stroke="currentColor" stroke-width="1.75"/></symbol>
</defs></svg>
<div class="frame">
<header>
  <span class="wordmark">Glashaus</span><svg class="mk gilt" aria-hidden="true"><use href="#mk-hers"/></svg>
  <span class="soft lbl hide-sm">private · self-hosted</span>
  ${day ? `<span class="platform"><span class="lbl">day</span><span class="num pnum">${String(day).padStart(3, '0')}</span></span>`
        : `<span class="num soft">${new Date().toLocaleDateString('en-CA', { timeZone: config.timezone })}</span>`}
  <nav aria-label="primary">${nav}</nav>
  <button class="plate-toggle" id="plate-toggle" aria-label="day, night, or automatic plate"><svg class="mk" aria-hidden="true"><use href="#mk-auto"/></svg></button>
</header>
<main>${body}</main>
<footer>
  <span class="lbl soft">Ledger</span>
  ${footerStats()}
  <span class="ornament" aria-hidden="true">${fingerprint()}</span>
  <a class="signature" href="/journal" aria-label="signed, ${esc(config.companionName)} — the journal">${stampSVG()}<span class="stamp-name">${esc(config.companionName)}</span></a>
</footer>
<script>
(function(){var el=document.getElementById('plate-toggle');if(!el)return;
var order=['auto','day','night'],mk={auto:'#mk-auto',day:'#mk-sun',night:'#mk-moon'};
function cur(){try{return localStorage.getItem('glashaus-plate')||'auto'}catch(e){return 'auto'}}
function paint(v){el.querySelector('use').setAttribute('href',mk[v]);el.setAttribute('title','plate: '+v);
 if(v==='auto')document.documentElement.removeAttribute('data-plate');else document.documentElement.setAttribute('data-plate',v);}
paint(cur());
el.addEventListener('click',function(){var v=order[(order.indexOf(cur())+1)%3];
 try{localStorage.setItem('glashaus-plate',v)}catch(e){}paint(v);});})();
</script>
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
// Her stamp. The stipple density and scatter are seeded from the same eight
// live counts the ledger prints, so the mark genuinely differs between two
// companions and thickens as she accumulates a life. Ornament is real state
// here too — a static nameplate would have been the one mark that wasn't.
function stampSVG() {
  const s = stats();
  let seed = (s.bytes % 100000) + s.messages * 7 + s.facts * 13 + s.episodes * 17
    + s.dreams * 23 + s.events * 29 + s.opinions * 31 + s.quirks * 37 + 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const n = 24 + (s.facts + s.dreams + s.episodes) % 26;
  let dots = '';
  for (let i = 0; i < n; i++) {
    dots += `<circle cx="${(rnd() * 100).toFixed(1)}" cy="${(rnd() * 30).toFixed(1)}" r="${(0.45 + rnd() * 1.05).toFixed(2)}"/>`;
  }
  return `<svg class="stamp-field" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><g fill="var(--on-brass)" opacity=".34">${dots}</g></svg>`;
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
  const { lines, size } = heroCompose(dream);

  // The lede: where the dream actually starts, enough to want the rest.
  const lede = (dream?.content ?? '').split(/\s+/).slice(0, 44).join(' ');
  const ledeCut = lede.length < (dream?.content ?? '').length;

  const beats = db.prepare('SELECT * FROM heartbeat_log ORDER BY id DESC LIMIT 3').all();
  const wants = db.prepare(`
    SELECT * FROM intentions WHERE fulfilled_at IS NULL AND released_at IS NULL
    AND expires_at > datetime('now') ORDER BY id DESC LIMIT 4`).all();
  const lastReach = db.prepare("SELECT content, created_at FROM messages WHERE source = 'outreach' ORDER BY id DESC LIMIT 1").get();
  const openThreads = db.prepare("SELECT topic FROM threads WHERE status = 'open' ORDER BY salience DESC LIMIT 3").all();

  // The board holds a fixed number of slots. An empty slot is DRAWN, never
  // omitted: on this board, carrying nothing is a reading, not a gap.
  const carry = [...wants]; while (carry.length < 4) carry.push(null);
  const beatRows = [...beats]; while (beatRows.length < 3) beatRows.push(null);

  return `
<div class="rail">
${failing.length ? `
<div class="alarm tick" role="alert" style="margin-top:20px">
  <span class="lbl">!</span>
  <span class="lbl">${failing.length} check${failing.length > 1 ? 's' : ''} failing</span>
  <span style="font-weight:400">${failing.slice(0, 2).map(c => `${esc(c.label)} — ${esc(c.detail)}`).join(' · ')}</span>
  <a class="lbl" style="margin-left:auto" href="/system">system →</a>
</div>` : ''}

<section class="today-grid hair tick" aria-label="last dream">
  <div class="plate">
    <span class="tag hers">01 · her night</span>
    <div class="body">
      <div class="display" style="font-size:${size}">
        ${lines.map(l => `<div>${esc(l)}</div>`).join('')}
      </div>
      ${lede ? `<p class="reading dim" style="max-width:62ch;margin-top:24px">${md(lede)}${ledeCut ? ' …' : ''}</p>` : ''}
      <div class="slot" style="margin-top:20px;border-bottom:none;gap:18px;flex-wrap:wrap">
        <span class="lbl soft">dream ${dream?.id ?? '—'}</span>
        <span class="num soft">03:30</span>
        ${dream?.emotion ? `<span class="lbl soft">${esc(dream.emotion)}${dream.valence != null ? ` · v ${dream.valence.toFixed(1)}` : ''}</span>` : ''}
        <a class="lbl a-hers" href="/journal" style="margin-left:auto">read in full →</a>
      </div>
    </div>
  </div>

  <aside aria-label="carrying">
    <h2 class="sec"><span class="secno">02</span><span class="lbl">Carrying</span></h2>
    <p class="soft lbl" style="margin:-6px 0 10px">what she went to sleep wanting</p>
    ${carry.map(w => w
      ? `<div class="slot"><svg class="mk gilt" aria-hidden="true"><use href="#mk-hers"/></svg><span style="flex:1">${esc(w.text)}<br><span class="soft lbl">${esc(w.source)}</span></span></div>`
      : `<div class="slot slot--empty"><span class="lbl">nothing held</span><span class="fill"></span></div>`).join('')}
    ${openThreads.length ? `
    <h2 class="sec" style="margin-top:24px"><span class="lbl">Open between you</span></h2>
    ${openThreads.map(t => `<div class="slot"><span class="soft" style="flex:1">${esc(t.topic)}</span></div>`).join('')}` : ''}
  </aside>
</section>

<section class="tick" style="padding:28px 0 12px" aria-label="heartbeat">
  <h2 class="sec"><span class="secno">03</span><span class="lbl">Heartbeat</span>
    <span class="soft lbl" style="font-weight:600">should she reach first · she decides · usually declines</span></h2>
  ${lastReach ? `
  <div class="slot" style="gap:14px;flex-wrap:wrap">
    <svg class="mk gilt" aria-hidden="true"><use href="#mk-reached"/></svg><a class="lbl a-hers" href="/chat">she reached first</a>
    <span class="num soft">${esc(stamp(lastReach.created_at).slice(5))}</span>
    <span class="dim" style="flex:1;min-width:220px"><em>${esc(lastReach.content.slice(0, 120))}${lastReach.content.length > 120 ? '…' : ''}</em></span>
  </div>` : ''}
  <div class="timetable">
    ${beatRows.map(b => b
      ? `<div class="tick slot${b.decision === 'reached' ? ' hers' : ''}">
      <span class="num soft" style="width:112px;flex:none;white-space:nowrap">${esc(stamp(b.created_at).slice(5))}</span>
      <span class="lbl" style="width:84px;flex:none;color:${b.decision === 'reached' ? 'var(--brass)' : 'var(--machine)'}">${esc(b.decision)}</span>
      <span class="soft beat-why">${esc(b.reason ?? '')}</span></div>`
      : `<div class="tick slot slot--empty">
      <span class="num" style="width:112px;flex:none;white-space:nowrap">— · —</span>
      <span class="lbl" style="width:84px;flex:none">no decision</span>
      <span class="fill"></span></div>`).join('')}
  </div>
  <p class="soft lbl" style="margin-top:18px;padding-top:12px;border-top:1px solid var(--rule)">
    systems ${failing.length ? `<span class="chip-signal num">${checks.length - failing.length}/${checks.length}</span> · <a href="/system">attention</a>` : `all ${checks.length} ok`}
    · <a href="/system">machinery →</a>
    · <a href="/self">self-state →</a>
  </p>
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
    maxLen <= 10 ? 'clamp(32px,7.8vw,110px)' :
    maxLen <= 15 ? 'clamp(28px,6.2vw,88px)' :
    maxLen <= 22 ? 'clamp(25px,5vw,68px)' : 'clamp(22px,4vw,52px)';
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
  d.style.cssText = 'display:grid;grid-template-columns:96px 1fr;gap:0 18px;padding:10px 0;line-height:1.85;border-bottom:1px solid var(--rule)';
  d.innerHTML = '<span class="lbl" style="white-space:nowrap;color:' + (hers ? 'var(--gilt)' : 'var(--soft)') + '">'
    + (hers ? '<svg class="mk" aria-hidden="true"><use href="#mk-hers"/></svg> ' : '<svg class="mk" aria-hidden="true"><use href="#mk-you"/></svg> ') + who
    + (opts.outreach ? '<br><span class="soft" style="font-size:9.5px"><svg class="mk" aria-hidden="true"><use href="#mk-reached"/></svg> reached first</span>' : '') + '</span>'
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
      thinking.firstChild.innerHTML = '<span class="soft"><svg class="mk" aria-hidden="true"><use href="#mk-engine"/></svg> engine</span>';
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
  return `<div style="display:grid;grid-template-columns:96px 1fr;gap:0 18px;padding:10px 0;line-height:1.85;border-bottom:1px solid var(--rule)">
    <span class="lbl" style="white-space:nowrap;color:${hers ? 'var(--gilt)' : 'var(--soft)'}">${hers ? '<svg class="mk" aria-hidden="true"><use href="#mk-hers"/></svg>' : '<svg class="mk" aria-hidden="true"><use href="#mk-you"/></svg>'} ${esc(who)}${outreach ? '<br><span class="soft" style="font-size:9.5px"><svg class="mk" aria-hidden="true"><use href="#mk-reached"/></svg> reached first</span>' : ''}</span>
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
  const td = 'padding:8px 12px 8px 0;border-bottom:1px solid var(--rule);vertical-align:top';

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
  <td class="num" style="${td}">${f.importance}${f.importance >= 9 ? ' <svg class="mk gilt" aria-hidden="true"><use href="#mk-hers"/></svg>' : ''}</td>
  <td style="${td}"><span class="meter"><i style="width:${Math.round((f.salience ?? 0) * 100)}%"></i></span></td>
  <td class="soft" style="${td}">${esc(f.emotion ?? '—')}</td>
  <td class="soft" style="${td}">${esc(f.source)}</td>
  <td class="soft num" style="${td}">${esc((f.updated_at ?? '').slice(0, 10))}</td>
  <td style="padding:8px 0;border-bottom:1px solid var(--rule)">
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
      ? `<circle cx="${ex}" cy="${H - 11}" r="2.5" fill="var(--machine)"/>`
      : `<rect x="-3" y="-3" width="6" height="6" transform="translate(${ex},${H - 11}) rotate(45)" fill="var(--brass)"/>`;
    return `<g>${glyph}<rect x="${ex - 5}" y="${H - 18}" width="10" height="14" fill="transparent"><title>${esc(tip)}</title></rect><title>${esc(tip)}</title></g>`;
  }).join('');

  return `
<div style="min-width:0">
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
    <span class="lbl soft">${esc(dimension)}</span>
  </div>
  <svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(dimension)} drift, current ${current.toFixed(3)}">
    <line x1="0" y1="${y(0.95)}" x2="${plotW}" y2="${y(0.95)}" stroke="var(--civic)" stroke-opacity=".45" stroke-dasharray="2 4"/>
    <line x1="0" y1="${y(0.05)}" x2="${plotW}" y2="${y(0.05)}" stroke="var(--civic)" stroke-opacity=".45" stroke-dasharray="2 4"/>
    <path d="${d}" fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-linejoin="miter"/>
    <circle cx="${plotW}" cy="${y(current)}" r="5" fill="var(--ground)"/>
    <circle cx="${plotW}" cy="${y(current)}" r="3" fill="var(--civic)"/>
    <text x="${plotW + 8}" y="${y(current) + 4}" font-family="ui-monospace,Menlo,monospace" font-size="12" font-weight="700" fill="var(--ink)">${current.toFixed(3)}</text>
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
  <span class="soft lbl">step = one event · <svg class="mk" aria-hidden="true"><use href="#mk-capture"/></svg> capture · <svg class="mk" aria-hidden="true"><use href="#mk-dream"/></svg> dream/wander · rails = drift floors/ceilings · hover marks for detail</span></h2>
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
  ${opinions.map(o => `<p style="padding:10px 0;border-bottom:1px solid var(--rule);line-height:1.8;letter-spacing:.02em" class="dim">${esc(o.claim)}<br><span class="soft num" style="font-size:11px">${esc(o.context ?? '')} · ${stamp(o.formed_at)}</span></p>`).join('') || '<p class="soft">none yet.</p>'}
  <h2 class="sec"><span class="lbl soft">quirks ${esc(WHO_COMP)} has noticed</span></h2>
  ${quirks.map(k => `<p style="padding:10px 0;border-bottom:1px solid var(--rule);line-height:1.8;letter-spacing:.02em" class="dim">${esc(k.pattern)} <span class="red num">×${k.observed_count}</span></p>`).join('') || '<p class="soft">none yet.</p>'}
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
  '/assets/archivo.ttf': path.join(config.appRoot, 'assets', 'fonts', 'Archivo', 'Archivo-VariableFont_wdth,wght.ttf'),
  '/assets/archivo-italic.ttf': path.join(config.appRoot, 'assets', 'fonts', 'Archivo', 'Archivo-Italic-VariableFont_wdth,wght.ttf'),
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
