import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { z } from 'zod';

export class DockerError extends Error {}
export function dockerConnectionError(
  error: NodeJS.ErrnoException,
  proxy = !!process.env.DOCKER_API_URL,
) {
  const target = proxy ? 'Docker API proxy' : 'Docker socket';
  if (error.code === 'EACCES' || error.code === 'EPERM')
    return new DockerError(
      'Docker socket permission denied. Use the supplied restricted proxy, or add the socket owning group with group_add. A read-only mount still needs socket permissions.',
    );
  if (error.code === 'ENOENT')
    return new DockerError(
      'Docker socket was not found. Mount the host socket at DOCKER_SOCKET, or use the supplied Compose Docker proxy and set DOCKER_API_URL=http://docker-proxy:2375.',
    );
  if (error.code === 'ECONNREFUSED')
    return new DockerError(
      target +
        ' refused the connection. Start Docker and its proxy, check the endpoint, then recreate the dashboard container.',
    );
  if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN')
    return new DockerError(
      'Docker API proxy hostname could not be resolved. Check DOCKER_API_URL and connect the dashboard and proxy to the same Docker network.',
    );
  if (
    [
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'CERT_HAS_EXPIRED',
      'ERR_TLS_CERT_ALTNAME_INVALID',
    ].includes(error.code || '')
  )
    return new DockerError(
      'Docker API proxy TLS certificate could not be verified. Configure a trusted certificate and matching hostname.',
    );
  return new DockerError(
    target +
      ' is unavailable. Check the server Docker connection. The Docker host address in this form only sets imported service links.',
  );
}
const portSchema = z.object({
  PrivatePort: z.number().optional(),
  PublicPort: z.number().optional(),
  IP: z.string().optional(),
  Type: z.string().optional(),
});
export const containerSchema = z.object({
  Id: z.string(),
  Names: z.array(z.string()).default([]),
  Image: z.string().default(''),
  State: z.string().default('unknown'),
  Status: z.string().default(''),
  Labels: z
    .record(z.string(), z.string())
    .nullish()
    .transform((v) => v || {}),
  Ports: z.array(portSchema).default([]),
});
export type DockerContainer = z.infer<typeof containerSchema>;
export const dockerConfigured = () =>
  !!(process.env.DOCKER_SOCKET || process.env.DOCKER_API_URL);

// Only these read routes are allowed, including when a restricted proxy is used.
export function dockerRead(
  path: '/containers/json?all=true' | '/services',
): Promise<unknown> {
  if (!dockerConfigured())
    throw new DockerError(
      'Docker discovery is not configured. Ask your administrator to connect a Docker socket or restricted proxy.',
    );
  let endpoint: URL | undefined;
  if (process.env.DOCKER_API_URL) {
    try {
      endpoint = new URL(process.env.DOCKER_API_URL);
      if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.pathname !== '/' ||
        endpoint.search ||
        endpoint.hash
      )
        throw new Error();
    } catch {
      throw new DockerError(
        'DOCKER_API_URL must be an HTTP(S) origin without credentials or a path.',
      );
    }
  }
  return new Promise((resolve, reject) => {
    const request = (
      endpoint?.protocol === 'https:' ? httpsRequest : httpRequest
    )(
      endpoint
        ? new URL(path, endpoint)
        : { socketPath: process.env.DOCKER_SOCKET, path, method: 'GET' },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2_000_000)
            request.destroy(new DockerError('Docker returned too much data.'));
          else chunks.push(chunk);
        });
        response.on('error', () =>
          reject(new DockerError('Docker connection interrupted.')),
        );
        response.on('end', () => {
          if (response.statusCode !== 200)
            return reject(
              new DockerError(
                path === '/services'
                  ? 'Unable to list Swarm services. Connect a manager endpoint and allow GET /services on your proxy.'
                  : 'Unable to list Docker containers. Check the socket or proxy permissions.',
              ),
            );
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new DockerError('Docker returned an invalid response.'));
          }
        });
      },
    );
    request.setTimeout(5000, () =>
      request.destroy(new DockerError('Docker discovery timed out.')),
    );
    request.on('error', (error) =>
      reject(
        error instanceof DockerError ? error : dockerConnectionError(error),
      ),
    );
    request.end();
  });
}
export async function listContainers() {
  return z
    .array(containerSchema)
    .max(1000)
    .parse(await dockerRead('/containers/json?all=true'));
}
