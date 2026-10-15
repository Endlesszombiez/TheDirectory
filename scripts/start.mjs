import { startRenderLogDrain } from './render-log-drain.mjs';

const drain = await startRenderLogDrain();
if (drain) {
  console.log('Render TLS syslog listener started');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await drain.close();
      process.exit(0);
    });
}
await import('../dist/server/entry.mjs');
