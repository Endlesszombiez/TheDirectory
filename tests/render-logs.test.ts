import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:tls';
import { createServer } from 'node:net';
import { once } from 'node:events';
import {
  parseSyslog,
  syslogDecoder,
  senderAllowlist,
  startRenderLogDrain,
} from '../scripts/render-log-drain.mjs';
import { GET } from '../src/pages/api/render/logs';

const line =
  '<14>1 2026-10-15T20:00:00Z my-service srv-test 123 srv-test - hello <script>world</script>';

test('Render syslog decoder handles fragmented UTF-8 octet frames, batched lines, structured data, and limits', () => {
  const received: ReturnType<typeof parseSyslog>[] = [];
  const decode = syslogDecoder((log: ReturnType<typeof parseSyslog>) =>
    received.push(log),
  );
  const unicode = line + ' 🌍';
  const frame = Buffer.from(`${Buffer.byteLength(unicode)} ${unicode}`);
  for (const byte of frame) decode(Buffer.from([byte]));
  decode(Buffer.from(`${line}\r\n${line}\n`));
  assert.equal(received.length, 3);
  assert.equal(received[0].message, 'hello <script>world</script> 🌍');
  assert.equal(received[0].service, 'my-service');
  assert.equal(received[0].severity, 6);
  const structured = parseSyslog(
    '<11>1 - host app proc msg [meta key="a\\]b"][other x="y"] failure',
  );
  assert.equal(structured.message, 'failure');
  assert.equal(structured.severity, 3);
  for (const input of [
    '99999 ',
    '0 ',
    'x'.repeat(17000),
    '<999>1 - a b c d - bad\n',
    'bad\n',
  ]) {
    assert.throws(() => syslogDecoder(() => {})(Buffer.from(input)));
  }
});

test('Render listener requires valid sender ranges and handles mapped IPv4 and IPv6', () => {
  const allowed = senderAllowlist('192.0.2.0/24,2001:db8::/32');
  assert.equal(allowed('::ffff:192.0.2.10'), true);
  assert.equal(allowed('2001:db8::5'), true);
  assert.equal(allowed('198.51.100.1'), false);
  for (const input of ['', 'bad', '192.0.2.1/33', '::/129', '192.0.2.1/1/2'])
    assert.throws(() => senderAllowlist(input));
});

test('Render log read API is administrator-only, returns received logs, and fails safely on corrupt storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-render-read-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  try {
    for (const user of [null, { role: 'viewer' }])
      assert.equal((await GET({ locals: { user } } as any)).status, 403);
    const read = () => GET({ locals: { user: { role: 'admin' } } } as any);
    assert.deepEqual((await (await read()).json()).logs, []);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(directory, 'render-logs.json'),
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        logs: [parseSyslog(line)],
      }),
    );
    const response = await read();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).logs[0].service, 'my-service');
    await writeFile(join(directory, 'render-logs.json'), 'corrupt');
    assert.equal((await read()).status, 503);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('TLS log drain receives real TLS syslog traffic, persists a bounded history, and reloads after restart', async (t) => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
  } catch {
    t.skip('OpenSSL is required to generate a test TLS certificate');
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'directory-render-tls-'));
  let drain: Awaited<ReturnType<typeof startRenderLogDrain>> = null;
  try {
    const cert = join(directory, 'cert.pem');
    const key = join(directory, 'key.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-subj',
        '/CN=localhost',
        '-days',
        '1',
      ],
      { stdio: 'ignore' },
    );
    const allocator = createServer().listen(0, '127.0.0.1');
    await once(allocator, 'listening');
    const port = (allocator.address() as { port: number }).port;
    await new Promise<void>((resolve) => allocator.close(() => resolve()));
    const env = {
      DATA_DIR: directory,
      RENDER_LOG_PORT: String(port),
      RENDER_LOG_HOST: '127.0.0.1',
      RENDER_LOG_TLS_CERT: cert,
      RENDER_LOG_TLS_KEY: key,
      RENDER_LOG_ALLOWED_IPS: '127.0.0.1',
    };
    drain = await startRenderLogDrain(env);
    const socket = connect({
      host: '127.0.0.1',
      port,
      ca: await readFile(cert),
      servername: 'localhost',
    });
    await once(socket, 'secureConnect');
    const closed = once(socket, 'close');
    socket.end(Buffer.from((line + '\n').repeat(510)));
    await closed;
    await drain!.close();
    drain = null;
    const saved = JSON.parse(
      await readFile(join(directory, 'render-logs.json'), 'utf8'),
    );
    assert.equal(saved.logs.length, 500);
    assert.equal(saved.logs[0].message, 'hello <script>world</script>');
    drain = await startRenderLogDrain(env);
    await drain!.close();
    drain = null;
    assert.equal(
      JSON.parse(await readFile(join(directory, 'render-logs.json'), 'utf8'))
        .logs.length,
      500,
    );
  } finally {
    await drain?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
