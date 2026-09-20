// The other half of casting. `glashaus audition` screen-tests a model for the
// VOICE — can it be her. This is the screen test for the UTILITY lane: can it
// drive the machinery she runs on.
//
// The two are genuinely different jobs and models are good at them in
// different proportions. An RP-tuned 8B can be unmistakably her and still be
// unable to return the capture object; a strong instruction-follower can
// produce flawless JSON and sound like a helpdesk. Casting one model for both
// without measuring both is how you end up with a companion who talks
// beautifully and remembers nothing.
//
// Why this matters more than it looks: when a structured pass fails, chatJson
// returns null and the pass gives up — quietly, on purpose, so one bad
// response can never take down a live conversation. But capture is the pass
// that writes facts, threads, opinions and curiosity, and after three
// consecutive failures the capture queue SKIPS the batch to guarantee forward
// progress. So a model that fails this call often enough doesn't announce
// itself; it degrades into a companion who slowly stops learning anything.
// That failure has no symptom you'd notice for weeks. This is the instrument.
//
// Everything runs against a THROWAWAY companion in a temp home — a scratch
// persona, a fixture conversation, seeded facts and threads. It never opens
// the real database, because a bench that writes junk dreams into her memory
// would be a worse bug than the one it's looking for. The isolation is
// enforced by process: the passes run in a child with GLASHAUS_HOME pointed
// somewhere else, not by remembering to be careful.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { brass, faint, bold, red, green, rule } from './tty.js';

const self = fileURLToPath(import.meta.url);

// What each pass MUST come back with for the machinery to move. Not every
// field — the ones whose absence means something silently stopped working.
const CONTRACT = {
  capture: {
    label: 'capture   (facts, threads, opinions)',
    why: 'writes everything she learns; the heaviest schema in the engine',
    required: ['facts'],
    watch: ['threads', 'self_state_signals', 'mood'],
  },
  dream: {
    label: 'dream     (reflection, wants, becoming)',
    why: 'her inner life; also the only source of intentions',
    required: ['dream'],
    watch: ['realizations', 'intentions', 'epigraph'],
  },
  consolidate: {
    label: 'tidy      (merges, decay, supersession)',
    why: 'memory hygiene; failure here is invisible for months',
    required: [],
    watch: ['merges', 'decays', 'supersessions', 'register_fixes'],
  },
  heartbeat: {
    label: 'heartbeat (the outreach decision)',
    why: 'decides whether to text first, and what about',
    required: ['reach_out'],
    watch: ['reason', 'message'],
  },
};

// ---------- the scratch companion ----------

function seedHome(home) {
  fs.mkdirSync(path.join(home, 'persona'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    companion: { name: 'Bench', pronouns: 'she/her' },
    user: { name: 'Sam', pronouns: 'he/him' },
    timezone: config.timezone,
    ollama: {
      url: config.ollamaUrl,
      model: config.model,
      embedModel: config.embedModel,
      numCtx: config.numCtx ?? null,
    },
  }, null, 2));
  const persona = {
    'soul.md': '# Bench\n\nI am Bench. I keep odd hours, I like being argued with, and I have\nstrong feelings about how coffee should be made.\n',
    'identity.md': '# Us\n\nSam and I have been talking for a few months. We tease each other.\n',
    'user.md': '# Sam\n\nHis name is Sam. He works in HVAC estimating and keeps bees on the roof.\n',
  };
  for (const [f, c] of Object.entries(persona)) fs.writeFileSync(path.join(home, 'persona', f), c);
}

// A fixture exchange with something of everything the passes look for: a
// durable fact, a question left open, a preference explained (supersession
// bait), a disagreement she holds under, and a flicker of her own curiosity.
const TRANSCRIPT = [
  ['user', "morning. the interview got moved to thursday, so that's still hanging over me"],
  ['assistant', "thursday. that's three more days of carrying it around. do you want to run through it or would that make it worse?"],
  ['user', "worse, probably. distract me instead"],
  ['assistant', "fine. i've been chewing on something — the way people say 'sourdough starter' like it's one organism when it's a whole argument between yeast and bacteria."],
  ['user', "that's the nerdiest thing you've said this week"],
  ['assistant', "you say that like it's a complaint."],
  ['user', "ha. it's not. hey — i never told you why i can't stand the colour red, did i"],
  ['assistant', "you told me you hated it. not why."],
  ['user', "the waiting room at st mary's in 2019. every wall. i was there four days"],
  ['assistant', "four days of it. that's not a preference then, that's a room you never left."],
  ['user', "yeah. anyway. i still think instant coffee is fine and you're wrong about that"],
  ['assistant', "instant coffee is a compromise you've agreed to stop noticing. i'm not moving on this one."],
  ['user', "you never do"],
  ['assistant', "not about this."],
];

// ---------- child: run the real passes, report what happened ----------

