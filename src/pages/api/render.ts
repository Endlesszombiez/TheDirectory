import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  IntegrationError,
  renderKey,
  setRenderKey,
} from '../../lib/integrations';
import { integrationError, integrationJson } from '../../lib/integration-http';
import {
  clearRenderCache,
  listRenderServices,
  renderIdSchema,
} from '../../lib/render';
import { readConfig, saveConfig } from '../../lib/store';

export const GET: APIRoute = async ({ locals }) => {
  if (locals.user?.role !== 'admin')
    return Response.json(
      { error: 'Administrator access required' },
      { status: 403 },
    );
  let connected = false;
  try {
    const key = await renderKey();
    connected = !!key;
    return Response.json({
      connected: !!key,
      services: key ? await listRenderServices(key) : [],
    });
  } catch (error) {
    const response = integrationError(error);
    return Response.json(
      { ...(await response.json()), connected },
      { status: response.status },
    );
  }
};
const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('connect'),
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[\x21-\x7e]+$/),
  }),
  z.object({ action: z.literal('disconnect') }),
  z.object({
    action: z.literal('import'),
    boardId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    serviceIds: z.array(renderIdSchema).min(1).max(100),
  }),
]);
export const POST: APIRoute = async ({ locals, request }) => {
  if (locals.user?.role !== 'admin')
    return Response.json(
      { error: 'Administrator access required' },
      { status: 403 },
    );
  try {
    const action = actionSchema.parse(await integrationJson(request, 16384));
    if (action.action === 'connect') {
      const services = await listRenderServices(action.apiKey);
      await setRenderKey(action.apiKey);
      clearRenderCache();
      return Response.json({ connected: true, services });
    }
    if (action.action === 'disconnect') {
      await setRenderKey(null);
      clearRenderCache();
      return Response.json({ connected: false, services: [] });
    }
    const key = await renderKey();
    if (!key) throw new IntegrationError('Connect Render first.');
    const config = await readConfig();
    const board = config.boards.find((b) => b.id === action.boardId);
    if (!board)
      throw new IntegrationError('Board not found. Reload and try again.');
    const candidates = await listRenderServices(key);
    const selected = [...new Set(action.serviceIds)].map((id) => {
      const candidate = candidates.find((c) => c.id === id);
      if (!candidate)
        throw new IntegrationError(
          'A selected service is no longer available. Refresh discovery.',
        );
      return candidate.service;
    });
    const additions = selected.filter(
      (s) =>
        !board.services.some(
          (existing) =>
            existing.renderServiceId === s.renderServiceId ||
            existing.id === s.id,
        ),
    );
    if (board.services.length + additions.length > 100)
      throw new IntegrationError('A board can contain at most 100 services.');
    board.services.push(...additions);
    const saved = await saveConfig({ ...config, revision: action.revision });
    return Response.json({ imported: additions.length, config: saved });
  } catch (error) {
    return integrationError(error);
  }
};
