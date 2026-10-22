// -----------------------------------------------------------------------------
// Known Envy units -> Gladys devices and states (pure). One Gladys device per
// Envy, keyed by its MAC address (`GetMacAddress`, the address Wake-on-LAN
// needs anyway): the IP address may change, the MAC does not.
//
// Categories and types of the Gladys core only: `button/push` for Power on,
// Standby, Power off and the tone mapping commands, the power state read only
// (`unknown/binary`) — no switch, nothing an "everything on / off" (voice
// assistants, scenes) could turn into a command —, `text/text` for the
// signal details, `text/select` for the profiles and remote keys,
// `device-temperature-sensor/decimal` in `celsius` for the internal
// temperatures (`celsius` is one of the units the core lists for that
// category; the category keeps them out of the room averages).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE, FEATURES, LIMITS } from './constants.js';
import { PROFILES, REMOTE_KEYS, formatRatio, isHdr } from './envy/protocol.js';

const readText = (name) => ({
  name,
  category: C.TEXT,
  type: T.TEXT.TEXT,
  min: 0,
  max: 0,
  read_only: true,
});
const readBinary = (name, extra = {}) => ({
  name,
  category: C.UNKNOWN,
  type: T.SENSOR.BINARY,
  min: 0,
  max: 1,
  read_only: true,
  ...extra,
});
const button = (name) => ({ name, category: C.BUTTON, type: T.BUTTON.PUSH, min: 0, max: 1 });
const temperature = (name) => ({
  name,
  category: C.DEVICE_TEMPERATURE_SENSOR,
  type: T.SENSOR.DECIMAL,
  unit: U.CELSIUS,
  min: -30,
  max: 150,
  read_only: true,
  keep_history: true,
});
const select = (name) => ({ name, category: C.TEXT, type: T.TEXT.SELECT, min: 0, max: 0 });

/** The feature definitions, by frozen key, in their frozen order. */
export const FEATURE_SPECS = Object.freeze({
  [FEATURES.POWER]: readBinary('Power', { keep_history: true }),
  [FEATURES.POWER_STATUS]: readText('Power status'),
  [FEATURES.POWER_ON]: button('Power on (Wake-on-LAN)'),
  [FEATURES.STANDBY]: button('Standby'),
  [FEATURES.POWER_OFF]: button('Power off'),
  [FEATURES.SIGNAL]: readBinary('Input signal', { keep_history: true }),
  [FEATURES.HDR]: readBinary('HDR input', { keep_history: true }),
  [FEATURES.INCOMING_RESOLUTION]: readText('Input resolution'),
  [FEATURES.INCOMING_FRAME_RATE]: readText('Input frame rate'),
  [FEATURES.INCOMING_DYNAMIC_RANGE]: readText('Input dynamic range'),
  [FEATURES.INCOMING_COLOR]: readText('Input color format'),
  [FEATURES.INCOMING_ASPECT]: readText('Input aspect ratio'),
  [FEATURES.OUTGOING_RESOLUTION]: readText('Output resolution'),
  [FEATURES.OUTGOING_FRAME_RATE]: readText('Output frame rate'),
  [FEATURES.OUTGOING_DYNAMIC_RANGE]: readText('Output dynamic range'),
  [FEATURES.ASPECT_RATIO]: readText('Detected aspect ratio'),
  [FEATURES.MASKING_RATIO]: readText('Masking ratio'),
  [FEATURES.TEMPERATURE_GPU]: temperature('GPU temperature'),
  [FEATURES.TEMPERATURE_HDMI]: temperature('HDMI temperature'),
  [FEATURES.TEMPERATURE_CPU]: temperature('CPU temperature'),
  [FEATURES.TEMPERATURE_MAINBOARD]: temperature('Mainboard temperature'),
  [FEATURES.PROFILE]: select('Activate a profile'),
  [FEATURES.TONE_MAP_ON]: button('Tone mapping on'),
  [FEATURES.TONE_MAP_OFF]: button('Tone mapping off'),
  [FEATURES.REMOTE_KEY]: select('Remote key'),
});

export const PROFILE_OPTIONS = Object.freeze(
  PROFILES.map(({ value, label }) => ({ value, label })),
);
export const REMOTE_OPTIONS = Object.freeze(
  REMOTE_KEYS.map(({ value, label }) => ({ value, label })),
);

