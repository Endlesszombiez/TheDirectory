import { z } from 'zod';

export const serviceSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(80),
  description: z.string().max(160),
  url: z
    .url()
    .max(2048)
    .refine((v) => /^https?:\/\//i.test(v), 'Use an HTTP or HTTPS URL'),
  icon: z.enum([
    'server',
    'film',
    'play',
    'download',
    'home',
    'shield',
    'cloud',
    'database',
    'activity',
    'code',
    'music',
    'globe',
  ]),
  color: z.enum(['mint', 'purple', 'orange', 'blue', 'pink']),
  group: z.string().min(1).max(50),
  check: z.boolean(),
});
export const boardSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(40),
  services: z.array(serviceSchema).max(100),
  notes: z.string().max(10000),
});
export const configSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    title: z.string().min(1).max(60),
    theme: z.enum(['dark', 'light']),
    accent: z.enum(['mint', 'blue', 'purple', 'orange']),
    columns: z.number().int().min(2).max(4),
    subtitle: z
      .string()
      .max(160)
      .default('Everything you need, right where you left it.'),
    compact: z.boolean().default(false),
    backgroundUrl: z
      .union([
        z.literal(''),
        z
          .url()
          .max(2048)
          .refine((v) => /^https?:\/\//i.test(v)),
      ])
      .default(''),
    customCss: z.string().max(12000).default(''),
    widgets: z
      .array(z.enum(['clock', 'system', 'docker', 'notes']))
      .max(4)
      .refine((v) => new Set(v).size === v.length),
    boards: z.array(boardSchema).min(1).max(12),
  })
  .superRefine((value, ctx) => {
    const ids = value.boards.map((b) => b.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Board IDs must be unique' });
    for (const board of value.boards) {
      if (
        new Set(board.services.map((s) => s.id)).size !== board.services.length
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Service IDs must be unique within each board',
        });
    }
  });
export type Service = z.infer<typeof serviceSchema>;
export type Config = z.infer<typeof configSchema>;
export type Board = z.infer<typeof boardSchema>;