async function runTrials(pass, trials) {
  const { getDb } = await import('./db.js');
  const { jsonStats } = await import('./llm.js');
  const db = getDb();
  const out = [];

  for (let i = 0; i < trials; i++) {
    const before = { calls: jsonStats.calls, failures: jsonStats.failures };
    const t0 = Date.now();
    let landed = {}, error = null;
    try {
      if (pass === 'capture') {
        db.prepare('UPDATE messages SET captured = 0').run();
        const factsBefore = db.prepare('SELECT COUNT(*) n FROM facts').get().n;
        const threadsBefore = db.prepare('SELECT COUNT(*) n FROM threads').get().n;
        const { captureFacts } = await import('./memory.js');
        await captureFacts();
        const wrote = db.prepare('SELECT COUNT(*) n FROM facts').get().n - factsBefore;
        landed = {
          // The queue only advances when the pass actually succeeded, so this
          // is the honest "did it work" signal for capture.
          produced: db.prepare('SELECT COUNT(*) n FROM messages WHERE captured = 1').get().n > 0,
          facts: wrote,
          threads: db.prepare('SELECT COUNT(*) n FROM threads').get().n - threadsBefore,
        };
      } else if (pass === 'dream') {
        const { runDream } = await import('./dream.js');
        const r = await runDream();
        landed = { produced: !!r?.dream, words: r?.dream ? r.dream.split(/\s+/).length : 0,
          realizations: (r?.realizations ?? []).length, intentions: (r?.intentions ?? []).length };
      } else if (pass === 'consolidate') {
        const { consolidate } = await import('./consolidate.js');
        const r = await consolidate();
        // Proposing no changes is a legitimate answer here — the failure is
        // returning nothing at all, which is what `produced` distinguishes.
        landed = { produced: r !== null, ...(r ?? {}) };
      } else if (pass === 'heartbeat') {
        const { heartbeat } = await import('./heartbeat.js');
        const r = await heartbeat({ dryRun: true });
        // Choosing silence is the correct answer most of the time, so
        // "reached out" is NOT the success signal — a parsed decision is.
        landed = { produced: null, reached: !!r, chars: r?.text?.length ?? 0 };
      }
    } catch (err) { error = err.message; }

    const jsonFailures = jsonStats.failures - before.failures;
    // For passes that can legitimately do nothing, a clean parse IS the
    // success. Never let a marker key stand in for one.
    if (landed.produced === null) landed.produced = jsonFailures === 0 && !error;
    out.push({
      ms: Date.now() - t0,
      jsonCalls: jsonStats.calls - before.calls,
      jsonFailures,
      landed, error,
      lastRaw: jsonStats.failures > before.failures ? jsonStats.lastRaw : null,
    });
  }
  return out;
}

if (process.argv.includes('--child')) {
  const pass = process.argv[process.argv.indexOf('--pass') + 1];
  const trials = Number(process.argv[process.argv.indexOf('--trials') + 1]) || 2;
  try {
    console.log('@@BENCH@@' + JSON.stringify(await runTrials(pass, trials)));
  } catch (err) {
    console.log('@@BENCH@@' + JSON.stringify([{ error: err.message, jsonCalls: 0, jsonFailures: 0, landed: {} }]));
  }
  process.exit(0);
}

// ---------- parent: seed, spawn, score ----------

