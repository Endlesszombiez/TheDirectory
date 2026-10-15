import { z } from 'zod';
import { createHash } from 'node:crypto';
import { IntegrationError, renderKey } from './integrations';
import { serviceSchema, type Config, type Service } from './schema';

export const renderIdSchema = z
  .string()
  .regex(/^srv-[a-z0-9-]+$/)
  .max(100);
const remoteService = z.object({
  id: renderIdSchema,
  name: z.string().min(1),
  type: z.string(),
  suspended: z.string().optional(),
  dashboardUrl: z.string().optional(),
  serviceDetails: z.object({ url: z.string().optional() }).optional(),
});
const deploymentSchema = z.object({
  id: z.string(),
  status: z.string(),
  createdAt: z.string(),
  finishedAt: z.string().nullable().optional(),
  commit: z
    .object({ id: z.string(), message: z.string().optional() })
    .nullable()
    .optional(),
});
export type RenderDeployment = z.infer<typeof deploymentSchema>;
export type RenderService = {
  id: string;
  name: string;
  type: string;
  suspended?: string;
  service: Service;
};
async function renderRequest(path: string, key: string): Promise<unknown> {
  try {
    const response = await fetch(`https://api.render.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new IntegrationError(
        response.status === 401 || response.status === 403
          ? 'Render rejected this API key. Check its access or reconnect.'
          : response.status === 429
            ? 'Render rate limit reached. Try again shortly.'
            : 'Render is unavailable. Try again shortly.',
        response.status === 429 ? 429 : 502,
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError(
      'Unable to reach Render. Try again shortly.',
      502,
    );
  }
}
export async function listRenderServices(
  key: string,
): Promise<RenderService[]> {
  const result: RenderService[] = [];
  let cursor = '';
  for (let page = 0; page <= 10; page++) {
    const parsed = z
      .array(
        z.object({ service: remoteService, cursor: z.string().optional() }),
      )
      .safeParse(
        await renderRequest(
          `services?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          key,
        ),
      );
    if (!parsed.success)
      throw new IntegrationError(
        'Render returned an unexpected service list.',
        502,
      );
    const entries = parsed.data;
    if (result.length + entries.length > 1000) break;
    for (const { service: remote } of entries) {
      const kind =
        (
          {
            static_site: 'static',
            cron_job: 'cron',
            background_worker: 'worker',
            private_service: 'pserv',
          } as Record<string, string>
        )[remote.type] || 'web';
      let dashboardUrl = `https://dashboard.render.com/${kind}/${remote.id}`;
      const safeDashboard = serviceSchema.shape.renderDashboardUrl.safeParse(
        remote.dashboardUrl,
      );
      if (safeDashboard.success && safeDashboard.data)
        dashboardUrl = safeDashboard.data;
      let url = dashboardUrl;
      const publicUrl = remote.serviceDetails?.url;
      if (publicUrl) {
        try {
          const parsed = new URL(publicUrl);
          if (
            parsed.protocol === 'https:' &&
            !parsed.username &&
            !parsed.password
          )
            url = parsed.href;
        } catch {
          /* Fall back to Render's dashboard for services without a public URL. */
        }
      }
      result.push({
        id: remote.id,
        name: remote.name.slice(0, 80),
        type: remote.type,
        suspended: remote.suspended,
        service: serviceSchema.parse({
          id: `render-${remote.id}`,
          renderServiceId: remote.id,
          renderDashboardUrl: dashboardUrl,
          name: remote.name.slice(0, 80),
          description: `Render · ${remote.type.replaceAll('_', ' ')}`.slice(
            0,
            160,
          ),
          url,
          webUrl: url,
          localUrl: '',
          icon: 'cloud',
          color: 'purple',
          group: 'Render',
          check: false,
        }),
      });
    }
    if (entries.length < 100) return result;
    const next = entries.at(-1)?.cursor;
    if (!next || next === cursor)
      throw new IntegrationError(
        'Render returned an invalid pagination cursor.',
        502,
      );
    cursor = next;
  }
  throw new IntegrationError(
    'This account exceeds the 1,000-service discovery limit. Import from a smaller Render account.',
    400,
  );
}
export type RenderDeploymentStatus = {
  deployment?: RenderDeployment | null;
  checkedAt?: string;
  error?: string;
};
const cache = new Map<string, { at: number; value: RenderDeploymentStatus }>();
const pending = new Map<string, Promise<RenderDeploymentStatus>>();
let generation = 0;
export function clearRenderCache() {
  generation++;
  cache.clear();
}
async function latestDeployment(id: string, key: string) {
  const cacheId = `${generation}:${createHash('sha256').update(key).digest('hex')}:${id}`;
  const cached = cache.get(cacheId);
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const existing = pending.get(cacheId);
  if (existing) return existing;
  const task = (async () => {
    let value: RenderDeploymentStatus;
    try {
      const entries = z
        .array(z.object({ deploy: deploymentSchema }))
        .parse(
          await renderRequest(
            `services/${encodeURIComponent(id)}/deploys?limit=1`,
            key,
          ),
        );
      value = {
        deployment: entries[0]?.deploy || null,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      value = {
        ...cached?.value,
        error:
          error instanceof IntegrationError
            ? error.message
            : 'Unexpected response from Render.',
      };
    }
    if (cache.size > 1500) cache.clear();
    cache.set(cacheId, { at: Date.now(), value });
    return value;
  })();
  pending.set(cacheId, task);
  try {
    return await task;
  } finally {
    pending.delete(cacheId);
  }
}
export async function renderStatus(config: Config) {
  const key = await renderKey();
  const services: Record<string, RenderDeploymentStatus> = {};
  if (!key) return { configured: false, services };
  const ids = [
    ...new Set(
      config.boards.flatMap((b) =>
        b.services.flatMap((s) =>
          s.renderServiceId ? [s.renderServiceId] : [],
        ),
      ),
    ),
  ];
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (index < ids.length) {
        const id = ids[index++];
        services[id] = await latestDeployment(id, key);
      }
    }),
  );
  return { configured: true, services };
}
