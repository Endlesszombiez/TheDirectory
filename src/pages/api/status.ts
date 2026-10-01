import type { APIRoute } from 'astro';
import { readConfig } from '../../lib/store';
import { checkServices, dockerInfo, systemInfo } from '../../lib/monitor';
export const GET: APIRoute = async () => {
  const config = await readConfig();
  const [services, docker] = await Promise.all([
    checkServices(config),
    config.widgets.includes('docker')
      ? dockerInfo()
      : Promise.resolve({ configured: false }),
  ]);
  return Response.json({
    services,
    docker,
    system: systemInfo(),
    checkedAt: new Date().toISOString(),
  });
};
