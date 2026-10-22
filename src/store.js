// -----------------------------------------------------------------------------
// What the integration keeps across restarts, in /data (the one writable
// volume, file mode 0600): the known Envy units by MAC address (address,
// port), and the time of the last read attempt (written before a read, at
// most once a minute), so a restart never reads sooner than the interval.
// The protocol has no secret: nothing secret is ever stored.
//
// The MAC addresses come from the network: only 12 lowercase hexadecimal
// digits are keys, and the tables have no prototype.
// -----------------------------------------------------------------------------

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LIMITS } from './constants.js';
import { DEFAULT_PORT } from './envy/protocol.js';

export const emptyData = () => ({ devices: Object.create(null), lastAttempt: undefined });

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isMac = (value) => typeof value === 'string' && /^[0-9a-f]{12}$/.test(value);
const HOST = /^[a-z0-9.-]{1,253}$/;

/** `lastAttempt` read back is capped at `now`: a future value never blocks the reads. */
function sanitize(data, { now = Date.now() } = {}) {
  const base = emptyData();
  if (!isObject(data)) {
    return base;
  }
  if (isObject(data.devices)) {
    for (const [mac, device] of Object.entries(data.devices).slice(0, LIMITS.devices * 2)) {
      if (
        Object.keys(base.devices).length >= LIMITS.devices ||
        !isMac(mac) ||
        !isObject(device) ||
        device.mac !== mac
      ) {
        continue;
      }
      base.devices[mac] = {
        mac,
        host: typeof device.host === 'string' && HOST.test(device.host) ? device.host : '',
        port:
          Number.isInteger(device.port) && device.port > 0 && device.port < 65536
            ? device.port
            : DEFAULT_PORT,
      };
    }
  }
  if (Number.isFinite(data.lastAttempt) && data.lastAttempt > 0) {
    base.lastAttempt = Math.min(data.lastAttempt, now);
  }
  return base;
}

export class FileStore {
  constructor({ dir = process.env.DATA_DIR || '/data', name = 'madvr.json' } = {}) {
    this.dir = dir;
    this.path = join(dir, name);
    this.corrupted = false;
  }

  /**
   * The saved data. An unreadable file is moved aside to `madvr.json.bad`
   * and `corrupted` is set, so the app says so instead of silently starting
   * over.
   */
  async load(options) {
    let text;
    try {
      text = await readFile(this.path, 'utf8');
    } catch {
      return emptyData();
    }
    try {
      return sanitize(JSON.parse(text), options);
    } catch {
      this.corrupted = true;
      const bad = `${this.path}.bad`;
      await rename(this.path, bad).catch(() => {});
      await chmod(bad, 0o600).catch(() => {});
      return emptyData();
    }
  }

  async save(data) {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

/** For the tests. */
export class MemoryStore {
  constructor(data = emptyData()) {
    this.data = JSON.parse(JSON.stringify(data));
    this.saves = 0;
    this.corrupted = false;
  }

  async load(options) {
    return sanitize(JSON.parse(JSON.stringify(this.data)), options);
  }

  async save(data) {
    // Through JSON, as the file store: what a restart would read back.
    this.data = JSON.parse(JSON.stringify(data));
    this.saves += 1;
  }
}

export { sanitize as sanitizeData };
