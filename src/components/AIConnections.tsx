import { useEffect, useState } from 'react';
import { KeyRound, Unplug, Check } from 'lucide-react';
import type { AIConnectionStatus } from '../lib/ai-connections';
import '../styles/setup.css';
export default function AIConnections() {
  const [status, setStatus] = useState<AIConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('My OpenAI key');
  async function load() {
    try {
      const response = await fetch('/api/ai/connections');
      if (response.status === 401) {
        location.assign('/login');
        return;
      }
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || 'Unable to load AI connections.');
      setStatus(data);
      setError('');
    } catch (error) {
      setError((error as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/ai/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || 'Unable to update the connection.');
      setStatus(data);
      if (body.action === 'import') setApiKey('');
      setMessage(
        body.action === 'disconnect'
          ? 'API key removed locally. Revoke it in OpenAI project settings if needed.'
          : body.action === 'select'
            ? 'Active API key updated.'
            : 'API key verified and saved.',
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ai-connections">
      <h3>OpenAI</h3>
      <p className="account-intro">
        Your personal API keys for AI setup. Usage is billed to your OpenAI
        project.
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}{' '}
          <button
            className="button"
            disabled={busy}
            onClick={() => void load()}
          >
            Retry
          </button>
        </p>
      )}
      {message && (
        <p className="account-success" role="status">
          {message}
        </p>
      )}
      {!status && !error && <p role="status">Loading connections…</p>}
      <div className="connection-list">
        {status?.accounts.map((account) => (
          <article className="connection-entry" key={account.id}>
            <div>
              <strong>{account.label}</strong>
              <p>OpenAI</p>
            </div>
            <div className="connection-actions">
              {account.active ? (
                <span className="role-badge">
                  <Check size={12} /> Active
                </span>
              ) : (
                account.connected && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void act({ action: 'select', id: account.id })
                    }
                  >
                    Use this key
                  </button>
                )
              )}
              {account.connected && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void act({ action: 'disconnect', id: account.id })
                  }
                >
                  <Unplug size={14} /> Remove key
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <section className="setup-help">
        <h2>Add API key</h2>
        <p>
          Create a key in your{' '}
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noreferrer"
          >
            OpenAI API project ↗
          </a>{' '}
          with permission to list models and create responses. API billing is
          separate from ChatGPT subscriptions.
        </p>
        <form
          className="setup-form"
          onSubmit={(event) => {
            event.preventDefault();
            void act({ action: 'import', apiKey, label });
          }}
        >
          <label>
            Key label
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              required
              maxLength={80}
              disabled={busy}
            />
          </label>
          <label>
            OpenAI API key
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-…"
              autoComplete="off"
              spellCheck={false}
              required
              maxLength={512}
              disabled={busy}
            />
          </label>
          <button
            className="button primary"
            disabled={busy || !apiKey.trim() || !label.trim()}
          >
            <KeyRound size={14} />{' '}
            {busy ? 'Verifying key…' : 'Verify and save key'}
          </button>
        </form>
        <p className="account-help">
          Encrypted on the server and excluded from exports. Use HTTPS or
          localhost.
        </p>
      </section>
      <p className="account-help">
        <a
          href="https://platform.openai.com/usage"
          target="_blank"
          rel="noreferrer"
        >
          Manage API usage ↗
        </a>{' '}
        ·{' '}
        <a
          href="https://developers.openai.com/api/reference/overview"
          target="_blank"
          rel="noreferrer"
        >
          API documentation ↗
        </a>
      </p>
    </div>
  );
}
