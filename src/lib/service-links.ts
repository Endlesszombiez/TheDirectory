import type { Service } from './schema';

export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.home') ||
    host.endsWith('.lan') ||
    (!host.includes('.') && !host.includes(':'))
  )
    return true;
  if (/^(fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:/i.test(host)) return true;
  const parts = host.split('.').map(Number);
  return (
    parts.length === 4 &&
    parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255) &&
    (parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 169 && parts[1] === 254))
  );
}

export function serviceDestinations(service: Service) {
  if (service.localUrl !== undefined || service.webUrl !== undefined)
    return { local: service.localUrl || '', web: service.webUrl || '' };
  return isLocalHostname(new URL(service.url).hostname)
    ? { local: service.url, web: '' }
    : { local: '', web: service.url };
}

export function serviceDestination(service: Service, local = true) {
  const urls = serviceDestinations(service);
  return (
    (local ? urls.local || urls.web : urls.web || urls.local) || service.url
  );
}

const popularIcons: Record<string, string[]> = {
  portainer: ['portainer'],
  proxmox: ['proxmox'],
  'home-assistant': ['homeassistant', 'home-assistant'],
  jellyfin: ['jellyfin'],
  plex: ['plex'],
  sonarr: ['sonarr'],
  radarr: ['radarr'],
  prowlarr: ['prowlarr'],
  bazarr: ['bazarr'],
  tautulli: ['tautulli'],
  nextcloud: ['nextcloud'],
  'adguard-home': ['adguard'],
  gitea: ['gitea'],
  nginx: ['nginx'],
  grafana: ['grafana'],
  'uptime-kuma': ['uptime-kuma', 'uptimekuma'],
  qbittorrent: ['qbittorrent'],
  requestrr: ['requestrr'],
};

export function serviceIconSources(service: Service, local = false): string[] {
  if (service.iconMode === 'manual') return [];
  if (service.iconUrl) return [service.iconUrl];
  const urls = serviceDestinations(service);
  const destination =
    (local ? urls.local || urls.web : urls.web || urls.local) || service.url;
  const url = new URL(destination);
  const identity =
    service.name.toLowerCase().replace(/\s+/g, '-') + ' ' + url.hostname;
  const match = Object.entries(popularIcons).find(([, names]) =>
    names.some((name) =>
      new RegExp('(^|[^a-z0-9])' + name + '($|[^a-z0-9])').test(identity),
    ),
  );
  return [
    ...(match ? ['/service-icons/' + match[0] + '.svg'] : []),
    new URL('/favicon.ico', url.origin).href,
  ];
}
