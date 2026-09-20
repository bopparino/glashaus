# v3 alpha.2 release checks

The owner approved replacing the repository's current app with v3 and publishing an installable alpha. Git history and the v2 source are retained. Release status is recorded by GitHub Actions and the release page.

## Verified here

- 31 automated checks on Windows with Node 24.19: persistence, source evidence, archive restore, memory correction and forgetting, Telegram reconnect/rate limits/pairing/delivery, installer integrity, and matching the default installer release to the package version.
- The real Windows PowerShell 5 installer was tested twice with a spaced path. Each install used a new directory; a sentinel existing file survived. A bad checksum was refused before running app code.
- Live Kimi K2.6 cloud: streaming, public character research, concise preview, conversation, evidence-backed extraction, history-free recall, reflection, explicit correction, corrected recall after 100 additional synthetic exchanges, and archive restore.
- Owner confirmed Telegram paired and returned a reply. Tests did not alter the real companion's identity or history.

## Publication gate

1. Review the branch diff and preserve the existing v2 tag/history. The historical source under `legacy-v2/` is not included in runtime archives.
2. Run the included GitHub Actions Windows/macOS/Linux matrix. It covers installer execution, browser regression, build, and separate-process portable startup. Mac/Linux results are not verified locally.
3. A push to `main` runs the release workflow. It publishes a **prerelease** only after the full matrix succeeds, the build completes, and the actual ZIP passes a separate-process startup/restart test.
4. The package version selects the release tag. Existing release assets are never overwritten. Both installers default to `v3.0.0-alpha.2`, avoiding GitHub's stable-only latest-release lookup. `GLASHAUS_RELEASE_TAG` can select another v3 version.

## Upgrade and rollback

Stop GlasHaus before changing app versions. Export a JSON archive in Settings, and keep a filesystem copy of the old data directory while the app is stopped. Protect that copy: it includes credentials and private conversations. Do not upload it with source or release assets.

Alpha.2 upgrades the v3 SQLite schema additively from version 1 to version 2. Older rows stay intact; two tables track replaced memories and suppressions. Keep your pre-upgrade copy if you want to go back to alpha.1. Do not point alpha.1 at the upgraded database. To roll back, run the old app against the untouched pre-upgrade copy, or restore the old export into a separate empty home compatible with that version.

For v2, export a soul capsule from the old app and import it during v3 setup. This carries identity and supported memories; it does **not** import the full v2 conversation database. Unmapped capsule fields remain in the archive's recovery data. Leave v2 data intact.

## Offline installer check

Set `GLASHAUS_ARCHIVE` to the portable ZIP with a sibling `.sha256` file, `GLASHAUS_INSTALL_ROOT` to a test folder, and `GLASHAUS_INSTALL_ONLY=1`. Run the platform installer. This checks the same extraction and integrity path without contacting GitHub or starting a companion.

## Honest limits

- Memory correction is evidence-gated, not a guarantee that an LLM understands every change. Inspect the memory page when correctness matters.
- Forgetting excludes stored memory and its source exchange from future recall/extraction. It does not erase the original private archive, and cannot prevent a future conversation from expressing similar information again.
- Telegram resumes acknowledged message chunks without regeneration. An ambiguous network failure can still deliver twice; exactly-once delivery is not promised.
- No voice, photos, scheduled outreach, OS background service, or full v2 migration yet.
