import { useState } from 'react';
import type { RenderLog } from '../pages/api/render/logs';

export default function RenderLogs() {
  const [logs, setLogs] = useState<RenderLog[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/render/logs');
      if (response.status === 401) {
        location.assign('/login');
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load logs.');
      setLogs(data.logs);
      setLoaded(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="connection-settings">
      <h3>Render log drain</h3>
      <p className="settings-description">
        Receive pushed Render logs over TLS syslog. Only administrators can view
        these logs. The latest 500 messages are kept across restarts.
      </p>
      <details className="settings-advanced">
        <summary>Set up log streaming</summary>
        <p>
          Configure the server with RENDER_LOG_PORT, RENDER_LOG_TLS_CERT,
          RENDER_LOG_TLS_KEY, and RENDER_LOG_ALLOWED_IPS, then restart. See the
          README for certificate, network, and Docker setup.
        </p>
        <p>
          In Render, open Integrations → Observability → Log Streams. Set the
          destination to your public log hostname and port (for example
          logs.example.com:6514). Leave Token blank. The receiver restricts
          connections to the configured sender IPs. Static sites do not emit
          logs.
        </p>
      </details>
      <button className="button" disabled={busy} onClick={() => void refresh()}>
        {busy ? 'Loading…' : loaded ? 'Refresh logs' : 'Load received logs'}
      </button>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {loaded && !logs.length && (
        <p className="field-help">
          No logs received yet. Check the listener, TLS certificate, sender
          allowlist, and Render destination.
        </p>
      )}
      {logs.length > 0 && (
        <div
          className="render-log-list"
          role="region"
          aria-label="Received Render logs"
          tabIndex={0}
        >
          {[...logs].reverse().map((log, index) => (
            <pre
              key={index}
            >{`${log.timestamp} ${log.service} ${log.app} [${log.instance}] severity=${log.severity}\n${log.message}`}</pre>
          ))}
        </div>
      )}
    </section>
  );
}
