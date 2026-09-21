import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { AppError } from "./validation.ts";
import { psQuote } from "./startup.ts";

export interface Release {
  version: string;
  tag: string;
  url: string;
}
const pattern = /^v?(3)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/;
export function compareVersions(a: string, b: string) {
  const parts = (v: string) => {
    const m = pattern.exec(v);
    if (!m) throw new AppError("Unsupported release version.");
    return [
      +m[1],
      +m[2],
      +m[3],
      m[4] ? ["alpha", "beta", "rc"].indexOf(m[4]) : 3,
      +(m[5] ?? 0),
    ];
  };
  const aa = parts(a),
    bb = parts(b);
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return 0;
}
export async function latestRelease(
  current: string,
  request: typeof fetch = fetch,
): Promise<Release | null> {
  const response = await request(
    "https://api.github.com/repos/bopparino/glashaus/releases?per_page=100",
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "GlasHaus-update",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new AppError(
      "GitHub could not be reached or its request limit was hit. Your app has not changed. Try again later.",
    );
  const releases = (await response.json()) as {
    draft: boolean;
    tag_name: string;
    assets: { name: string }[];
  }[];
  if (!Array.isArray(releases))
    throw new AppError("GitHub returned an unreadable release list.");
  const candidate = releases
    .filter(
      (r) =>
        !r.draft &&
        pattern.test(r.tag_name) &&
        (current.includes("-") || !r.tag_name.includes("-")) &&
        ["glashaus-v3.zip", "glashaus-v3.zip.sha256"].every((name) =>
          r.assets?.some((a) => a.name === name),
        ),
    )
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
  return candidate && compareVersions(candidate.tag_name, current) > 0
    ? {
        version: candidate.tag_name.replace(/^v/, ""),
        tag: candidate.tag_name,
        url: `https://github.com/bopparino/glashaus/releases/tag/${candidate.tag_name}`,
      }
    : null;
}
async function download(url: string, limit: number, request: typeof fetch) {
  const response = await request(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body)
    throw new AppError(
      "The release download failed. The running app has not changed.",
    );
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > limit)
      throw new AppError("The release download exceeded its size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function stageRelease(
  release: Release,
  request: typeof fetch = fetch,
  installRoot?: string,
) {
  if (!pattern.test(release.tag) || release.tag !== `v${release.version}`)
    throw new AppError("Invalid release tag.");
  const base = `https://github.com/bopparino/glashaus/releases/download/${release.tag}`;
  const [archive, checksum] = await Promise.all([
    download(`${base}/glashaus-v3.zip`, 100_000_000, request),
    download(`${base}/glashaus-v3.zip.sha256`, 1024, request),
  ]);
  const expected = checksum
    .toString("utf8")
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
  if (
    !/^[a-f0-9]{64}$/.test(expected) ||
    createHash("sha256").update(archive).digest("hex") !== expected
  )
    throw new AppError(
      "Release checksum did not match. No downloaded code was run.",
    );
  const root = path.resolve(
    installRoot ??
      process.env.GLASHAUS_INSTALL_ROOT ??
      path.join(os.homedir(), ".local", "share", "glashaus"),
  );
  mkdirSync(root, { recursive: true });
  const candidate = mkdtempSync(path.join(root, "v3-update-"));
  const zip = path.join(candidate, "release.zip");
  writeFileSync(zip, archive, { mode: 0o600 });
  // Only the checksum-verified, fixed repository release is extracted; browser
  // input cannot supply a URL, archive, executable, or destination.
  const exec = promisify(execFile);
  if (process.platform === "win32")
    await exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${psQuote(zip)} -DestinationPath ${psQuote(candidate)}`,
      ],
      { windowsHide: true, timeout: 60000 },
    );
  else await exec("unzip", ["-q", zip, "-d", candidate], { timeout: 60000 });
  const pkg = JSON.parse(
    readFileSync(path.join(candidate, "package.json"), "utf8"),
  );
  if (pkg.name !== "glashaus" || pkg.version !== release.version)
    throw new AppError(
      "The downloaded app does not match the selected release.",
    );
  return candidate;
}
