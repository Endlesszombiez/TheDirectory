import { useState, type ReactNode } from 'react';
import type { Service } from '../lib/schema';
import { serviceIconSources } from '../lib/service-links';

export default function ServiceIcon({
  service,
  local,
  fallback,
}: {
  service: Service;
  local: boolean;
  fallback: ReactNode;
}) {
  const sources = serviceIconSources(service, local);
  const [failed, setFailed] = useState<string[]>([]);
  const source = sources.find((url) => !failed.includes(url));
  return (
    <span className={`service-icon ${service.color}`}>
      {source ? (
        <img
          key={source}
          src={source}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed((urls) => [...urls, source])}
        />
      ) : (
        fallback
      )}
    </span>
  );
}
