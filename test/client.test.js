// -----------------------------------------------------------------------------
// The TCP session against small hostile servers on the loopback interface.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { ERROR_KINDS, openSession } from '../src/envy/client.js';

async function server(t, onLine, greeting = 'WELCOME to Envy v1.1.3\r\n') {
  const lines = [];
  const s = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.write(greeting);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        lines.push(line);
        onLine(socket, line);
      }
    });
  });
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => s.close(resolve)));
  return { port: s.address().port, lines };
}

const open = (port, deadlineMs = 2_000) =>
  openSession({
    host: '127.0.0.1',
    port,
    deadline: Date.now() + deadlineMs,
    connectTimeout: 300,
    readTimeout: 300,
  });

test('a Get command: OK, then its answer; notifications kept in order', async (t) => {
  const { port } = await server(t, (socket, line) => {
    if (line === 'GetTemperatures') {
      socket.write('OK\r\nActivateProfile SOURCE 1\r\nTemperatures 1 2 3 4\r\n');
    }
  });
  const session = await open(port);
  const answer = await session.command(['GetTemperatures'], { expect: ['Temperatures'] });
  assert.deepEqual(answer, { title: 'Temperatures', args: ['1', '2', '3', '4'] });
  assert.deepEqual(
    session.received.map((r) => r.title),
    ['ActivateProfile', 'Temperatures'],
  );
  session.close();
});

test('ERROR is a refusal, sent, and the session stays usable', async (t) => {
  const { port } = await server(t, (socket, line) => {
    socket.write(line === 'KeyPress MENU' ? 'ERROR "no"\r\n' : 'OK\r\n');
  });
  const session = await open(port);
  await assert.rejects(session.command(['KeyPress', 'MENU']), (err) => {
    return err.kind === ERROR_KINDS.REFUSED && err.sent === true;
  });
  await session.command(['ToneMapOn']);
  session.close();
});

test('M2 (S4) an OK received before the write is never taken for the ack', async (t) => {
  const { port } = await server(t, (socket, line) => {
    if (line === 'GetMacAddress') {
      socket.write('OK\r\nMacAddress 00-11-22-AA-BB-CC\r\nOK\r\n');
    }
    if (line === 'Standby') {
      setTimeout(() => socket.write('ERROR "busy"\r\n'), 100);
    }
  });
  const session = await open(port);
  await session.command(['GetMacAddress'], { expect: ['MacAddress'] });
  await new Promise((resolve) => setTimeout(resolve, 30));
  await assert.rejects(session.command(['Standby']), (err) => err.kind === ERROR_KINDS.REFUSED);
  session.close();
});

test('a line too long closes the session', async (t) => {
  const { port } = await server(t, (socket) => socket.write('OK\r\n' + 'x'.repeat(2_000)));
  const session = await open(port);
  await assert.rejects(session.command(['GetMacAddress'], { expect: ['MacAddress'] }), (err) => {
    return err.kind === ERROR_KINDS.PROTOCOL || err.kind === ERROR_KINDS.CLOSED;
  });
});

test('a flood of lines closes the session', async (t) => {
  const { port } = await server(t, (socket) => socket.write('Noise 1\r\n'.repeat(500)));
  const session = await open(port);
  await assert.rejects(session.command(['GetMacAddress'], { expect: ['MacAddress'] }));
});

test('not a madVR greeting: refused', async (t) => {
  const { port } = await server(t, () => {}, 'PJ_OK');
  await assert.rejects(open(port), (err) => err.kind === ERROR_KINDS.TIMEOUT);
  const other = await server(t, () => {}, 'HELLO\r\n');
  await assert.rejects(open(other.port), (err) => err.kind === ERROR_KINDS.PROTOCOL);
});

test('beforeWrite may stop a command: nothing written', async (t) => {
  const { port, lines } = await server(t, (socket) => socket.write('OK\r\n'));
  const session = await open(port);
  await assert.rejects(
    session.command(['Standby'], {
      beforeWrite: () => {
        throw new Error('cancelled');
      },
    }),
    /cancelled/,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(lines, []);
  session.close();
});

test('no time left: nothing written', async (t) => {
  const { port, lines } = await server(t, (socket) => socket.write('OK\r\n'));
  const session = await open(port, 400);
  await assert.rejects(
    session.command(['Standby'], { until: Date.now() + 10 }),
    (err) => err.kind === ERROR_KINDS.BUDGET && !err.sent,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(lines, []);
  session.close();
});

test('connection refused: unreachable', async () => {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  await assert.rejects(open(port), (err) => err.kind === ERROR_KINDS.UNREACHABLE);
});
