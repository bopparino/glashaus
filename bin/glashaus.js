#!/usr/bin/env node
// glashaus — one command for everything.
//
//   glashaus setup            create (or repair) your companion — start here
//   glashaus                  chat in the terminal
//   glashaus view             open the memory webview in the browser
//   glashaus start            run in the background (channels + dreaming + viewer)
//   glashaus stop             stop the background process
//   glashaus restart          restart it
//   glashaus status           is it up? recent log lines
//   glashaus logs             follow logs live
//   glashaus doctor           full health check — run this when in doubt
//   glashaus dream            force a dream right now
//   glashaus tidy             run memory hygiene now (also runs nightly)
//   glashaus backup           back up the brain now (also runs daily)
//   glashaus restore <file>   replace the brain from a backup (snapshots current first)
//   glashaus purge            retire the companion: archive everything, wipe the brain — persona + config stay
//   glashaus purge --all      …and persona, config, service too: an emptied home for a from-zero setup
//   glashaus soul             export the personality-only capsule
//   glashaus facts [word]     quick memory search in the terminal
//   glashaus forget <id>      soft-forget a bad fact (reversible in the viewer)
//   glashaus lexicon           words the companion wants to learn (approve/reject <id>)
//   glashaus audition <model>  screen-test a model against this persona before casting it
//   glashaus export-corpus     dump clean chat JSONL for fine-tuning (docs/fine-tune.md)
//   glashaus redact <a> [b]    cut a glitched message range from the companion's mind (reversible)
//   glashaus unredact <a> [b]  restore a redacted range
//   glashaus persona sync     push persona/*.md edits into the live documents
//   glashaus persona edit <soul|identity|user|voice|dialogue>
//   glashaus service install  start at login + survive crashes (launchd/systemd)
//   glashaus service uninstall
//   glashaus bot              run the runtime in the foreground (debugging)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = f => path.join(appRoot, 'src', f);
const [cmd = 'chat', ...args] = process.argv.slice(2);

// config.js reads GLASHAUS_HOME; import lazily so `setup`/`help` never touch it.
const loadConfig = () => import(src('config.js'));

function help() {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('\n').filter(l => l.startsWith('//   glashaus')).map(l => l.slice(5));
  console.log(['glashaus — a companion runtime. https://github.com/bopparino/glashaus', '', ...lines].join('\n'));
}

const run = (file, extra = [], opts = {}) =>
  spawnSync(process.execPath, [src(file), ...extra], { stdio: 'inherit', ...opts }).status ?? 0;

async function requireSetup() {
  const { isConfigured } = await loadConfig();
  if (!isConfigured()) {
    console.error('No companion here yet. Run: glashaus setup');
    process.exit(1);
  }
  return loadConfig();
}

const pidfileOf = config => path.join(config.home, 'glashaus.pid');
function livePid(config) {
  try {
    const pid = Number(fs.readFileSync(pidfileOf(config), 'utf8').trim());
    if (pid) { process.kill(pid, 0); return pid; }
  } catch { /* stale or absent */ }
  return null;
}

const PLIST_LABEL = 'com.glashaus.runtime';
const plistPath = () => path.join(process.env.HOME, 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);
const unitPath = () => path.join(process.env.HOME, '.config', 'systemd', 'user', 'glashaus.service');
const serviceInstalled = () =>
  process.platform === 'darwin' ? fs.existsSync(plistPath()) : fs.existsSync(unitPath());

