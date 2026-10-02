export type Credentials = {
  client_id: string;
  subject: string;
  email: string;
  issuer: string;
  id_token: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  scopes: string[];
  expires_at: number;
  saved_at: string;
};
export type Claims = {
  sub: string;
  exp: number;
  scope?: string;
  email?: string;
  [key: string]: unknown;
};
export class ChatGPTError extends Error {
  status: number;
  code: string;
  requestId: string;
  constructor(
    message: string,
    status?: number,
    code?: string,
    requestId?: string,
  );
}
export const ISSUER: string;
export const RESOURCE: string;
export function providerError(
  status: number,
  body: unknown,
  requestId?: string,
): ChatGPTError;
export function verifyJwt(
  token: string,
  expected: {
    audience: string;
    nonce?: string;
    subject?: string;
    clientId?: string;
  },
  fetchImpl?: typeof fetch,
): Promise<Claims>;
export function createAuthorization(
  hostId: string,
  redirectUri: string,
  saved?: Credentials,
): {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  hostId: string;
  url: string;
  subject?: string;
};
export function completeAuthorization(
  attempt: ReturnType<typeof createAuthorization>,
  callback: string,
  fetchImpl?: typeof fetch,
): Promise<Credentials>;
export function validateCredentials(
  value: unknown,
  expected?: { nonce?: string; subject?: string; clientId?: string },
  fetchImpl?: typeof fetch,
): Promise<Credentials>;
export function refreshCredentials(
  credentials: Credentials,
  fetchImpl?: typeof fetch,
): Promise<Credentials>;
export function revokeCredentials(
  credentials: Credentials,
  fetchImpl?: typeof fetch,
): Promise<boolean>;
