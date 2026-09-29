#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const saved = path.join(root, "full-companion-install.json");
const config = existsSync(saved) ? JSON.parse(readFileSync(saved, "utf8")) : {};
process.env.GLASHAUS_HOME ??= config.directory ?? path.join(os.homedir(), "Library/Application Support/Glashaus/Companion");
process.env.GLASHAUS_PORT ??= String(config.port ?? 7783);
process.env.GLASHAUS_MOBILE_PORT ??= String(config.mobilePort ?? 7784);
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 14) throw new Error("Run Setup Glashaus.command to install Node 24.");
const command = process.argv[2] ?? "open";
if (command === "iphone") execFileSync("open", [path.join(root, "ios/Glashaus.xcodeproj")], { stdio: "inherit" });
else if (command === "backup") await import("../scripts/assistant-backup.ts");
else if (command === "service") {
  const {serviceCommand} = await import("../dist/server/service-cli.js");
  await serviceCommand(process.argv[3] ?? "status");
} else if (command === "start") await import("../dist/server/main.js");
else if (command === "open") {
  const {Startup} = await import("../dist/server/startup.js");
  const {serviceCommand} = await import("../dist/server/service-cli.js");
  const startup = new Startup({directory:process.env.GLASHAUS_HOME,port:Number(process.env.GLASHAUS_PORT),mobilePort:Number(process.env.GLASHAUS_MOBILE_PORT)});
  const base = `http://127.0.0.1:${process.env.GLASHAUS_PORT}`;
  let live;
  try { live = await (await fetch(base + "/api/startup", {signal:AbortSignal.timeout(1500)})).json(); } catch { /* Start below. */ }
  if (live && live.id !== startup.id) throw new Error("Another companion owns this port. Stop it or choose different GLASHAUS_PORT and GLASHAUS_MOBILE_PORT values.");
  if (!live) {
    // A graceful stop closes HTTP before the process exits. Starting launchd
    // during that gap is a no-op; wait for the recorded process or a ready host.
    let previousPID;
    try {
      const registration = JSON.parse(readFileSync(path.join(startup.folder,"registration.json"),"utf8"));
      const ready = JSON.parse(readFileSync(path.join(startup.folder,"ready.json"),"utf8"));
      if(registration.owner===startup.id && ready.nonce===registration.nonce && Number.isInteger(ready.pid) && ready.pid>1) previousPID=ready.pid;
    } catch { /* Fresh installation. */ }
    const stillRunning = () => { try { if(!previousPID)return false; process.kill(previousPID,0);return true; }catch{return false;} };
    for(let n=0;n<60 && stillRunning();n++) {
      try { const r=await fetch(base+"/api/startup",{signal:AbortSignal.timeout(500)});if(r.ok){const d=await r.json();if(d.id!==startup.id)throw new Error("Another companion now owns this port.");live=d;break;} }catch(error){if(error.message?.includes("Another companion"))throw error;}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!live && stillRunning())throw new Error("The previous Glashaus process is still stopping. Try the shortcut again shortly; your data has been preserved.");
    if(!live) await serviceCommand("enable");
  }
  let ready = false;
  for (let n=0;n<60;n++) {
    try { const r = await fetch(base+"/api/health",{signal:AbortSignal.timeout(1000)}); if(r.ok && (await r.json()).id===startup.id){ready=true;break;} } catch { /* Wait for startup. */ }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if (!ready) throw new Error("Glashaus has not become ready. Run service status to find its log.");
  console.log(`Glashaus is ready: ${base}`);
  if (process.env.GLASHAUS_NO_BROWSER !== "1") execFileSync("open",[base]);
} else throw new Error("Use open, start, iphone, backup, or service enable|disable|stop|status.");
