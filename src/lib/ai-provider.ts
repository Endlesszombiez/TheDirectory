export const RESOURCE = 'https://api.openai.com/v1';
export class AIError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code = '',
    public requestId = '',
  ) {
    super(message);
  }
}
export function providerError(status: number, body: unknown, requestId = '') {
  const value = body as { error?: { code?: string } } | null;
  const code = typeof value?.error?.code === 'string' ? value.error.code : '';
  return new AIError(
    code === 'insufficient_quota'
      ? 'Your OpenAI API quota is exhausted. Check API billing and project limits.'
      : status === 401
        ? 'OpenAI rejected the API key. Replace it in AI settings.'
        : status === 403
          ? 'This API key does not have permission for this request. Check its project and key permissions.'
          : status === 429
            ? 'OpenAI API requests are rate limited. Try again later.'
            : code === 'model_not_found'
              ? 'The selected model is unavailable to this API key. Refresh the model list.'
              : 'OpenAI could not complete the request. Try again later.',
    status,
    code,
    requestId,
  );
}
export async function apiModels(apiKey: string) {
  const response = await fetch(RESOURCE + '/models', {
    headers: { Authorization: 'Bearer ' + apiKey },
    signal: AbortSignal.timeout(20_000),
    redirect: 'error',
  });
  const raw = await response.text();
  if (raw.length > 1_000_000)
    throw new AIError('OpenAI returned too many models.');
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AIError('OpenAI returned an invalid model catalog.');
  }
  if (!response.ok)
    throw providerError(
      response.status,
      value,
      response.headers.get('x-request-id') || '',
    );
  return value;
}
