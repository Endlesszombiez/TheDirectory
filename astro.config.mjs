import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';

export default defineConfig({
  output: 'server',
  // File uploads enforce their configured limit while streaming; other APIs bound their own bodies.
  adapter: node({ mode: 'standalone', bodySizeLimit: 100 * 1024 ** 3 }),
  integrations: [react()],
  // Middleware validates every mutation against APP_ORIGIN (including behind TLS proxies).
  security: { checkOrigin: false },
});
