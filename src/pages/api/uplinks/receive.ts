import type { APIRoute } from 'astro';
import {
  authorizeUplink,
  IntegrationError,
  receiveUplink,
} from '../../../lib/integrations';
import {
  integrationError,
  integrationJson,
} from '../../../lib/integration-http';
export const POST: APIRoute = async ({ request }) => {
  try {
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer '))
      throw new IntegrationError('An uplink bearer token is required.', 401);
    const token = authorization.slice(7);
    await authorizeUplink(token);
    await receiveUplink(token, await integrationJson(request, 4096));
    return Response.json({ accepted: true });
  } catch (error) {
    return integrationError(error);
  }
};
