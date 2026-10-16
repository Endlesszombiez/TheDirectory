import type { APIRoute } from 'astro';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { requestJson } from '../../../lib/api-json';
import { AIError } from '../../../lib/ai-provider';
import {
  createPaste,
  listPastes,
  deletePaste,
  MAX_PASTE_BYTES,
} from '../../../lib/pastes';
import {
  FilesError,
  FILES_COOKIE,
  fileSettings,
  saveFileSettings,
  filesUnlocked,
  unlockFiles,
  lockFiles,
  listFiles,
  uploadFile,
  downloadFile,
  deleteFile,
} from '../../../lib/files';

const route: APIRoute = async (context) => {
  const { request, params, cookies, locals, url } = context;
  const action = params.action;
  const method = request.method;
  const token = cookies.get(FILES_COOKIE)?.value;
  try {
    const settings = await fileSettings();
    const unlocked = filesUnlocked(token, settings);
    if (action === 'status' && method === 'GET') {
      const { pinHash, ...publicSettings } = settings;
      return Response.json({
        ...publicSettings,
        configured: !!pinHash,
        unlocked,
        admin: locals.user?.role === 'admin',
      });
    }
    if (action === 'settings' && method === 'PUT') {
      if (locals.user?.role !== 'admin')
        throw new FilesError('Administrator access required.', 403);
      await saveFileSettings(await requestJson(request, 4096));
      return Response.json({ ok: true });
    }
    if (action === 'unlock' && method === 'POST') {
      const { pin } = z
        .object({ pin: z.string().max(128) })
        .parse(await requestJson(request, 4096));
      const value = await unlockFiles(pin, settings);
      cookies.set(FILES_COOKIE, value, {
        httpOnly: true,
        sameSite: 'strict',
        secure: (process.env.APP_ORIGIN || url.origin).startsWith('https:'),
        path: '/api/files',
        maxAge: 43200,
      });
      return Response.json({ ok: true });
    }
    if (action === 'lock' && method === 'POST') {
      lockFiles(token);
      cookies.delete(FILES_COOKIE, { path: '/api/files' });
      return Response.json({ ok: true });
    }
    if (!unlocked)
      throw new FilesError('Enter the file PIN or password to continue.', 401);
    if (action === 'pastes') {
      if (method === 'POST') {
        const { text } = z
          .object({ text: z.string() })
          .parse(await requestJson(request, MAX_PASTE_BYTES * 6 + 1024));
        return Response.json(await createPaste(text), { status: 201 });
      }
      if (method === 'GET')
        return Response.json({ pastes: await listPastes() });
      if (method === 'DELETE') {
        await deletePaste(url.searchParams.get('id') || '');
        return Response.json({ ok: true });
      }
    }
    if (action === 'list' && method === 'GET') {
      if (!settings.showFileList)
        throw new FilesError('File listing is disabled.', 403);
      return Response.json(await listFiles());
    }
    if (action === 'upload' && method === 'POST')
      return Response.json(
        await uploadFile(request, url.searchParams.get('path') || '', settings),
        { status: 201 },
      );
    if (action === 'download' && method === 'GET') {
      if (!settings.showFileList)
        throw new FilesError('File downloads are disabled.', 403);
      const path = url.searchParams.get('path') || '';
      const { handle, size } = await downloadFile(path);
      return new Response(
        Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>,
        {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(size),
            'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(path.split('/').pop()!).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
          },
        },
      );
    }
    if (action === 'delete' && method === 'DELETE') {
      if (!settings.showFileList)
        throw new FilesError('File management is disabled.', 403);
      await deleteFile(url.searchParams.get('path') || '');
      return Response.json({ ok: true });
    }
    return Response.json(
      { error: 'Unknown file action or method.' },
      { status: 404 },
    );
  } catch (error) {
    const status =
      error instanceof FilesError || error instanceof AIError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? 404
            : 500;
    if (status === 500) console.error('File operation failed', error);
    return Response.json(
      {
        error:
          error instanceof FilesError
            ? error.message
            : status === 400
              ? 'Invalid file settings or request.'
              : status === 404
                ? 'File not found.'
                : 'Unable to complete file operation.',
      },
      {
        status,
        headers: {
          ...(status === 429 ? { 'Retry-After': '900' } : {}),
          ...(action === 'upload' ? { Connection: 'close' } : {}),
        },
      },
    );
  }
};
export const ALL = route;
