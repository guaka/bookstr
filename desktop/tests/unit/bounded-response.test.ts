const { test } = require('node:test') as typeof import('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { readBoundedResponse } = require('../../bounded-response') as typeof import('../../src/bounded-response');

test('bounded response assembles chunks up to the exact limit', async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(Buffer.from('abc'));
    controller.enqueue(Buffer.from('def'));
    controller.close();
  } });
  assert.equal((await readBoundedResponse(new Response(body, { headers: { 'content-length': 'unknown' } }), 6, new AbortController().signal)).toString(), 'abcdef');
  assert.equal((await readBoundedResponse(new Response(''), 0)).length, 0);
});

test('bounded response rejects excess actual or declared bytes and cancels the body', async () => {
  for (const length of [undefined, '1', '100']) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Buffer.from('too large')); },
      cancel() { cancelled = true; },
    });
    const response = new Response(body, { headers: length ? { 'content-length': length } : {} });
    await assert.rejects(readBoundedResponse(response, 3), /too large/);
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  }
});

test('bounded response rejects missing bodies and propagates stream failures', async () => {
  await assert.rejects(readBoundedResponse(new Response(null), 3), /no readable body/);
  const failure = new Error('connection lost');
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(failure); } });
  await assert.rejects(readBoundedResponse(new Response(body), 3), failure);
  assert.equal(body.locked, false);
});

test('bounded response aborts before reading or while waiting for a stalled body', async () => {
  for (const alreadyAborted of [true, false]) {
    const controller = new AbortController();
    const failure = new Error('cancelled');
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    if (alreadyAborted) controller.abort(failure);
    const pending = readBoundedResponse(new Response(body), 3, controller.signal);
    if (!alreadyAborted) controller.abort(failure);
    await assert.rejects(pending, failure);
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  }
});

test('bounded response preserves its error when cancellation rejects', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(Buffer.from('excess')); },
    cancel() { throw new Error('cancel failed'); },
  });
  await assert.rejects(readBoundedResponse(new Response(body), 1), /too large/);
  const controller = new AbortController();
  const stalled = new ReadableStream<Uint8Array>({ cancel() { throw new Error('cancel failed'); } });
  const pending = readBoundedResponse(new Response(stalled), 1, controller.signal);
  controller.abort(new Error('aborted'));
  await assert.rejects(pending, /aborted/);
});
