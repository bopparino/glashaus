// The utility-lane bench, verified against a stub Ollama whose failure mode I
// control. The point of this suite is narrow and important: prove the bench
// REPORTS FAILURE when the model fails. A benchmark that only works when
// everything works is worse than none — it manufactures confidence.
//   node test/bench.test.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

const PORT = 11599;

// The stub runs in its OWN process, deliberately. Hosting it in this one and
// then calling spawnSync deadlocks: spawnSync blocks the event loop, so the
// server can never answer the child it just launched, and the child times out
// looking like a hang. (It did. That is why this comment exists.)
const stubSource = `
import http from 'node:http';
const mode = process.env.STUB_MODE ?? 'good';
const canned = prompt => {
  if (/"reach_out"/.test(prompt)) return JSON.stringify({ reach_out: false, reason: 'nothing to say', message: null });
  if (/"merges"/.test(prompt)) return JSON.stringify({ merges: [], decays: [], contradictions: [], supersessions: [], register_fixes: [] });
  if (/"dream"/.test(prompt)) return JSON.stringify({ dream: 'a '.repeat(150), epigraph: 'quiet', valence: 0, arousal: 0.2, emotion: 'even', realizations: [], quirks: [], intentions: [], pursuit: {} });
  if (/"facts"/.test(prompt)) return JSON.stringify({ facts: [{ category: 'user', content: 'You hate red because of a hospital waiting room in 2019', importance: 7, salience: 0.8 }], threads: { opened: [], answered: [], touched: [] } });
  return JSON.stringify({ ok: true });
};
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/api/show') return res.end(JSON.stringify({ model_info: { 'l.context_length': 8192 } }));
    // The body arrives JSON-ENCODED; matching the raw string never fires.
    let prompt = body;
    try { prompt = (JSON.parse(body).messages ?? []).map(m => m.content).join('\\n'); } catch {}
    const content = mode === 'broken' ? 'Sure! here you go: {facts: [oops' : canned(prompt);
    res.end(JSON.stringify({ message: { content } }));
  });
}).listen(${PORT}, () => console.error('stub up'));
`;

const stubFile = path.join(os.tmpdir(), `glashaus-stub-${process.pid}.mjs`);
fs.writeFileSync(stubFile, stubSource);

function withStub(mode, fn) {
  const proc = spawn(process.execPath, [stubFile], { env: { ...process.env, STUB_MODE: mode }, stdio: 'ignore' });
  try {
    // Wait for the port, synchronously — the whole test is spawnSync-shaped.
    for (let i = 0; i < 60; i++) {
      const probe = spawnSync(process.execPath, ['-e',
        `fetch('http://127.0.0.1:${PORT}/api/show',{method:'POST',body:'{}'}).then(()=>process.exit(0)).catch(()=>process.exit(1))`]);
      if (probe.status === 0) break;
      spawnSync(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200)']);
    }
    return fn();
  } finally { proc.kill(); }
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glashaus-bench-t-'));
const run = () => {
  const r = spawnSync(process.execPath, [new URL('../src/bench.js', import.meta.url).pathname, '--now', 'stub', '--trials', '1'], {
    encoding: 'utf8',
    env: { ...process.env, GLASHAUS_HOME: home, OLLAMA_HOST: `http://127.0.0.1:${PORT}`, GLASHAUS_MODEL: 'stub' },
    timeout: 120000,
  });
  return (r.stdout ?? '') + (r.stderr ?? '');
};

// -- a model that works ---------------------------------------------------------
const good = withStub('good', run);
assert.match(good, /CAST \(utility\)/, 'a working model is cast');
assert.doesNotMatch(good, /DO NOT CAST/, 'and not rejected');
assert.match(good, /100% of \d+ calls parsed/, 'parse rate is reported');
assert.match(good, /capture.*1\/1 usable/, 'capture reports usable');

// -- a model that cannot produce the objects ------------------------------------
// This is the assertion the whole file exists for.
const bad = withStub('broken', run);
assert.match(bad, /DO NOT CAST \(utility\)/, 'a model that cannot produce the objects is rejected');
assert.match(bad, /0% of \d+ calls parsed/, 'the parse rate reflects it');
assert.match(bad, /0\/1 usable/, 'and no pass claims to have worked');
assert.doesNotMatch(bad, /1\/1 usable/,
  'CRITICAL: no pass may report success at a 0% parse rate — a marker key standing in for success is how a broken model reads as CAST');
assert.match(bad, /unparseable sample/, 'and the actual bad output is shown');

// -- it never touches the real companion ------------------------------------------
// The isolation is by process (GLASHAUS_HOME in the child), not by care.
const src = fs.readFileSync(new URL('../src/bench.js', import.meta.url), 'utf8');
assert.match(src, /GLASHAUS_HOME: home/, 'the child is pointed at a temp home');
assert.ok(!fs.existsSync(path.join(home, 'data')), 'and the parent never opened a database of its own');

fs.rmSync(stubFile, { force: true });
fs.rmSync(home, { recursive: true, force: true });
console.log('bench ✓ — casts a working model, rejects a broken one, and says why');