function serviceFileContent(config) {
  if (process.platform === 'darwin') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${process.execPath}</string>
    <string>${src('index.js')}</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>GLASHAUS_HOME</key><string>${config.home}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(config.logsDir, 'glashaus.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(config.logsDir, 'glashaus.err')}</string>
</dict></plist>
`;
  }
  return `[Unit]
Description=GlasHaus companion runtime
After=network-online.target

[Service]
ExecStart=${process.execPath} ${src('index.js')}
Environment=GLASHAUS_HOME=${config.home}
Restart=always
RestartSec=5
StandardOutput=append:${path.join(config.logsDir, 'glashaus.log')}
StandardError=append:${path.join(config.logsDir, 'glashaus.err')}

[Install]
WantedBy=default.target
`;
}

const sh = (c, cargs) => spawnSync(c, cargs, { stdio: 'pipe', encoding: 'utf8' });

function serviceCtl(action) { // start | stop
  if (process.platform === 'darwin') {
    const uid = process.getuid();
    if (action === 'start') {
      const r = sh('launchctl', ['bootstrap', `gui/${uid}`, plistPath()]);
      if (r.status !== 0) sh('launchctl', ['kickstart', `gui/${uid}/${PLIST_LABEL}`]);
    } else {
      sh('launchctl', ['bootout', `gui/${uid}/${PLIST_LABEL}`]);
    }
  } else {
    sh('systemctl', ['--user', action, 'glashaus']);
  }
}

async function start(config) {
  if (livePid(config)) { console.log(`already up (pid ${livePid(config)})`); return; }
  fs.mkdirSync(config.logsDir, { recursive: true });
  if (serviceInstalled()) {
    serviceCtl('start');
  } else {
    const out = fs.openSync(path.join(config.logsDir, 'glashaus.log'), 'a');
    const err = fs.openSync(path.join(config.logsDir, 'glashaus.err'), 'a');
    const child = spawn(process.execPath, [src('index.js')], { detached: true, stdio: ['ignore', out, err] });
    fs.writeFileSync(pidfileOf(config), String(child.pid));
    child.unref();
  }
  await new Promise(r => setTimeout(r, 1200));
  if (!livePid(config)) {
    console.error('runtime died right after boot — last errors:');
    const errLog = path.join(config.logsDir, 'glashaus.err');
    if (fs.existsSync(errLog)) {
      console.error(fs.readFileSync(errLog, 'utf8').trim().split('\n').slice(-5).map(l => '  ' + l).join('\n'));
    }
    process.exit(1);
  }
  await status(config);
}

async function stop(config) {
  if (serviceInstalled()) serviceCtl('stop');
  const pid = livePid(config);
  if (pid) { try { process.kill(pid); console.log('stopped'); } catch { /* already gone */ } }
  else {
    console.log("wasn't running (no pidfile for this home)");
    // A home deleted without `stop` takes its pidfile with it and leaves the
    // process running blind — surface those instead of shrugging.
    const orphans = (sh('ps', ['-eo', 'pid=,args=']).stdout ?? '').split('\n')
      .filter(l => /glashaus[/\\]src[/\\]index\.js/.test(l))
      .map(l => l.trim().split(/\s+/)[0]);
    if (orphans.length === 1) {
      // One runtime, no pidfile: a lost child (crashed start, manual boot,
      // deleted home). Adopt and stop it — that is what stop means.
      try { process.kill(Number(orphans[0])); console.log(`stopped orphan runtime pid ${orphans[0]}`); }
      catch { /* raced away */ }
    } else if (orphans.length) {
      console.log(`…but found ${orphans.length} glashaus runtimes this home didn't start: pid ${orphans.join(', ')}`);
      console.log('multiple instances may be intentional — stop the right one yourself: kill <pid>');
    }
  }
  fs.rmSync(pidfileOf(config), { force: true });
}

async function status(config) {
  const pid = livePid(config);
  console.log(pid
    ? `up (pid ${pid}${serviceInstalled() ? ', service — auto-starts at login' : ', background'})`
    : 'down');
  const log = path.join(config.logsDir, 'glashaus.log');
  if (fs.existsSync(log)) {
    const tail = fs.readFileSync(log, 'utf8').trim().split('\n').slice(-5).join('\n');
    if (tail) console.log('---\n' + tail);
  }
}

function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
}

