import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  // Middleware validates every mutation against APP_ORIGIN (including behind TLS proxies).
  security: { checkOrigin: false },
});
