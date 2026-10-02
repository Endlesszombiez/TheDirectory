import { createHash } from 'node:crypto';
import { z } from 'zod';
import { dockerRead, listContainers, type DockerContainer } from './docker';
import { serviceSchema, type Service } from './schema';

export type DiscoveredService = {
  id: string;
  name: string;
  image: string;
  state: string;
  source: 'label' | 'traefik' | 'port' | 'manual';
  reason: string;
  service: Service;
};
const known: Record<
  string,
  { name: string; port: number; icon: Service['icon']; group: string }
> = {
  jellyfin: { name: 'Jellyfin', port: 8096, icon: 'film', group: 'Media' },
  plex: { name: 'Plex', port: 32400, icon: 'film', group: 'Media' },
  sonarr: { name: 'Sonarr', port: 8989, icon: 'download', group: 'Media' },
  radarr: { name: 'Radarr', port: 7878, icon: 'download', group: 'Media' },
  prowlarr: { name: 'Prowlarr', port: 9696, icon: 'download', group: 'Media' },
  qbittorrent: {
    name: 'qBittorrent',
    port: 8080,
    icon: 'download',
    group: 'Media',
  },
  grafana: {
    name: 'Grafana',
    port: 3000,
    icon: 'activity',
    group: 'Monitoring',
  },
  prometheus: {
    name: 'Prometheus',
    port: 9090,
    icon: 'activity',
    group: 'Monitoring',
  },
  'home-assistant': {
    name: 'Home Assistant',
    port: 8123,
    icon: 'home',
    group: 'Home',
  },
  homeassistant: {
    name: 'Home Assistant',
    port: 8123,
    icon: 'home',
    group: 'Home',
  },
  portainer: {
    name: 'Portainer',
    port: 9000,
    icon: 'server',
    group: 'Infrastructure',
  },
  'uptime-kuma': {
    name: 'Uptime Kuma',
    port: 3001,
    icon: 'activity',
    group: 'Monitoring',
  },
  nextcloud: { name: 'Nextcloud', port: 80, icon: 'cloud', group: 'Files' },
  nginx: { name: 'Nginx', port: 80, icon: 'globe', group: 'Infrastructure' },
};
export function safeWebUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      value.length > 2048
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
function proxyUrl(labels: Record<string, string>): string | null {
  const matches: string[] = [];
  for (const [key, rule] of Object.entries(labels)) {
    if (!/^traefik\.http\.routers\.[^.]+\.rule$/.test(key)) continue;
    // Compound host/path routing needs a URL supplied by the administrator.
    const host = /^Host\(\s*[`"']([^`"']+)[`"']\s*\)$/.exec(rule.trim());
    if (!host || !/^[a-z0-9.-]+$/i.test(host[1])) continue;
    const prefix = key.slice(0, -5);
    const secure =
      labels[`${prefix}.tls`] === 'true' ||
      Object.keys(labels).some((k) => k.startsWith(`${prefix}.tls.`));
    const url = safeWebUrl(`${secure ? 'https' : 'http'}://${host[1]}`);
    if (url) matches.push(url);
  }
  return new Set(matches).size === 1 ? matches[0] : null;
}
export function discoverContainer(
  c: DockerContainer,
  hostOrigin: string,
): DiscoveredService | null {
  const labels = c.Labels;
  if (labels['directory.enable'] === 'false') return null;
  const imageName =
    c.Image.split('@')[0].split('/').at(-1)?.split(':')[0] || '';
  const app = known[imageName];
  const name = (
    labels['directory.name'] ||
    app?.name ||
    c.Names[0]?.replace(/^\//, '') ||
    c.Id.slice(0, 12)
  ).slice(0, 80);
  let url = '',
    source: DiscoveredService['source'] = 'manual';
  let reason =
    'No browser URL could be inferred. Enter the URL you use to open this service.';
  if (labels['directory.url']) {
    url = safeWebUrl(labels['directory.url']) || '';
    source = url ? 'label' : 'manual';
    reason = url
      ? 'URL supplied by a directory.url label.'
      : 'The directory.url label is invalid. Enter an HTTP(S) URL without credentials.';
  } else {
    url = proxyUrl(labels) || '';
    if (url) {
      source = 'traefik';
      reason =
        'URL inferred from a Traefik host rule. Verify it before importing.';
    } else {
      const candidates = c.Ports.filter(
        (p) =>
          p.PublicPort &&
          p.Type !== 'udp' &&
          (app
            ? p.PrivatePort === app.port ||
              (imageName === 'portainer' && p.PrivatePort === 9443)
            : [80, 443, 8080, 8443, 8000, 3000].includes(p.PrivatePort || 0)),
      );
      const port = candidates.sort(
        (a, b) =>
          Number(b.PrivatePort === 443 || b.PrivatePort === 9443) -
          Number(a.PrivatePort === 443 || a.PrivatePort === 9443),
      )[0];
      if (port) {
        const host = new URL(hostOrigin);
        const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(
          host.hostname,
        );
        if (['127.0.0.1', '::1'].includes(port.IP || '') && !loopback)
          reason =
            'The published port is bound to loopback. Supply a reverse-proxy URL reachable from your browser.';
        else {
          host.protocol = [443, 8443, 9443].includes(port.PrivatePort || 0)
            ? 'https:'
            : 'http:';
          host.port = String(port.PublicPort);
          host.pathname = '/';
          url = host.href;
          source = 'port';
          reason =
            'URL inferred from a published web port and your Docker host address. Verify the protocol and address.';
        }
      }
    }
  }
  const id = `docker-${createHash('sha256').update(c.Id).digest('hex').slice(0, 24)}`;
  const choice = <T extends z.ZodType>(
    schema: T,
    value: unknown,
    fallback: z.infer<T>,
  ): z.infer<T> => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };
  return {
    id,
    name,
    image: c.Image,
    state: c.State,
    source,
    reason,
    service: {
      id,
      name,
      description: (
        labels['directory.description'] || `${app?.name || name} on Docker`
      ).slice(0, 160),
      url,
      icon: choice(
        serviceSchema.shape.icon,
        labels['directory.icon'],
        app?.icon || 'server',
      ),
      color: choice(
        serviceSchema.shape.color,
        labels['directory.color'],
        'mint',
      ),
      group: (
        labels['directory.group'] ||
        app?.group ||
        'Infrastructure'
      ).slice(0, 50),
      check: false,
    },
  };
}
const swarmSchema = z
  .array(
    z.object({
      ID: z.string(),
      Spec: z.object({
        Name: z.string(),
        Labels: z.record(z.string(), z.string()).optional(),
        TaskTemplate: z.object({
          ContainerSpec: z.object({
            Image: z.string(),
            Labels: z.record(z.string(), z.string()).optional(),
          }),
        }),
      }),
      Endpoint: z
        .object({
          Ports: z
            .array(
              z.object({
                TargetPort: z.number(),
                PublishedPort: z.number().optional(),
                Protocol: z.string().optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    }),
  )
  .max(1000);
export async function discoverServices(
  mode: 'containers' | 'swarm',
  hostOrigin: string,
) {
  const host = new URL(hostOrigin);
  if (
    !safeWebUrl(hostOrigin) ||
    host.pathname !== '/' ||
    host.search ||
    host.hash
  )
    throw new Error(
      'Enter the Docker host HTTP(S) origin, for example http://nas.home.',
    );
  let containers: DockerContainer[];
  if (mode === 'swarm') {
    containers = swarmSchema.parse(await dockerRead('/services')).map((c) => ({
      Id: c.ID,
      Names: [c.Spec.Name],
      Image: c.Spec.TaskTemplate.ContainerSpec.Image,
      State: 'swarm service',
      Status: '',
      Labels: { ...c.Spec.TaskTemplate.ContainerSpec.Labels, ...c.Spec.Labels },
      Ports: (c.Endpoint?.Ports || []).map((p) => ({
        PrivatePort: p.TargetPort,
        PublicPort: p.PublishedPort,
        Type: p.Protocol,
      })),
    }));
  } else containers = await listContainers();
  return containers
    .map((c) => discoverContainer(c, hostOrigin))
    .filter((c): c is DiscoveredService => !!c);
}
