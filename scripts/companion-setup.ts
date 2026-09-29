import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Startup } from "../dist/server/startup.js";
const root = path.resolve(import.meta.dirname, "..");
const directory = path.resolve(process.env.GLASHAUS_HOME!);
const port = Number(process.env.GLASHAUS_PORT), mobilePort = Number(process.env.GLASHAUS_MOBILE_PORT);
if (![port,mobilePort].every(p=>Number.isInteger(p)&&p>0&&p<65536)||port===mobilePort) throw new Error("Choose distinct valid Mac and phone ports.");
const startup = new Startup({directory,port,mobilePort});
const base = `http://127.0.0.1:${port}`;
let live;
try { live = await (await fetch(base+"/api/startup",{signal:AbortSignal.timeout(2000)})).json(); } catch { /* First install. */ }
if (live && live.id !== startup.id) throw new Error("Another companion uses this port. No service was changed. Keep using it, or set GLASHAUS_PORT and GLASHAUS_MOBILE_PORT to unused ports for a separate installation.");
const marker = path.join(root,"full-companion-install.json");
writeFileSync(marker,JSON.stringify({distribution:"full-companion",directory,port,mobilePort,node:process.execPath},null,2),{mode:0o600});
const quote = (s:string) => "'"+s.replaceAll("'", "'\\''")+"'";
const applications = process.env.GLASHAUS_APPLICATIONS_DIR ?? path.join(os.homedir(),"Applications"); mkdirSync(applications,{recursive:true});
const shortcut = path.join(applications,"Glashaus.command");
if (existsSync(shortcut) && !readFileSync(shortcut,"utf8").includes("# Glashaus companion launcher")) throw new Error("Applications/Glashaus.command belongs to another installation. It was not replaced.");
writeFileSync(shortcut,`#!/bin/bash\n# Glashaus companion launcher\nexec ${quote(process.execPath)} ${quote(path.join(root,"bin/glashaus-full.js"))} open\n`,{mode:0o700});chmodSync(shortcut,0o700);
console.log(`Installed. Companion data: ${directory}\nOpen again: ${shortcut}\nPhone setup: ${path.join(root,"docs/SETUP.md")}`);
if(process.argv[2]!=="--no-start") {
  if(live) {
    if(!live.managed) throw new Error("Stop the manual Glashaus terminal, then rerun setup to start the new background build.");
    execFileSync(process.execPath,[path.join(root,"bin/glashaus-full.js"),"service","stop"],{stdio:"inherit"});
    let stopped=false;
    for(let n=0;n<60;n++){try{await fetch(base+"/api/health",{signal:AbortSignal.timeout(1000)});}catch{stopped=true;break;}await new Promise(r=>setTimeout(r,500));}
    if(!stopped)throw new Error("The earlier service is still stopping. Run the Glashaus shortcut once it finishes.");
  }
  execFileSync(process.execPath,[path.join(root,"bin/glashaus-full.js"),"open"],{stdio:"inherit"});
}
