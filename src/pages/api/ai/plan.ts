import type { APIRoute } from 'astro';
import { z } from 'zod';
import { readConfig } from '../../../lib/store';
import { proposeDashboard } from '../../../lib/ai';
import { aiErrorResponse, requestJson } from '../../../lib/api-json';
import { AIError } from '../../../lib/ai-provider';
export const POST: APIRoute = async ({ request, locals }) => {
  if (locals.user?.role !== 'admin')
    return Response.json(
      { error: 'Administrator access required' },
      { status: 403 },
    );
  try {
    const parsed = z
      .object({
        prompt: z.string().trim().min(1).max(4000),
        model: z.string().min(1).max(200),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .safeParse(await requestJson(request, 32_000));
    if (!parsed.success)
      throw new AIError(
        'Enter a setup prompt (up to 4,000 characters) and choose a model.',
        400,
      );
    const config = await readConfig();
    if (config.revision !== parsed.data.revision)
      throw new AIError(
        'The dashboard changed in another tab. Reload before generating a proposal.',
        409,
      );
    return Response.json({
      config: await proposeDashboard(
        locals.user!.id,
        parsed.data.model,
        parsed.data.prompt,
        config,
      ),
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
};
