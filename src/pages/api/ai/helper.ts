import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export const GET: APIRoute = async () =>
  new Response(await readFile(resolve('scripts/connect-chatgpt.mjs'), 'utf8'), {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Disposition': 'attachment; filename="directory-chatgpt.mjs"',
    },
  });
