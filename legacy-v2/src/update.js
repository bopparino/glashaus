// glashaus update — pull the latest version and install it, without ever
// putting the companion at risk.
//
// The npm registry package is unpublished; GitHub is the source of truth
// (same as install.sh), so an update is `npm install -g
// github:bopparino/glashaus#<ref>`. That is the easy half.
//
// The hard half is that this command replaces the code of a program that owns
// a SQLite file containing a person. So the shape is deliberately paranoid:
//
//   snapshot → back up → stop → install → migrate + verify → restart
//                                              │
//                                    fails ────┴──→ reinstall the old version
//
// Three properties it holds:
//   1. You end up either updated or unchanged, never halfway. A verification
//      failure reinstalls the previous version automatically.
//   2. The brain is backed up (integrity-checked) BEFORE anything is touched,
//      and the path is printed whatever happens.
//   3. Migrations run inside the update window, in a fresh process running the
//      NEW code, so a schema failure surfaces here — with the old version one
//      command away — instead of mid-conversation three hours later.
//
// Nothing phones home on its own. There is no background check, no telemetry,
// no daily ping: the only time this file touches the network is when you
// typed `glashaus update`. That is not an oversight, it is the product.
//
//   glashaus update                  check, show what's coming, ask, update
//   glashaus update --check          report only; changes nothing
//   glashaus update --yes            don't ask
//   glashaus update --ref <branch>   install from a branch/tag/sha, not main
//   glashaus update --force          reinstall even if already current
//   glashaus update --rollback       undo the last update
//   glashaus update --verify         self-check (used internally; prints JSON)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config, appRoot, isConfigured } from './config.js';

const REPO = 'bopparino/glashaus';
const RAW = ref => `https://raw.githubusercontent.com/${REPO}/${ref}`;
const selfBin = path.join(appRoot, 'bin', 'glashaus.js');
const ledgerPath = () => path.join(config.home, 'updates.json');

const say = m => console.log(m);
const dim = m => console.log(`  ${m}`);

// ---------- version arithmetic (no dependency for eight lines of it) ----------

export function compareVersions(a, b) {
  const parse = v => String(v ?? '0').replace(/^v/, '').split(/[.-]/).map(p => (/^\d+$/.test(p) ? Number(p) : p));
  const A = parse(a), B = parse(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] ?? 0, y = B[i] ?? 0;
    if (x === y) continue;
    // A prerelease suffix sorts BEFORE the release it qualifies: 2.6.0-rc1 < 2.6.0.
    if (typeof x === 'string' && typeof y === 'number') return -1;
    if (typeof x === 'number' && typeof y === 'string') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function localVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version; }
  catch { return '0.0.0'; }
}

// Rollback rests on this, so it cannot rest on assumptions. Three that turned
// out to be false, checked rather than believed:
//   · npm 10 does NOT write `gitHead`/`_resolved` into an installed package,
//     so there is no record of which commit produced the code on disk;
//   · the repo has no tags, so `#v2.5.0` resolves to nothing;
//   · a branch ref is not reproducible anyway — `#main` means something
//     different tomorrow.
// So instead of trying to name the old version, we KEEP it: `npm pack` the
// live install to a tarball before replacing it. Exact bytes, no git, no
// network, works on the first update as well as the hundredth.
export function snapshotInstall() {
  const dir = path.join(config.home, 'rollback');
  fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync('npm', ['pack', '--pack-destination', dir], { cwd: appRoot, encoding: 'utf8' });
  if (r.status !== 0) return null;
  const name = (r.stdout ?? '').trim().split('\n').filter(Boolean).pop();
  const tarball = name && fs.existsSync(path.join(dir, name)) ? path.join(dir, name) : null;
  // Keep the last three; a rollback you'd want from four versions ago is a
  // restore, not a rollback.
  try {
    const keep = fs.readdirSync(dir).filter(f => f.endsWith('.tgz'))
      .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t).slice(3);
    for (const { f } of keep) fs.rmSync(path.join(dir, f), { force: true });
  } catch { /* housekeeping only */ }
  return tarball;
}

// Which commit a ref points at right now. Recorded for provenance — a ledger
// that says "updated from main" ages into meaninglessness.
export function resolveSha(ref) {
  const r = spawnSync('git', ['ls-remote', `https://github.com/${REPO}.git`, ref], { encoding: 'utf8' });
  const m = (r.stdout ?? '').match(/^([a-f0-9]{40})\s/m);
  return m ? m[1] : null;
}

