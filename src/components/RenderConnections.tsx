import { useEffect, useState } from 'react';
import type { Config } from '../lib/schema';
import type { RenderService } from '../lib/render';

export default function RenderConnections({
  initialConfig,
}: {
  initialConfig: Config;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [connected, setConnected] = useState(false);
  const [services, setServices] = useState<RenderService[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [boardId, setBoardId] = useState(initialConfig.boards[0].id);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function request(body?: object) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(
        '/api/render',
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
      if (typeof data.connected === 'boolean') setConnected(data.connected);
      if (!response.ok)
        throw new Error(data.error || 'Unable to contact Render.');
      if (data.config) {
        setConfig(data.config);
        setSelected([]);
        document.dispatchEvent(
          new CustomEvent('directory:config-saved', { detail: data.config }),
        );
        setMessage(
          `${data.imported} service${data.imported === 1 ? '' : 's'} imported. Existing cards were kept.`,
        );
      } else {
        setConnected(data.connected);
        setServices(data.services);
        setSelected([]);
        if (body) {
          setKey('');
          setMessage(
            data.connected
              ? 'Render API key verified and saved.'
              : 'Disconnected. Revoke the key in Render if needed. Imported cards were kept.',
          );
        }
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void request();
  }, []);
  const board = config.boards.find((b) => b.id === boardId) || config.boards[0];
  return (
    <section className="connection-settings render-connections">
      <h3>Render</h3>
      <p className="settings-description">
        Import cloud services and show their latest deployment on your
        dashboard. Cards are shared with everyone who can sign in. API keys stay
        on the server.
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}{' '}
          <button
            className="button"
            disabled={busy}
            onClick={() => void request()}
          >
            Retry discovery
          </button>
        </p>
      )}
      {message && (
        <p className="account-success" role="status">
          {message}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void request({ action: 'connect', apiKey: key });
        }}
      >
        <label>
          Render API key
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
            maxLength={512}
            placeholder={connected ? 'Replace connected key' : 'rnd_…'}
          />
        </label>
        <div className="form-row">
          <button className="button primary" disabled={busy || !key.trim()}>
            {busy ? 'Working…' : connected ? 'Replace key' : 'Connect Render'}
          </button>
          {connected && (
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    'Disconnect Render? Imported cards will remain, without deployment updates.',
                  )
                )
                  void request({ action: 'disconnect' });
              }}
            >
              Disconnect
            </button>
          )}
        </div>
      </form>
      <p className="field-help">
        Create a key in{' '}
        <a
          href="https://dashboard.render.com/u/settings#api-keys"
          target="_blank"
          rel="noreferrer"
        >
          Render account settings
        </a>
        . This connection only reads Render data. HTTP checks are off on
        imported cards to avoid waking idle apps.
      </p>
      {connected && (
        <>
          <div className="settings-row">
            <strong>{services.length} services discovered</strong>
            <button
              className="button"
              disabled={busy}
              onClick={() => void request()}
            >
              Refresh discovery
            </button>
          </div>
          <label>
            Destination board
            <select
              value={board.id}
              disabled={busy}
              onChange={(e) => {
                setBoardId(e.target.value);
                setSelected([]);
              }}
            >
              {config.boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <div className="render-service-list">
            {services.map((candidate) => {
              const imported = board.services.some(
                (s) =>
                  s.renderServiceId === candidate.id ||
                  s.id === candidate.service.id,
              );
              return (
                <label className="checkbox-label" key={candidate.id}>
                  <input
                    type="checkbox"
                    disabled={busy || imported}
                    checked={imported || selected.includes(candidate.id)}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, candidate.id]
                          : ids.filter((id) => id !== candidate.id),
                      )
                    }
                  />
                  <span>
                    <strong>{candidate.name}</strong>
                    <small>
                      {candidate.type.replaceAll('_', ' ')}
                      {candidate.suspended === 'suspended'
                        ? ' · suspended'
                        : ''}
                      {imported ? ' · already imported' : ''}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          {!services.length && (
            <p className="field-help">No services found for this key.</p>
          )}
          <button
            className="button primary"
            disabled={busy || !selected.length || selected.length > 100}
            onClick={() =>
              void request({
                action: 'import',
                boardId: board.id,
                revision: config.revision,
                serviceIds: selected,
              })
            }
          >
            Import selected ({selected.length})
          </button>
          <p className="field-help">
            Workers and private services link to Render when they have no public
            URL. Deployment details refresh about once a minute. If another tab
            changes the dashboard, reload this page before importing.
          </p>
        </>
      )}
    </section>
  );
}
