import type { APIRoute } from 'astro';
import { readConfig } from '../../lib/store';
import { checkServices, dockerInfo, systemInfo } from '../../lib/monitor';
import { renderStatus } from '../../lib/render';
import { integrationStatus } from '../../lib/integrations';
export const GET: APIRoute = async () => {
  const config = await readConfig();
  const [services, docker, render, integrations] = await Promise.all([
    checkServices(config),
    config.widgets.includes('docker')
      ? dockerInfo()
      : Promise.resolve({ configured: false }),
    renderStatus(config).catch(() => ({
      configured: false,
      services: {},
      error: 'Render connection unavailable.',
    })),
    config.widgets.includes('uplinks')
      ? integrationStatus().catch(() => null)
      : Promise.resolve(null),
  ]);
  return Response.json({
    services,
    docker,
    render,
    uplinks: integrations?.uplinks || [],
    uplinksError:
      config.widgets.includes('uplinks') && !integrations
        ? 'Uplink storage unavailable.'
        : undefined,
    system: systemInfo(),
    checkedAt: new Date().toISOString(),
  });
};
