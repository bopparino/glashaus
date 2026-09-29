# Desktop and local workspace

Glashaus owns the conversation, tool selection, durable task queue and file library. Hermes is an upstream source for a small MIT-licensed document helper; no Hermes agent or daemon runs.

## Start on a Mac

Build with Node 24, pnpm and Xcode command-line tools:

```sh
pnpm install --frozen-lockfile
pnpm desktop:dmg
```

Open `macos/build/Glashaus.dmg`, drag Glashaus into Applications, and launch it. The app connects to a running service at `http://127.0.0.1:7783`. If there is none, it starts the bundled Node runtime using `~/.glashaus-v3`. A new companion is configured through the existing browser setup. Advanced companion, account, voice and Calendar settings continue to use that shared settings interface.

Install and open Docker Desktop, accept its first-run agreement, then choose **Settings → Prepare local tools** in the Mac app. This builds the image once; later document and calculation jobs have no network access. Docker must be running while those jobs execute. The source equivalent is `pnpm sandbox:setup`.

This package is a private development build, locally signed. Developer ID signing, notarization, automatic updates, a Windows desktop shell and Linux desktop packaging are not included. Do not describe the DMG as notarized. The build uses the current Mac's architecture.

## First useful workflow

1. Attach up to three photos from Conversation's menu on the Mac or iPhone.
2. Ask for a plan and explicitly request PDF and Word files. Image reasoning uses the configured vision model, including Kimi K2.6 through Ollama.
3. Elle returns a saved-task receipt. Conversation remains usable while the task runs.
4. On the Mac, use Tasks and Library. On iPhone, open Home → Files and tasks, or use the Conversation menu.
5. Open either format, save a copy, or use the platform share sheet. Revising a plan makes another file pair, preserving the earlier outputs.

The Mac app previews files beside chat when the available detail area is at least 850 points wide. In narrower detail areas, the preview fills that area and a back arrow restores the underlying view. Save As and Share remain in the preview toolbar; switching sidebar destinations closes the preview. iPhone previews use Quick Look, including its Files/share actions. These downloads use the existing authenticated connection and certificate pinning. Pairing and the WARP-compatible private connection are unchanged.

## Execution and limits

- One job runs at a time, with at most four active jobs per home. Each chat message may start one workspace job. Cancelling stops its container; retry creates a new task linked to the previous one.
- A service restart marks unfinished work interrupted. It does not silently repeat work. Known interrupted job containers are removed before another task starts.
- The container runs as a non-root user, without network, host mounts, Docker socket or account credentials. Its root filesystem is read-only; writable RAM disks, CPU, memory, processes, execution time and output size are bounded.
- Document tasks accept validated structured content. Glashaus reuses Hermes's DOCX block helper, applies sans-serif document styles and produces the PDF from the same Word document through LibreOffice. Requested page limits are checked before publishing files.
- Python tasks run model-written code in that same isolated workspace. Initial outputs support PDF, DOCX, UTF-8 text and CSV. This is not host terminal access, browser automation or Mac computer control.
- Image inputs are JPEG/PNG, up to three per message and 3 MB each after client resizing. Files are at most 8 MB each. The initial shared library holds 24 MB so it remains within the existing portable JSON backup limit. Save and remove unneeded files when full.
- Files, task metadata and attachment references live in SQLite. Archive schema 7 includes file bytes and checksums; database schema 8 adds the workspace tables. Reset clears them atomically. Restored unfinished jobs remain interrupted, and existing external-action review rules are retained.
- Model inference and image reasoning use the owner's configured provider. Local sandbox execution does not mean the model itself is local.

## Remaining stages

Native desktop microphone/voice controls, native account/settings editors, browser automation, opt-in computer control, richer artifact formats, a larger file-backed library and signed public distribution remain separate follow-up stages. APNs remains deferred. Existing iPhone voice, mail, Calendar and reviewed external actions remain available.

## Verification

The [desktop design record](DESKTOP-DESIGN.md) documents implemented tokens, layout, navigation and artwork reuse. Final captures and the bounded reviewer verdict are linked from the [native completion record](../.impeccable/review/desktop-workspace/native-completion.md). The HTML/CSS hero comparison gate remains open; native review does not establish a numerical pixel-fidelity pass or certify unfinished desktop features.

Backend tests cover vision payloads, exact retry attachment identity, archive integrity, destructive reset, durable completion, cancellation, interrupted recovery, task idempotency and the one-task receipt. The local Docker smoke check verifies non-root execution, a read-only root filesystem, no host mount, no Docker socket, no API keys and no network. Live Kimi trials exercise image → plan → PDF/DOCX and Python → saved arithmetic result. Native iPhone tests cover the new library and photo entry alongside the existing pairing, reminder, memory and connection flows.