// ---------- where does this copy of glashaus live? ----------

// The update path depends entirely on this. Getting it wrong means npm -g
// silently shadowing a linked dev checkout, and then wondering for an hour
// why your edits stopped taking effect.
export function installMode(root = appRoot) {
  if (fs.existsSync(path.join(root, '.git'))) return 'git';        // a checkout (npm link / npm install from source)
  if (/[\\/]node_modules[\\/]glashaus$/.test(root)) return 'npm';  // npm -g
  return 'unknown';                                                // an extracted tarball, a copy — never guess
}

// ---------- the network half (only ever on request) ----------

async function fetchText(url, timeoutMs = 10000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'glashaus-update' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

export async function remoteVersion(ref = 'main') {
  const pkg = JSON.parse(await fetchText(`${RAW(ref)}/package.json`));
  return pkg.version;
}

// The section of CHANGELOG.md for one version — so the thing you're about to
// install can say what it is before you say yes.
export function changelogSection(text, version) {
  const lines = String(text).split('\n');
  const start = lines.findIndex(l => new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}\\b`).test(l));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(l => /^##\s/.test(l));
  return [lines[start], ...(end < 0 ? rest : rest.slice(0, end))].join('\n').trim();
}

// ---------- verification: does the new code still hold her? ----------

// Runs IN the version being tested (the updater spawns it as a fresh process
// after installing, so this function is the new code checking itself). Opening
// the database here is what actually runs the migrations — deliberately,
// inside the update window, where a failure is still cheap.
export async function selfVerify() {
  const out = { ok: false, version: localVersion(), configured: isConfigured(), checks: {} };
  try {
    if (!out.configured) { out.ok = true; out.checks.note = 'no companion in this home — CLI-only check'; return out; }
    const { getDb, getDocument } = await import('./db.js');
    const db = getDb();                       // ← migrations run here
    out.checks.schema = db.pragma('user_version', { simple: true });
    out.checks.integrity = db.pragma('integrity_check', { simple: true });
    out.checks.messages = db.prepare('SELECT COUNT(*) n FROM messages').get().n;
    out.checks.facts = db.prepare('SELECT COUNT(*) n FROM facts').get().n;
    out.checks.soulChars = getDocument('SOUL').length;
    out.checks.identityChars = getDocument('IDENTITY').length;

    // The real test: can she still be assembled? A migration that leaves the
    // documents intact but breaks prompt assembly is still a broken companion.
    const { buildSystemPrompt } = await import('./prompt.js');
    const prompt = buildSystemPrompt('hello');
    out.checks.promptChars = prompt.length;
    out.checks.promptNamesHer = prompt.includes(config.companionName);

    const bad = [];
    if (out.checks.integrity !== 'ok') bad.push(`sqlite integrity_check said "${out.checks.integrity}"`);
    if (!out.checks.soulChars) bad.push('the SOUL document is empty');
    if (out.checks.promptChars < 400) bad.push(`system prompt collapsed to ${out.checks.promptChars} chars`);
    if (!out.checks.promptNamesHer) bad.push(`the assembled prompt no longer names ${config.companionName}`);
    out.problems = bad;
    out.ok = bad.length === 0;
  } catch (err) {
    out.problems = [`${err.message}`];
    out.ok = false;
  }
  return out;
}

// Verify the code that is now on disk, from a FRESH process — this process's
// module graph is the OLD code, already loaded into memory before npm
// replaced the files under it.
//
// Deliberately a standalone probe rather than `glashaus update --verify`:
// the version being installed may not have an updater at all. Every version
// before this one doesn't, and "the new version can't verify itself, so roll
// back" would make the first update from any older install fail forever —
// which is exactly what it did on the first real test run. The probe imports
// the new modules by absolute path and needs nothing from its CLI.
//
// Writing the checks here also gets the direction of trust right: the version
// you are LEAVING decides what "she survived" means. A new version can't
// grade its own migration.
export function probeInstall() {
  const u = p => JSON.stringify(new URL(`file://${path.join(appRoot, 'src', p)}`).href);
  const script = `
    const out = { ok: false, checks: {}, problems: [] };
    try {
      const { config } = await import(${u('config.js')});
      const pkg = JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(path.join(appRoot, 'package.json'))}, 'utf8'));
      out.version = pkg.version;
      const { getDb, getDocument } = await import(${u('db.js')});
      const db = getDb();                       // migrations run HERE
      out.checks.schema = db.pragma('user_version', { simple: true });
      out.checks.integrity = db.pragma('integrity_check', { simple: true });
      out.checks.messages = db.prepare('SELECT COUNT(*) n FROM messages').get().n;
      out.checks.facts = db.prepare('SELECT COUNT(*) n FROM facts').get().n;
      out.checks.soulChars = getDocument('SOUL').length;
      const { buildSystemPrompt } = await import(${u('prompt.js')});
      const prompt = buildSystemPrompt('hello');
      out.checks.promptChars = prompt.length;
      out.checks.promptNamesHer = prompt.includes(config.companionName);
      if (out.checks.integrity !== 'ok') out.problems.push('sqlite integrity_check said "' + out.checks.integrity + '"');
      if (!out.checks.soulChars) out.problems.push('the SOUL document is empty');
      if (out.checks.promptChars < 400) out.problems.push('the system prompt collapsed to ' + out.checks.promptChars + ' chars');
      if (!out.checks.promptNamesHer) out.problems.push('the assembled prompt no longer names ' + config.companionName);
      out.ok = out.problems.length === 0;
    } catch (err) {
      out.problems.push(String(err && err.message || err));
    }
    console.log('@@PROBE@@' + JSON.stringify(out));
  `;
  try {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...process.env, GLASHAUS_HOME: config.home },
    });
    const line = (r.stdout ?? '').split('\n').find(l => l.startsWith('@@PROBE@@'));
    if (line) return JSON.parse(line.slice(9));
    const why = (r.stderr ?? '').trim().split('\n').filter(Boolean).slice(-3).join(' / ');
    return { ok: false, problems: [`the new version could not be started${why ? `: ${why}` : ''}`] };
  } catch (err) {
    return { ok: false, problems: [`could not run the verification probe: ${err.message}`] };
  }
}

