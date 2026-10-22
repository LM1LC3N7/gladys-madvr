// -----------------------------------------------------------------------------
// One TCP session with a madVR Envy: connection, the WELCOME line, then
// commands one at a time, each acked by `OK` (or refused by `ERROR`), the
// `Get...` ones followed by their answer line. Ported from py-madvr2 1.9.1
// (MIT, pymadvr/madvr.py `_send_command_direct`, pymadvr/simple_pool.py), see
// THIRD_PARTY_NOTICES.md. A session is short: the integration never keeps a
// connection open (no heartbeat needed), and closes it with `Bye`.
//
// Untrusted input: a line longer than 512 bytes, more than 64 lines waiting,
// or more than 400 lines in a session closes it. Every line received
// (answers and notifications) is kept, parsed, in order, for the caller.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { MAX_LINE, commandLine, splitLine } from './protocol.js';

export const ERROR_KINDS = Object.freeze({
  /** Nothing connected: refused, no route, no answer to the TCP connection. */
  UNREACHABLE: 'unreachable',
  /** Connected, then no answer in time. */
  TIMEOUT: 'timeout',
  /** Unexpected bytes, or not a madVR Envy. */
  PROTOCOL: 'protocol',
  /** The Envy answered ERROR. */
  REFUSED: 'refused',
  /** No time left in the budget of the caller (nothing sent). */
  BUDGET: 'budget',
  /** The connection closed under a request. */
  CLOSED: 'closed',
  /** Cancelled by a protective command (nothing sent). */
  CANCELLED: 'cancelled',
});

export class EnvyError extends Error {
  /** `sent`: the command line left, it may have reached the Envy. */
  constructor(kind, message, { sent = false } = {}) {
    super(message);
    this.name = 'EnvyError';
    this.kind = kind;
    this.sent = sent;
  }
}

const MAX_WAITING = 64;
const MAX_LINES = 400;
/** A write needs this much time left before the deadline, else it is not made. */
const WRITE_MARGIN = 50;

export class Session {
  constructor(socket, { readTimeout, deadline, now = Date.now }) {
    this.socket = socket;
    this.readTimeout = readTimeout;
    this.deadline = deadline;
    this.now = now;
    this.partial = '';
    this.lines = [];
    this.count = 0;
    this.pending = undefined;
    this.closed = false;
    this.failure = undefined;
    /** Every parsed line received, answers and notifications, in arrival order. */
    this.received = [];
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', () => this.onClose());
    socket.on('close', () => this.onClose());
    if (socket.destroyed) {
      this.onClose();
    }
  }

  onData(chunk) {
    if (this.closed) {
      return;
    }
    const text = chunk.toString('latin1');
    let start = 0;
    let index;
    while ((index = text.indexOf('\n', start)) !== -1) {
      const piece = text.slice(start, index);
      start = index + 1;
      if (this.partial.length + piece.length > MAX_LINE) {
        this.fail(new EnvyError(ERROR_KINDS.PROTOCOL, 'Line too long from the madVR Envy'));
        return;
      }
      const line = (this.partial + piece).replace(/\r$/, '');
      this.partial = '';
      this.count += 1;
      if (this.count > MAX_LINES || this.lines.length >= MAX_WAITING) {
        this.fail(new EnvyError(ERROR_KINDS.PROTOCOL, 'Too many lines from the madVR Envy'));
        return;
      }
      this.lines.push(line);
    }
    const rest = text.length - start;
    if (this.partial.length + rest > MAX_LINE) {
      this.fail(new EnvyError(ERROR_KINDS.PROTOCOL, 'Line too long from the madVR Envy'));
      return;
    }
    if (rest > 0) {
      this.partial += text.slice(start);
    }
    this.serve();
  }

  onClose() {
    if (!this.closed) {
      this.fail(new EnvyError(ERROR_KINDS.CLOSED, 'The madVR Envy closed the connection'));
    }
  }

  fail(err) {
    this.failure = this.failure ?? err;
    this.destroy();
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
  }

  destroy() {
    if (!this.closed) {
      this.closed = true;
      this.socket.destroy();
    }
  }

  /** Closes the session politely (`Bye`, as py-madvr), never waiting. */
  close() {
    if (!this.closed && !this.failure) {
      try {
        this.socket.end('Bye\r\n');
      } catch {
        // Closed meanwhile: nothing to say goodbye to.
      }
    }
    this.destroy();
  }

  serve() {
    if (this.pending && this.lines.length > 0) {
      const { resolve, timer } = this.pending;
      this.pending = undefined;
      clearTimeout(timer);
      resolve(this.lines.shift());
    }
  }

