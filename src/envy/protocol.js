// -----------------------------------------------------------------------------
// The madVR Envy IP control protocol (TCP 44077), pure functions: command
// lines, the answers and notifications the Envy sends, the remote keys and
// profiles offered. Ported from py-madvr2 1.9.1 (MIT, pymadvr/commands.py,
// pymadvr/notifications.py, pymadvr/consts.py), see THIRD_PARTY_NOTICES.md.
//
// Every line comes from the network: printable ASCII only, bounded in length
// and number of tokens, split in one linear pass; each value is checked
// against a strict pattern and dropped when it does not match.
// -----------------------------------------------------------------------------

export const DEFAULT_PORT = 44077;
/** Longest line accepted from the Envy (py-madvr reads 1024-byte chunks). */
export const MAX_LINE = 512;
const MAX_TOKENS = 16;

/** Remote keys offered (py-madvr `KeyPress`), without POWER: never a power toggle. */
export const REMOTE_KEYS = Object.freeze(
  [
    ['menu', 'Menu', 'MENU'],
    ['up', 'Up', 'UP'],
    ['down', 'Down', 'DOWN'],
    ['left', 'Left', 'LEFT'],
    ['right', 'Right', 'RIGHT'],
    ['ok', 'OK', 'OK'],
    ['input', 'Input', 'INPUT'],
    ['settings', 'Settings', 'SETTINGS'],
    ['red', 'Red', 'RED'],
    ['green', 'Green', 'GREEN'],
    ['blue', 'Blue', 'BLUE'],
    ['yellow', 'Yellow', 'YELLOW'],
  ].map(([value, label, code]) => Object.freeze({ value, label, code })),
);

/** Profiles offered: the groups of py-madvr (`Profiles`), numbers 1 to 9. */
export const PROFILES = Object.freeze(
  [
    ['source', 'Source', 'SOURCE'],
    ['display', 'Display', 'DISPLAY'],
    ['custom', 'Custom', 'CUSTOM'],
  ].flatMap(([group, label, code]) =>
    Array.from({ length: 9 }, (_, i) =>
      Object.freeze({
        value: `${group}-${i + 1}`,
        label: `${label} profile ${i + 1}`,
        words: Object.freeze(['ActivateProfile', code, String(i + 1)]),
      }),
    ),
  ),
);

const WORD = /^[A-Za-z0-9]{1,32}$/;

/** A command line: words of letters and digits only, CR LF terminated. */
export function commandLine(words) {
  if (!Array.isArray(words) || words.length === 0 || words.length > 4) {
    throw new Error('Invalid command');
  }
  for (const word of words) {
    if (typeof word !== 'string' || !WORD.test(word)) {
      throw new Error('Invalid command word');
    }
  }
  return `${words.join(' ')}\r\n`;
}

/**
 * One line from the Envy (without CR LF) -> { title, args }, or undefined
 * when it is not printable ASCII, too long, or has too many tokens. Quoted
 * tokens ("Panavision") keep their inner spaces. One pass over the line.
 */
export function splitLine(line) {
  if (typeof line !== 'string' || line.length === 0 || line.length > MAX_LINE) {
    return undefined;
  }
  const tokens = [];
  let current = '';
  let quoted = false;
  let inToken = false;
  for (let i = 0; i < line.length; i += 1) {
    const code = line.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      return undefined;
    }
    const char = line[i];
    if (char === '"') {
      quoted = !quoted;
      inToken = true;
    } else if (char === ' ' && !quoted) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
        if (tokens.length > MAX_TOKENS) {
          return undefined;
        }
      }
    } else {
      current += char;
      inToken = true;
    }
  }
  if (inToken) {
    tokens.push(current);
  }
  if (tokens.length === 0 || tokens.length > MAX_TOKENS || !/^[A-Za-z]{1,40}$/.test(tokens[0])) {
    return undefined;
  }
  return { title: tokens[0], args: tokens.slice(1) };
}

const pick = (value, pattern) =>
  typeof value === 'string' && pattern.test(value) ? value : undefined;

/** `MacAddress 01-02-03-04-05-06` -> '010203040506'; zero, broadcast and multicast refused. */
export function parseMac(args) {
  const raw = pick(args?.[0], /^[0-9a-fA-F]{2}(?:[-:][0-9a-fA-F]{2}){5}$/);
  if (!raw) {
    return undefined;
  }
  const mac = raw.replace(/[-:]/g, '').toLowerCase();
  if (mac === '000000000000' || parseInt(mac.slice(0, 2), 16) & 1) {
    return undefined;
  }
  return mac;
}

/** 12 hex digits -> 'aa:bb:cc:dd:ee:ff' (the form Gladys' Wake-on-LAN takes). */
export const colonMac = (mac) => mac.match(/../g).join(':');