/** The texts of the "Power status" feature (a text state has one language: English). */
export const POWER_TEXTS = Object.freeze({ on: 'On', off: 'Off or standby' });

export function deviceName(device) {
  return `madVR Envy ${device.mac.slice(6).toUpperCase()}`;
}

export function buildDevice(gladys, device) {
  const ids = gladys.externalIds(DEVICE_TYPE, device.mac);
  const options = {
    [FEATURES.PROFILE]: PROFILE_OPTIONS,
    [FEATURES.REMOTE_KEY]: REMOTE_OPTIONS,
  };
  return {
    name: deviceName(device),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: 'IP_ADDRESS', value: device.host || '' }],
    // Always the full, fixed list: a device published again never loses a feature.
    features: Object.entries(FEATURE_SPECS).map(([key, { name, ...spec }]) => ({
      name,
      external_id: ids.feature(key),
      read_only: false,
      has_feedback: false,
      keep_history: false,
      ...spec,
      ...(options[key] ? { supported_options: options[key].map((o) => ({ ...o })) } : {}),
    })),
  };
}

/** The feature key of a feature external id of `device`, or undefined. */
export function featureKey(deviceExternalId, featureExternalId) {
  const prefix = `${deviceExternalId}:`;
  return String(featureExternalId ?? '').startsWith(prefix)
    ? String(featureExternalId).slice(prefix.length)
    : undefined;
}

const clean = (text) =>
  typeof text === 'string' && text.length > 0 ? text.slice(0, LIMITS.text) : undefined;

/**
 * The states of a reading. `reading` is null for an Envy that does not
 * answer (power 0, "Off or standby"), undefined when nothing is known
 * (nothing published), else what the last read gave. Only values read are
 * published: never an undefined, NaN or empty text.
 */
export function stateList(gladys, device, reading) {
  if (reading === undefined) {
    return [];
  }
  const ids = gladys.externalIds(DEVICE_TYPE, device.mac);
  const states = [];
  const number = (key, value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  };
  const text = (key, value) => {
    const cleaned = clean(value);
    if (cleaned !== undefined) {
      states.push({ device_feature_external_id: ids.feature(key), text: cleaned });
    }
  };
  if (reading === null || reading.goingOff) {
    number(FEATURES.POWER, 0);
    text(FEATURES.POWER_STATUS, POWER_TEXTS.off);
    return states;
  }
  number(FEATURES.POWER, 1);
  text(FEATURES.POWER_STATUS, POWER_TEXTS.on);
  if (typeof reading.signal === 'boolean') {
    number(FEATURES.SIGNAL, reading.signal ? 1 : 0);
  }
  const incoming = reading.signal === true ? reading.incoming : undefined;
  if (reading.signal === false) {
    number(FEATURES.HDR, 0);
  } else if (incoming?.range) {
    number(FEATURES.HDR, isHdr(incoming.range) ? 1 : 0);
  }
  if (incoming) {
    text(FEATURES.INCOMING_RESOLUTION, incoming.resolution);
    text(FEATURES.INCOMING_FRAME_RATE, incoming.frameRate);
    text(FEATURES.INCOMING_DYNAMIC_RANGE, incoming.range);
    const color = [
      incoming.colorSpace,
      incoming.bitDepth,
      incoming.colorimetry,
      incoming.blackLevels,
    ]
      .filter(Boolean)
      .join(' ');
    text(FEATURES.INCOMING_COLOR, color);
    text(FEATURES.INCOMING_ASPECT, incoming.aspect);
  }
  if (reading.signal !== false && reading.outgoing) {
    text(FEATURES.OUTGOING_RESOLUTION, reading.outgoing.resolution);
    text(FEATURES.OUTGOING_FRAME_RATE, reading.outgoing.frameRate);
    text(FEATURES.OUTGOING_DYNAMIC_RANGE, reading.outgoing.range);
  }
  if (reading.signal !== false) {
    text(FEATURES.ASPECT_RATIO, formatRatio(reading.aspect));
    text(FEATURES.MASKING_RATIO, formatRatio(reading.masking));
  }
  const t = reading.temperatures ?? {};
  number(FEATURES.TEMPERATURE_GPU, t.gpu);
  number(FEATURES.TEMPERATURE_HDMI, t.hdmi);
  number(FEATURES.TEMPERATURE_CPU, t.cpu);
  number(FEATURES.TEMPERATURE_MAINBOARD, t.mainboard);
  return states;
}
