# v3 alpha.5 release checks

The owner approved replacing the repository's current app with v3 and publishing an installable alpha. Git history and the v2 source are retained. Release status is recorded by GitHub Actions and the release page.

## Verified here

- 47 automated checks on Windows with Node 24.19: persistence, source evidence, archive restore, memory correction and forgetting, Telegram reconnect/rate limits/pairing/delivery, installer integrity, background-service behavior, and first-person prompt coverage. Both TypeScript checks, the production build, and the separate-process portable restart check also passed.
- The real Windows PowerShell 5 installer was tested twice with a spaced path. Each install used a new directory; a sentinel existing file survived. A bad checksum was refused before running app code.
- Live Kimi K2.6 cloud: streaming, public character research, concise preview, conversation, evidence-backed extraction, history-free recall, reflection, explicit correction, corrected recall after 100 additional synthetic exchanges, and archive restore.
- Owner confirmed Telegram paired and returned a reply. Tests did not alter the real companion's identity or history.

## Publication gate

1. Review the branch diff and preserve the existing v2 tag/history. The historical source under `legacy-v2/` is not included in runtime archives.
2. Run the included GitHub Actions Windows/macOS/Linux matrix. It covers installer execution, browser regression, build, and separate-process portable startup. Mac/Linux results are not verified locally.
3. A push to `main` runs the release workflow. It publishes a **prerelease** only after the full matrix succeeds, the build completes, and the actual ZIP passes a separate-process startup/restart test.
4. The package version selects the release tag. Existing release assets are never overwritten. Both installers default to `v3.0.0-alpha.5`, avoiding GitHub's stable-only latest-release lookup. `GLASHAUS_RELEASE_TAG` can select another v3 version.

## First-person voice checks

Alpha.5 adds a shared first-person default for self speech and permitted roleplay actions. Six automated regression cases cover character/authored/grow identities, web and Telegram history, previews and reflections, explicit narration requests, and preserving other people's pronouns and old replies. The tests use an in-memory synthetic companion, not the owner's data. This is a prompt change, not a database migration or a text-replacement filter.

The optional `node tests/live-perspective.ts --run <model> [ollama-url]` check exercises ordinary conversation, roleplay actions, an explicit third-person request, another character's actions, and voice preview. It sends only synthetic conversations to the selected Ollama model. Hosted inference may consume the account's allowance; this test is not part of automatic CI.

All five cases passed in a full live run with `kimi-k2.6:cloud`. An earlier run exposed drafting text in a model response ending with an unmatched `</think>` marker despite `think: false`. The live check treats that as a failure, not as a valid first-person reply. A separate test assertion was corrected to accept past-tense third-person narration as well as present tense. The later successful run does not prove the drafting-text issue is fixed; alpha.5 leaves inference settings and the existing reply filter unchanged.

## Background-service checks

Alpha.4 adds opt-in background startup in setup and Settings, with Windows Task Scheduler, macOS LaunchAgents, and Linux systemd user units. Unit tests use fake OS commands and isolated files, never a real login registration. Native service integration runs only on explicitly opted-in disposable CI machines: it exercises registration, a foreground-to-background handoff, persistence, duplicate-port refusal, disable-without-shutdown, stop, and restart. Publication is blocked if any platform fails.

No background service is enabled on the owner's PC during development. Native CI passes are recorded in the linked release workflow, not inferred from unit tests. The default manual-start path and portable restart test remain release gates. Alpha.4 does not change the SQLite schema.

## Published-install regression

The alpha.2 public ZIP matched its SHA-256, but Windows PowerShell 5 returned the checksum response as a byte array because GitHub serves it as `application/octet-stream`. Casting those bytes to a string rejected a valid download. Alpha.3 reads the checksum from a downloaded file, adds a binary-response regression fixture, and retains refusal of an invalid checksum. No database schema or companion behavior changed in alpha.3.

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
- No voice, photos, scheduled outreach, or full v2 migration yet. Background startup does not keep a sleeping computer online or start Ollama for you.