const RESOLUTION = /^\d{2,5}x\d{2,5}$/;
const FRAME_RATE = /^\d{1,3}(?:\.\d{1,3})?[pi]$/;
const RANGE = /^[A-Za-z0-9+]{2,12}$/;
const COLOR_SPACE = /^(?:RGB|YCbCr|444|422|420)$/;
const BIT_DEPTH = /^\d{1,2}bit$/;
const COLORIMETRY = /^(?:601|709|2020|DCI|P3|[A-Za-z0-9]{2,8})$/;
const BLACK_LEVELS = /^(?:TV|PC)$/;
const ASPECT = /^\d{1,2}(?:\.\d{1,3})?:\d{1,2}(?:\.\d{1,3})?$/;

/** HDR as py-madvr reads it ("HDR" in the token), plus HLG. */
export const isHdr = (range) => typeof range === 'string' && /HDR|HLG/i.test(range);

/**
 * `IncomingSignalInfo 3840x2160 23.976p 2D 422 10bit HDR10 2020 TV 16:9`:
 * resolution, frame rate, 2D/3D, color space, bit depth, HDR, colorimetry,
 * black levels, aspect ratio (py-madvr `_process_incoming_signal`).
 */
export function parseIncoming(args) {
  if (!Array.isArray(args) || args.length < 6) {
    return undefined;
  }
  return {
    resolution: pick(args[0], RESOLUTION),
    frameRate: pick(args[1], FRAME_RATE),
    dimension: pick(args[2], /^[23]D$/),
    colorSpace: pick(args[3], COLOR_SPACE),
    bitDepth: pick(args[4], BIT_DEPTH),
    range: pick(args[5], RANGE),
    colorimetry: pick(args[6], COLORIMETRY),
    blackLevels: pick(args[7], BLACK_LEVELS),
    aspect: pick(args[8], ASPECT),
  };
}

/** `OutgoingSignalInfo 3840x2160 23.976p 2D RGB 12bit SDR 2020 TV` (py-madvr `_process_outgoing_signal`). */
export function parseOutgoing(args) {
  if (!Array.isArray(args) || args.length < 6) {
    return undefined;
  }
  return {
    resolution: pick(args[0], RESOLUTION),
    frameRate: pick(args[1], FRAME_RATE),
    range: pick(args[5], RANGE),
  };
}

const ratio = (value) => {
  const text = pick(value, /^\d{1,2}\.\d{1,4}$/);
  const number = text === undefined ? NaN : Number(text);
  return Number.isFinite(number) && number > 0.3 && number < 10 ? number : undefined;
};

/** `AspectRatio 3840:1600 2.400 240 "Panavision"` -> { ratio: 2.4, name: 'Panavision' }. */
export function parseAspect(args) {
  const value = ratio(args?.[1]);
  if (value === undefined) {
    return undefined;
  }
  const name = pick(args[3], /^[\w .:+/()-]{1,30}$/);
  return { ratio: value, name };
}

/** `MaskingRatio 3840:1700 2.259 220` -> { ratio: 2.259 }. */
export function parseMasking(args) {
  const value = ratio(args?.[1]);
  return value === undefined ? undefined : { ratio: value };
}

/** `Temperatures 74 67 41 45`: GPU, HDMI, CPU, mainboard, in °C (py-madvr `_process_temperatures`). */
export function parseTemperatures(args) {
  if (!Array.isArray(args) || args.length < 4) {
    return undefined;
  }
  const value = (text) => {
    const raw = pick(text, /^-?\d{1,3}(?:\.\d{1,2})?$/);
    const number = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(number) && number >= -30 && number <= 150 ? number : undefined;
  };
  return {
    gpu: value(args[0]),
    hdmi: value(args[1]),
    cpu: value(args[2]),
    mainboard: value(args[3]),
  };
}

/** A ratio as users read it: 2.4 -> "2.40:1", with its name when given. */
export function formatRatio({ ratio: value, name } = {}) {
  if (value === undefined) {
    return undefined;
  }
  const text = `${value.toFixed(2)}:1`;
  return name ? `${text} (${name})` : text;
}

/**
 * Folds one line (an answer or a notification) into a reading. Unknown
 * titles are ignored. `PowerOff` / `Standby` notifications mark the Envy as
 * going off.
 */
export function applyLine(reading, parsed) {
  if (!parsed) {
    return;
  }
  const { title, args } = parsed;
  switch (title) {
    case 'IncomingSignalInfo': {
      const incoming = parseIncoming(args);
      if (incoming) {
        reading.signal = true;
        reading.incoming = incoming;
      }
      break;
    }
    case 'NoSignal':
      reading.signal = false;
      reading.incoming = undefined;
      break;
    case 'OutgoingSignalInfo': {
      const outgoing = parseOutgoing(args);
      if (outgoing) {
        reading.outgoing = outgoing;
      }
      break;
    }
    case 'AspectRatio':
      reading.aspect = parseAspect(args) ?? reading.aspect;
      break;
    case 'MaskingRatio':
      reading.masking = parseMasking(args) ?? reading.masking;
      break;
    case 'Temperatures':
      reading.temperatures = parseTemperatures(args) ?? reading.temperatures;
      break;
    case 'PowerOff':
    case 'Standby':
      reading.goingOff = true;
      break;
    default:
      break;
  }
}
