// -----------------------------------------------------------------------------
// The configuration, the /data store and the state budget (no network).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StatePublisher } from '../src/budget.js';
import { configKey, normalizeConfig, parseAddress } from '../src/config.js';
import { MemoryStore, sanitizeData } from '../src/store.js';

test('configuration: addresses, interval, Wake-on-LAN address', () => {
  assert.deepEqual(parseAddress('192.168.1.60'), { host: '192.168.1.60', port: 44077 });
  assert.deepEqual(parseAddress('tcp://Envy.lan:44078/x'), { host: 'envy.lan', port: 44078 });
  assert.equal(parseAddress('999.1.1.1'), undefined);
  assert.equal(parseAddress('a b'), undefined);
  const config = normalizeConfig({
    addresses: '192.168.1.60, bad_host!, 192.168.1.60',
    poll_interval: '5',
    wake_broadcast: 'nope',
  });
  assert.equal(config.addresses.length, 1);
  assert.deepEqual(config.invalid, ['bad_host!']);
  assert.equal(config.pollInterval, 10);
  assert.equal(config.wakeAddressInvalid, true);
  assert.equal(normalizeConfig({ poll_interval: '' }).pollInterval, 30);
  assert.equal(normalizeConfig({ wake_broadcast: '192.168.1.255' }).wakeAddress, '192.168.1.255');
  assert.equal(
    configKey(normalizeConfig({ addresses: '10.0.0.2' })),
    configKey(normalizeConfig({ addresses: ' 10.0.0.2 ' })),
  );
});

test('/data: only MAC keys, no prototype, a future attempt time capped', async () => {
  const now = 1_000_000;
  const data = sanitizeData(
    JSON.parse(
      '{"devices":{"__proto__":{"mac":"__proto__"},"001122aabbcc":{"mac":"001122aabbcc","host":"10.0.0.2","port":44077},"zz":{}},"lastAttempt":9999999999}',
    ),
    { now },
  );
  assert.deepEqual(Object.keys(data.devices), ['001122aabbcc']);
  assert.equal(Object.getPrototypeOf(data.devices), null);
  assert.equal(data.lastAttempt, now);
  assert.equal(sanitizeData('x').lastAttempt, undefined);
  const store = new MemoryStore();
  await store.save(data);
  assert.equal((await store.load({ now })).devices['001122aabbcc'].host, '10.0.0.2');
});

function fakeGladys() {
  const sent = [];
  return {
    sent,
    publishStates: async (states) => {
      sent.push(...states);
      return { success: true };
    },
  };
}

test('state budget: only changes, 300 per minute for all devices, the latest value waits', async () => {
  let now = 0;
  const handles = [];
  const timers = {
    setTimeout: (fn, ms) => handles.push({ fn, at: now + ms }),
    clearTimeout: () => {},
  };
  const gladys = fakeGladys();
  const publisher = new StatePublisher({ gladys, now: () => now, timers });
  const state = (i, value) => ({
    device_feature_external_id: `ext:madvr:envy:a:f${i}`,
    state: value,
  });
  await publisher.publish([state(0, 1), state(0, 1)]);
  await publisher.publish([state(0, 1)]);
  assert.equal(gladys.sent.length, 1, 'unchanged values are not sent');

  // Two publications at once, 350 states: 299 more go out, the 51 others wait.
  await Promise.all([
    publisher.publish(Array.from({ length: 200 }, (_, i) => state(i + 1, 1))),
    publisher.publish(Array.from({ length: 150 }, (_, i) => state(i + 201, 1))),
  ]);
  assert.equal(gladys.sent.length, 300);
  assert.equal(publisher.pending.size, 51);
  // A newer value replaces a waiting one.
  await publisher.publish([state(340, 2)]);
  assert.equal(publisher.pending.get('ext:madvr:envy:a:f340').state, 2);
  assert.equal(handles.length, 1, 'one timer');
  now = 60_100;
  handles[0].fn();
  await publisher.flush();
  assert.equal(gladys.sent.length, 351);
  assert.equal(gladys.sent.filter((s) => s.device_feature_external_id.endsWith(':f340')).length, 1);
  assert.equal(gladys.sent.find((s) => s.device_feature_external_id.endsWith(':f340')).state, 2);

  // forget: everything is sent again.
  publisher.forget('ext:madvr:envy:a');
  await publisher.publish([state(0, 1)]);
  assert.equal(gladys.sent.length, 352);
});
