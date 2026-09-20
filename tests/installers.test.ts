import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

test("both one-line installers select the package's v3 release instead of GitHub's stable-only latest", () => {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  for (const file of ["install.ps1", "install.sh"]) {
    const script = readFileSync(file, "utf8");
    assert.ok(
      script.includes(`v${version}`),
      `${file} must select v${version}`,
    );
    assert.ok(!script.includes("releases/latest/download"));
    if (file.endsWith(".ps1")) {
      assert.equal(
        (script.match(/Invoke-WebRequest -UseBasicParsing/g) ?? []).length,
        2,
      );
    }
  }
});

// Offline fixture exercises the real installer, not a production bot or home.
test("platform installer checks integrity, handles spaced paths, and never replaces an existing installation", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "glashaus installer "));
  const fixture = path.join(directory, "fixture"),
    installRoot = path.join(directory, "apps"),
    archive = path.join(directory, "glashaus-v3.zip");
  try {
    mkdirSync(path.join(fixture, "bin"), { recursive: true });
    mkdirSync(installRoot);
    writeFileSync(
      path.join(fixture, "bin/glashaus-v3.js"),
      "console.log('fixture install');\n",
    );
    writeFileSync(path.join(installRoot, "existing.txt"), "Leave me intact.");
    const windows = process.platform === "win32";
    const childEnv = { ...process.env };
    // Windows PowerShell must discover its own modules, not inherit PowerShell 7's.
    delete childEnv.PSModulePath;
    const zip = windows
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            "Compress-Archive -Path (Join-Path $env:FIXTURE '*') -DestinationPath $env:ARCHIVE",
          ],
          {
            env: { ...childEnv, FIXTURE: fixture, ARCHIVE: archive },
            encoding: "utf8",
            windowsHide: true,
          },
        )
      : spawnSync("zip", ["-qr", archive, "."], {
          cwd: fixture,
          encoding: "utf8",
        });
    assert.equal(zip.status, 0, zip.stderr);
    const checksum = createHash("sha256")
      .update(readFileSync(archive))
      .digest("hex");
    writeFileSync(`${archive}.sha256`, `${checksum}  glashaus-v3.zip\n`);
    const run = () =>
      spawnSync(
        windows ? "powershell.exe" : "sh",
        windows
          ? [
              "-NoProfile",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              path.resolve("install.ps1"),
            ]
          : [path.resolve("install.sh")],
        {
          encoding: "utf8",
          timeout: 30000,
          windowsHide: true,
          env: {
            ...childEnv,
            GLASHAUS_ARCHIVE: archive,
            GLASHAUS_INSTALL_ROOT: installRoot,
            GLASHAUS_INSTALL_ONLY: "1",
            GLASHAUS_RELEASE_TAG: "v3.0.0-alpha.3",
          },
        },
      );
    for (let i = 0; i < 2; i++) {
      const result = run();
      assert.equal(result.status, 0, result.stderr);
    }
    const versions = readdirSync(installRoot).filter((name) =>
      name.startsWith("v3-"),
    );
    assert.equal(versions.length, 2);
    for (const version of versions)
      assert.match(
        readFileSync(
          path.join(installRoot, version, "bin/glashaus-v3.js"),
          "utf8",
        ),
        /fixture install/,
      );
    assert.equal(
      readFileSync(path.join(installRoot, "existing.txt"), "utf8"),
      "Leave me intact.",
    );
    // Match GitHub's application/octet-stream response in Windows PowerShell 5.
    // No network is used: the real installer receives the same fixture bytes.
    const networkRun = () =>
      spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `
        function Invoke-WebRequest {
          param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)
          $source = if ($Uri.EndsWith('.sha256')) { "$env:FIXTURE_ARCHIVE.sha256" } else { $env:FIXTURE_ARCHIVE }
          if ($OutFile) { Copy-Item -LiteralPath $source -Destination $OutFile }
          else { [pscustomobject]@{ Content = [IO.File]::ReadAllBytes($source) } }
        }
        & $env:INSTALL_SCRIPT
      `,
        ],
        {
          encoding: "utf8",
          timeout: 30000,
          windowsHide: true,
          env: {
            ...childEnv,
            GLASHAUS_ARCHIVE: "",
            GLASHAUS_RELEASE_TAG: "",
            GLASHAUS_INSTALL_ROOT: installRoot,
            GLASHAUS_INSTALL_ONLY: "1",
            FIXTURE_ARCHIVE: archive,
            INSTALL_SCRIPT: path.resolve("install.ps1"),
          },
        },
      );
    if (windows) {
      const downloaded = networkRun();
      assert.equal(downloaded.status, 0, downloaded.stderr);
    }
    writeFileSync(`${archive}.sha256`, `${"0".repeat(64)}  glashaus-v3.zip\n`);
    const failed = run();
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /checksum/i);
    if (windows) {
      const refused = networkRun();
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /checksum/i);
    }
    assert.equal(
      readdirSync(installRoot).filter(
        (name) =>
          name.startsWith("v3-") &&
          readdirSync(path.join(installRoot, name)).length,
      ).length,
      windows ? 3 : 2,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
