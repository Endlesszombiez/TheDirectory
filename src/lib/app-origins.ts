/** Explicit browser origins accepted for authenticated form/API mutations. */
export function appOrigins(
  requestUrl: URL,
  configured = process.env.APP_ORIGIN,
): string[] {
  const origins = configured
    ? configured.split(',').map((value) => value.trim())
    : [requestUrl.origin];
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin
    )
      throw new Error(
        'APP_ORIGIN must contain HTTP(S) origins without trailing slashes or paths.',
      );
  }
  return origins;
}

/** Origin has already been validated by middleware before session cookies are set. */
export function requestAppOrigin(
  request: Request,
  url: URL,
  origins = appOrigins(url),
): string {
  const submitted = request.headers.get('origin');
  if (submitted && origins.includes(submitted)) return submitted;
  return (
    origins.find((origin) => new URL(origin).host === url.host) || origins[0]
  );
}
