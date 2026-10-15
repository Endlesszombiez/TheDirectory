import { readRequestText, RequestBodyTooLargeError } from './request-body';
import { AIError } from './ai-provider';
export async function requestJson(
  request: Request,
  limit = 512_000,
): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new AIError('Expected JSON.', 415);
  if (!request.body) throw new AIError('Expected a request body.', 400);
  let text: string;
  try {
    text = await readRequestText(request, limit);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      throw new AIError('Request is too large.', 413);
    throw error;
  }
  try {
    return JSON.parse(text);
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
