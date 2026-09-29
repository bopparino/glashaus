import { useEffect, useState } from "react";
import { api } from "./api";
import { Field, Notice, messageOf } from "./Forms";

interface Status {
  enabled: boolean;
  addresses: string[];
  simulatorAddress?: string;
  devices: { id: string; name: string; lastSeenAt: string }[];
}
export function PhoneConnection() {
  const [status, setStatus] = useState<Status>();
  const [address, setAddress] = useState("");
  const [link, setLink] = useState("");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function refresh() {
    const next = await api<Status>("/mobile");
    setStatus(next);
    setAddress((old) =>
      [...next.addresses, next.simulatorAddress].includes(old)
        ? old
        : (next.addresses[0] ?? next.simulatorAddress ?? ""),
    );
  }
  useEffect(() => {
    void refresh().catch((e) => setError(messageOf(e)));
    const timer = setInterval(() => void refresh().catch(() => {}), 10_000);
    return () => clearInterval(timer);
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section">
      <h2>Your iPhone</h2>
      <p className="section-description">
        Connect the native app while both devices are on the same Wi-Fi. The Mac
        must be awake and Glashaus running. Phone access uses an encrypted,
        paired connection.
      </p>
      {error && <Notice error>{error}</Notice>}
      {status?.enabled ? (
        <>
          <Field label="Connect to this Mac">
            <select
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setLink("");
              }}
              disabled={busy}
            >
              {status.addresses.map((value) => (
                <option key={value} value={value}>
                  {value} · Wi-Fi / local network
                </option>
              ))}
              <option value={status.simulatorAddress}>
                {status.simulatorAddress} · Simulator only
              </option>
            </select>
          </Field>
          {!status.addresses.length && (
            <p className="helper">
              No private network address found. Join Wi-Fi before pairing a
              physical iPhone.
            </p>
          )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await api<{ link: string; expiresAt: string }>(
                  "/mobile/pair",
                  { address },
                );
                setLink(result.link);
                setExpires(result.expiresAt);
                setCopied(false);
              })
            }
          >
            {busy ? "Working…" : "Create pairing link"}
          </button>
          {link && (
            <div>
              <p className="helper">
                Paste this link into the iPhone app. It works once and expires
                at {new Date(expires).toLocaleTimeString()}. Anyone with this
                link can pair until then.
              </p>
              <Field label="Private pairing link">
                <textarea readOnly value={link} rows={3} autoComplete="off" />
              </Field>
              <button
                className="button secondary"
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                  })
                }
              >
                {copied ? "Copied" : "Copy pairing link"}
              </button>
            </div>
          )}
          {status.devices.length > 0 && (
            <ul>
              {status.devices.map((device) => (
                <li key={device.id}>
                  <strong>{device.name}</strong> · Last connected{" "}
                  {new Date(device.lastSeenAt).toLocaleString()}{" "}
                  <button
                    className="button quiet"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/mobile/devices/${device.id}`, {}, "DELETE");
                      })
                    }
                  >
                    Revoke {device.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="helper">
          Phone connections are off. In this development checkout, start with{" "}
          <code>pnpm assistant</code>.
        </p>
      )}
    </section>
  );
}