  /** What is left before `until` (the deadline by default), capped by the read timeout. */
  left(until = this.deadline) {
    return Math.min(this.readTimeout, Math.min(until, this.deadline) - this.now());
  }

  readLine(until, what) {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    if (this.lines.length > 0) {
      return Promise.resolve(this.lines.shift());
    }
    const timeout = this.left(until);
    if (timeout <= 0) {
      return Promise.reject(new EnvyError(ERROR_KINDS.TIMEOUT, `No time left to read ${what}`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new EnvyError(ERROR_KINDS.TIMEOUT, `No ${what} from the madVR Envy in time`));
      }, timeout);
      this.pending = { resolve, reject, timer };
    });
  }

  /** The WELCOME line the Envy sends first. */
  async welcome(until) {
    const line = await this.readLine(until, 'welcome');
    if (!/^WELCOME\b/.test(line)) {
      throw new EnvyError(ERROR_KINDS.PROTOCOL, 'Not a madVR Envy greeting');
    }
  }

  /**
   * Sends one command and waits for its `OK`; with `expect` (titles), then
   * for the answer line, returned parsed. Every line is kept in `received`. `beforeWrite` runs just before the line leaves (it may throw:
   * nothing is then sent). From the write on, every error is `sent`.
   */
  async command(words, { expect, until = this.deadline, beforeWrite } = {}) {
    const line = commandLine(words);
    const end = Math.min(until, this.deadline);
    if (this.failure) {
      throw new EnvyError(this.failure.kind, `${this.failure.message}, nothing sent`);
    }
    if (end - this.now() <= WRITE_MARGIN) {
      throw new EnvyError(ERROR_KINDS.BUDGET, 'No time left for this command, nothing sent');
    }
    beforeWrite?.();
    this.socket.write(line);
    try {
      for (;;) {
        const text = await this.readLine(end, `answer to ${words[0]}`);
        if (text === 'OK') {
          break;
        }
        if (/^ERROR\b/.test(text)) {
          throw new EnvyError(ERROR_KINDS.REFUSED, `The madVR Envy refused ${words[0]}`);
        }
        this.keep(text);
      }
      if (!expect) {
        return undefined;
      }
      for (;;) {
        const parsed = splitLine(await this.readLine(end, `answer to ${words[0]}`));
        if (parsed) {
          this.keepParsed(parsed);
        }
        if (parsed && expect.includes(parsed.title)) {
          return parsed;
        }
      }
    } catch (err) {
      // ERROR is a complete answer; anything else that failed half-way
      // leaves the line out of step: the session is never reused.
      if (err.kind !== ERROR_KINDS.REFUSED) {
        this.fail(err);
      }
      throw new EnvyError(err.kind ?? ERROR_KINDS.PROTOCOL, err.message, { sent: true });
    }
  }

  keep(text) {
    const parsed = splitLine(text);
    if (parsed) {
      this.keepParsed(parsed);
    }
  }

  keepParsed(parsed) {
    if (this.received.length < MAX_LINES) {
      this.received.push(parsed);
    }
  }
}

function connect({ host, port, timeout, createConnection }) {
  return new Promise((resolve, reject) => {
    if (timeout <= 0) {
      reject(new EnvyError(ERROR_KINDS.BUDGET, 'No time left to connect, nothing sent'));
      return;
    }
    const socket = createConnection({ host, port });
    socket.setNoDelay?.(true);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new EnvyError(ERROR_KINDS.UNREACHABLE, `No answer from ${host}:${port}`));
    }, timeout);
    const onError = (err) => {
      clearTimeout(timer);
      socket.destroy();
      reject(
        new EnvyError(
          ERROR_KINDS.UNREACHABLE,
          `Cannot connect to ${host}:${port} (${err.code ?? 'error'})`,
        ),
      );
    };
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.off('error', onError);
      // Until the session listens: an error is never left unhandled.
      socket.on('error', () => {});
      resolve(socket);
    });
    socket.once('error', onError);
  });
}

/**
 * Opens a session: TCP connection then the WELCOME line, before `deadline`.
 * @returns {Promise<Session>}
 */
export async function openSession({
  host,
  port,
  deadline,
  connectTimeout,
  readTimeout,
  now = Date.now,
  createConnection = net.createConnection,
}) {
  const socket = await connect({
    host,
    port,
    timeout: Math.min(connectTimeout, deadline - now()),
    createConnection,
  });
  const session = new Session(socket, { readTimeout, deadline, now });
  try {
    await session.welcome();
  } catch (err) {
    session.destroy();
    throw err;
  }
  return session;
}
