// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form. The protocol has
// no password: the configuration holds no secret.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { LIMITS, POLL_INTERVAL } from './constants.js';
import { DEFAULT_PORT } from './envy/protocol.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  addresses: '',
  poll_interval: POLL_INTERVAL.default,
  wake_broadcast: '',
};

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * The address of an Envy typed by the user: an IPv4 address or a host name,
 * with an optional port (44077 by default).
 * @returns {{ host: string, port: number } | undefined} undefined when invalid or empty.
 */
export function parseAddress(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(/^(?:tcp|https?):\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
  if (text === '' || text.length > 260) {
    return undefined;
  }
  const match = text.match(/^([^:]+)(?::(\d{1,5}))?$/);
  if (!match) {
    return undefined;
  }
  const host = match[1];
  const port = match[2] === undefined ? DEFAULT_PORT : Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || host.length > 253) {
    return undefined;
  }
  if (isIP(host) === 4) {
    return { host, port };
  }
  if (/^[\d.]+$/.test(host)) {
    return undefined;
  }
  return host.split('.').every((label) => LABEL.test(label)) ? { host, port } : undefined;
}

export const addressKey = ({ host, port }) => (port === DEFAULT_PORT ? host : `${host}:${port}`);

/** The refresh interval in seconds; anything unreadable gives the default. */
export function parsePollInterval(raw) {
  const value = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
  if (raw === null || raw === undefined || typeof raw === 'boolean' || !Number.isFinite(value)) {
    return POLL_INTERVAL.default;
  }
  return Math.min(POLL_INTERVAL.max, Math.max(POLL_INTERVAL.min, Math.round(value)));
}

/** The Wake-on-LAN broadcast address: an IPv4 address, or none. */
export function parseWakeAddress(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { wakeAddress: undefined, wakeAddressInvalid: false };
  }
  return isIP(text) === 4
    ? { wakeAddress: text, wakeAddressInvalid: false }
    : { wakeAddress: undefined, wakeAddressInvalid: true };
}

export function normalizeConfig(raw = {}) {
  const c = {
    ...DEFAULT_CONFIG,
    ...Object.fromEntries(Object.entries(raw ?? {}).filter(([, v]) => v != null)),
  };
  const addresses = [];
  const invalid = [];
  for (const entry of String(c.addresses ?? '')
    .split(/[\s,;]+/)
    .filter((e) => e !== '')) {
    const address = parseAddress(entry);
    if (!address) {
      invalid.push(entry.slice(0, 100));
    } else if (
      !addresses.some((a) => addressKey(a) === addressKey(address)) &&
      addresses.length < LIMITS.addresses
    ) {
      addresses.push(address);
    }
  }
  return {
    addresses,
    invalid,
    pollInterval: parsePollInterval(c.poll_interval),
    ...parseWakeAddress(c.wake_broadcast),
  };
}

/** What changes the reads: a save without any change of it starts nothing. */
export const configKey = (config) =>
  JSON.stringify([config.addresses.map(addressKey), config.pollInterval, config.wakeAddress]);
