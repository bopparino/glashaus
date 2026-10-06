import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { Notice } from "./Forms";

type Device = { id: string; name: string; lastSeenAt: string };
export function MobileSettings() {
  const [state, setState] = useState<{
    port: number | null;
    devices: Device[];
  }>();
  const [code, setCode] = useState<{ code: string; expiresAt: string }>();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const refresh = useCallback(async () => setState(await api("/mobile")), []);
  useEffect(() => {
    void refresh().catch(() =>
      setError("Could not check phone connections. Try refreshing."),
    );
  }, [refresh]);
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => {
      if (Date.parse(code.expiresAt) > Date.now())
        void refresh().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [code, refresh]);
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [code]);
  const remaining = code
    ? Math.max(0, Math.ceil((Date.parse(code.expiresAt) - now) / 1000))
    : 0;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not update the phone connection.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="settings-section"
      aria-labelledby="phone-settings-title"
    >
      <h2 id="phone-settings-title">Your phone</h2>
      <p className="section-description">
        Open GlasHaus on your iPhone, enter your computer’s private HTTPS
        address, then enter a pairing code. Your conversation and memories stay
        together.
      </p>
      {error && <Notice error>{error}</Notice>}
      {!state && !error && (
        <p className="helper" role="status">
          Checking phone connections…
        </p>
      )}
      {error && (
        <button
          type="button"
          className="button text"
          disabled={busy}
          onClick={() => void run(refresh)}
        >
          Refresh connections
        </button>
      )}
      {state && !state.port && (
        <p className="helper">
          The phone connection starts with the installed host. It is unavailable
          in this preview.
        </p>
      )}
      <button
        type="button"
        className="button secondary"
        disabled={busy || !state?.port}
        onClick={() =>
          void run(async () => {
            setCode(await api("/mobile/code", {}));
            setNow(Date.now());
            setCopied(false);
          })
        }
      >
        {busy
          ? "Working…"
          : code && remaining
            ? "Create a new code"
            : "Create pairing code"}
      </button>
      {code && (
        <div className="pairing-code">
          {remaining ? (
            <>
              <output aria-label="Pairing code">{code.code}</output>
              <p className="helper">
                Expires in {Math.floor(remaining / 60)}:
                {String(remaining % 60).padStart(2, "0")}. Each code works once.
              </p>
              <button
                type="button"
                className="button text"
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(code.code);
                    setCopied(true);
                  })
                }
              >
                {copied ? "Copied" : "Copy code"}
              </button>
            </>
          ) : (
            <p role="status">This code expired. Create a new one to connect.</p>
          )}
        </div>
      )}
      {!!state?.devices.length && (
        <ul className="paired-devices">
          {state.devices.map((device) => (
            <li key={device.id}>
              <div>
                <strong>{device.name}</strong>
                <p className="helper">
                  Last connected {new Date(device.lastSeenAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                className="button text"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(`/mobile/devices/${device.id}`, {}, "DELETE");
                    await refresh();
                  })
                }
              >
                Disconnect<span className="sr-only"> {device.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {state?.port && (
        <details>
          <summary>Connect from outside this computer</summary>
          <p>
            Use Tailscale on your computer and phone. After checking your
            existing Serve configuration, forward private HTTPS to the phone
            listener:
          </p>
          <code className="phone-command">
            tailscale serve --bg http://127.0.0.1:{state.port}
          </code>
          <p className="helper">
            Use the HTTPS address it displays in the phone app. Keep this
            computer awake and Ollama running. The phone listener is separate
            from your computer’s administration page.
          </p>
        </details>
      )}
    </section>
  );
}