switch (cmd) {
  case 'help': case '-h': case '--help': help(); break;
  case 'setup': process.exit(run('setup.js', args));

  case 'chat': { await requireSetup(); process.exit(run('cli.js', args)); }
  case 'bot': { await requireSetup(); process.exit(run('index.js')); }
  case 'dream': { await requireSetup(); process.exit(run('dream.js', ['--now'])); }
  case 'tidy': { await requireSetup(); process.exit(run('consolidate.js', ['--now'])); }
  case 'backup': { await requireSetup(); process.exit(run('backup.js', ['--now'])); }
  case 'soul': { await requireSetup(); process.exit(run('soul.js', ['--now'])); }
  case 'doctor': { await requireSetup(); process.exit(run('doctor.js')); }

  case 'start': { const { config } = await requireSetup(); await start(config); break; }
  case 'stop': { const { config } = await requireSetup(); await stop(config); break; }
  case 'restart': {
    const { config } = await requireSetup();
    await stop(config); await new Promise(r => setTimeout(r, 1000)); await start(config);
    break;
  }
  case 'status': { const { config } = await requireSetup(); await status(config); break; }

  case 'logs': {
    const { config } = await requireSetup();
    fs.mkdirSync(config.logsDir, { recursive: true });
    const files = ['glashaus.log', 'glashaus.err'].map(f => path.join(config.logsDir, f));
    files.forEach(f => fs.closeSync(fs.openSync(f, 'a')));
    process.exit(spawnSync('tail', ['-f', ...files], { stdio: 'inherit' }).status ?? 0);
  }

  case 'view': {
    const { config } = await requireSetup();
    const url = `http://${config.viewerBind}:${config.viewerPort}`;
    const up = await fetch(url, { signal: AbortSignal.timeout(800) }).then(() => true).catch(() => false);
    if (!up) {
      fs.mkdirSync(config.logsDir, { recursive: true });
      const out = fs.openSync(path.join(config.logsDir, 'viewer.log'), 'a');
      spawn(process.execPath, [src('viewer-standalone.js')], { detached: true, stdio: ['ignore', out, out] }).unref();
      await new Promise(r => setTimeout(r, 700));
    }
    console.log(url);
    openBrowser(url);
    break;
  }

  case 'facts': {
    await requireSetup();
    const { getDb } = await import(src('db.js'));
    const rows = args[0]
      ? getDb().prepare("SELECT category, importance, content FROM facts WHERE active = 1 AND content LIKE '%' || ? || '%' ORDER BY importance DESC").all(args[0])
      : getDb().prepare('SELECT category, importance, content FROM facts WHERE active = 1 ORDER BY importance DESC, updated_at DESC LIMIT 30').all();
    for (const f of rows) console.log(`[${f.category} ${f.importance}] ${f.content}`);
    break;
  }

  case 'forget': {
    await requireSetup();
    if (!args[0]) { console.error("usage: glashaus forget <fact-id>  (find ids with 'glashaus facts' or the viewer)"); process.exit(1); }
    const { forgetFact } = await import(src('memory.js'));
    forgetFact(Number(args[0]));
    console.log(`fact ${args[0]} forgotten (restore in the viewer)`);
    break;
  }

  case 'persona': {
    const { config } = await requireSetup();
    const sub = args[0];
    if (sub === 'sync' || !sub) {
      const { syncPersonaFromDisk } = await import(src('persona.js'));
      const synced = syncPersonaFromDisk();
      console.log(synced.length ? 'synced. restart (or wait for the next boot) to take effect everywhere.' : 'nothing to sync — files match the live documents.');
    } else if (sub === 'edit') {
      const file = `${args[1] ?? 'soul'}.md`;
      const p = path.join(config.personaDir, file);
      if (!fs.existsSync(p)) { console.error(`${p} doesn't exist. files: soul, identity, user, voice, dialogue`); process.exit(1); }
      const editor = process.env.EDITOR || process.env.VISUAL || 'nano';
      spawnSync(editor, [p], { stdio: 'inherit' });
      const { syncPersonaFromDisk } = await import(src('persona.js'));
      syncPersonaFromDisk();
    } else { console.error('usage: glashaus persona [sync | edit <soul|identity|user|voice|dialogue>]'); process.exit(1); }
    break;
  }

  case 'lexicon': {
    await requireSetup();
    const { listCandidates, resolveCandidate } = await import(src('lexicon.js'));
    const [sub, id] = args;
    if (sub === 'approve' || sub === 'reject') {
      const c = resolveCandidate(Number(id), sub === 'approve');
      if (!c) { console.error('no pending candidate with that id'); process.exit(1); }
      console.log(sub === 'approve'
        ? `"${c.term}" added to persona/lexicon.md — edit the entry to sharpen it, then: glashaus persona sync`
        : `"${c.term}" rejected.`);
    } else {
      const pending = listCandidates();
      if (!pending.length) { console.log('no words waiting.'); break; }
      for (const c of pending) console.log(`#${c.id}  ${c.term}${c.means ? ' — ' + c.means : ''}${c.example ? `\n     "${c.example}"` : ''}`);
      console.log('\napprove with: glashaus lexicon approve <id>');
    }
    break;
  }

  case 'audition': {
    await requireSetup();
    if (!args[0]) { console.error('usage: glashaus audition <model>   (e.g. glashaus audition mag-mell:12b)'); process.exit(1); }
    const { audition } = await import(src('audition.js'));
    await audition(args[0]);
    break;
  }

  case 'export-corpus': {
    const { config } = await requireSetup();
    const out = args[0] ?? `${config.home}/corpus-${new Date().toISOString().slice(0, 10)}.jsonl`;
    const { exportCorpus } = await import(src('corpus.js'));
    const { pairs, skipped } = exportCorpus(out);
    console.log(`${pairs} exchange(s) exported to ${out}${skipped ? ` (${skipped} skipped: register/identity impurities)` : ''}`);
    console.log('recipe: docs/fine-tune.md');
    break;
  }

  case 'redact': case 'unredact': {
    await requireSetup();
    const [from, to = args[0]] = args.map(Number);
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
      console.error('usage: glashaus redact <fromId> [toId]   (ids from the viewer or `glashaus facts`-adjacent queries)');
      process.exit(1);
    }
    const { redactMessages } = await import(src('memory.js'));
    const n = redactMessages(from, to, cmd === 'redact');
    console.log(cmd === 'redact'
      ? `redacted ${n} message(s) [${from}..${to}] — gone from context, summaries, and the viewer; rows remain on disk (reversible: glashaus unredact ${from} ${to})`
      : `restored ${n} message(s) [${from}..${to}]`);
    break;
  }

  case 'restore': {
    const { config } = await requireSetup();
    const file = args[0];
    if (!file || !fs.existsSync(file)) { console.error(`usage: glashaus restore <backup.sqlite>   (backups live in ${config.backupDir})`); process.exit(1); }
    const { default: Database } = await import('better-sqlite3');
    const check = new Database(file, { readonly: true });
    const ok = check.pragma('integrity_check', { simple: true }) === 'ok';
    check.close();
    if (!ok) { console.error(`REFUSING: ${file} fails integrity check`); process.exit(1); }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(`This replaces the current brain with: ${file}`);
    const confirm = await rl.question("Type 'restore' to continue: ");
    rl.close();
    if (confirm.trim() !== 'restore') { console.log('aborted — nothing touched'); process.exit(1); }
    await stop(config);
    const snap = path.join(config.backupDir, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sqlite`);
    fs.mkdirSync(config.backupDir, { recursive: true });
    fs.copyFileSync(config.dbPath, snap);
    fs.rmSync(config.dbPath + '-wal', { force: true });
    fs.rmSync(config.dbPath + '-shm', { force: true });
    fs.copyFileSync(file, config.dbPath);
    console.log(`restored from ${file}\nprevious brain saved at ${snap} (restore it the same way to undo)`);
    await start(config);
    break;
  }

  case 'purge': {
    // Retire the companion deliberately. Everything is archived BEFORE
    // anything is deleted — on this framework's rule that a companion never
    // just vanishes. Default scope wipes the lived state (the brain) and
    // keeps persona files + config, then re-births an empty brain from them:
    // same soul, same disposition, no memories. --all empties the home.
    const { config } = await requireSetup();
    const all = args.includes('--all');
    const forceIdx = args.indexOf('--force');
    const forcedName = forceIdx >= 0 ? args[forceIdx + 1] : null;

    console.log(`This retires ${config.companionName}. What gets wiped: ${all
      ? 'EVERYTHING — brain, persona files, config, backups, logs, and the login service. Only the archive remains.'
      : 'the BRAIN — every message, fact, episode, dream, opinion, quirk, self-note, and the relationship state. Persona files, config, and backups stay; disposition carries over.'}`);
    console.log('A complete archive (database, soul capsule, persona, config — including any bot token) is written first.');

    if (forceIdx >= 0) {
      if (!forcedName || forcedName !== config.companionName) {
        console.error(`--force must name this home's companion exactly: glashaus purge --force ${config.companionName}`);
        process.exit(1);
      }
    } else {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`Type the companion's name (${config.companionName}) to continue: `);
      rl.close();
      if (answer.trim() !== config.companionName) { console.log('aborted — nothing touched'); process.exit(1); }
    }

    await stop(config);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    let archive = path.join(`${config.home}-archive`, `${config.companionName}-${stamp}`);
    for (let n = 2; fs.existsSync(archive); n++) { // same-second purge must never merge archives
      archive = path.join(`${config.home}-archive`, `${config.companionName}-${stamp}-${n}`);
    }
    fs.mkdirSync(archive, { recursive: true, mode: 0o700 });
    run('soul.js', ['--now']); // fresh capsule via a child process — this one never holds a DB handle
    const capsule = path.join(config.backupDir, 'soul-latest.json');
    if (fs.existsSync(capsule)) fs.copyFileSync(capsule, path.join(archive, 'soul.json'));
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(config.dbPath + suffix)) {
        fs.copyFileSync(config.dbPath + suffix, path.join(archive, path.basename(config.dbPath) + suffix));
      }
    }
    if (fs.existsSync(config.personaDir)) fs.cpSync(config.personaDir, path.join(archive, 'persona'), { recursive: true });
    const configFile = path.join(config.home, 'config.json');
    if (fs.existsSync(configFile)) fs.copyFileSync(configFile, path.join(archive, 'config.json'));

    // Personality survives a purge; the relationship doesn't. Carry the
    // dispositional dims into the next brain through the baseline mechanism;
    // trust/familiarity/desire/security restart at their birth values.
    let disposition = {};
    if (!all) {
      try {
        const { default: Database } = await import('better-sqlite3');
        const old = new Database(config.dbPath, { readonly: true });
        for (const r of old.prepare("SELECT dimension, value FROM self_state WHERE layer = 'disposition'").all()) {
          disposition[r.dimension] = r.value;
        }
        old.close();
      } catch { /* unreadable brain — nothing to carry */ }
    }

    if (all) {
      if (serviceInstalled()) {
        serviceCtl('stop');
        if (process.platform !== 'darwin') sh('systemctl', ['--user', 'disable', 'glashaus']);
        fs.rmSync(process.platform === 'darwin' ? plistPath() : unitPath(), { force: true });
      }
      fs.rmSync(config.home, { recursive: true, force: true });
      console.log(`${config.companionName} is retired. Archive: ${archive}`);
      console.log('The home is empty — `glashaus setup` starts from zero.');
      break;
    }

    fs.rmSync(path.dirname(config.dbPath), { recursive: true, force: true });
    fs.rmSync(config.logsDir, { recursive: true, force: true });
    if (Object.keys(disposition).length) {
      fs.writeFileSync(path.join(config.home, 'baseline.json'), JSON.stringify(disposition, null, 2));
    }
    if (run('setup-apply.js') !== 0) { // fresh migrations + persona sync + baseline
      console.error('rebirth failed — the archive is intact; run `glashaus setup` to repair');
      process.exit(1);
    }
    console.log(`${config.companionName} is reborn — same soul, same disposition, no memories. Archive: ${archive}`);
    console.log('First hello is yours to time:  glashaus chat   (then: glashaus start)');
    break;
  }

  case 'service': {
    const { config } = await requireSetup();
    if (args[0] === 'install') {
      await stop(config).catch(() => {});
      const target = process.platform === 'darwin' ? plistPath() : unitPath();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.mkdirSync(config.logsDir, { recursive: true });
      fs.writeFileSync(target, serviceFileContent(config));
      if (process.platform !== 'darwin') {
        sh('systemctl', ['--user', 'daemon-reload']);
        sh('systemctl', ['--user', 'enable', 'glashaus']);
      }
      serviceCtl('start');
      console.log('installed — glashaus now starts at login and restarts if it crashes');
      await new Promise(r => setTimeout(r, 1200));
      await status(config);
    } else if (args[0] === 'uninstall') {
      serviceCtl('stop');
      if (process.platform !== 'darwin') sh('systemctl', ['--user', 'disable', 'glashaus']);
      fs.rmSync(process.platform === 'darwin' ? plistPath() : unitPath(), { force: true });
      console.log("service removed (use 'glashaus start' to run manually)");
    } else { console.error('usage: glashaus service <install|uninstall>'); process.exit(1); }
    break;
  }

  default:
    help();
    process.exit(1);
}
