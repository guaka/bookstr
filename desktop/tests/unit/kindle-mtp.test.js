'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MtpKindles } = require('../../kindle-mtp');

test('MTP sessions use the default factory and decorate progress with current book and device', async () => {
  const progress = [];
  const transport = new MtpKindles({
    platform: 'darwin',
    onProgress: value => progress.push(value),
  });
  const device = { id: 'mtp:darwin:1-2', helperId: '1-2' };
  transport.currentBook = { bookId: 'book-1', title: 'Example' };

  await transport.withSession(device, async () => {
    assert.equal(transport.session.helper, transport.helper);
    assert.equal(transport.session.deviceId, device.helperId);
    transport.session.onProgress({ phase: 'copying', percent: 50 });
  });

  assert.deepEqual(progress, [{
    bookId: 'book-1',
    title: 'Example',
    phase: 'copying',
    percent: 50,
    deviceId: device.id,
  }]);
  assert.equal(transport.session, null);
});

test('MTP sessions use the default no-op progress callback when none is supplied', async () => {
  const transport = new MtpKindles({ platform: 'darwin' });
  const device = { id: 'mtp:darwin:3-4', helperId: '3-4' };

  await transport.withSession(device, async () => {
    assert.doesNotThrow(() => transport.session.onProgress({ phase: 'copying' }));
  });
});
