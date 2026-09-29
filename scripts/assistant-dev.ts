import path from "node:path";
import { fileURLToPath } from "node:url";

// A separate development home prevents ordinary project startup from opening
// the user's installed companion. Explicit environment overrides still work.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.GLASHAUS_HOME ??= path.join(root, ".glashaus-v3");
process.env.GLASHAUS_PORT ??= "7783";
process.env.GLASHAUS_MOBILE_PORT ??= "7784";
await import("../app/server/main.ts");
