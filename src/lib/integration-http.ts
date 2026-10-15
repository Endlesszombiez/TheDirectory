import { z } from 'zod';
import { IntegrationError } from './integrations';
import { readRequestText, RequestBodyTooLargeError } from './request-body';
import { ConflictError } from './store';

export async function integrationJson(
  request: Request,
  limit = 8192,
): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new IntegrationError('Expected JSON.', 415);
  try {
    return JSON.parse(await readRequestText(request, limit));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      throw new IntegrationError('Request is too large.', 413);
    if (error instanceof SyntaxError)
      throw new IntegrationError('Invalid JSON.');
    throw error;
  }
}
export function integrationError(error: unknown) {
  const status =
    error instanceof IntegrationError
      ? error.status
      : error instanceof ConflictError
        ? 409
        : error instanceof z.ZodError
          ? 400
          : 503;
  const message =
    error instanceof IntegrationError || error instanceof ConflictError
      ? error.message
      : error instanceof z.ZodError
        ? 'Invalid settings or data. Check the allowed fields and limits.'
        : 'Integration unavailable. Check server storage and try again.';
  return Response.json(
    { error: message },
    { status, headers: status === 429 ? { 'Retry-After': '5' } : {} },
  );
}
