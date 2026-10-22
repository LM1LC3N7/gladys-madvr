// -----------------------------------------------------------------------------
// A fake madVR Envy on 127.0.0.1: the WELCOME line, `OK` / `ERROR` acks, the
// `Get...` answers, the commands recorded, a power state (off = connection
// refused, by closing the listening socket), and the misbehaviours the tests
// need (silent, garbage, flood, late or missing acks, notifications).
// -----------------------------------------------------------------------------

import net from 'node:net';

export const MAC = '00-11-22-AA-BB-CC';
export const MAC_ID = '001122aabbcc';

export async function startFakeEnvy(options = {}) {
  const fake = {
    mac: options.mac ?? MAC,
    signal: options.signal ?? true,
    incoming: options.incoming ?? '3840x2160 23.976p 2D 422 10bit HDR10 2020 TV 16:9',
    outgoing: options.outgoing ?? '3840x2160 23.976p 2D RGB 12bit HDR10 2020 PC',
    aspect: options.aspect ?? '3840:1600 2.400 240 "Panavision"',
    masking: options.masking ?? '3840:1600 2.400 240',
    temperatures: options.temperatures ?? '74 67 41 45',
    /** 'ok' | 'silent' (no WELCOME) | 'garbage' | 'flood' */
    mode: options.mode ?? 'ok',
    /** command -> 'never' | 'error' | ms: how the OK of a command comes */
    ack: options.ack ?? {},
    /** Lines sent before the answer of every Get (notifications). */
    notes: options.notes ?? [],
    /** Every command line received. */
    received: [],
    connections: 0,
    sockets: new Set(),
  };

  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  function answer(command) {
    switch (command) {
      case 'GetMacAddress':
        return `MacAddress ${fake.mac}`;
      case 'GetIncomingSignalInfo':
        return fake.signal ? `IncomingSignalInfo ${fake.incoming}` : 'NoSignal';
      case 'GetOutgoingSignalInfo':
        return fake.signal ? `OutgoingSignalInfo ${fake.outgoing}` : 'NoSignal';
      case 'GetAspectRatio':
        return fake.signal ? `AspectRatio ${fake.aspect}` : 'NoSignal';
      case 'GetMaskingRatio':
        return `MaskingRatio ${fake.masking}`;
      case 'GetTemperatures':
        return `Temperatures ${fake.temperatures}`;
      default:
        return undefined;
    }
  }

  function onConnection(socket) {
    fake.connections += 1;
    fake.sockets.add(socket);
    socket.on('close', () => fake.sockets.delete(socket));
    socket.on('error', () => {});
    if (fake.mode === 'silent') {
      return;
    }
    if (fake.mode === 'garbage') {
      socket.write('HELLO THERE\r\n');
      return;
    }
    if (fake.mode === 'flood') {
      socket.write(`WELCOME to Envy v1.1.3\r\n${'x'.repeat(4096)}`);
      return;
    }
    socket.write('WELCOME to Envy v1.1.3\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (line === 'Bye' || line === '') {
          continue;
        }
        fake.received.push(line);
        const command = line.split(' ')[0];
        const how = fake.ack[command] ?? fake.ack[line];
        if (how === 'never') {
          continue;
        }
        if (how === 'error') {
          socket.write('ERROR "not possible"\r\n');
          continue;
        }
        const reply = () => {
          if (socket.destroyed) {
            return;
          }
          socket.write('OK\r\n');
          const data = answer(command);
          if (data !== undefined) {
            for (const note of fake.notes) {
              socket.write(`${note}\r\n`);
            }
            socket.write(`${data}\r\n`);
          }
          if (command === 'Standby' || command === 'PowerOff') {
            socket.write(`${command}\r\n`);
          }
        };
        if (typeof how === 'number') {
          later(reply, how);
        } else {
          reply();
        }
      }
    });
  }

  let server;
  const listen = async (port = 0) => {
    server = net.createServer(onConnection);
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    fake.port = server.address().port;
  };
  await listen();

  /** Off: the port refuses connections. */
  fake.powerOff = () =>
    new Promise((resolve) => {
      for (const socket of fake.sockets) {
        socket.destroy();
      }
      server.close(() => resolve());
    });
  /** On again, at the same port. */
  fake.powerOn = () => listen(fake.port);
  fake.commands = () => fake.received.filter((l) => !l.startsWith('Get'));
  fake.close = () =>
    new Promise((resolve) => {
      for (const t of timers) {
        clearTimeout(t);
      }
      for (const socket of fake.sockets) {
        socket.destroy();
      }
      if (server.listening) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  return fake;
}