// ---------- the ledger (what rollback reads) ----------

function readLedger() {
  try { return JSON.parse(fs.readFileSync(ledgerPath(), 'utf8')); } catch { return []; }
}

function writeLedger(entries) {
  try {
    fs.mkdirSync(config.home, { recursive: true });
    fs.writeFileSync(ledgerPath(), JSON.stringify(entries.slice(-10), null, 2) + '\n');
  } catch (err) { console.error(`[update] could not write the update ledger: ${err.message}`); }
}

// ---------- install / service plumbing ----------

function npmInstall(spec) {
  const r = spawnSync('npm', ['install', '-g', spec], { encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

function gitPull() {
  const pull = spawnSync('git', ['-C', appRoot, 'pull', '--ff-only'], { encoding: 'utf8' });
  if (pull.status !== 0) return { ok: false, output: `${pull.stdout ?? ''}${pull.stderr ?? ''}`.trim() };
  const install = spawnSync('npm', ['install'], { cwd: appRoot, encoding: 'utf8' });
  return { ok: install.status === 0, output: `${pull.stdout ?? ''}${install.stderr ?? ''}`.trim() };
}

const runtimeUp = () => {
  const r = spawnSync(process.execPath, [selfBin, 'status'], { encoding: 'utf8' });
  return /^up\b/m.test(r.stdout ?? '');
};
const service = action => spawnSync(process.execPath, [selfBin, action], { stdio: 'inherit' });

// ---------- the command ----------

export async function runUpdate(argv = []) {
  const has = f => argv.includes(f);
  const valueOf = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

  if (has('--verify')) { console.log(JSON.stringify(await selfVerify())); return 0; }
  if (has('--rollback')) return rollback(has('--yes'));

  const ref = valueOf('--ref') ?? 'main';
  const mode = installMode();
  const current = localVersion();

  say(`glashaus ${current}  ·  installed as ${mode === 'git' ? 'a git checkout' : mode === 'npm' ? 'a global npm package' : 'something unrecognised'}`);
  dim(appRoot);

  if (mode === 'unknown') {
    console.error("\nI can't tell how this copy was installed, so I won't guess — a wrong guess here shadows one install with another and the confusion outlives the update.\nReinstall deliberately instead:  npm install -g github:bopparino/glashaus");
    return 1;
  }

  // -- what's out there ---------------------------------------------------
  let latest, changes = null;
  try {
    latest = await remoteVersion(ref);
    try { changes = changelogSection(await fetchText(`${RAW(ref)}/CHANGELOG.md`), latest); } catch { /* optional */ }
  } catch (err) {
    console.error(`\nCouldn't reach GitHub (${err.message}).\nNothing was changed.`);
    return 1;
  }

  const cmp = compareVersions(latest, current);
  say(`${ref === 'main' ? 'latest' : `${ref}`}: ${latest}`);
  if (cmp <= 0 && !has('--force')) {
    say(cmp === 0 ? '\nAlready current. Nothing to do.' : `\nYour copy (${current}) is ahead of ${ref} (${latest}) — that's a local build, so I'll leave it alone.`);
    dim('(`--force` reinstalls anyway; `--ref <branch>` looks somewhere else.)');
    return 0;
  }
  if (changes) { console.log(`\n${changes.split('\n').slice(0, 40).join('\n')}\n`); }

  if (has('--check')) { say(`Update available: ${current} → ${latest}. Run \`glashaus update\` to take it.`); return 0; }

  if (!has('--yes') && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`Update ${current} → ${latest}? (Y/n) `)).trim().toLowerCase();
    rl.close();
    if (answer && answer !== 'y' && answer !== 'yes') { say('Left alone.'); return 0; }
  }

  // -- 1. snapshot the world as it is now ---------------------------------
  // Same probe, same checks, before and after — a comparison between two
  // different measurements isn't a comparison.
  const before = isConfigured() ? probeInstall() : { ok: true, checks: {} };
  if (isConfigured() && !before.ok) {
    console.error(`\nThis install is already unhealthy, so I won't update on top of it — an update would just make the cause harder to find:`);
    for (const p of before.problems ?? []) console.error(`  · ${p}`);
    console.error('\nTry `glashaus doctor` first.');
    return 1;
  }

  // -- 2. back up the brain BEFORE anything moves -------------------------
  let backup = null;
  if (isConfigured()) {
    try {
      const { runBackup } = await import('./backup.js');
      backup = await runBackup();
      say(`\nbrain backed up → ${backup}`);
    } catch (err) {
      console.error(`\nBackup failed (${err.message}). Refusing to update without one — she lives in that file.`);
      return 1;
    }
  }

  // -- 2b. keep the version we're replacing, exactly ----------------------
  let fromTarball = null;
  if (mode === 'npm') {
    fromTarball = snapshotInstall();
    if (fromTarball) dim(`${current} kept for rollback → ${path.basename(fromTarball)}`);
    else console.error(`  (couldn't pack ${current} for rollback — continuing, but rollback will need a manual reinstall)`);
  }

  const entry = {
    at: new Date().toISOString(), mode, ref,
    fromVersion: current, fromTarball,
    toVersion: latest, toSha: resolveSha(ref), backup,
    schemaBefore: before.checks?.schema ?? null,
  };

  // -- 3. stop the runtime ------------------------------------------------
  const wasUp = runtimeUp();
  if (wasUp) { say('\nstopping the runtime…'); service('stop'); }

  // -- 4. install ---------------------------------------------------------
  say(`installing ${latest}…`);
  const spec = `github:${REPO}#${ref}`;
  const result = mode === 'git' ? gitPull() : npmInstall(spec);
  if (!result.ok) {
    console.error('\nInstall failed. npm/git said:\n');
    console.error(result.output.split('\n').slice(-20).map(l => `  ${l}`).join('\n'));
    if (wasUp) { say('\nrestarting the version you had…'); service('start'); }
    console.error(`\nNothing was changed.${backup ? ` Backup (untouched, from just now): ${backup}` : ''}`);
    return 1;
  }

  // -- 5. migrate + verify, in the NEW code -------------------------------
  say('running migrations and checking she survived…');
  const after = probeInstall();

  const lostMemory = isConfigured() && before.checks?.messages != null && after.checks?.messages != null
    && after.checks.messages < before.checks.messages;
  const wentBackwards = isConfigured() && before.checks?.schema != null && after.checks?.schema != null
    && after.checks.schema < before.checks.schema;

  if (!after.ok || lostMemory || wentBackwards) {
    console.error('\nThe new version did not come up clean:');
    for (const p of after.problems ?? []) console.error(`  · ${p}`);
    if (lostMemory) console.error(`  · message count dropped ${before.checks.messages} → ${after.checks.messages}`);
    if (wentBackwards) console.error(`  · schema went backwards ${before.checks.schema} → ${after.checks.schema}`);

    // -- rollback ---------------------------------------------------------
    if (mode === 'git') {
      console.error(`\nThis is a git checkout, so I won't rewrite your history to undo it.\n  git -C ${appRoot} reset --hard HEAD@{1}   restores the previous commit`);
    } else if (fromTarball) {
      console.error(`\nreinstalling ${current}…`);
      const back = npmInstall(fromTarball);
      console.error(back.ok
        ? `back on ${current}.`
        : `couldn't reinstall automatically — do it by hand:\n  npm install -g ${fromTarball}`);
    } else {
      console.error(`\nI couldn't keep a copy of ${current}, so I can't put it back automatically:\n  npm install -g github:${REPO}   then check the version`);
    }
    if (backup) console.error(`\nHer brain is untouched, and there's a fresh backup either way: ${backup}`);
    if (wasUp) service('start');
    writeLedger([...readLedger(), { ...entry, failed: after.problems ?? ['verification failed'] }]);
    return 1;
  }

  writeLedger([...readLedger(), { ...entry, schemaAfter: after.checks?.schema ?? null, ok: true }]);

  // -- 6. put her back the way we found her -------------------------------
  if (wasUp) { say('restarting…'); service('start'); }

  say(`\n✠  ${current} → ${after.version}`);
  if (isConfigured()) {
    dim(`schema ${entry.schemaBefore} → ${after.checks.schema}${entry.schemaBefore === after.checks.schema ? ' (no migration needed)' : ''} · ${after.checks.messages} messages · ${after.checks.facts} facts, all present`);
    dim(`backup from before the update: ${backup}`);
    dim('changed your mind? `glashaus update --rollback`');
  }
  if (!wasUp) dim('the runtime was down, so I left it down. `glashaus start` when you want her up.');
  return 0;
}

// ---------- rollback ----------

async function rollback(assumeYes = false) {
  const last = readLedger().filter(e => e.ok).pop();
  if (!last) { console.error('No update on record to undo.'); return 1; }
  if (last.mode === 'git') {
    console.error(`The last update was a git pull in ${appRoot}, which is yours to undo:\n  git -C ${appRoot} reset --hard HEAD@{1}`);
    return 1;
  }
  if (!last.fromTarball || !fs.existsSync(last.fromTarball)) {
    console.error(`The kept copy of ${last.fromVersion} is gone (${last.fromTarball ?? 'it was never packed'}), so I can't put it back exactly.`);
    if (last.backup) console.error(`Her database from before that update is still there: glashaus restore ${last.backup}`);
    return 1;
  }

  say(`rolling back ${last.toVersion} → ${last.fromVersion}`);
  dim(path.basename(last.fromTarball));
  say('\nNote: her database stays as it is. Migrations are forward-only by design, and older code ignores a newer schema — nothing is lost by going back, but the schema does not come back with you.');
  if (last.backup) dim(`if you want the database as it was too: glashaus restore ${last.backup}`);

  if (!assumeYes && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('\nProceed? (y/N) ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') { say('Left alone.'); return 0; }
  }

  const wasUp = runtimeUp();
  if (wasUp) service('stop');
  const result = npmInstall(last.fromTarball);
  if (!result.ok) {
    console.error('\nRollback install failed:\n' + result.output.split('\n').slice(-15).map(l => `  ${l}`).join('\n'));
    if (wasUp) service('start');
    return 1;
  }
  const after = probeInstall();
  if (wasUp) service('start');
  writeLedger([...readLedger(), { at: new Date().toISOString(), mode: last.mode, rolledBackTo: last.fromVersion, ok: after.ok }]);
  say(`\n✠  back on ${after.version ?? last.fromVersion}`);
  if (!after.ok) console.error('…but it did not verify clean:\n' + (after.problems ?? []).map(p => `  · ${p}`).join('\n'));
  return after.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await runUpdate(process.argv.slice(2)));
}
