// -----------------------------------------------------------------------------
// Every state publication goes through one StatePublisher: Gladys admits 300
// states per minute per integration, for all its devices together. Only
// changed values are sent; when the minute is full, the latest value of each
// feature waits (an older waiting value is replaced, never sent late) and
// goes out as soon as the window frees. Publications made at the same time
// run one after the other, against the same count.
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';

const WINDOW = 60_000;
const valueKey = (state) => JSON.stringify([state.state, state.text]);

export class StatePublisher {
  constructor({
    gladys,
    now = Date.now,
    timers = globalThis,
    logger,
    limit = LIMITS.statesPerMinute,
  }) {
    this.gladys = gladys;
    this.now = now;
    this.timers = timers;
    this.logger = logger;
    this.limit = limit;
    /** Times of the states sent in the last minute (oldest first). */
    this.sent = [];
    /** feature external id -> value key last accepted by Gladys */
    this.last = new Map();
    /** feature external id -> state waiting for room */
    this.pending = new Map();
    this.chain = Promise.resolve();
    this.timer = undefined;
  }

  /** Forgets what was published (all, or the features of one device). */
  forget(deviceExternalId) {
    if (deviceExternalId === undefined) {
      this.last.clear();
      return;
    }
    const prefix = `${deviceExternalId}:`;
    for (const id of [...this.last.keys()]) {
      if (id.startsWith(prefix)) {
        this.last.delete(id);
      }
    }
  }

  stop() {
    this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
  }

  publish(states) {
    for (const state of states) {
      const id = state.device_feature_external_id;
      this.pending.delete(id);
      if (this.last.get(id) !== valueKey(state)) {
        this.pending.set(id, state);
      }
    }
    return this.flush();
  }

  flush() {
    const run = this.chain.then(() => this.flushNow());
    this.chain = run.catch(() => {});
    return run;
  }

  prune() {
    const limit = this.now() - WINDOW;
    let drop = 0;
    while (drop < this.sent.length && this.sent[drop] <= limit) {
      drop += 1;
    }
    if (drop > 0) {
      this.sent.splice(0, drop);
    }
  }

  async flushNow() {
    while (this.pending.size > 0) {
      this.prune();
      const room = Math.min(this.limit - this.sent.length, LIMITS.statesPerRequest);
      if (room <= 0) {
        this.schedule();
        return;
      }
      const batch = [...this.pending.values()].slice(0, room);
      for (const state of batch) {
        this.pending.delete(state.device_feature_external_id);
      }
      const at = this.now();
      for (let i = 0; i < batch.length; i += 1) {
        this.sent.push(at);
      }
      try {
        await this.gladys.publishStates(batch);
        for (const state of batch) {
          this.last.set(state.device_feature_external_id, valueKey(state));
        }
      } catch (err) {
        // Not taken: waiting again, unless a newer value arrived meanwhile.
        for (const state of batch) {
          if (!this.pending.has(state.device_feature_external_id)) {
            this.pending.set(state.device_feature_external_id, state);
          }
        }
        this.schedule();
        throw err;
      }
    }
  }

  schedule() {
    if (this.timer !== undefined) {
      return;
    }
    const wait = this.sent.length > 0 ? this.sent[0] + WINDOW - this.now() + 10 : 1_000;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        this.flush().catch((err) => this.logger?.warn(`Could not publish states: ${err.message}`));
      },
      Math.max(1_000, wait),
    );
  }
}
