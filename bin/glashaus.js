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
//   glashaus soul             export the personality-only capsule
//   glashaus facts [word]     quick memory search in the terminal
//   glashaus forget <id>      soft-forget a bad fact (reversible in the viewer)
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
    if (orphans.length) {
      console.log(`…but found ${orphans.length} glashaus runtime(s) this home didn't start: pid ${orphans.join(', ')}`);
      console.log('if that\'s an orphan from a deleted/old home:  kill ' + orphans.join(' '));
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
