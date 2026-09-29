import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const devices = JSON.parse(
  execFileSync("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    encoding: "utf8",
  }),
).devices;
const available = Object.values(devices).flat() as {
  name: string;
  udid: string;
  state: string;
}[];
const device = process.env.GLASHAUS_SIMULATOR_UDID
  ? available.find((d) => d.udid === process.env.GLASHAUS_SIMULATOR_UDID)
  : available.find((d) => d.name === "iPhone 17");
if (!device)
  throw new Error(
    "Install an iPhone 17 simulator in Xcode, or set GLASHAUS_SIMULATOR_UDID to an available simulator UUID.",
  );
const run = (command: string, args: string[]) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
if (device.state !== "Booted") run("xcrun", ["simctl", "boot", device.udid]);
run("xcrun", ["simctl", "bootstatus", device.udid, "-b"]);
run("xcodebuild", [
  "-project",
  "ios/Glashaus.xcodeproj",
  "-scheme",
  "Glashaus",
  "-configuration",
  "Debug",
  "-sdk",
  "iphonesimulator",
  "-destination",
  `platform=iOS Simulator,id=${device.udid}`,
  "-derivedDataPath",
  "ios/build",
  "CODE_SIGN_IDENTITY=-",
  "build",
]);
run("xcrun", [
  "simctl",
  "install",
  device.udid,
  "ios/build/Build/Products/Debug-iphonesimulator/Glashaus.app",
]);
const developerDirectory = execFileSync("xcode-select", ["-p"], {
  encoding: "utf8",
}).trim();
const deviceUI = [
  path.join(developerDirectory, "Applications/Simulator.app"),
  path.join(developerDirectory, "../Applications/Simulator.app"),
  path.join(developerDirectory, "../Applications/DeviceHub.app"),
].find(existsSync);
if (deviceUI) run("open", ["-a", deviceUI]);
run("xcrun", ["simctl", "launch", device.udid, "net.glashaus.companion"]);
console.log(
  "Glashaus is running in the iPhone simulator. Start pnpm assistant separately; pair using the Simulator address in Mac Settings.",
);
if (!deviceUI)
  console.log(
    "Open the simulator device window from Xcode to view the running app.",
  );
