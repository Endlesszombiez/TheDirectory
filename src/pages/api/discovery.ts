import type { APIRoute } from 'astro';
import { z } from 'zod';
import { discoverServices } from '../../lib/discovery';
import { DockerError } from '../../lib/docker';
export const GET: APIRoute = async ({ locals, url }) => {
  if (locals.user?.role !== 'admin')
    return Response.json(
      { error: 'Administrator access required' },
      { status: 403 },
    );
  try {
    const mode = z
      .enum(['containers', 'swarm'])
      .parse(url.searchParams.get('mode') || 'containers');
    const host = z
      .string()
      .max(2048)
      .parse(
        url.searchParams.get('host') ||
          process.env.DOCKER_HOST_ORIGIN ||
          url.origin,
      );
    return Response.json({ services: await discoverServices(mode, host) });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof DockerError
            ? error.message
            : 'Invalid discovery settings or Docker response. Enter an HTTP(S) host origin and select containers or Swarm.',
      },
      { status: error instanceof DockerError ? 503 : 400 },
    );
  }
};
