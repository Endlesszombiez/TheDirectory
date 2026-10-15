import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readRequestText,
  RequestBodyTooLargeError,
} from '../src/lib/request-body';
import { formData } from '../src/lib/auth-http';
import { requestJson } from '../src/lib/api-json';
import { PUT } from '../src/pages/api/config';

function streamed(chunks: Uint8Array[], contentType: string) {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[reads++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request('http://localhost/', {
    method: 'POST',
    body,
    duplex: 'half',
    headers: { 'Content-Type': contentType },
  } as RequestInit & { duplex: string });
  return { request, reads: () => reads, cancelled: () => cancelled };
}

test('bounded reader counts bytes and decodes UTF-8 across chunk boundaries', async () => {
  const bytes = new TextEncoder().encode('a€b');
  const input = streamed([bytes.slice(0, 2), bytes.slice(2)], 'text/plain');
  assert.equal(await readRequestText(input.request, bytes.length), 'a€b');
  assert.equal(input.cancelled(), false);
  assert.equal(await readRequestText(new Request('http://localhost/'), 10), '');
});

test('bounded reader cancels oversized streams without reading the remainder', async () => {
  const input = streamed(
    [new Uint8Array(3), new Uint8Array(3), new Uint8Array(100)],
    'text/plain',
  );
  await assert.rejects(
    readRequestText(input.request, 5),
    RequestBodyTooLargeError,
  );
  assert.equal(input.reads(), 2);
  assert.equal(input.cancelled(), true);
  assert.equal(input.request.body?.locked, false);
});

test('form and AI readers preserve errors and stop oversized request streams', async () => {
  const form = streamed(
    [new Uint8Array(4097), new Uint8Array(100)],
    'application/x-www-form-urlencoded',
  );
  await assert.rejects(formData(form.request), /Form is too large/);
  assert.equal(form.reads(), 1);
  assert.equal(form.cancelled(), true);
  const ai = streamed(
    [new Uint8Array(6), new Uint8Array(100)],
    'application/json',
  );
  await assert.rejects(
    requestJson(ai.request, 5),
    (error: unknown) =>
      error instanceof Error && 'status' in error && error.status === 413,
  );
  assert.equal(ai.reads(), 1);
  assert.equal(ai.cancelled(), true);
  assert.deepEqual(
    await requestJson(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"ok":true}',
      }),
    ),
    { ok: true },
  );
  const validForm = new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=test&password=a%26b',
  });
  assert.equal((await formData(validForm)).get('password'), 'a&b');
});

test('configuration endpoint rejects oversized streams with HTTP 413 before reading the remainder', async () => {
  const input = streamed(
    [new Uint8Array(512001), new Uint8Array(100)],
    'application/json',
  );
  const response = await PUT({
    request: input.request,
    locals: { user: { role: 'admin' } },
  } as Parameters<typeof PUT>[0]);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: 'Configuration is too large',
  });
  assert.equal(input.reads(), 1);
  assert.equal(input.cancelled(), true);
});
