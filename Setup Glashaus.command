#!/bin/bash
set -euo pipefail
glashaus_root="$(cd "$(dirname "$0")" && pwd)"
cd "$glashaus_root"
fail() { printf '%s\n' "$1" >&2; exit 1; }
[[ "$(uname -s)" == Darwin ]] || fail 'This setup is for macOS. The native Calendar bridge needs a Mac.'
[[ -f package.json && -f bin/glashaus-full.js ]] || fail 'Keep Setup Glashaus.command inside the downloaded Glashaus folder.'
[[ "${1:-}" == '' || "${1:-}" == '--check' || "${1:-}" == '--no-start' ]] || fail 'Options: --check (requirements only), --no-start (build without starting a service).'
/usr/bin/xcode-select -p >/dev/null 2>&1 || fail 'Install Xcode from the Mac App Store and open it once, then retry.'
/usr/bin/xcrun --find swiftc >/dev/null 2>&1 || fail 'Finish installing the Xcode tools, then retry.'
[[ "${1:-}" != '--check' ]] || { printf '%s\n' 'Mac and Swift tools found. Setup can install its own Node and pnpm. Full Xcode is required to install on iPhone.'; exit 0; }
case "$(uname -m)" in
  arm64) glashaus_arch=arm64; glashaus_sha=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057 ;;
  x86_64) glashaus_arch=x64; glashaus_sha=1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097 ;;
  *) fail 'Unsupported Mac architecture.' ;;
esac
glashaus_runtime="${GLASHAUS_RUNTIME_DIR:-$HOME/Library/Application Support/Glashaus/Runtime}"
mkdir -p "$glashaus_runtime"
glashaus_temp="$(mktemp -d "${TMPDIR:-/tmp}/glashaus-setup.XXXXXXXX")"
trap 'rm -rf "$glashaus_temp"' EXIT
glashaus_node_dir="$glashaus_runtime/node-v24.21.0-darwin-$glashaus_arch"
if [[ ! -x "$glashaus_node_dir/bin/node" ]]; then
  printf '%s\n' 'Installing a private Node 24 runtime…'
  curl --proto '=https' --tlsv1.2 -fL --retry 2 "https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-$glashaus_arch.tar.gz" -o "$glashaus_temp/node.tar.gz"
  [[ "$(shasum -a 256 "$glashaus_temp/node.tar.gz" | awk '{print $1}')" == "$glashaus_sha" ]] || fail 'Node download checksum did not match. Nothing was installed.'
  tar -xzf "$glashaus_temp/node.tar.gz" -C "$glashaus_runtime"
fi
export PATH="$glashaus_node_dir/bin:$PATH"
node -e 'if(process.versions.node!=="24.21.0")process.exit(1)' || fail 'The private Node runtime is incomplete. Remove only that Runtime/node-v24.21.0 folder and rerun setup.'
glashaus_pnpm="$glashaus_runtime/pnpm-11.19.0"
if [[ ! -f "$glashaus_pnpm/bin/pnpm.cjs" ]]; then
  printf '%s\n' 'Installing a private pnpm…'
  curl --proto '=https' --tlsv1.2 -fL --retry 2 https://registry.npmjs.org/pnpm/-/pnpm-11.19.0.tgz -o "$glashaus_temp/pnpm.tgz"
  node --input-type=module - "$glashaus_temp/pnpm.tgz" <<'JS'
import {readFileSync} from 'node:fs'; import {createHash} from 'node:crypto';
if(createHash('sha512').update(readFileSync(process.argv[2])).digest('base64')!=='eIHz7VkNRyxKlV4riLISF5ERYGbcyIy8o4SeybYPG7qm0syyIfqR2k4cZb7yvL43k2Wup6xTnHv4be3DobItzg==')throw Error('pnpm download checksum did not match.');
JS
  mkdir "$glashaus_temp/pnpm"
  tar -xzf "$glashaus_temp/pnpm.tgz" -C "$glashaus_temp/pnpm" --strip-components=1
  mv "$glashaus_temp/pnpm" "$glashaus_pnpm"
fi
printf '%s\n' 'Building Glashaus and its Calendar helper…'
node "$glashaus_pnpm/bin/pnpm.cjs" install --frozen-lockfile
node "$glashaus_pnpm/bin/pnpm.cjs" build
if [[ -f full-companion-install.json ]]; then
  glashaus_saved_home="$(node -p 'JSON.parse(require("fs").readFileSync("full-companion-install.json","utf8")).directory')"
  glashaus_saved_port="$(node -p 'JSON.parse(require("fs").readFileSync("full-companion-install.json","utf8")).port')"
  glashaus_saved_mobile="$(node -p 'JSON.parse(require("fs").readFileSync("full-companion-install.json","utf8")).mobilePort')"
fi
export GLASHAUS_HOME="${GLASHAUS_HOME:-${glashaus_saved_home:-$HOME/Library/Application Support/Glashaus/Companion}}"
export GLASHAUS_PORT="${GLASHAUS_PORT:-${glashaus_saved_port:-7783}}"
export GLASHAUS_MOBILE_PORT="${GLASHAUS_MOBILE_PORT:-${glashaus_saved_mobile:-7784}}"
node scripts/calendar-install.ts
node scripts/companion-setup.ts "${1:-}"
