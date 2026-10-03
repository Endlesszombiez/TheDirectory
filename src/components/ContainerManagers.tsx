import { useState } from 'react';
import { ArrowUpRight, Container, Info, RefreshCw } from 'lucide-react';
import type { ContainerManager } from '../lib/container-managers';

export function ContainerManagerNav({
  managers,
  selected,
  onSelect,
}: {
  managers: ContainerManager[];
  selected: ContainerManager | null;
  onSelect: (manager: ContainerManager) => void;
}) {
  return (
    <nav aria-label="Container managers">
      <div className="nav-label">CONTAINER MANAGERS</div>
      {managers.map((manager) => (
        <div className="manager-nav-row" key={manager.id}>
          <button
            className={`nav-item ${selected?.id === manager.id ? 'active' : ''}`}
            disabled={!manager.url}
            onClick={() => onSelect(manager)}
            aria-current={selected?.id === manager.id ? 'page' : undefined}
          >
            <Container size={18} />
            <span>{manager.name}</span>
          </button>
          {!manager.url && (
            <details className="manager-info">
              <summary
                aria-label={`How to enable ${manager.name}`}
                title={`How to enable ${manager.name}`}
              >
                <Info size={16} />
              </summary>
              <div className="manager-help">
                <strong>
                  {manager.error
                    ? 'Check configuration'
                    : `Enable ${manager.name}`}
                </strong>
                {manager.error && <p>{manager.error}</p>}
                <p>
                  Set <code>{manager.envKey}</code> in your server environment
                  or <code>.env</code> file, then restart TheDirectory.
                </p>
                <code>
                  {manager.envKey}=http://localhost:
                  {manager.id === 'portainer' ? '3333' : '3000'}
                </code>
                <p>
                  Use an address reachable from your browser. The service must
                  allow iframe embedding.
                </p>
              </div>
            </details>
          )}
        </div>
      ))}
    </nav>
  );
}

export function ContainerManagerView({
  manager,
}: {
  manager: ContainerManager;
}) {
  const [reload, setReload] = useState(0);
  const mixedContent =
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    manager.url?.startsWith('http:');
  return (
    <section className="manager-view" aria-label={manager.name}>
      <div className="manager-toolbar">
        <div>
          <div className="eyebrow">CONTAINER MANAGER</div>
          <h1>{manager.name}</h1>
        </div>
        <div className="manager-actions">
          <button
            className="button"
            onClick={() => setReload((value) => value + 1)}
            disabled={!!mixedContent}
          >
            <RefreshCw size={16} /> Reload
          </button>
          <a
            className="button"
            href={manager.url!}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in new tab <ArrowUpRight size={16} />
          </a>
        </div>
      </div>
      <details className="manager-troubleshooting">
        <summary>Page blank or sign-in not working?</summary>
        <p>
          {manager.name} keeps its own login. Its iframe policy must allow
          TheDirectory's origin. Browser cookie restrictions or an untrusted
          HTTPS certificate can also prevent loading or sign-in. Check the
          service or reverse proxy configuration, or use Open in new tab.
        </p>
        <p>
          Localhost refers to the device running your browser. When accessing
          TheDirectory remotely, use the server's LAN address or hostname.
        </p>
      </details>
      {mixedContent ? (
        <p className="alert" role="alert">
          Set {manager.envKey} to an HTTPS URL to embed it in this HTTPS
          dashboard, then restart TheDirectory.
        </p>
      ) : (
        <iframe
          key={reload}
          className="manager-frame"
          src={manager.url!}
          title={`${manager.name} container management`}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        />
      )}
    </section>
  );
}
