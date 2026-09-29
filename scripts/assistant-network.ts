// Manage the dedicated macOS userspace Tailscale service. No system VPN/DNS changes.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const exec = promisify(execFile);
const root = path.join(os.homedir(), "Library", "Application Support", "Glashaus", "Network");
const binary = path.join(root, "bin", "tailscale");
const agent = path.join(os.homedir(), "Library", "LaunchAgents", "net.glashaus.private-network.plist");
const service = `gui/${process.getuid?.()}/net.glashaus.private-network`;
const command = process.argv[2] ?? "status";
if (process.platform !== "darwin" || !existsSync(binary) || !existsSync(agent)) throw new Error("Install the dedicated private network service first; see docs/OPERATIONS.md. The normal Tailscale app is also supported where it can coexist with your other VPN.");
const run = async (file: string, args: string[]) => (await exec(file, args, { timeout: 20_000, maxBuffer: 1_000_000 })).stdout;
const cli = async (...args: string[]) => run(binary, ["--socket=" + path.join(root, "tailscaled.sock"), ...args]);
if (command === "start") {
  await run("launchctl", ["enable", service]);
  try { await run("launchctl", ["print", service]); }
  catch { await run("launchctl", ["bootstrap", `gui/${process.getuid?.()}`, agent]); }
  await run("launchctl", ["kickstart", service]);
  console.log("Private network service started. Run pnpm assistant:network status to check sign-in.");
} else if (command === "stop") {
  await run("launchctl", ["disable", service]);
  try { await run("launchctl", ["bootout", service]); } catch { /* Already stopped. */ }
  console.log("Private network stopped and disabled at sign-in. Your internet VPN is unchanged.");
} else if (command === "status") {
  const state = JSON.parse(await cli("status", "--json"));
  console.log("Private Glashaus network:", state.BackendState);
  for (const address of state.TailscaleIPs ?? []) if (!address.includes(":")) console.log("iPhone Mac address: https://" + address + ":7784");
  if (state.BackendState !== "Running") console.log("Sign-in or reconnection is needed. See docs/OPERATIONS.md.");
  console.log((await cli("serve", "status")).trim());
} else throw new Error("Use status, start or stop. No system routing or WARP settings will be changed.");
