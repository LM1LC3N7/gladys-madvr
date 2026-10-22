// -----------------------------------------------------------------------------
// The integration: the madVR Envy units it knows (typed addresses, identified
// by their MAC address), the Gladys devices built from them, the reads (one
// short TCP session per Envy and round, never more often than the interval,
// even across restarts), the commands, and the "Check the Envy units" button.
// index.js only wires the SDK handlers to it (src/handlers.js).
//
// Standby and Power off are the protective commands: push buttons, never a
// switch, never queued nor behind a read, never blocked; they cancel a Power
// on (Wake-on-LAN) waiting or in progress. The other commands are serialized
// per Envy, checked against its MAC address just before they leave, each
// within the 5 s Gladys waits for its ack.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { StatePublisher } from './budget.js';
import { addressKey, configKey, normalizeConfig } from './config.js';
import { DEVICE_TYPE, FEATURES, LIMITS, TIMINGS } from './constants.js';
import { ERROR_KINDS, EnvyError, openSession as defaultOpenSession } from './envy/client.js';
import { PROFILES, REMOTE_KEYS, applyLine, colonMac, parseMac } from './envy/protocol.js';
import { T } from './i18n.js';
import { buildDevice, deviceName, featureKey, stateList } from './model.js';
import { FileStore, emptyData, isMac } from './store.js';

const NOTHING_SENT = 'nothing sent';
const SENT_UNCONFIRMED = 'Sent, without confirmation from the madVR Envy';
const short = (value) => String(value).slice(0, 32);

/** The protective commands: out of any queue, never blocked. */
const PROTECTIVE = new Map([
  [FEATURES.STANDBY, ['Standby']],
  [FEATURES.POWER_OFF, ['PowerOff']],
]);
const SIMPLE = new Map([
  [FEATURES.TONE_MAP_ON, ['ToneMapOn']],
  [FEATURES.TONE_MAP_OFF, ['ToneMapOff']],
]);

/** What a read asks, and the titles answering it (py-madvr `_get_initial_device_info`). */
const READS = [
  ['GetIncomingSignalInfo', ['IncomingSignalInfo', 'NoSignal']],
  ['GetOutgoingSignalInfo', ['OutgoingSignalInfo', 'NoSignal']],
  ['GetAspectRatio', ['AspectRatio', 'NoSignal']],
  ['GetMaskingRatio', ['MaskingRatio']],
  ['GetTemperatures', ['Temperatures']],
];

/** Queue priorities: the commands, then the background reads. */
const PRIORITY = Object.freeze({ COMMAND: 0, BACKGROUND: 1 });

/** An error with the exact outcome: refused, sent without confirmation, or nothing sent. */
function outcome(err) {
  if (err?.sent && err.kind === ERROR_KINDS.REFUSED) {
    return err;
  }
  if (err?.sent) {
    return new EnvyError(ERROR_KINDS.TIMEOUT, SENT_UNCONFIRMED, { sent: true });
  }
  const message = String(err?.message ?? err);
  return message.includes(NOTHING_SENT)
    ? err
    : new EnvyError(err?.kind ?? ERROR_KINDS.PROTOCOL, `${message}, ${NOTHING_SENT}`);
}

