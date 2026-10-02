import { useEffect, useRef, useState } from 'react';
import { Download, Upload, Unplug, Check } from 'lucide-react';
import type { AIConnectionStatus } from '../lib/ai-connections';
import '../styles/setup.css';
export default function AIConnections() {
  const [status, setStatus] = useState<AIConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
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
      setMessage(
        body.action === 'disconnect'
          ? data.revocationConfirmed
            ? 'Disconnected and the renewable session was revoked.'
            : 'Disconnected locally. Remote revocation could not be confirmed; disconnect this app in ChatGPT Settings → Security and login.'
          : body.action === 'select'
            ? 'Active ChatGPT account updated.'
            : 'ChatGPT connection imported. Your dashboard can now use the permissions you granted.',
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 128_000)
        throw new Error('The connection file is too large.');
      const credentials = JSON.parse(await file.text());
      await act({ action: 'import', credentials });
    } catch {
      setError(
        'Invalid connection file. Select the JSON file saved by the ChatGPT sign-in helper.',
      );
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  return (
    <div className="ai-connections">
      <p className="account-intro">
        Connect your own eligible ChatGPT plan for dashboard setup. Requests use
        your existing plan limits. Each dashboard user manages their own
        connections.
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
              <p>
                {account.connected
                  ? account.planEnabled
                    ? 'ChatGPT plan usage enabled'
                    : 'Signed in; plan usage permission was not granted'
                  : 'Disconnected — sign in again to reconnect'}
              </p>
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
                    Use this account
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
                  <Unplug size={14} /> Disconnect
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <section className="setup-help">
        <h2>Connect ChatGPT</h2>
        <p>
          For a self-hosted dashboard, complete sign-in on the computer running
          your browser, then import the protected connection file here. You need
          Node.js 22 or later on that computer.
        </p>
        <ol>
          <li>
            <a
              className="button"
              href="/api/ai/helper"
              download="directory-chatgpt.mjs"
            >
              <Download size={14} /> Download sign-in helper
            </a>
          </li>
          <li>
            In the download folder, run <code>node directory-chatgpt.mjs</code>.
            Open the local address it prints and choose{' '}
            <strong>Continue with ChatGPT</strong>.
          </li>
          <li>
            Review and grant <strong>Use your ChatGPT plan</strong>, then select
            the connection file whose path appears in the terminal.
          </li>
        </ol>
        <p>
          To add a different account or workspace, run{' '}
          <code>node directory-chatgpt.mjs --profile another-account</code>. To
          reconnect the same registration, rerun its existing profile.
        </p>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={14} />{' '}
          {busy ? 'Updating connection…' : 'Import ChatGPT connection'}
        </button>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(event) => void importFile(event.target.files?.[0])}
        />
        <p className="account-help">
          The file contains private credentials. Transfer it only to your own
          dashboard over HTTPS or localhost. Credentials stay in protected
          server storage and are excluded from dashboard exports. After
          importing, the dashboard manages token refreshes.
        </p>
      </section>
      <p className="account-help">
        <a
          href="https://chatgpt.com/settings/usage"
          target="_blank"
          rel="noreferrer"
        >
          Manage ChatGPT usage and app limits ↗
        </a>{' '}
        ·{' '}
        <a
          href="https://developers.openai.com/siwc/token-sharing-open-source"
          target="_blank"
          rel="noreferrer"
        >
          OpenAI connection documentation ↗
        </a>
      </p>
    </div>
  );
}
