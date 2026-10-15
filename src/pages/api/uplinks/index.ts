import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  createUplink,
  integrationStatus,
  revokeUplink,
} from '../../../lib/integrations';
import {
  integrationError,
  integrationJson,
} from '../../../lib/integration-http';
export const GET: APIRoute = async ({ locals }) => {
  if (locals.user?.role !== 'admin')
    return Response.json(
      { error: 'Administrator access required' },
      { status: 403 },
    );
  try {
    return Response.json(await integrationStatus());
  } catch (error) {
    return integrationError(error);
  }
};
export const POST: APIRoute = async ({ locals, request }) => {
  if (locals.user?.role !== 'admin')
    return Response.json(
      { error: 'Administrator access required' },
      { status: 403 },
    );
  try {
    const action = z
      .discriminatedUnion('action', [
        z.object({
          action: z.literal('create'),
          name: z.string(),
          staleAfter: z.number(),
        }),
        z.object({ action: z.literal('revoke'), id: z.uuid() }),
      ])
      .parse(await integrationJson(request));
    const created =
      action.action === 'create'
        ? await createUplink(action)
        : (await revokeUplink(action.id), undefined);
    return Response.json({ ...(await integrationStatus()), created });
  } catch (error) {
    return integrationError(error);
  }
};
