// -----------------------------------------------------------------------------
// EnvyApp with the SDK's fake Gladys, the exact handlers of the container
// (src/handlers.js), a memory store and the fake Envy on the loopback
// interface. The round timer never fires: the tests drive the rounds, and
// move the clock forward to pass the interval.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { EnvyApp } from '../src/app.js';
import { TIMINGS } from '../src/constants.js';
import { openSession } from '../src/envy/client.js';
import { registerHandlers } from '../src/handlers.js';
import { MemoryStore } from '../src/store.js';
import { MAC_ID, startFakeEnvy } from './fixtures/fakeEnvy.js';

const SELECTOR = 'madvr';
const id = (key, mac = MAC_ID) => `ext:${SELECTOR}:envy:${mac}${key ? `:${key}` : ''}`;

const timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};
/** The round timer never fires. */
const roundTimers = { setTimeout: () => 1, clearTimeout: () => {} };

const FAST = {
  ...TIMINGS,
  connectTimeout: 300,
  readTimeout: 300,
  commandBudget: 900,
  preRead: 300,
  pollBudget: 2_000,
  recheckDelay: 30,
  wakeStep: 40,
  wakeWait: 3_000,
  persistDelay: 5,
};

async function waitFor(predicate, what, timeout = 3_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

async function setup(
  t,
  { fakeOptions, config, timings = {}, store = new MemoryStore(), open, fake: given } = {},
) {
  const fake = given ?? (await startFakeEnvy(fakeOptions));
  t.after(() => fake.close());
  const clock = { offset: 0 };
  const now = () => Date.now() + clock.offset;
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: config ?? { addresses: `127.0.0.1:${fake.port}`, poll_interval: 30 },
  });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.message ?? a).join(' ')}`),
    ]),
  );
  const app = new EnvyApp({
    gladys,
    logger,
    store,
    now,
    timers,
    roundTimers,
    timings: { ...FAST, ...timings },
    openSession: open ?? openSession,
  });
  registerHandlers(gladys, app, logger);
  t.after(() => app.stop());
  await gladys.connect();
  await waitFor(() => app.started && app.data, 'the start');
  const advance = (ms) => {
    clock.offset += ms;
  };
  return { fake, gladys, app, logs, store, advance, now };
}

async function discovered(gladys, app) {
  await app.round();
  await waitFor(
    () => gladys.fake.discoveredDevices.some((d) => d.external_id === id()),
    'the Envy in the Discovery tab',
  );
  return gladys.fake.discoveredDevices.find((d) => d.external_id === id());
}

/** Discovered, created, then read once (the clock moved past the interval). */
async function createDevice(ctx) {
  const { gladys, app, advance } = ctx;
  const device = await discovered(gladys, app);
  await gladys.fake.deviceCreated(device);
  advance(31_000);
  await app.round();
  await waitFor(() => gladys.fake.lastState(id('power')) !== undefined, 'the power state');
  return device;
}

const press = (gladys, device, key, value = 1) =>
  gladys.fake.setValue(
    device,
    device.features.find((f) => f.external_id === id(key)),
    value,
  );

const wakes = (gladys) => gladys.fake.bodies('POST', '/network/wake');

test('a typed address becomes a Gladys device, identified by its MAC; states once created', async (t) => {
  const ctx = await setup(t);
  const { gladys, fake } = ctx;
  const device = await discovered(gladys, ctx.app);
  assert.equal(device.name, 'madVR Envy AABBCC');
  assert.deepEqual(device.params, [{ name: 'IP_ADDRESS', value: '127.0.0.1' }]);
  const byKey = Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));
  assert.ok(
    device.features.every((f) => f.category !== 'switch'),
    'never a switch',
  );
  assert.deepEqual(
    [byKey.power.category, byKey.power.type, byKey.power.read_only],
    ['unknown', 'binary', true],
  );
  for (const key of ['power_on', 'standby', 'power_off', 'tone_map_on', 'tone_map_off']) {
    assert.deepEqual([byKey[key].category, byKey[key].type], ['button', 'push'], key);
  }
  assert.deepEqual(
    [byKey.temperature_gpu.category, byKey.temperature_gpu.type, byKey.temperature_gpu.unit],
    ['device-temperature-sensor', 'decimal', 'celsius'],
  );
  assert.ok(!byKey.remote_key.supported_options.some((o) => /power/i.test(o.value)));
  assert.equal(gladys.fake.states.length, 0, 'no state before the device is created');

  await createDevice(ctx);
  await waitFor(() => gladys.fake.lastState(id('temperature_gpu')) === 74, 'the temperatures');
  assert.equal(gladys.fake.lastState(id('power')), 1);
  assert.equal(gladys.fake.lastState(id('power_status')), 'On');
  assert.equal(gladys.fake.lastState(id('signal')), 1);
  assert.equal(gladys.fake.lastState(id('hdr')), 1);
  assert.equal(gladys.fake.lastState(id('incoming_resolution')), '3840x2160');
  assert.equal(gladys.fake.lastState(id('incoming_frame_rate')), '23.976p');
  assert.equal(gladys.fake.lastState(id('incoming_dynamic_range')), 'HDR10');
  assert.equal(gladys.fake.lastState(id('incoming_color')), '422 10bit 2020 TV');
  assert.equal(gladys.fake.lastState(id('incoming_aspect')), '16:9');
  assert.equal(gladys.fake.lastState(id('outgoing_resolution')), '3840x2160');
  assert.equal(gladys.fake.lastState(id('aspect_ratio')), '2.40:1 (Panavision)');
  assert.equal(gladys.fake.lastState(id('masking_ratio')), '2.40:1');
  assert.equal(gladys.fake.lastState(id('temperature_mainboard')), 45);
  assert.equal(fake.commands().length, 0, 'reading never sends a command');
  for (const state of gladys.fake.states) {
    assert.ok(state.state !== undefined || state.text !== undefined);
    assert.ok(!Number.isNaN(state.state));
  }
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('no input signal: signal 0, HDR 0, no signal details published', async (t) => {
  const ctx = await setup(t, { fakeOptions: { signal: false } });
  await createDevice(ctx);
  const { gladys } = ctx;
  await waitFor(() => gladys.fake.lastState(id('signal')) === 0, 'no signal');
  assert.equal(gladys.fake.lastState(id('hdr')), 0);
  assert.equal(gladys.fake.lastState(id('incoming_resolution')), undefined);
  assert.equal(gladys.fake.lastState(id('aspect_ratio')), undefined);
  assert.equal(gladys.fake.lastState(id('temperature_cpu')), 41);
});

test('an Envy that stops answering: power 0, "Off or standby", in the status', async (t) => {
  const ctx = await setup(t);
  await createDevice(ctx);
  await ctx.fake.powerOff();
  ctx.advance(31_000);
  await ctx.app.round();
  assert.equal(ctx.gladys.fake.lastState(id('power')), 0);
  assert.equal(ctx.gladys.fake.lastState(id('power_status')), 'Off or standby');
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /Off or standby .*madVR Envy AABBCC/);
});

test('Power on: Wake-on-LAN through Gladys when it does not answer, nothing when it does', async (t) => {
  const ctx = await setup(t);
  const device = await createDevice(ctx);
  const { gladys, fake } = ctx;
  const already = await press(gladys, device, 'power_on');
  assert.equal(already.success, true, already.error);
  assert.equal(wakes(gladys).length, 0, 'it answers: nothing sent');

  await fake.powerOff();
  const ack = await press(gladys, device, 'power_on');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(wakes(gladys)[0], { mac: '00:11:22:aa:bb:cc' });
  // Sent again until it answers, then no more.
  await waitFor(() => wakes(gladys).length >= 2, 'a second Wake-on-LAN');
  await waitFor(() => gladys.fake.lastState(id('power')) === 0, 'seen off');
  await fake.powerOn();
  await waitFor(() => gladys.fake.lastState(id('power')) === 1, 'on again');
  const count = wakes(gladys).length;
  await settle(150);
  assert.equal(wakes(gladys).length, count, 'no Wake-on-LAN once it answers');
});

test('Standby: sent at once, never behind a read; Power off too', async (t) => {
  const ctx = await setup(t, { fakeOptions: { ack: { GetTemperatures: 250 } } });
  const device = await createDevice(ctx);
  const { gladys, fake, app, advance } = ctx;
  const before = fake.received.filter((l) => l === 'GetMaskingRatio').length;
  advance(31_000);
  const reading = app.round();
  await waitFor(
    () => fake.received.filter((l) => l === 'GetMaskingRatio').length > before,
    'a read under way',
  );
  const started = Date.now();
  const ack = await press(gladys, device, 'standby');
  assert.equal(ack.success, true, ack.error);
  assert.ok(Date.now() - started < 240, 'not behind the read');
  assert.deepEqual(fake.commands(), ['Standby']);
  await reading;
  const off = await press(gladys, device, 'power_off');
  assert.equal(off.success, true, off.error);
  assert.deepEqual(fake.commands(), ['Standby', 'PowerOff']);
});

test('Standby when it does not answer: nothing to send, acked', async (t) => {
  const ctx = await setup(t);
  const device = await createDevice(ctx);
  await ctx.fake.powerOff();
  const ack = await press(ctx.gladys, device, 'standby');
  assert.equal(ack.success, true, ack.error);
  assert.ok(ctx.logs.some((l) => /off or standby already/.test(l)));
});

test('Standby cancels the Wake-on-LAN chain and a Power on waiting in the queue', async (t) => {
  let hold;
  let held = false;
  const open = async (options) => {
    if (hold && !held) {
      held = true;
      await hold.promise;
    }
    return openSession(options);
  };
  const ctx = await setup(t, { open });
  const device = await createDevice(ctx);
  const { gladys, fake } = ctx;
  await fake.powerOff();
  // The chain: stopped by standby.
  assert.equal((await press(gladys, device, 'power_on')).success, true);
  const ack = await press(gladys, device, 'standby');
  assert.equal(ack.success, true, ack.error);
  const count = wakes(gladys).length;
  await settle(150);
  assert.equal(wakes(gladys).length, count, 'no Wake-on-LAN after standby');

  // A Power on whose connection is slow, then a standby: the Power on is dropped.
  hold = Promise.withResolvers();
  const on = press(gladys, device, 'power_on');
  await waitFor(() => held, 'the Power on under way');
  assert.equal((await press(gladys, device, 'standby')).success, true);
  hold.resolve();
  const result = await on;
  assert.equal(result.success, false);
  assert.match(result.error, /Cancelled by a standby or power off, nothing sent/);
  assert.equal(wakes(gladys).length, count);
});

test('commands: remote key, profile, tone mapping; validated before anything is sent', async (t) => {
  const ctx = await setup(t);
  const device = await createDevice(ctx);
  const { gladys, fake } = ctx;
  assert.equal((await press(gladys, device, 'remote_key', 'menu')).success, true);
  assert.equal((await press(gladys, device, 'profile', 'source-2')).success, true);
  assert.equal((await press(gladys, device, 'tone_map_off')).success, true);
  assert.deepEqual(fake.commands(), ['KeyPress MENU', 'ActivateProfile SOURCE 2', 'ToneMapOff']);

  const connections = fake.connections;
  for (const [key, value] of [
    ['remote_key', 'POWER'],
    ['remote_key', 'MENU\r\nPowerOff'],
    ['profile', 'source-99'],
    ['power', 1],
    ['incoming_resolution', 'x'],
  ]) {
    const ack = await press(gladys, device, key, value);
    assert.equal(ack.success, false, `${key} ${value}`);
  }
  assert.equal(fake.connections, connections, 'no connection for an invalid command');
});

test('exact outcomes: refused, sent without confirmation, nothing sent', async (t) => {
  const ctx = await setup(t, { fakeOptions: { ack: { KeyPress: 'error', ToneMapOn: 'never' } } });
  const device = await createDevice(ctx);
  const { gladys, fake } = ctx;
  const refused = await press(gladys, device, 'remote_key', 'ok');
  assert.equal(refused.success, false);
  assert.match(refused.error, /refused KeyPress/);
  const silent = await press(gladys, device, 'tone_map_on');
  assert.equal(silent.success, false);
  assert.match(silent.error, /^Sent, without confirmation from the madVR Envy$/);
  await fake.powerOff();
  const off = await press(gladys, device, 'tone_map_off');
  assert.equal(off.success, false);
  assert.match(off.error, /does not answer \(off or standby\), nothing sent/);
});

test('another Envy at the address: refused, nothing sent, the address forgotten', async (t) => {
  const ctx = await setup(t);
  const device = await createDevice(ctx);
  const { gladys, fake } = ctx;
  fake.mac = '00-11-22-DD-EE-FF';
  const ack = await press(gladys, device, 'standby');
  assert.equal(ack.success, false);
  assert.match(ack.error, /another madVR Envy answers at its address, nothing sent/);
  assert.deepEqual(fake.commands(), []);
  assert.equal(gladys.fake.lastState(id('power_status')), 'Off or standby');
  await waitFor(
    () => /Address unknown/.test(gladys.fake.connectionStatus?.message?.en ?? ''),
    'the status',
  );
  // An unreadable MAC is no proof of another Envy.
  fake.mac = 'garbage';
  ctx.app.data.devices[MAC_ID].host = '127.0.0.1';
  assert.equal((await press(gladys, device, 'remote_key', 'up')).success, true);
});

test('never read more often than the interval: rounds, button, reconnection, restart', async (t) => {
  const store = new MemoryStore();
  const ctx = await setup(t, { store });
  await createDevice(ctx);
  const { gladys, fake, app, advance } = ctx;
  const connections = fake.connections;
  await app.round();
  const answer = await app.checkDevices();
  assert.match(answer.en, /next one in \d+ s/);
  await app.start(await gladys.getConfig(), { connected: true });
  await app.start(await gladys.getConfig(), { saved: true });
  assert.equal(fake.connections, connections, 'no read before the interval');
  assert.ok(Number.isFinite(store.data.lastAttempt), 'the attempt time is in /data');

  // A restart: the time in /data holds the reads back (a minute of margin).
  await app.stop();
  const again = new EnvyApp({
    gladys,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    store,
    now: ctx.now,
    timers,
    roundTimers,
    timings: FAST,
  });
  t.after(() => again.stop());
  await again.start(await gladys.getConfig(), { connected: true });
  await again.round();
  assert.equal(fake.connections, connections, 'no read right after a restart');
  advance(95_000);
  await again.round();
  assert.ok(fake.connections > connections, 'read once the interval passed');
});

test('the attempt time is written to /data before the read', async (t) => {
  const fake = await startFakeEnvy();
  const store = new MemoryStore();
  const saves = [];
  const save = store.save.bind(store);
  store.save = async (data) => {
    saves.push({ lastAttempt: data.lastAttempt, connections: fake.connections });
    return save(data);
  };
  const ctx = await setup(t, { fake, store });
  await ctx.app.round();
  const first = saves.find((s) => s.lastAttempt !== undefined);
  assert.ok(first, 'saved');
  assert.equal(first.connections, 0, 'before any connection');
});

test('a read for an older configuration publishes nothing', async (t) => {
  const ctx = await setup(t, { fakeOptions: { ack: { GetTemperatures: 200 } } });
  await createDevice(ctx);
  const { gladys, fake, app, advance } = ctx;
  fake.temperatures = '80 70 50 50';
  const count = () => fake.received.filter((l) => l === 'GetTemperatures').length;
  const before = count();
  advance(31_000);
  const round = app.round();
  await waitFor(() => count() > before, 'a read');
  await app.start({ addresses: `127.0.0.1:${fake.port}`, poll_interval: 60 }, { saved: true });
  await round;
  assert.equal(gladys.fake.lastState(id('temperature_gpu')), 74, 'the late read is dropped');
});

test('hostile answers: a flood or garbage closes the session, nothing published', async (t) => {
  const flood = await setup(t, { fakeOptions: { mode: 'flood' } });
  await flood.app.round();
  assert.equal(flood.gladys.fake.discoveredDevices.length, 0);
  assert.match(flood.gladys.fake.connectionStatus.message.en, /No madVR Envy answers yet/);

  const garbage = await setup(t, { fakeOptions: { mode: 'garbage' } });
  await garbage.app.round();
  assert.equal(garbage.gladys.fake.discoveredDevices.length, 0);
});

test('after a restart, Standby works before the first read (the Envy is in /data)', async (t) => {
  const fake = await startFakeEnvy();
  const store = new MemoryStore({
    devices: { [MAC_ID]: { mac: MAC_ID, host: '127.0.0.1', port: fake.port } },
    lastAttempt: Date.now(),
  });
  const ctx = await setup(t, { fake, store });
  await waitFor(() => ctx.gladys.fake.discoveredDevices.length > 0, 'the Discovery tab');
  const device = ctx.gladys.fake.discoveredDevices.find((d) => d.external_id === id());
  await ctx.gladys.fake.deviceCreated(device);
  assert.equal(fake.connections, 0, 'no read yet');
  const ack = await press(ctx.gladys, device, 'standby');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(fake.commands(), ['Standby']);
});
