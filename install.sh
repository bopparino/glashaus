#!/bin/sh
# Inspect this file before running it. Requires Node 24, curl, and unzip.
set -eu
fail() { printf '%s\n' "$1" >&2; exit 1; }
command -v node >/dev/null 2>&1 || fail 'Install Node.js 24 LTS first: https://nodejs.org/en/download'
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major===24&&minor>=14?0:1)' || fail 'GlasHaus v3 requires Node 24.14 or newer within the 24.x line.'
command -v curl >/dev/null 2>&1 || fail 'Install curl, then try again.'
command -v unzip >/dev/null 2>&1 || fail 'Install unzip, then try again.'
: "${GLASHAUS_RELEASE_TAG:=v3.0.0-alpha.6}"
if [ -n "$GLASHAUS_RELEASE_TAG" ]; then
  case "$GLASHAUS_RELEASE_TAG" in v3.*) ;; *) fail 'GLASHAUS_RELEASE_TAG must be a v3 release tag.' ;; esac
  case "$GLASHAUS_RELEASE_TAG" in *[!A-Za-z0-9._-]*) fail 'Invalid release tag.' ;; esac
  release_base="https://github.com/bopparino/glashaus/releases/download/$GLASHAUS_RELEASE_TAG"
fi
install_base="${GLASHAUS_INSTALL_ROOT:-$HOME/.local/share/glashaus}"
mkdir -p "$install_base"
install_dir="$(mktemp -d "$install_base/v3-XXXXXXXX")"
download_dir="$(mktemp -d "${TMPDIR:-/tmp}/glashaus-download-XXXXXXXX")"
printf '%s\n' 'Downloading the published GlasHaus v3 release...'
if [ -n "${GLASHAUS_ARCHIVE:-}" ]; then
  cp "$GLASHAUS_ARCHIVE" "$download_dir/glashaus-v3.zip"
  cp "$GLASHAUS_ARCHIVE.sha256" "$download_dir/checksum"
else
  curl --proto '=https' -fsSL "$release_base/glashaus-v3.zip" -o "$download_dir/glashaus-v3.zip" || fail 'No v3 release asset was found. Nothing was run.'
  curl --proto '=https' -fsSL "$release_base/glashaus-v3.zip.sha256" -o "$download_dir/checksum" || fail 'No release checksum was found. Nothing was run.'
fi
node --input-type=module -e 'import{readFileSync}from"node:fs";import{createHash}from"node:crypto";const expected=readFileSync(process.argv[2],"utf8").trim().split(/\s+/)[0];const actual=createHash("sha256").update(readFileSync(process.argv[1])).digest("hex");if(!/^[a-f0-9]{64}$/i.test(expected)||expected.toLowerCase()!==actual){console.error("Release checksum did not match.");process.exit(1)}' "$download_dir/glashaus-v3.zip" "$download_dir/checksum"
unzip -q "$download_dir/glashaus-v3.zip" -d "$install_dir"
[ -f "$install_dir/bin/glashaus-v3.js" ] || fail 'This release does not contain a v3 app.'
printf 'Installed in %s\nTo start again: node "%s/bin/glashaus-v3.js"\n' "$install_dir" "$install_dir"
printf '%s\n' 'Your companion data is separate, in ~/.glashaus-v3. Existing v2 data is untouched.'
if [ "${GLASHAUS_INSTALL_ONLY:-}" != '1' ]; then
  exec node "$install_dir/bin/glashaus-v3.js" install
fi
