import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.platform !== "darwin")
  throw new Error("Build the Mac app on macOS with Xcode command-line tools.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (file: string, args: string[], cwd = root) =>
  execFileSync(file, args, { cwd, stdio: "inherit" });
const app = path.join(root, "macos/build/Glashaus.app"),
  contents = path.join(app, "Contents"),
  resources = path.join(contents, "Resources"),
  runtime = path.join(resources, "runtime");
mkdirSync(path.join(contents, "MacOS"), { recursive: true });
mkdirSync(runtime, { recursive: true });
run("pnpm", ["build"]);
run("xcrun", [
  "swiftc",
  ...(process.argv.includes("--review") ? ["-D", "DEBUG"] : []),
  "-parse-as-library",
  "-O",
  "-target",
  `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macosx14.0`,
  "macos/Glashaus.swift",
  "-o",
  path.join(contents, "MacOS", "Glashaus"),
]);
writeFileSync(
  path.join(contents, "Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>net.glashaus.desktop</string><key>CFBundleName</key><string>Glashaus</string><key>CFBundleExecutable</key><string>Glashaus</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.2.0</string><key>CFBundleVersion</key><string>2</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSHighResolutionCapable</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>`,
);
for (const name of ["PastoralBackdrop", "FieldQuiet", "NightRelay"]) {
  const directory = path.join(
    root,
    "ios/Glashaus/Assets.xcassets",
    `${name}.imageset`,
  );
  const manifest = JSON.parse(
    readFileSync(path.join(directory, "Contents.json"), "utf8"),
  );
  const file = manifest.images.find(
    (image: { filename?: string }) => image.filename,
  )?.filename;
  if (file)
    cpSync(path.join(directory, file), path.join(resources, `${name}.png`));
}
cpSync(process.execPath, path.join(runtime, "node"));
cpSync(path.join(root, "macos/NODE-LICENSE.txt"), path.join(runtime, "NODE-LICENSE.txt"));
for (const item of [
  "dist",
  "bin",
  "tool-runtime",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "pnpm-lock.yaml",
])
  cpSync(path.join(root, item), path.join(runtime, item), { recursive: true });
const manifest = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
writeFileSync(
  path.join(runtime, "package.json"),
  JSON.stringify(manifest, null, 2),
);
run(
  "pnpm",
  [
    "install",
    "--ignore-workspace",
    "--prod",
    "--frozen-lockfile",
    "--ignore-scripts",
  ],
  runtime,
);
const iconset = path.join(root, "macos/build/Glashaus.iconset");
mkdirSync(iconset, { recursive: true });
const sourceIcon = path.join(
  root,
  "ios/Glashaus/Assets.xcassets/AppIcon.appiconset/AppIcon.png",
);
for (const size of [16, 32, 128, 256, 512])
  for (const scale of [1, 2])
    run("sips", [
      "-z",
      String(size * scale),
      String(size * scale),
      sourceIcon,
      "--out",
      path.join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
    ]);
run("iconutil", [
  "-c",
  "icns",
  iconset,
  "-o",
  path.join(resources, "Glashaus.icns"),
]);
const plistPath = path.join(contents, "Info.plist");
writeFileSync(
  plistPath,
  readFileSync(plistPath, "utf8").replace(
    "<key>CFBundleName</key>",
    "<key>CFBundleIconFile</key><string>Glashaus</string><key>CFBundleName</key>",
  ),
);
const identity = process.env.GLASHAUS_MAC_SIGN_IDENTITY ?? "-";
run("codesign", ["--force", "--deep", "--sign", identity, app]);
run("codesign", ["--verify", "--deep", "--strict", app]);
if (process.argv.includes("--dmg")) {
  const stage = path.join(root, "macos/build/dmg");
  mkdirSync(stage, { recursive: true });
  cpSync(app, path.join(stage, "Glashaus.app"), { recursive: true });
  const { symlinkSync } = await import("node:fs");
  if (!existsSync(path.join(stage, "Applications")))
    symlinkSync("/Applications", path.join(stage, "Applications"));
  writeFileSync(
    path.join(stage, "READ ME.txt"),
    "Glashaus for Mac\n\nDrag Glashaus to Applications and open it. It connects to an existing Glashaus service on port 7783, or starts its bundled service with a new ~/.glashaus-v3 home. Finish companion setup in the browser when prompted.\n\nDocument and calculation tasks need Docker Desktop. Install and open it, then choose Settings > Prepare local tools in Glashaus. Model and voice credentials are entered in Glashaus Settings, never bundled.\n\nThis private development build is locally signed, not notarized by Apple. Public distribution and automatic updates remain release work.\n",
  );
  run("hdiutil", [
    "create",
    "-volname",
    "Glashaus",
    "-srcfolder",
    stage,
    "-ov",
    "-format",
    "UDZO",
    path.join(root, "macos/build/Glashaus.dmg"),
  ]);
}
console.log(`Built ${app}`);
