import type { IntegrationStatus } from '../lib/integrations';
import { useEffect, useState } from 'react';
import type { RenderDeploymentStatus } from '../lib/render';

export function RenderDeployment({
  id,
  dashboardUrl,
  status,
  connected,
}: {
  id: string;
  dashboardUrl?: string;
  status?: RenderDeploymentStatus;
  connected: boolean;
}) {
  const deployment = status?.deployment;
  return (
    <div className="render-deployment">
      <a
        href={dashboardUrl || `https://dashboard.render.com/web/${id}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Render ↗
      </a>
      <span>
        {!connected
          ? 'Connection unavailable'
          : deployment
            ? deployment.status.replaceAll('_', ' ')
            : status?.error
              ? 'Deployment unavailable'
              : status?.checkedAt
                ? 'No deployments yet'
                : 'Loading deployment…'}
      </span>
      {deployment && (
        <small title={deployment.commit?.message || undefined}>
          {deployment.commit ? `${deployment.commit.id.slice(0, 7)} · ` : ''}
          {new Date(deployment.createdAt).toLocaleString()}
        </small>
      )}
      {status?.checkedAt && (
        <small>Checked {new Date(status.checkedAt).toLocaleTimeString()}</small>
      )}
      {status?.error && (
        <small className="integration-error">
          {status.error} {deployment ? 'Showing last known deployment.' : ''}
        </small>
      )}
    </div>
  );
}
export function UplinksWidget({
  uplinks,
  error,
  loading,
}: {
  uplinks: IntegrationStatus['uplinks'];
  error?: string;
  loading: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="widget uplinks-widget">
      <div className="widget-heading">
        <h3>Data uplinks</h3>
      </div>
      {error && (
        <p className="integration-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="widget-caption">Loading uplinks…</p>}
      {!loading && !error && !uplinks.length && (
        <p className="widget-caption">
          No uplinks connected. An administrator can add one in Connections.
        </p>
      )}
      {uplinks.map((uplink) => {
        const stale =
          !uplink.receivedAt ||
          now - Date.parse(uplink.receivedAt) > uplink.staleAfter * 1000;
        return (
          <div className="uplink-summary" key={uplink.id}>
            <div className="settings-row">
              <strong>{uplink.name}</strong>
              <span
                className={`role-badge ${stale ? 'integration-error' : ''}`}
              >
                {!uplink.receivedAt ? 'Waiting' : stale ? 'Stale' : 'Current'}
              </span>
            </div>
            <dl>
              {Object.entries(uplink.values || {}).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value === null ? '—' : String(value)}</dd>
                </div>
              ))}
            </dl>
            <p className="widget-caption">
              {uplink.receivedAt
                ? `Received ${new Date(uplink.receivedAt).toLocaleString()}`
                : 'No data received yet'}
            </p>
          </div>
        );
      })}
    </section>
  );
}
