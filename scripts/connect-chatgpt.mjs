import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
} from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
const TOKEN_ENDPOINT = `${ISSUER}/api/accounts/oauth/token`;
const SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export class ChatGPTError extends Error {
  constructor(message, status = 502, code = '', requestId = '') {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}
const messages = {
  subscription_sharing_user_not_eligible:
    'This ChatGPT account or workspace is not eligible to share its plan.',
  subscription_sharing_usage_limit_exceeded:
    'The ChatGPT plan or app usage limit has been reached. Review limits in ChatGPT Settings → Usage.',
  subscription_sharing_usage_unavailable:
    'ChatGPT usage availability is temporarily unavailable. Try again later.',
  subscription_sharing_user_unavailable:
    'The ChatGPT account is temporarily unavailable. Try again later.',
  subscription_sharing_unsupported_capability:
    'The selected model does not support this dashboard setup request.',
  subscription_sharing_route_not_supported:
    'ChatGPT plan usage is not available for this API route.',
  invalid_grant:
    'The ChatGPT connection has expired or been revoked. Sign in again.',
  invalid_refresh_token:
    'The ChatGPT connection has expired or been revoked. Sign in again.',
  token_expired: 'The ChatGPT connection has expired. Sign in again.',
  refresh_token_expired: 'The ChatGPT connection has expired. Sign in again.',
  refresh_token_invalidated:
    'The ChatGPT connection was revoked. Sign in again.',
  refresh_token_reused: 'The ChatGPT connection needs a fresh sign-in.',
  invalid_client: 'The ChatGPT registration is invalid. Sign in again.',
};
export function providerError(status, body, requestId = '') {
  const code =
    typeof body?.error?.code === 'string'
      ? body.error.code
      : typeof body?.error === 'string'
        ? body.error
        : '';
  return new ChatGPTError(
    messages[code] ||
      (status === 401
        ? 'ChatGPT rejected the connection. Sign in again.'
        : status === 403
          ? 'ChatGPT plan usage is restricted for this account, workspace, or region.'
          : status === 429
            ? 'ChatGPT requests are rate limited. Try again later.'
            : 'ChatGPT could not complete the request. Try again later.'),
    status,
    code,
    requestId,
  );
}
async function jsonRequest(url, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (text.length > 1_000_000)
    throw new ChatGPTError('ChatGPT returned too much data.');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ChatGPTError('ChatGPT returned an invalid response.');
  }
  if (!response.ok)
    throw providerError(
      response.status,
      body,
      response.headers.get('x-request-id') || '',
    );
  return body;
}
async function discovery(fetchImpl) {
  const metadata = await jsonRequest(
    `${ISSUER}/.well-known/openid-configuration`,
    {},
    fetchImpl,
  );
  if (
    metadata.issuer !== ISSUER ||
    typeof metadata.jwks_uri !== 'string' ||
    new URL(metadata.jwks_uri).origin !== ISSUER
  )
    throw new ChatGPTError('Invalid OpenAI identity configuration.');
  return metadata;
}
export async function verifyJwt(token, expected, fetchImpl = fetch) {
  try {
    if (typeof token !== 'string' || token.length > 32_000) throw new Error();
    const parts = token.split('.');
    if (
      parts.length !== 3 ||
      parts.some(
        (p) =>
          !/^[a-zA-Z0-9_-]+$/.test(p) ||
          Buffer.from(p, 'base64url').toString('base64url') !== p,
      )
    )
      throw new Error();
    const header = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8'),
    );
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit)
      throw new Error();
    const metadata = await discovery(fetchImpl);
    const jwks = await jsonRequest(metadata.jwks_uri, {}, fetchImpl);
    const key = jwks.keys?.find(
      (k) =>
        k.kid === header.kid &&
        k.kty === 'RSA' &&
        (!k.use || k.use === 'sig') &&
        (!k.alg || k.alg === 'RS256'),
    );
    if (
      !key ||
      !verify(
        'RSA-SHA256',
        Buffer.from(`${parts[0]}.${parts[1]}`),
        createPublicKey({ key, format: 'jwk' }),
        Buffer.from(parts[2], 'base64url'),
      )
    )
      throw new Error();
    const claims = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    );
    const now = Date.now() / 1000;
    if (
      claims.iss !== ISSUER ||
      ![claims.aud].flat().includes(expected.audience) ||
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      typeof claims.exp !== 'number' ||
      claims.exp <= now ||
      (claims.nbf !== undefined &&
        (typeof claims.nbf !== 'number' || claims.nbf > now + 30)) ||
      (claims.iat !== undefined &&
        (typeof claims.iat !== 'number' || claims.iat > now + 30))
    )
      throw new Error();
    if (expected.nonce !== undefined && claims.nonce !== expected.nonce)
      throw new Error();
    if (expected.subject !== undefined && claims.sub !== expected.subject)
      throw new Error();
    if (
      expected.clientId !== undefined &&
      claims.client_id !== expected.clientId
    )
      throw new Error();
    return claims;
  } catch (error) {
    if (error instanceof ChatGPTError) throw error;
    throw new ChatGPTError(
      'Unable to verify the ChatGPT identity or credentials. Complete a fresh sign-in.',
      400,
    );
  }
}
export function createAuthorization(hostId, redirectUri, saved) {
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const url = new URL(`${ISSUER}/api/accounts/authorize`);
  const clientId = saved?.client_id || 'dynamic_agent_client';
  const params = {
    client_id: clientId,
    ext_agent_host_id: hostId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
  if (!saved) params.agent_name_hint = 'The Directory';
  else {
    if (saved.id_token) params.id_token_hint = saved.id_token;
    if (saved.email) params.login_hint = saved.email;
    if (!saved.scopes?.includes('chatgpt.tokens.use.direct'))
      params.prompt = 'consent';
  }
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  return {
    state,
    nonce,
    verifier,
    redirectUri,
    clientId,
    hostId,
    url: url.href,
    subject: saved?.subject,
  };
}
export async function validateCredentials(
  value,
  expected = {},
  fetchImpl = fetch,
) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.client_id !== 'string' ||
    value.client_id === 'dynamic_agent_client' ||
    value.client_id.length > 512 ||
    typeof value.access_token !== 'string' ||
    typeof value.id_token !== 'string' ||
    typeof value.refresh_token !== 'string' ||
    value.refresh_token.length > 32_000 ||
    !value.refresh_token ||
    typeof value.token_type !== 'string' ||
    value.token_type.toLowerCase() !== 'bearer'
  )
    throw new ChatGPTError(
      'Invalid credential file. Use the Directory ChatGPT sign-in helper.',
      400,
    );
  if (expected.clientId && value.client_id !== expected.clientId)
    throw new ChatGPTError(
      'ChatGPT returned a different account registration.',
      400,
    );
  const identity = await verifyJwt(
    value.id_token,
    {
      audience: value.client_id,
      nonce: expected.nonce,
      subject: expected.subject,
    },
    fetchImpl,
  );
  const access = await verifyJwt(
    value.access_token,
    { audience: RESOURCE, subject: identity.sub, clientId: value.client_id },
    fetchImpl,
  );
  if (typeof access.scope !== 'string')
    throw new ChatGPTError(
      'ChatGPT returned credentials without granted permissions.',
      400,
    );
  const scopes = access.scope.split(/\s+/).filter(Boolean);
  const returnedScopes =
    typeof value.scope === 'string'
      ? value.scope.split(/\s+/)
      : Array.isArray(value.scopes)
        ? value.scopes
        : [];
  const permitted =
    scopes.includes('chatgpt.tokens.use.direct') &&
    returnedScopes.includes('chatgpt.tokens.use.direct');
  return {
    client_id: value.client_id,
    subject: identity.sub,
    email: typeof identity.email === 'string' ? identity.email : '',
    issuer: ISSUER,
    id_token: value.id_token,
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    token_type: 'Bearer',
    scopes: permitted
      ? scopes
      : scopes.filter((s) => s !== 'chatgpt.tokens.use.direct'),
    expires_at: access.exp * 1000,
    saved_at: new Date().toISOString(),
  };
}
export async function completeAuthorization(
  attempt,
  callback,
  fetchImpl = fetch,
) {
  const params = new URL(callback).searchParams;
  if (params.get('state') !== attempt.state)
    throw new ChatGPTError('Invalid sign-in state. Start a new sign-in.', 400);
  if (params.get('error'))
    throw new ChatGPTError('ChatGPT sign-in was declined or cancelled.', 400);
  const issued =
    params.get('client_id') ||
    (attempt.clientId !== 'dynamic_agent_client' ? attempt.clientId : '');
  if (
    !issued ||
    issued === 'dynamic_agent_client' ||
    (attempt.clientId !== 'dynamic_agent_client' && issued !== attempt.clientId)
  )
    throw new ChatGPTError(
      'ChatGPT returned an invalid client registration.',
      400,
    );
  const code = params.get('code');
  if (!code || code.length > 8192)
    throw new ChatGPTError('No authorization code was received.', 400);
  const tokens = await jsonRequest(
    TOKEN_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: issued,
        code,
        code_verifier: attempt.verifier,
        redirect_uri: attempt.redirectUri,
        resource: RESOURCE,
      }),
    },
    fetchImpl,
  );
  return validateCredentials(
    { ...tokens, client_id: issued },
    { nonce: attempt.nonce, subject: attempt.subject, clientId: issued },
    fetchImpl,
  );
}
export async function refreshCredentials(credentials, fetchImpl = fetch) {
  const tokens = await jsonRequest(
    TOKEN_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: credentials.client_id,
        refresh_token: credentials.refresh_token,
        resource: RESOURCE,
      }),
    },
    fetchImpl,
  );
  if (
    typeof tokens.refresh_token !== 'string' ||
    !tokens.refresh_token ||
    tokens.refresh_token.length > 32_000 ||
    typeof tokens.token_type !== 'string' ||
    tokens.token_type.toLowerCase() !== 'bearer'
  )
    throw new ChatGPTError('ChatGPT returned invalid renewed credentials.');
  const access = await verifyJwt(
    tokens.access_token,
    {
      audience: RESOURCE,
      subject: credentials.subject,
      clientId: credentials.client_id,
    },
    fetchImpl,
  );
  let idToken = credentials.id_token;
  if (tokens.id_token) {
    await verifyJwt(
      tokens.id_token,
      { audience: credentials.client_id, subject: credentials.subject },
      fetchImpl,
    );
    idToken = tokens.id_token;
  }
  const scopes =
    typeof access.scope === 'string'
      ? access.scope.split(/\s+/).filter(Boolean)
      : [];
  return {
    ...credentials,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: idToken,
    scopes,
    expires_at: access.exp * 1000,
    saved_at: new Date().toISOString(),
  };
}
export async function revokeCredentials(credentials, fetchImpl = fetch) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const metadata = await discovery(fetchImpl);
      if (
        typeof metadata.revocation_endpoint !== 'string' ||
        new URL(metadata.revocation_endpoint).origin !== ISSUER
      )
        return false;
      const response = await fetchImpl(metadata.revocation_endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: credentials.refresh_token,
          token_type_hint: 'refresh_token',
          client_id: credentials.client_id,
        }),
      });
      if (response.status === 200) return true;
      if (response.status < 500) return false;
    } catch {
      /* Retry once while the renewable session is still available. */
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function atomicFile(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(
    temp,
    JSON.stringify(value, null, 2).replace(/\n/g, '\r\n') + '\r\n',
    { mode: 0o600 },
  );
  await rename(temp, path);
}
async function main() {
  if (process.argv.includes('--help')) {
    console.log(
      'Usage: node connect-chatgpt.mjs [--profile NAME]\nRuns a local ChatGPT OAuth sign-in and writes a protected credential file for import into The Directory. Requires Node.js 22+.',
    );
    return;
  }
  const index = process.argv.indexOf('--profile');
  const profile = index >= 0 ? process.argv[index + 1] : 'default';
  if (!profile || !/^[a-zA-Z0-9_-]{1,40}$/.test(profile))
    throw new Error(
      'Use a profile name containing 1–40 letters, numbers, dashes, or underscores.',
    );
  const directory = join(homedir(), '.config', 'thedirectory');
  const path = join(directory, `chatgpt-${profile}.json`);
  let saved;
  try {
    saved = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error(
        'Cannot read the existing profile. Choose a different --profile name.',
      );
  }
  let hostId;
  const hostPath = join(directory, 'chatgpt-host.json');
  try {
    hostId = JSON.parse(await readFile(hostPath, 'utf8')).id;
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error('Cannot read the saved host ID.');
  }
  if (!hostId) {
    hostId = `urn:uuid:${randomUUID()}`;
    await atomicFile(hostPath, { id: hostId });
  }
  let attempt,
    busy = false;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    );
    if (
      request.method !== 'GET' ||
      request.headers.host !== `127.0.0.1:${server.address().port}`
    ) {
      response.writeHead(400);
      response.end('Invalid request.');
      return;
    }
    const url = new URL(request.url, attempt.redirectUri);
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      const link = attempt.url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      response.end(
        `<!doctype html><html lang="en"><meta charset="utf-8"><title>Connect ChatGPT · The Directory</title><style>body{font:16px system-ui;max-width:560px;margin:12vh auto;padding:24px;line-height:1.7}a{display:inline-block;padding:12px 20px;background:#111;color:white;border-radius:8px;text-decoration:none}</style><h1>Connect your ChatGPT plan</h1><p>Authorize The Directory to use your eligible ChatGPT plan. Dashboard setup requests count toward your existing plan limits.</p><a href="${link}">Continue with ChatGPT</a><p>After sign-in, import the saved connection file in your dashboard’s AI settings.</p></html>`,
      );
      return;
    }
    if (url.pathname !== '/auth/callback') {
      response.writeHead(404);
      response.end();
      return;
    }
    if (url.searchParams.get('state') !== attempt.state || busy) {
      response.writeHead(400);
      response.end('Invalid or already used sign-in attempt.');
      return;
    }
    busy = true;
    try {
      const credentials = await completeAuthorization(attempt, url.href);
      await atomicFile(path, { ...credentials, ext_agent_host_id: hostId });
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end(
        'ChatGPT connected. Return to your terminal for the connection file path, then import it in The Directory → AI settings.',
      );
      console.log(
        `Connection file saved: ${path}\nImport this file in The Directory → AI settings. Keep it private. After importing, the dashboard owns token refreshes.\n${credentials.scopes.includes('chatgpt.tokens.use.direct') ? 'ChatGPT plan permission enabled.' : 'ChatGPT plan permission was not granted. Repeat sign-in to enable AI usage.'}`,
      );
      finish();
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(
        error instanceof ChatGPTError
          ? error.message
          : 'Sign-in failed. Start the helper again.',
      );
      console.error(
        error instanceof ChatGPTError
          ? error.message
          : 'Sign-in failed. Start the helper again.',
      );
      process.exitCode = 1;
      finish();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  attempt = createAuthorization(
    hostId,
    `http://127.0.0.1:${port}/auth/callback`,
    saved,
  );
  const timer = setTimeout(() => {
    console.error('Sign-in timed out. Start the helper again.');
    process.exitCode = 1;
    finish();
  }, 10 * 60_000);
  function finish() {
    clearTimeout(timer);
    server.close();
    server.closeIdleConnections();
  }
  process.once('SIGINT', finish);
  console.log(
    `Open http://127.0.0.1:${port}/ in your browser to continue with ChatGPT.\nUse --profile another-name to connect a different ChatGPT account or workspace.`,
  );
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(
      error instanceof ChatGPTError
        ? error.message
        : 'Unable to start ChatGPT sign-in. Check the profile name, file permissions, and network connection.',
    );
    process.exitCode = 1;
  });
}