export class EnvyApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'madvr' }),
    store = new FileStore(),
    now = Date.now,
    timers = globalThis,
    roundTimers = timers,
    timings = TIMINGS,
    openSession = defaultOpenSession,
    createConnection,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.store = store;
    this.now = now;
    this.timers = timers;
    this.roundTimers = roundTimers;
    this.timings = timings;
    this.openSessionImpl = openSession;
    this.createConnection = createConnection;
    this.publisher = new StatePublisher({ gladys, now, timers, logger });
    this.config = normalizeConfig();
    this.configLoaded = false;
    this.data = undefined;
    this.loading = undefined;
    /** mac -> null (not answering) | undefined (unknown) | reading */
    this.readings = new Map();
    /** queue key -> { running, items } */
    this.queues = new Map();
    /** macs of the devices created in Gladys */
    this.created = new Set();
    this.createdStale = false;
    /** addressKey -> time of the last probe of a typed address */
    this.probes = new Map();
    /** addressKey -> kind of the last probe failure */
    this.probeErrors = new Map();
    /** macs with a background read queued */
    this.readQueued = new Set();
    /** mac -> { until, epoch, timer }: a Power on waiting for the Envy to answer */
    this.wakes = new Map();
    /** mac -> count of protective commands: a Power on started before one is cancelled */
    this.epochs = new Map();
    /** Time of the last read attempt (memory), and of the one written to /data. */
    this.lastAttempt = undefined;
    this.attemptSavedAt = undefined;
    this.wakeRefused = false;
    this.backgroundTimers = new Set();
    this.generation = 0;
    this.roundTimer = undefined;
    this.persistTimer = undefined;
    this.polling = undefined;
    this.lastStatus = undefined;
    this.warned = new Set();
    this.started = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * (Re)start with a configuration: on every connection to Gladys
   * (`connected`) and on every configuration save (`saved`). Neither reads an
   * Envy sooner than the interval: the devices, states (from memory) and
   * status are published again, and the next round keeps its time. A save
   * that changes the configuration drops the reads under way (generation)
   * and probes the new addresses at once (never asked before).
   */
  async start(raw = {}, { connected = false } = {}) {
    const next = normalizeConfig(raw);
    const changed = this.configLoaded && configKey(next) !== configKey(this.config);
    const before = new Set(this.config.addresses.map(addressKey));
    this.config = next;
    this.configLoaded = true;
    this.started = true;
    if (changed) {
      this.generation += 1;
    }
    if (connected) {
      // The core forgot what was published: everything again.
      this.lastStatus = undefined;
      this.publisher.forget();
    }
    if (!this.data) {
      // Two starts at once (connected + configuration saved) share one load.
      this.loading ??= this.load();
      await this.loading;
    }
    await this.step('read the Gladys devices', () => this.refreshCreated());
    await this.step('publish the devices', () => this.publishDevices());
    await this.step('publish the states', () => this.publishAllStates());
    await this.step('publish the status', () => this.updateStatus());
    if (changed) {
      const added = next.addresses.map(addressKey).filter((key) => !before.has(key));
      if (added.length > 0) {
        await this.step('probe the new addresses', async () => {
          if (await this.probeAddresses(this.generation, { keys: added })) {
            await this.publishDevices();
          }
          await this.updateStatus();
        });
      }
    }
    this.schedule();
  }

  async load() {
    let data;
    try {
      data = await this.store.load({ now: this.now() });
    } catch {
      data = emptyData();
    }
    if (this.store.corrupted) {
      this.logger.warn('Unreadable /data/madvr.json moved to madvr.json.bad');
    }
    this.data = data;
    if (Number.isFinite(data.lastAttempt)) {
      // Written at most once a minute: the true last attempt may be up to
      // that much later. The next read waits for the worst case.
      this.attemptSavedAt = data.lastAttempt;
      this.lastAttempt = data.lastAttempt + this.timings.attemptPersist;
    }
  }

  async step(name, task) {
    try {
      await task();
    } catch (err) {
      this.logger.warn(`Start: could not ${name}: ${err.message}`);
    }
  }

  stop() {
    this.started = false;
    this.generation += 1;
    this.roundTimers.clearTimeout(this.roundTimer);
    this.roundTimer = undefined;
    for (const handle of this.backgroundTimers) {
      this.timers.clearTimeout(handle);
    }
    this.backgroundTimers.clear();
    this.wakes.clear();
    this.publisher.stop();
    if (this.persistTimer) {
      this.timers.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
      return this.store.save(this.data).catch(() => {});
    }
    return Promise.resolve();
  }

  /** The earliest time of the next read: never sooner than the interval. */
  nextAllowed() {
    return this.lastAttempt === undefined
      ? -Infinity
      : this.lastAttempt + this.config.pollInterval * 1000;
  }

  schedule() {
    if (!this.started) {
      return;
    }
    this.roundTimers.clearTimeout(this.roundTimer);
    const wait = Math.max(0, this.nextAllowed() - this.now());
    this.roundTimer = this.roundTimers.setTimeout(() => {
      this.roundTimer = undefined;
      this.round().catch((err) => this.logger.warn(`Reading failed: ${err.message}`));
    }, wait);
  }

  /**
   * One round: the typed addresses, then every known Envy. One at a time:
   * a round asked while another runs shares it.
   */
  round() {
    if (this.polling) {
      return this.polling;
    }
    if (!this.started || !this.data) {
      return Promise.resolve();
    }
    if (this.now() < this.nextAllowed()) {
      this.schedule();
      return Promise.resolve();
    }
    this.polling = this.runRound().finally(() => {
      this.polling = undefined;
      this.schedule();
    });
    return this.polling;
  }

  async runRound() {
    const generation = this.generation;
    await this.markAttempt();
    if (this.createdStale) {
      await this.step('read the Gladys devices', () => this.refreshCreated());
    }
    const changed = await this.probeAddresses(generation);
    if (generation !== this.generation) {
      return;
    }
    if (changed) {
      await this.step('publish the devices', () => this.publishDevices());
    }
    await Promise.all(this.devices.filter((d) => d.host).map((d) => this.queueRead(d, generation)));
    await this.updateStatus(generation);
  }

  /** The attempt time, written to /data before the read (at most once a minute). */
  async markAttempt() {
    const now = this.now();
    this.lastAttempt = now;
    if (
      this.attemptSavedAt === undefined ||
      now - this.attemptSavedAt >= this.timings.attemptPersist
    ) {
      this.attemptSavedAt = now;
      this.data.lastAttempt = now;
      await this.saveNow();
    }
  }

  async saveNow() {
    if (this.persistTimer) {
      this.timers.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    try {
      await this.store.save(this.data);
    } catch (err) {
      this.logger.warn(`Could not save /data: ${err.message}`);
    }
  }

  /** Background work, cancelled by stop(). */
  later(task, ms) {
    const generation = this.generation;
    const handle = this.timers.setTimeout(() => {
      this.backgroundTimers.delete(handle);
      if (generation === this.generation) {
        Promise.resolve()
          .then(task)
          .catch((err) => this.logger.debug?.(`Background task failed: ${err.message}`));
      }
    }, ms);
    this.backgroundTimers.add(handle);
  }

  persist() {
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = this.timers.setTimeout(() => {
      this.persistTimer = undefined;
      this.store
        .save(this.data)
        .catch((err) => this.logger.warn(`Could not save /data: ${err.message}`));
    }, this.timings.persistDelay);
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  /** The queue of one Envy: commands first, then the background reads. */
  enqueue(key, task, priority) {
    let queue = this.queues.get(key);
    if (!queue) {
      queue = { running: false, items: [] };
      this.queues.set(key, queue);
    }
    return new Promise((resolve, reject) => {
      const item = { task, resolve, reject, priority };
      const index = queue.items.findIndex((i) => i.priority > priority);
      queue.items.splice(index === -1 ? queue.items.length : index, 0, item);
      this.drain(queue);
    });
  }

  async drain(queue) {
    if (queue.running) {
      return;
    }
    queue.running = true;
    while (queue.items.length > 0) {
      const item = queue.items.shift();
      try {
        item.resolve(await item.task());
      } catch (err) {
        item.reject(err);
      }
    }
    queue.running = false;
  }

  /** One session with the Envy at `address`, closed at the end. */
  async withSession(address, deadline, task) {
    const session = await this.open(address, deadline);
    try {
      return await task(session);
    } finally {
      session.close();
    }
  }

  open(address, deadline) {
    return this.openSessionImpl({
      host: address.host,
      port: address.port,
      deadline,
      connectTimeout: this.timings.connectTimeout,
      readTimeout: this.timings.readTimeout,
      now: this.now,
      createConnection: this.createConnection,
    });
  }

  // --- Known Envy units ----------------------------------------------------------

  get devices() {
    return Object.values(this.data?.devices ?? {});
  }

  deviceOf(gladysDevice) {
    return this.devices.find(
      (d) => this.gladys.externalIds(DEVICE_TYPE, d.mac).device === gladysDevice?.external_id,
    );
  }

  addressOf(device) {
    return { host: device.host, port: device.port };
  }

  /**
   * Remembers the Envy answering at `address` by its MAC. Another one that
   * had this address lost it (DHCP): never commanded at an address that is
   * no longer its own.
   */
  remember(mac, address) {
    if (!isMac(mac)) {
      return undefined;
    }
    const table = this.data.devices;
    let device = Object.hasOwn(table, mac) ? table[mac] : undefined;
    if (!device) {
      if (Object.keys(table).length >= LIMITS.devices) {
        this.warnOnce(
          'devices',
          `More than ${LIMITS.devices} Envy units: the next ones are ignored`,
        );
        return undefined;
      }
      device = { mac, host: '', port: address.port };
      table[mac] = device;
      this.persist();
    }
    for (const other of this.devices) {
      if (other.mac !== mac && other.host === address.host && other.port === address.port) {
        this.addressLost(other, address);
      }
    }
    if (device.host !== address.host || device.port !== address.port) {
      device.host = address.host;
      device.port = address.port;
      this.persist();
    }
    return device;
  }

  /** Its address went to another Envy (DHCP): never read nor commanded there again. */
  addressLost(device, address) {
    this.logger.warn(`${deviceName(device)}: another Envy answers at ${addressKey(address)}`);
    device.host = '';
    this.readings.set(device.mac, null);
    this.wakes.delete(device.mac);
    this.persist();
    // When it is a typed address, it is identified again at the next round.
    this.probes.delete(addressKey(address));
    this.publishStates(device).catch(() => {});
  }

  async publishDevices() {
    if (!this.data) {
      return;
    }
    await this.gladys.publishDiscoveredDevices(
      this.devices.map((d) => buildDevice(this.gladys, d)),
    );
  }

  /**
   * The devices created in Gladys. When `getDevices` fails, the list the SDK
   * keeps (`gladys.devices`) is used, and the call is made again at every
   * round until it works.
   */
  async refreshCreated() {
    let list;
    try {
      list = await this.gladys.getDevices();
      this.createdStale = false;
    } catch (err) {
      this.createdStale = true;
      if (!Array.isArray(this.gladys.devices)) {
        throw err;
      }
      this.logger.warn(`Could not read the Gladys devices (${err.message}): using the last list`);
      list = this.gladys.devices;
    }
    const byExternalId = new Map(
      this.devices.map((d) => [this.gladys.externalIds(DEVICE_TYPE, d.mac).device, d.mac]),
    );
    this.created = new Set(
      (Array.isArray(list) ? list : [])
        .map((d) => byExternalId.get(d?.external_id))
        .filter(Boolean),
    );
  }

  // --- Identification -----------------------------------------------------------------

  /** The MAC of the Envy at `address` (one short session). */
  identify(address) {
    return this.enqueue(
      `address:${addressKey(address)}`,
      () =>
        this.withSession(address, this.now() + this.timings.pollBudget, async (session) => {
          const line = await session.command(['GetMacAddress'], { expect: ['MacAddress'] });
          const mac = parseMac(line?.args);
          if (!mac) {
            throw new EnvyError(ERROR_KINDS.PROTOCOL, 'MAC address unreadable');
          }
          return mac;
        }),
      PRIORITY.BACKGROUND,
    );
  }

  /**
   * The typed addresses where no known Envy is: at each round, every minute
   * at most (`keys`: only those, at once, after a configuration change).
   */
  async probeAddresses(generation, { keys } = {}) {
    let changed = false;
    const spacing = Math.max(this.timings.probeRetry, this.config.pollInterval * 1000);
    await Promise.all(
      this.config.addresses.map(async (address) => {
        const key = addressKey(address);
        if (keys && !keys.includes(key)) {
          return;
        }
        if (this.devices.some((d) => d.host && addressKey(this.addressOf(d)) === key)) {
          this.probeErrors.delete(key);
          return;
        }
        const last = this.probes.get(key) ?? -Infinity;
        if (!keys && this.now() - last < spacing) {
          return;
        }
        this.probes.set(key, this.now());
        try {
          const mac = await this.identify(address);
          if (generation !== this.generation) {
            return;
          }
          const device = this.remember(mac, address);
          this.probeErrors.delete(key);
          if (device) {
            changed = true;
            this.logger.info(`${deviceName(device)} found at ${key}`);
          }
        } catch (err) {
          if (generation === this.generation) {
            this.probeErrors.set(key, err.kind ?? ERROR_KINDS.PROTOCOL);
          }
          this.logger.debug?.(`${key}: ${err.message}`);
        }
      }),
    );
    return changed;
  }

  // --- Reads ---------------------------------------------------------------------------

  /** One background read of an Envy; one at most waiting per Envy. */
  queueRead(device, generation = this.generation) {
    if (this.readQueued.has(device.mac)) {
      return Promise.resolve();
    }
    this.readQueued.add(device.mac);
    return this.enqueue(
      device.mac,
      () => {
        this.readQueued.delete(device.mac);
        return this.readDevice(device, generation);
      },
      PRIORITY.BACKGROUND,
    ).catch((err) => this.logger.debug?.(`${deviceName(device)}: ${err.message}`));
  }

  async soft(task) {
    try {
      return await task();
    } catch {
      return undefined;
    }
  }

  /**
   * Reads an Envy (from its queue): its MAC first (the address must still be
   * its own; only a valid, different MAC proves another Envy), then the
   * signal, aspect, masking and temperatures. A secondary request that fails
   * never drops the power state. A read made for an older configuration
   * publishes nothing.
   */
  async readDevice(device, generation) {
    if (!device.host) {
      return null;
    }
    const address = this.addressOf(device);
    let other;
    let reading;
    try {
      reading = await this.withSession(
        address,
        this.now() + this.timings.pollBudget,
        async (session) => {
          const line = await this.soft(() =>
            session.command(['GetMacAddress'], { expect: ['MacAddress'] }),
          );
          const mac = parseMac(line?.args);
          if (mac && mac !== device.mac) {
            other = mac;
            return null;
          }
          if (!mac) {
            this.warnOnce(
              `mac:${device.mac}`,
              `${deviceName(device)}: MAC address not readable, its identity not checked then`,
            );
          }
          for (const [words, expect] of READS) {
            await this.soft(() => session.command([words], { expect }));
          }
          const result = { power: 'on' };
          for (const parsed of session.received) {
            applyLine(result, parsed);
          }
          return result;
        },
      );
    } catch (err) {
      reading = err.kind === ERROR_KINDS.UNREACHABLE ? null : undefined;
      if (reading === undefined) {
        this.logger.debug?.(`${deviceName(device)}: ${err.message}`);
      }
    }
    if (generation !== this.generation) {
      return undefined;
    }
    if (other) {
      this.addressLost(device, address);
      if (this.remember(other, address)) {
        await this.step('publish the devices', () => this.publishDevices());
      }
      reading = null;
    }
    // An unknown answer keeps what was known.
    if (reading !== undefined) {
      this.readings.set(device.mac, reading);
    }
    await this.publishStates(device);
    this.followWake(device, reading);
    return reading;
  }

  async publishStates(device) {
    if (!this.created.has(device.mac)) {
      return;
    }
    const states = stateList(this.gladys, device, this.readings.get(device.mac));
    if (states.length === 0) {
      return;
    }
    try {
      await this.publisher.publish(states);
    } catch (err) {
      this.logger.warn(`Could not publish the states of ${deviceName(device)}: ${err.message}`);
    }
  }

  async publishAllStates() {
    for (const device of this.devices) {
      await this.publishStates(device);
    }
  }

  recheck(device) {
    this.later(() => this.queueRead(device), this.timings.recheckDelay);
  }

  // --- Power on (Wake-on-LAN) ------------------------------------------------------------

  async sendWake(device) {
    const options = this.config.wakeAddress ? { address: this.config.wakeAddress } : undefined;
    try {
      await this.gladys.wakeOnLan(colonMac(device.mac), options);
    } catch (err) {
      if (err?.status === 403 && !this.wakeRefused) {
        this.wakeRefused = true;
        this.updateStatus().catch(() => {});
      }
      throw err;
    }
    if (this.wakeRefused) {
      this.wakeRefused = false;
      this.updateStatus().catch(() => {});
    }
  }

  /**
   * After each read: a Power on waiting is done (the Envy answers), sent
   * again (every `wakeStep`, until `wakeWait`), or dropped (cancelled by a
   * protective command, or too late).
   */
  followWake(device, reading) {
    const entry = this.wakes.get(device.mac);
    if (!entry) {
      return;
    }
    if (reading && !reading.goingOff) {
      this.wakes.delete(device.mac);
      this.logger.info(`${deviceName(device)} answers after Wake-on-LAN`);
      return;
    }
    if ((this.epochs.get(device.mac) ?? 0) !== entry.epoch) {
      this.wakes.delete(device.mac);
      return;
    }
    if (this.now() > entry.until) {
      this.wakes.delete(device.mac);
      this.logger.warn(`${deviceName(device)} did not answer after Wake-on-LAN`);
      return;
    }
    if (entry.timer) {
      return;
    }
    entry.timer = true;
    this.later(async () => {
      entry.timer = false;
      if (
        this.wakes.get(device.mac) !== entry ||
        (this.epochs.get(device.mac) ?? 0) !== entry.epoch
      ) {
        return;
      }
      await this.sendWake(device).catch((err) =>
        this.logger.debug?.(`${deviceName(device)}: Wake-on-LAN not sent (${err.message})`),
      );
      await this.queueRead(device);
    }, this.timings.wakeStep);
  }

  // --- Commands --------------------------------------------------------------------

  /** Validates a command before anything is queued or sent. */
  validate(key, value) {
    if (PROTECTIVE.has(key)) {
      return { kind: 'protective', words: PROTECTIVE.get(key) };
    }
    if (key === FEATURES.POWER_ON) {
      return { kind: 'power_on' };
    }
    if (SIMPLE.has(key)) {
      return { kind: 'command', words: SIMPLE.get(key) };
    }
    if (key === FEATURES.PROFILE) {
      const profile = PROFILES.find((p) => p.value === value);
      if (!profile) {
        throw new Error(`Unknown profile "${short(value)}"`);
      }
      return { kind: 'command', words: profile.words };
    }
    if (key === FEATURES.REMOTE_KEY) {
      const remote = REMOTE_KEYS.find((k) => k.value === value);
      if (!remote) {
        throw new Error(`Unknown remote key "${short(value)}"`);
      }
      return { kind: 'command', words: ['KeyPress', remote.code] };
    }
    throw new Error(`Feature "${short(key)}" cannot be commanded`);
  }

  remaining(started) {
    return this.timings.commandBudget - (this.now() - started);
  }

  async setValue(gladysDevice, feature, value) {
    const device = this.deviceOf(gladysDevice);
    if (!device) {
      throw new Error(`Unknown madVR Envy ${short(gladysDevice?.external_id)}`);
    }
    const key = featureKey(gladysDevice.external_id, feature?.external_id);
    const action = this.validate(key, value);
    // The budget runs from the request of Gladys, the wait in the queue included.
    const started = this.now();
    // `mayHaveSent` is set just before a command line (or the Wake-on-LAN
    // request) leaves: from then on it may have reached the Envy.
    const context = { mayHaveSent: false, late: false };
    let run;
    if (action.kind === 'protective') {
      run = this.protective(device, action.words, started, context).catch((err) => {
        throw outcome(err);
      });
    } else {
      const epoch = this.epochs.get(device.mac) ?? 0;
      run = this.enqueue(
        device.mac,
        async () => {
          if (context.late || this.remaining(started) < 50) {
            // Gladys stopped waiting while this command was queued: dropped, never sent late.
            context.late = true;
            throw new EnvyError(
              ERROR_KINDS.BUDGET,
              `No time left for this command, ${NOTHING_SENT}`,
            );
          }
          try {
            return await this.command(device, action, started, context, epoch);
          } catch (err) {
            throw outcome(err);
          }
        },
        PRIORITY.COMMAND,
      );
    }
    // Wall-clock deadline (not the injectable timers): the ack Gladys waits
    // for never waits for a publication.
    let timer;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => {
          context.late = true;
          reject(
            context.mayHaveSent
              ? new EnvyError(ERROR_KINDS.TIMEOUT, SENT_UNCONFIRMED, { sent: true })
              : new EnvyError(
                  ERROR_KINDS.BUDGET,
                  `No time left for this command (madVR Envy busy), ${NOTHING_SENT}`,
                ),
          );
        },
        Math.max(0, this.remaining(started)) + 100,
      );
    });
    run.catch(() => {});
    try {
      return await Promise.race([run, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The MAC read just before acting: another valid MAC refuses, nothing sent. */
  async checkIdentity(session, device, until) {
    let line;
    try {
      line = await session.command(['GetMacAddress'], { expect: ['MacAddress'], until });
    } catch (err) {
      if (err.kind === ERROR_KINDS.REFUSED) {
        return 'unknown';
      }
      return 'unread';
    }
    const mac = parseMac(line?.args);
    if (mac && mac !== device.mac) {
      this.addressLost(device, this.addressOf(device));
      this.updateStatus().catch(() => {});
      const err = new EnvyError(
        ERROR_KINDS.PROTOCOL,
        `${deviceName(device)}: another madVR Envy answers at its address, ${NOTHING_SENT}`,
      );
      err.lost = true;
      throw err;
    }
    return mac ? 'same' : 'unknown';
  }

  /**
   * Standby / Power off: out of the queue, never behind a read, one try.
   * They cancel any Power on waiting or in progress. An Envy that does not
   * answer is already off or in standby: nothing to send. The identity is
   * checked first; when it cannot be read, the command is still sent (in a
   * new session if that one broke), time allowing.
   */
  async protective(device, words, started, context) {
    this.epochs.set(device.mac, (this.epochs.get(device.mac) ?? 0) + 1);
    this.wakes.delete(device.mac);
    const name = deviceName(device);
    if (!device.host) {
      throw new EnvyError(
        ERROR_KINDS.UNREACHABLE,
        `${name}: address unknown, type its new address in the configuration, ${NOTHING_SENT}`,
      );
    }
    const address = this.addressOf(device);
    const deadline = started + this.timings.commandBudget;
    let session;
    try {
      session = await this.open(address, deadline);
    } catch (err) {
      if (err.kind === ERROR_KINDS.UNREACHABLE) {
        this.logger.info(
          `${name} does not answer (off or standby already): ${words[0]} not needed`,
        );
        return undefined;
      }
      throw err;
    }
    try {
      const until = Math.min(deadline, this.now() + this.timings.preRead);
      const identity = await this.checkIdentity(session, device, until);
      if (identity === 'unread') {
        session.close();
        session = await this.open(address, deadline);
      }
      await session.command(words, {
        until: deadline,
        beforeWrite: () => {
          context.mayHaveSent = true;
        },
      });
    } finally {
      session.close();
      this.recheck(device);
    }
    this.logger.info(`${name}: ${words[0]} sent`);
    return undefined;
  }

  async command(device, action, started, context, epoch) {
    const name = deviceName(device);
    if (!device.host) {
      throw new EnvyError(
        ERROR_KINDS.UNREACHABLE,
        `${name}: address unknown, type its new address in the configuration`,
      );
    }
    const deadline = started + this.timings.commandBudget;
    let session;
    try {
      session = await this.open(this.addressOf(device), deadline);
    } catch (err) {
      if (err.kind !== ERROR_KINDS.UNREACHABLE) {
        throw err;
      }
      if (action.kind === 'power_on') {
        return this.wake(device, started, context, epoch);
      }
      throw new EnvyError(ERROR_KINDS.UNREACHABLE, `${name} does not answer (off or standby)`);
    }
    try {
      const until = Math.min(deadline, this.now() + this.timings.preRead);
      const identity = await this.checkIdentity(session, device, until);
      if (action.kind === 'power_on') {
        // It answers: already on, nothing to send.
        return undefined;
      }
      if (identity === 'unread') {
        throw new EnvyError(ERROR_KINDS.TIMEOUT, `${name}: identity not checked in time`);
      }
      await session.command(action.words, {
        until: deadline,
        beforeWrite: () => {
          context.mayHaveSent = true;
        },
      });
    } finally {
      session.close();
    }
    this.recheck(device);
    return undefined;
  }

  /** Power on when the Envy does not answer: Wake-on-LAN, unless a protective command came. */
  async wake(device, started, context, epoch) {
    if ((this.epochs.get(device.mac) ?? 0) !== epoch) {
      throw new EnvyError(
        ERROR_KINDS.CANCELLED,
        `Cancelled by a standby or power off, ${NOTHING_SENT}`,
      );
    }
    if (context.late || this.remaining(started) < 50) {
      throw new EnvyError(ERROR_KINDS.BUDGET, `No time left for this command, ${NOTHING_SENT}`);
    }
    context.mayHaveSent = true;
    try {
      await this.sendWake(device);
    } catch (err) {
      context.mayHaveSent = false;
      throw new EnvyError(
        ERROR_KINDS.PROTOCOL,
        `Wake-on-LAN not sent (${err?.status ?? err?.message}), ${NOTHING_SENT}`,
      );
    }
    this.logger.info(`${deviceName(device)}: Wake-on-LAN sent`);
    this.wakes.set(device.mac, {
      until: this.now() + this.timings.wakeWait,
      epoch,
      timer: false,
    });
    this.followWake(device, undefined);
    return undefined;
  }

  // --- Device lifecycle --------------------------------------------------------------

  async deviceCreated(gladysDevice) {
    const device = this.deviceOf(gladysDevice);
    if (!device) {
      return;
    }
    this.created.add(device.mac);
    // Gladys forgot the states of this device: everything again, from memory
    // (never a read sooner than the interval).
    this.publisher.forget(this.gladys.externalIds(DEVICE_TYPE, device.mac).device);
    await this.publishStates(device);
    await this.updateStatus();
  }

  async deviceDeleted(gladysDevice) {
    const device = this.deviceOf(gladysDevice);
    if (device) {
      this.created.delete(device.mac);
      this.wakes.delete(device.mac);
      await this.updateStatus();
    }
  }

  // --- Configuration screen button -------------------------------------------------

  /**
   * Reads now only when the interval allows it (the round shares one under
   * way); otherwise answers what the last read gave and when the next is.
   */
  async checkDevices() {
    if (this.devices.length === 0 && this.config.addresses.length === 0) {
      return T.noDevice;
    }
    if (this.now() >= this.nextAllowed()) {
      await this.round();
    }
    const wait = Math.ceil(Math.max(0, this.nextAllowed() - this.now()) / 1000);
    const lines = this.devices.map((d) =>
      T.checkLine(
        `${deviceName(d)} (${d.host ? addressKey(this.addressOf(d)) : '?'})`,
        this.readings.get(d.mac),
      ),
    );
    if (lines.length === 0) {
      return T.noDevice;
    }
    return T.check(lines, this.config.pollInterval, this.polling ? 0 : wait);
  }

  // --- Status ---------------------------------------------------------------------

  async updateStatus(generation = this.generation) {
    if (!this.started || !this.data || generation !== this.generation) {
      return;
    }
    const notes = [];
    if (this.store.corrupted) {
      notes.push(T.dataReset);
    }
    if (this.config.invalid.length > 0) {
      notes.push(T.invalidEntries(this.config.invalid));
    }
    if (this.config.wakeAddressInvalid) {
      notes.push(T.invalidWakeAddress);
    }
    if (this.wakeRefused) {
      notes.push(T.wakeRefused);
    }
    const silent = this.config.addresses
      .map(addressKey)
      .filter(
        (key) =>
          !this.devices.some((d) => d.host && addressKey(this.addressOf(d)) === key) &&
          this.probeErrors.has(key),
      );
    if (silent.length > 0) {
      notes.push(T.noAnswerAt(silent));
    }
    const lost = this.devices.filter((d) => this.created.has(d.mac) && !d.host);
    if (lost.length > 0) {
      notes.push(T.addressUnknown(lost.map(deviceName)));
    }
    const off = this.devices
      .filter((d) => this.created.has(d.mac) && d.host && this.readings.get(d.mac) === null)
      .map(deviceName);
    if (off.length > 0) {
      notes.push(T.unreachable(off));
    }
    // A local integration: "connected" means running.
    const status = { connected: true };
    if (notes.length > 0) {
      status.message = {
        en: notes.map((n) => n.en).join(' '),
        fr: notes.map((n) => n.fr).join(' '),
      };
    }
    const key = JSON.stringify(status);
    if (key === this.lastStatus) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.lastStatus = generation === this.generation ? key : undefined;
    } catch (err) {
      this.logger.warn(`Could not publish the status: ${err.message}`);
    }
  }
}
