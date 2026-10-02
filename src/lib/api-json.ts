import { ChatGPTError } from '../../scripts/connect-chatgpt.mjs';
export async function requestJson(
  request: Request,
  limit = 512_000,
): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ChatGPTError('Expected JSON.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ChatGPTError('Expected a request body.', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ChatGPTError('Request is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ChatGPTError('Invalid JSON.', 400);
  }
}
export function aiErrorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof ChatGPTError
          ? error.message
          : 'Unable to complete the AI request. Check your connection and try again.',
      ...(error instanceof ChatGPTError && error.code
        ? { code: error.code }
        : {}),
      ...(error instanceof ChatGPTError && error.requestId
        ? { requestId: error.requestId }
        : {}),
    },
    {
      status:
        error instanceof ChatGPTError &&
        error.status >= 400 &&
        error.status <= 599
          ? error.status
          : 502,
    },
  );
}
