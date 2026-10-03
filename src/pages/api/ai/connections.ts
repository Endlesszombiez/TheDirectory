import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  connectionStatus,
  disconnectConnection,
  importConnection,
  selectConnection,
} from '../../../lib/ai-connections';
import { aiErrorResponse, requestJson } from '../../../lib/api-json';
import { cancelAIRequest } from '../../../lib/ai';
import { AIError } from '../../../lib/ai-provider';
export const GET: APIRoute = async ({ locals }) => {
  try {
    return Response.json(await connectionStatus(locals.user!.id));
  } catch (error) {
    return aiErrorResponse(error);
  }
};
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const value = await requestJson(request, 128_000);
    const parsed = z
      .discriminatedUnion('action', [
        z
          .object({
            action: z.literal('import'),
            apiKey: z.string(),
            label: z.string(),
          })
          .strict(),
        z.object({ action: z.literal('select'), id: z.uuid() }),
        z.object({ action: z.literal('disconnect'), id: z.uuid() }),
      ])
      .safeParse(value);
    if (!parsed.success) throw new AIError('Invalid connection action.', 400);
    const data = parsed.data,
      userId = locals.user!.id;
    cancelAIRequest(userId);
    if (data.action === 'import')
      return Response.json(
        await importConnection(userId, {
          apiKey: data.apiKey,
          label: data.label,
        }),
      );
    if (data.action === 'select')
      return Response.json(await selectConnection(userId, data.id));
    return Response.json(await disconnectConnection(userId, data.id));
  } catch (error) {
    return aiErrorResponse(error);
  }
};
