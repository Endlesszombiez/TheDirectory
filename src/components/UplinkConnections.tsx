import { useEffect, useState } from 'react';
import type { IntegrationStatus } from '../lib/integrations';

export default function UplinkConnections() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [created, setCreated] = useState<{ id: string; token: string } | null>(
    null,
  );
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [endpoint, setEndpoint] = useState('');
  async function request(body?: object) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        '/api/uplinks',
        body
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          : undefined,
      );
      if (response.status === 401) {
        location.assign('/login');
        return;
      }
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || 'Unable to update uplinks.');
      setStatus(data);
      if (data.created) {
        setCreated(data.created);
        setName('');
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setEndpoint(`${location.origin}/api/uplinks/receive`);
    void request();
  }, []);
  return (
    <section className="connection-settings uplink-connections">
      <h3>Data uplinks</h3>
      <p className="settings-description">
        Let a Render app—or any server—send small JSON summaries. Enable the
        Uplinks widget in <a href="/settings">Appearance</a> to show them to
        signed-in dashboard users.
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}{' '}
          <button
            className="button"
            disabled={busy}
            onClick={() => void request()}
          >
            Retry
          </button>
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void request({ action: 'create', name, staleAfter: minutes * 60 });
        }}
      >
        <div className="form-row">
          <label>
            App name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="Background worker"
            />
          </label>
          <label>
            Stale after (minutes)
            <input
              type="number"
              required
              min={1}
              max={1440}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
        </div>
        <button
          className="button primary"
          disabled={busy || !status || !!created || status.uplinks.length >= 20}
        >
          Create uplink
        </button>
      </form>
      {created && (
        <div className="uplink-secret" role="status">
          <strong>Save this token now. It is shown only once.</strong>
          <p className="field-help">
            Store it as DIRECTORY_UPLINK_TOKEN in your app’s Render environment.
            Store the endpoint as DIRECTORY_UPLINK_URL. These credentials can
            only send updates to this uplink.
          </p>
          <label>
            Uplink token
            <input
              readOnly
              value={created.token}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <label>
            Endpoint
            <input
              readOnly
              value={endpoint}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button className="button" onClick={() => setCreated(null)}>
            I saved the token
          </button>
        </div>
      )}
      <details className="settings-advanced">
        <summary>Send data from your app</summary>
        <p>
          Set the two environment variables above, then send a server-side
          request:
        </p>
        <pre>
          <code>{`await fetch(process.env.DIRECTORY_UPLINK_URL, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + process.env.DIRECTORY_UPLINK_TOKEN,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ jobsProcessed: 1240, queueDepth: 8 })
});`}</code>
        </pre>
        <p className="field-help">
          The endpoint must be reachable from your app over HTTPS. Send 1–12
          flat values (text, numbers, booleans, or null), at most once every
          five seconds. Nested objects are rejected. Updates replace the
          previous summary. Avoid secrets and personal data: values are shared
          with dashboard users.
        </p>
      </details>
      <div className="render-service-list">
        {status?.uplinks.map((uplink) => (
          <div className="settings-row" key={uplink.id}>
            <div>
              <strong>{uplink.name}</strong>
              <p className="field-help">
                {uplink.receivedAt
                  ? `Last received ${new Date(uplink.receivedAt).toLocaleString()}`
                  : 'Waiting for first update'}{' '}
                · stale after {uplink.staleAfter / 60} min
              </p>
            </div>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    `Revoke ${uplink.name}? Its token and saved data will be removed.`,
                  )
                ) {
                  if (created?.id === uplink.id) setCreated(null);
                  void request({ action: 'revoke', id: uplink.id });
                }
              }}
            >
              Revoke
            </button>
          </div>
        ))}
      </div>
      <button className="button" disabled={busy} onClick={() => void request()}>
        Refresh uplinks
      </button>
    </section>
  );
}
