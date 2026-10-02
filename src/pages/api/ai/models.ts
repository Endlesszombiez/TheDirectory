import type { APIRoute } from 'astro';
import { listModels } from '../../../lib/ai';
import { aiErrorResponse } from '../../../lib/api-json';
export const GET: APIRoute = async ({ locals }) => {
  try {
    return Response.json({ models: await listModels(locals.user!.id) });
  } catch (error) {
    return aiErrorResponse(error);
  }
};
