import { AIError } from './ai-provider';
export async function requestJson(
  request: Request,
  limit = 512_000,
): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new AIError('Expected JSON.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AIError('Expected a request body.', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AIError('Request is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AIError('Invalid JSON.', 400);
  }
}
export function aiErrorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof AIError
          ? error.message
          : 'Unable to complete the AI request. Check your connection and try again.',
      ...(error instanceof AIError && error.code ? { code: error.code } : {}),
      ...(error instanceof AIError && error.requestId
        ? { requestId: error.requestId }
        : {}),
    },
    {
      status:
        error instanceof AIError && error.status >= 400 && error.status <= 599
          ? error.status
          : 502,
    },
  );
}
