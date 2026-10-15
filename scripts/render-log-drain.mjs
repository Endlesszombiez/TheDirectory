import { createServer } from 'node:tls';
import { BlockList, isIP } from 'node:net';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MAX_FRAME = 16384;
export function parseSyslog(frame) {
  const match =
    /^<(\d{1,3})>1 (\S+) (\S+) (\S+) (\S+) (\S+) (-|(?:\[(?:[^\]"\\]|\\.|"(?:[^"\\]|\\.)*")*\])+)(?: ([\s\S]*))?$/.exec(
      frame,
    );
  if (!match || Number(match[1]) > 191)
    throw new Error('Invalid RFC5424 message');
  return {
    receivedAt: new Date().toISOString(),
    timestamp: match[2],
    service: match[3],
    app: match[4],
    instance: match[5],
    messageId: match[6],
    severity: Number(match[1]) % 8,
    message: (match[8] || '').replace(/^\uFEFF/, ''),
  };
}

// RFC6587 octet counting and newline framing; TCP chunks need not be frames.
export function syslogDecoder(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length) {
      let frame;
      if (buffer[0] >= 48 && buffer[0] <= 57) {
        const space = buffer.indexOf(32);
        if (space === -1) {
          if (buffer.length > 5 || !/^\d+$/.test(buffer.toString()))
            throw new Error('Invalid frame length');
          break;
        }
        const prefix = buffer.subarray(0, space).toString();
        if (!/^\d{1,5}$/.test(prefix)) throw new Error('Invalid frame length');
        const length = Number(prefix);
        if (!length || length > MAX_FRAME) throw new Error('Frame too large');
        if (buffer.length < space + 1 + length) break;
        frame = buffer.subarray(space + 1, space + 1 + length);
        buffer = buffer.subarray(space + 1 + length);
      } else {
        const newline = buffer.indexOf(10);
        if (newline === -1) break;
        if (newline > MAX_FRAME) throw new Error('Frame too large');
        frame = buffer.subarray(0, newline);
        buffer = buffer.subarray(newline + 1);
        if (frame.at(-1) === 13) frame = frame.subarray(0, -1);
      }
      if (frame.length) onMessage(parseSyslog(frame.toString('utf8')));
    }
    if (buffer.length > MAX_FRAME + 6) throw new Error('Frame too large');
  };
}

export function senderAllowlist(value) {
  if (!value?.trim()) throw new Error('RENDER_LOG_ALLOWED_IPS is required');
  const list = new BlockList();
  for (const entry of value.split(',').map((s) => s.trim())) {
    const [address, prefix, extra] = entry.split('/');
    const version = isIP(address);
    if (!version || extra !== undefined)
      throw new Error('Invalid sender IP/CIDR');
    const family = version === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(address, family);
    else {
      if (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128))
        throw new Error('Invalid sender CIDR');
      list.addSubnet(address, Number(prefix), family);
    }
  }
  return (address) => {
    const normalized = address?.replace(/^::ffff:/, '') || '';
    return (
      !!isIP(normalized) &&
      list.check(normalized, isIP(normalized) === 4 ? 'ipv4' : 'ipv6')
    );
  };
}

export async function startRenderLogDrain(env = process.env) {
  if (!env.RENDER_LOG_PORT) return null;
  const port = Number(env.RENDER_LOG_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid RENDER_LOG_PORT');
  const allowed = senderAllowlist(env.RENDER_LOG_ALLOWED_IPS);
  if (!env.RENDER_LOG_TLS_CERT || !env.RENDER_LOG_TLS_KEY)
    throw new Error('Render log drain requires a TLS certificate and key');
  const directory = resolve(env.DATA_DIR || './data');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = join(directory, 'render-logs.json');
  let logs = [];
  try {
    const saved = JSON.parse(await readFile(destination, 'utf8'));
    if (!Array.isArray(saved.logs))
      throw new Error('Invalid saved Render logs');
    logs = saved.logs.slice(-500);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let revision = 0;
  let persisted = -1;
  let flushing = null;
  async function flush() {
    if (flushing) return flushing;
    if (persisted === revision) return;
    const snapshot = revision;
    flushing = (async () => {
      const temp = join(directory, `render-logs.${randomUUID()}.tmp`);
      await writeFile(
        temp,
        JSON.stringify({ updatedAt: new Date().toISOString(), logs }) + '\r\n',
        { mode: 0o600 },
      );
      await rename(temp, destination);
      persisted = snapshot;
    })();
    try {
      await flushing;
    } finally {
      flushing = null;
    }
  }
  await flush();
  let count = 0;
  let windowStart = Date.now();
  const sockets = new Set();
  const server = createServer(
    {
      cert: await readFile(env.RENDER_LOG_TLS_CERT),
      key: await readFile(env.RENDER_LOG_TLS_KEY),
      minVersion: 'TLSv1.2',
      handshakeTimeout: 10000,
    },
    (socket) => {
      socket.on('error', () => {});
      if (!allowed(socket.remoteAddress)) return socket.destroy();
      socket.setTimeout(60000, () => socket.destroy());
      const decode = syslogDecoder((log) => {
        if (Date.now() - windowStart >= 1000) {
          windowStart = Date.now();
          count = 0;
        }
        if (++count > 1000) throw new Error('Log rate limit exceeded');
        logs.push(log);
        if (logs.length > 500) logs.shift();
        revision++;
      });
      socket.on('data', (chunk) => {
        try {
          decode(chunk);
        } catch {
          socket.destroy();
        }
      });
    },
  );
  server.maxConnections = 32;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    if (!allowed(socket.remoteAddress)) socket.destroy();
  });
  server.on('tlsClientError', () => {});
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, env.RENDER_LOG_HOST || '0.0.0.0', resolve);
  });
  server.on('error', (error) =>
    console.error('Render log listener failed:', error.code || 'unknown'),
  );
  const timer = setInterval(() => {
    void flush().catch(() => console.error('Unable to persist Render logs'));
  }, 1000);
  return {
    server,
    async close() {
      clearInterval(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      await flush();
      await flush();
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const drain = await startRenderLogDrain();
  if (!drain) throw new Error('Set RENDER_LOG_PORT to enable the log drain');
  console.log('Render TLS syslog listener started');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await drain.close();
      process.exit(0);
    });
}
