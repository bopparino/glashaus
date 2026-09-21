import { useEffect, useRef, useState } from "react";
import type { UpdateStatus } from "../shared/types";
import { api } from "./api";
import { messageOf, Notice } from "./Forms";

const pending = (status: UpdateStatus | null) =>
  !!status?.operation &&
  ["preparing", "stopping", "backing-up", "starting"].includes(
    status.operation.phase,
  );

export function UpdateSettings() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const checkButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (confirm) confirmButton.current?.focus();
    else if (returnFocus.current) {
      checkButton.current?.focus();
      returnFocus.current = false;
    }
  }, [confirm]);
  const reconnecting = useRef(false);
  useEffect(() => {
    let active = true;
    let disconnectedAt = 0;
    const load = async () => {
      try {
        const next = await api<UpdateStatus>(
          "/updates",
          undefined,
          "GET",
          AbortSignal.timeout(4000),
        );
        if (!active) return;
        setStatus(next);
        setOffline(false);
        disconnectedAt = 0;
        if (
          reconnecting.current &&
          next.operation?.phase === "complete" &&
          next.current === next.operation.version
        ) {
          // New HTML loads the matching JS bundle and a fresh mutation token.
          window.location.reload();
          return;
        }
        if (pending(next)) reconnecting.current = true;
        if (
          next.operation?.phase === "failed" ||
          next.operation?.phase === "recovery-needed"
        ) {
          reconnecting.current = false;
          await api("/state");
        }
      } catch {
        if (!active) return;
        if (reconnecting.current) {
          setOffline(true);
          disconnectedAt ||= Date.now();
          if (Date.now() - disconnectedAt > 180000) {
            setError(
              "GlasHaus has not reconnected. Refresh this page in a moment. If it stays offline, run 'node bin/glashaus-v3.js recover' from the downloaded app. Keep your companion and app folders.",
            );
            reconnecting.current = false;
          }
        } else
          setError(
            "Could not read update status. Try Check for updates, or reopen Settings.",
          );
      }
    };
    void load();
    const timer = setInterval(() => {
      if (reconnecting.current) void load();
    }, 1800);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function check() {
    setBusy(true);
    setError("");
    setConfirm(false);
    try {
      setStatus(await api<UpdateStatus>("/updates/check", {}));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function update() {
    if (!status?.latest) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<UpdateStatus>("/updates", {
        version: status.latest.version,
        confirmed: true,
      });
      setStatus(next);
      setConfirm(false);
      reconnecting.current = true;
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  const running = pending(status);
  const recovery = status?.operation?.phase === "recovery-needed";
  return (
    <section className="settings-section" aria-labelledby="updates-title">
      <h2 id="updates-title">Updates</h2>
      <p className="section-description">
        A newer app, the same companion. Check when you’re ready; nothing
        installs without your say-so.
      </p>
      {status && <p className="helper">Installed · {status.current}</p>}
      {error && <Notice error>{error}</Notice>}
      {status?.operation && (
        <Notice error={recovery || status.operation.phase === "failed"}>
          {offline
            ? "Restarting GlasHaus. Waiting for this page to reconnect…"
            : status.operation.message}
        </Notice>
      )}
      {status?.operation?.backup && (
        <p className="helper update-backup">
          Private recovery backup: {status.operation.backup}. It includes saved
          keys; keep it safe.
        </p>
      )}
      {status?.message && <p className="helper">{status.message}</p>}
      {!running && !recovery && (
        <>
          {status?.checkedAt && (
            <p role="status" className="helper">
              {status.latest
                ? `${status.latest.version} is available.`
                : "You’re on the latest release for this version channel."}
            </p>
          )}
          {confirm ? (
            <div>
              <p className="section-description">
                Update to {status?.latest?.version}? GlasHaus downloads and
                checks the release first, then briefly stops to back up your
                data and restart. Chats, memory, keys, and Telegram pairing stay
                in place. If startup fails, it tries to restore the previous
                version.
              </p>
              <div className="inline-actions">
                <button
                  ref={confirmButton}
                  className="button primary"
                  disabled={busy}
                  onClick={() => void update()}
                >
                  {busy ? "Starting update…" : "Update and restart"}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    returnFocus.current = true;
                    setConfirm(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="inline-actions">
              <button
                ref={checkButton}
                className="button secondary"
                disabled={busy}
                onClick={() => void check()}
              >
                {busy ? "Checking…" : "Check for updates"}
              </button>
              {status?.latest && (
                <>
                  <button
                    className="button primary"
                    disabled={busy || !status.available}
                    onClick={() => setConfirm(true)}
                  >
                    Update GlasHaus
                  </button>
                  <a href={status.latest.url} target="_blank" rel="noreferrer">
                    Release notes
                  </a>
                </>
              )}
            </div>
          )}
        </>
      )}
      <p className="helper">
        You can also rerun the one-line installer. Your old app folder and local
        recovery copy are kept.
      </p>
    </section>
  );
}
