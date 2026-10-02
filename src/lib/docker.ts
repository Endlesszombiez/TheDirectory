import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { z } from 'zod';

export class DockerError extends Error {}
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
        error instanceof DockerError
          ? error
          : new DockerError(
              'Docker is unavailable. Check its path, connection, and permissions.',
            ),
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
