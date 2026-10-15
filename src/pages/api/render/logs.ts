import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const logSchema = z.object({
  receivedAt: z.string(),
  timestamp: z.string(),
  service: z.string(),
  app: z.string(),
  instance: z.string(),
  messageId: z.string(),
  severity: z.number().int().min(0).max(7),
  message: z.string(),
});
export type RenderLog = z.infer<typeof logSchema>;
const savedSchema = z.object({
  updatedAt: z.string(),
  logs: z.array(logSchema).max(500),
});
export const GET: APIRoute = async ({ locals }) => {
  if (locals.user?.role !== 'admin')
    return Response.json(
      { error: 'Administrator access required' },
      { status: 403 },
    );
  try {
    const saved = savedSchema.parse(
      JSON.parse(
        await readFile(
          join(resolve(process.env.DATA_DIR || './data'), 'render-logs.json'),
          'utf8',
        ),
      ),
    );
    return Response.json(saved, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return Response.json(
        { logs: [], updatedAt: null },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    return Response.json(
      { error: 'Render log storage is unavailable.' },
      { status: 503 },
    );
  }
};
