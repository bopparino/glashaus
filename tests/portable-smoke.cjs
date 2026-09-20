const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const root = path.resolve(process.argv[2] || '.');
const data = mkdtempSync(path.join(tmpdir(), 'glashaus-portable-'));
let child;
let output = '';
async function start() {
  child = spawn(process.execPath, [path.join(root, 'bin/glashaus-v3.js')], { windowsHide: true, env: { ...process.env, GLASHAUS_HOME: data, GLASHAUS_PORT: '7793' } });
  child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
  for (let attempt=0; attempt<50; attempt++) { if (child.exitCode !== null) throw Error(output); try { const response = await fetch('http://127.0.0.1:7793/api/state'); if(response.ok) return await response.json(); } catch {} await new Promise(resolve=>setTimeout(resolve,50)); }
  throw Error('Portable startup timed out: '+output);
}
async function stop() { if (!child || child.exitCode !== null) return; const closed = new Promise(resolve=>child.once('exit',resolve)); child.kill('SIGTERM'); await closed; }
(async()=>{
  try {
    let state = await start(); assert.equal(state.companion,null);
    assert.ok((await (await fetch('http://127.0.0.1:7793/')).text()).includes('GlasHaus'));
    const draft={name:'Portable test',userName:'Test user',mode:'grow',relationship:'Friendly testing context.',sources:[],claims:[],uncertainties:[]};
    const response=await fetch('http://127.0.0.1:7793/api/companion',{method:'POST',headers:{'Content-Type':'application/json','x-glashaus-token':state.csrfToken},body:JSON.stringify(draft)});assert.equal(response.status,200);const saved=await response.json();
    await stop(); state=await start();assert.equal(state.companion.id,saved.id);assert.equal(state.companion.name,'Portable test');
    console.log('PASS: dependency-free portable build serves UI, saves identity, and restores it after a separate-process restart. No model inference or external API called.');
  }finally{await stop();rmSync(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