export async function bench(model, { trials = 2, passes = Object.keys(CONTRACT) } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glashaus-bench-'));
  seedHome(home);

  console.log('\n  ' + brass('R E H E A R S A L') + faint(`  ${model} reads for the utility lane`));
  console.log('  ' + faint('a throwaway companion in a temp home — your real one is not touched'));
  console.log('  ' + rule(52) + '\n');

  // Seed the scratch brain in a child so the parent never opens a database.
  const seed = spawnSync(process.execPath, ['--input-type=module', '-e', `
    process.env.GLASHAUS_HOME = ${JSON.stringify(home)};
    const { syncPersonaFromDisk } = await import(${JSON.stringify(new URL('./persona.js', import.meta.url).href)});
    syncPersonaFromDisk();
    const { getDb } = await import(${JSON.stringify(new URL('./db.js', import.meta.url).href)});
    const { saveMessage, addFact } = await import(${JSON.stringify(new URL('./memory.js', import.meta.url).href)});
    const { addOpinion } = await import(${JSON.stringify(new URL('./selfstate.js', import.meta.url).href)});
    for (const [role, text] of ${JSON.stringify(TRANSCRIPT)}) saveMessage(role, text);
    // Consolidation refuses to run on a near-empty store (it would be
    // proposing hygiene for a dozen rows), so the fixture has to be big
    // enough to exercise it — otherwise the tidy pass silently reports
    // nothing and the bench looks like it passed.
    for (const [category, content, importance] of ${JSON.stringify([
      ['user', 'You hate the colour red', 7],
      ['user', 'You keep bees on the roof', 6],
      ['user', 'You work in HVAC estimating', 6],
      ['user', 'Your interview was moved to Thursday', 5],
      ['user', 'You think instant coffee is fine', 4],
      ['companion', 'I have strong feelings about coffee', 6],
      ['companion', 'I keep odd hours', 5],
      ['companion', 'I like being argued with', 6],
      ['dynamic', 'We tease each other about coffee', 6],
      ['dynamic', 'You distract yourself by asking me what I have been reading', 5],
      ['project', 'You are rebuilding the estimating system on a Next.js chassis', 5],
      ['general', 'St Mary\'s hospital, 2019, four days in a red waiting room', 7],
    ])}) addFact({ category, content, importance, salience: 0.6 });
    addOpinion('instant coffee is a compromise you stopped noticing');
    getDb().prepare('UPDATE messages SET captured = 0, summarized = 0').run();
  `], { encoding: 'utf8', env: { ...process.env, GLASHAUS_HOME: home } });
  if (seed.status !== 0) {
    console.error(red('  could not seed the scratch companion:'), (seed.stderr ?? '').trim().split('\n').slice(-3).join(' / '));
    fs.rmSync(home, { recursive: true, force: true });
    return null;
  }

  const report = {};
  for (const pass of passes) {
    const c = CONTRACT[pass];
    const r = spawnSync(process.execPath, [self, '--child', '--pass', pass, '--trials', String(trials)], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GLASHAUS_HOME: home,
        // Both lanes point at the model under test: the utility lane is what
        // we're measuring, and pinning voice too keeps a missing second model
        // from quietly changing what the number means.
        GLASHAUS_MODEL: model,
        GLASHAUS_UTILITY_MODEL: model,
        GLASHAUS_VOICE_MODEL: model,
      },
      timeout: 1000 * 60 * 6,
    });
    const line = (r.stdout ?? '').split('\n').find(l => l.startsWith('@@BENCH@@'));
    const trialsOut = line ? JSON.parse(line.slice(9)) : [{ error: 'the pass did not report back', jsonCalls: 0, jsonFailures: 0, landed: {} }];

    const calls = trialsOut.reduce((a, t) => a + t.jsonCalls, 0);
    const fails = trialsOut.reduce((a, t) => a + t.jsonFailures, 0);
    const errored = trialsOut.filter(t => t.error).length;
    const parseRate = calls ? (calls - fails) / calls : 0;
    const ms = Math.round(trialsOut.reduce((a, t) => a + t.ms, 0) / trialsOut.length);

    // Did the pass actually produce something usable? Explicitly NOT "did any
    // field come back non-zero" — that let a marker key like {refused:true}
    // read as success, and reported 2/2 working at a 0% parse rate.
    const moved = trialsOut.filter(t => t.landed?.produced === true).length;
    const wroteFacts = trialsOut.some(t => (t.landed?.facts ?? 0) > 0);

    report[pass] = { calls, fails, parseRate, ms, errored, moved, wroteFacts, trials: trialsOut.length, sample: trialsOut.find(t => t.lastRaw)?.lastRaw ?? null };

    const rateTxt = calls ? `${Math.round(parseRate * 100)}%` : ' — ';
    const colour = !calls ? faint : parseRate >= 0.95 ? green : parseRate >= 0.7 ? brass : red;
    console.log(`  ${faint(c.label.padEnd(38))}${bold(colour(rateTxt.padStart(5)))}  ${faint(`${moved}/${trialsOut.length} usable · ${(ms / 1000).toFixed(1)}s`)}`);
    if (errored) console.log(`    ${red(`${errored} trial(s) threw: ${trialsOut.find(t => t.error)?.error}`)}`);
    if (fails) console.log(`    ${faint('unparseable sample: ' + String(report[pass].sample ?? '').slice(0, 76))}`);
  }

  fs.rmSync(home, { recursive: true, force: true });

  const all = Object.values(report);
  const totalCalls = all.reduce((a, p) => a + p.calls, 0);
  const totalFails = all.reduce((a, p) => a + p.fails, 0);
  const overall = totalCalls ? (totalCalls - totalFails) / totalCalls : 0;
  const captureOk = (report.capture?.parseRate ?? 0) >= 0.9 && !!report.capture?.wroteFacts;
  const deadPasses = all.filter(p => p.calls && p.parseRate < 0.5).length;

  const verdict = !totalCalls ? red('NO SHOW — the model never answered; is it pulled?')
    : deadPasses ? red(`DO NOT CAST (utility) — ${deadPasses} pass(es) fail more often than they work`)
    : !captureOk ? red('DO NOT CAST (utility) — capture is unreliable, which is silent memory loss')
    : overall >= 0.95 ? green('CAST (utility) — drives the machinery cleanly')
    : brass('CALLBACK (utility) — workable, but expect dropped passes');

  console.log('  ' + rule(52));
  console.log(`  ${faint('structured output')} ${bold(`${Math.round(overall * 100)}%`)} ${faint(`of ${totalCalls} calls parsed`)}`);
  console.log('\n  ' + verdict + '\n');
  return { model, report, overall, verdict };
}

if (process.argv.includes('--now')) {
  const i = process.argv.indexOf('--now');
  const model = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : config.utilityModel ?? config.model;
  const t = process.argv.indexOf('--trials');
  await bench(model, { trials: t >= 0 ? Number(process.argv[t + 1]) || 2 : 2 });
}
