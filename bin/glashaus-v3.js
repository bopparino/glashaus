#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const command = process.argv[2] ?? "start";
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor !== 24 || nodeMinor < 14) {
  console.error(
    "GlasHaus v3 requires Node 24.14 or newer within the 24.x line.",
  );
  process.exit(1);
}
if (command === "--version" || command === "version") {
  console.log("3.0.0-alpha.2");
  process.exit(0);
}
if (command === "--help" || command === "help") {
  console.log(
    "GlasHaus v3\n\n  glashaus [start]     Start the local companion app\n  glashaus setup       Open the same app for guided setup\n  glashaus doctor      Check Node and Ollama\n\nGLASHAUS_HOME chooses a data directory (default: ~/.glashaus-v3).\nGLASHAUS_PORT chooses a port (default: 7777).\nThis alpha uses a separate v3 home; it never opens your v2 database.",
  );
  process.exit(0);
}
if (command === "doctor") {
  console.log(`Node ${process.versions.node}`);
  try {
    const r = await fetch(
      `${process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434"}/api/tags`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) throw new Error();
    const data = await r.json();
    console.log(
      `Ollama reachable · ${data.models?.length ?? 0} installed models`,
    );
  } catch {
    console.log(
      "Ollama is not reachable. Start Ollama, then check the address in the web app.",
    );
    process.exitCode = 1;
  }
} else if (command === "start" || command === "setup") {
  const entry = fileURLToPath(
    new URL("../dist/server/main.js", import.meta.url),
  );
  if (!existsSync(entry)) {
    console.error(
      "This source checkout needs a build: pnpm install && pnpm build",
    );
    process.exit(1);
  }
  // One process owns the server and shutdown handlers; no orphaned child on Windows.
  await import(new URL("../dist/server/main.js", import.meta.url).href);
} else {
  console.error(`Unknown command: ${command}. Use glashaus help.`);
  process.exitCode = 1;
}
