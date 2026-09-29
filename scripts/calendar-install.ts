import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.platform !== "darwin") throw new Error("The Calendar bridge requires macOS.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.GLASHAUS_HOME ?? path.join(root, ".glashaus-v3");
const app = path.join(home, "helpers", "Glashaus Calendar.app");
mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true, mode: 0o700 });
writeFileSync(path.join(app, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>net.glashaus.calendar</string><key>CFBundleName</key><string>Glashaus Calendar</string><key>CFBundleExecutable</key><string>GlashausCalendar</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/><key>NSCalendarsFullAccessUsageDescription</key><string>Your companion reads the calendars you select and saves only changes you review and confirm in Glashaus.</string></dict></plist>`);
execFileSync("xcrun", ["swiftc", "-parse-as-library", "-O", "-target", `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macosx14.0`, path.join(root, "scripts", "GlashausCalendar.swift"), "-o", path.join(app, "Contents", "MacOS", "GlashausCalendar")], { stdio: "inherit" });
// A certificate-backed identity keeps Calendar consent stable across rebuilds.
// Ad-hoc signing hashes each binary, so its consent may need renewal on update.
const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
const available = [...identities.matchAll(/\b([A-F0-9]{40}) "(?:Apple Development|Developer ID Application):[^\n]+"/g)].map((match) => match[1]);
const signingIdentity = process.env.GLASHAUS_MAC_SIGN_IDENTITY ?? (available.length === 1 ? available[0] : "-");
execFileSync("codesign", ["--force", "--sign", signingIdentity, "--identifier", "net.glashaus.calendar", app], { stdio: "inherit" });
console.log("Calendar helper installed. Connect Calendar in Glashaus Settings to request access on this Mac.");
if (signingIdentity === "-") console.log("Using local ad-hoc signing. Rebuilding may require Calendar access again; set GLASHAUS_MAC_SIGN_IDENTITY to a signing identity for stable updates.");
