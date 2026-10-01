import type { APIRoute } from 'astro';
import { configSchema } from '../../lib/schema';
import { ConflictError, readConfig, saveConfig } from '../../lib/store';
export const GET: APIRoute = async () => Response.json(await readConfig());
export const PUT: APIRoute = async ({ request, locals }) => {
  if (locals.user?.role !== 'admin')
    return Response.json(
      { error: 'Administrator access required' },
      { status: 403 },
    );
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return Response.json({ error: 'Expected JSON' }, { status: 415 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 512_000)
    return Response.json(
      { error: 'Configuration is too large' },
      { status: 413 },
    );
  let config;
  try {
    config = configSchema.parse(JSON.parse(raw));
  } catch {
    return Response.json(
      {
        error:
          'Invalid dashboard configuration. Check URLs and required fields.',
      },
      { status: 400 },
    );
  }
  try {
    return Response.json(await saveConfig(config));
  } catch (error) {
    if (error instanceof ConflictError)
      return Response.json({ error: error.message }, { status: 409 });
    console.error('Unable to save dashboard', error);
    return Response.json(
      { error: 'Unable to save. Check data directory permissions.' },
      { status: 500 },
    );
  }
};
