// -----------------------------------------------------------------------------
// The protocol functions (pure): command lines, line splitting, the answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILES,
  REMOTE_KEYS,
  applyLine,
  colonMac,
  commandLine,
  formatRatio,
  isHdr,
  parseAspect,
  parseIncoming,
  parseMac,
  parseTemperatures,
  splitLine,
} from '../src/envy/protocol.js';

test('command lines: words of letters and digits only', () => {
  assert.equal(commandLine(['KeyPress', 'MENU']), 'KeyPress MENU\r\n');
  assert.equal(commandLine(['ActivateProfile', 'CUSTOM', '2']), 'ActivateProfile CUSTOM 2\r\n');
  for (const words of [[], ['KeyPress', 'MENU\r\nPowerOff'], ['Display Message'], [1], 'Standby']) {
    assert.throws(() => commandLine(words));
  }
  assert.ok(!REMOTE_KEYS.some((k) => k.code === 'POWER'), 'no power toggle');
  assert.equal(PROFILES.length, 27);
  assert.deepEqual(PROFILES.find((p) => p.value === 'display-3').words, [
    'ActivateProfile',
    'DISPLAY',
    '3',
  ]);
});

test('splitLine: quoted tokens, printable ASCII only, bounded', () => {
  assert.deepEqual(splitLine('AspectRatio 3840:1600 2.400 240 "Panavision Wide"'), {
    title: 'AspectRatio',
    args: ['3840:1600', '2.400', '240', 'Panavision Wide'],
  });
  assert.deepEqual(splitLine('NoSignal'), { title: 'NoSignal', args: [] });
  assert.equal(splitLine('Temperatures 1\u0000 2'), undefined);
  assert.equal(splitLine('Températures 1'), undefined);
  assert.equal(splitLine(`A ${'1 '.repeat(20)}`), undefined, 'too many tokens');
  assert.equal(splitLine('x'.repeat(600)), undefined);
  assert.equal(splitLine('123 abc'), undefined, 'a title is letters');
  assert.equal(splitLine(''), undefined);
});

test('MAC addresses: 12 hex digits; zero, broadcast and multicast refused', () => {
  assert.equal(parseMac(['00-11-22-AA-BB-CC']), '001122aabbcc');
  assert.equal(parseMac(['00:11:22:aa:bb:cc']), '001122aabbcc');
  assert.equal(parseMac(['00-00-00-00-00-00']), undefined);
  assert.equal(parseMac(['FF-FF-FF-FF-FF-FF']), undefined);
  assert.equal(parseMac(['01-00-5E-00-00-01']), undefined);
  assert.equal(parseMac(['__proto__']), undefined);
  assert.equal(parseMac(undefined), undefined);
  assert.equal(colonMac('001122aabbcc'), '00:11:22:aa:bb:cc');
});

test('signal info: each value checked, unknown ones dropped', () => {
  const incoming = parseIncoming(
    splitLine('IncomingSignalInfo 3840x2160 23.976p 2D 422 10bit HDR10 2020 TV 16:9').args,
  );
  assert.deepEqual(incoming, {
    resolution: '3840x2160',
    frameRate: '23.976p',
    dimension: '2D',
    colorSpace: '422',
    bitDepth: '10bit',
    range: 'HDR10',
    colorimetry: '2020',
    blackLevels: 'TV',
    aspect: '16:9',
  });
  const odd = parseIncoming(['<script>', '60p', '2D', 'RGB', '8bit', 'SDR']);
  assert.equal(odd.resolution, undefined);
  assert.equal(odd.frameRate, '60p');
  assert.equal(parseIncoming(['1']), undefined);
  assert.equal(isHdr('HDR10'), true);
  assert.equal(isHdr('HLG'), true);
  assert.equal(isHdr('SDR'), false);
});

test('ratios and temperatures', () => {
  assert.deepEqual(parseAspect(['3840:1600', '2.400', '240', 'Panavision']), {
    ratio: 2.4,
    name: 'Panavision',
  });
  assert.equal(parseAspect(['3840:1600', 'NaN']), undefined);
  assert.equal(formatRatio({ ratio: 1.778 }), '1.78:1');
  assert.equal(formatRatio(undefined), undefined);
  assert.deepEqual(parseTemperatures(['74', '67', '41', '45']), {
    gpu: 74,
    hdmi: 67,
    cpu: 41,
    mainboard: 45,
  });
  assert.deepEqual(parseTemperatures(['999', 'x', '41', '-5']), {
    gpu: undefined,
    hdmi: undefined,
    cpu: 41,
    mainboard: -5,
  });
});

test('applyLine folds answers and notifications in order', () => {
  const reading = {};
  applyLine(reading, splitLine('IncomingSignalInfo 1920x1080 50i 2D 422 8bit SDR 709 TV 16:9'));
  assert.equal(reading.signal, true);
  applyLine(reading, splitLine('NoSignal'));
  assert.equal(reading.signal, false);
  assert.equal(reading.incoming, undefined);
  applyLine(reading, splitLine('Standby'));
  assert.equal(reading.goingOff, true);
  applyLine(reading, splitLine('Whatever 1 2'));
  applyLine(reading, undefined);
  assert.equal(Object.getPrototypeOf(reading), Object.prototype);
});
