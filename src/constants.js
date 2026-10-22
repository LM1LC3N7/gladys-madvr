// -----------------------------------------------------------------------------
// Frozen keys (external ids, features, manifest actions), limits and timings.
// Every key here is stored by Gladys or by its users: never rename one.
// -----------------------------------------------------------------------------

/** `gladys.externalIds(DEVICE_TYPE, <MAC address of the Envy, 12 hex digits>)`. */
export const DEVICE_TYPE = 'envy';

export const FEATURES = Object.freeze({
  /** Read only: 1 when the Envy answers on the network, 0 otherwise. */
  POWER: 'power',
  /** Read only text: On, Off or standby. */
  POWER_STATUS: 'power_status',
  /** Push button: Wake-on-LAN, sent only when the Envy does not answer. */
  POWER_ON: 'power_on',
  /** Push button (protective): `Standby`. */
  STANDBY: 'standby',
  /** Push button (protective): `PowerOff`. */
  POWER_OFF: 'power_off',
  /** Read only: 1 when an input signal is present. */
  SIGNAL: 'signal',
  /** Read only: 1 when the incoming signal is HDR (HDR10, HLG...). */
  HDR: 'hdr',
  INCOMING_RESOLUTION: 'incoming_resolution',
  INCOMING_FRAME_RATE: 'incoming_frame_rate',
  INCOMING_DYNAMIC_RANGE: 'incoming_dynamic_range',
  INCOMING_COLOR: 'incoming_color',
  INCOMING_ASPECT: 'incoming_aspect',
  OUTGOING_RESOLUTION: 'outgoing_resolution',
  OUTGOING_FRAME_RATE: 'outgoing_frame_rate',
  OUTGOING_DYNAMIC_RANGE: 'outgoing_dynamic_range',
  ASPECT_RATIO: 'aspect_ratio',
  MASKING_RATIO: 'masking_ratio',
  TEMPERATURE_GPU: 'temperature_gpu',
  TEMPERATURE_HDMI: 'temperature_hdmi',
  TEMPERATURE_CPU: 'temperature_cpu',
  TEMPERATURE_MAINBOARD: 'temperature_mainboard',
  /** Dropdown: activates a profile (`ActivateProfile <group> <number>`). */
  PROFILE: 'profile',
  /** Push buttons: `ToneMapOn` / `ToneMapOff`. */
  TONE_MAP_ON: 'tone_map_on',
  TONE_MAP_OFF: 'tone_map_off',
  /** Dropdown: one remote control key per selection (`KeyPress <key>`). */
  REMOTE_KEY: 'remote_key',
});

export const ACTIONS = Object.freeze({
  CHECK: 'check_devices',
});

export const POLL_INTERVAL = Object.freeze({ min: 10, max: 300, default: 30 });

export const TIMINGS = Object.freeze({
  /** TCP connection (py-madvr: 1 s for a command connection, 5 s for its notification one). */
  connectTimeout: 2_000,
  /** The WELCOME line, then each answer (py-madvr: 0.5 s on a local network; more margin here). */
  readTimeout: 1_500,
  /**
   * Gladys waits 5 s for the ack of a command: the whole command (wait in the
   * queue, connection, identity check, command) gets `commandBudget`, the
   * identity check `preRead` of it.
   */
  commandBudget: 3_500,
  preRead: 1_200,
  /** One read of one Envy, all its requests included. */
  pollBudget: 8_000,
  /** A typed address where no Envy answered yet is asked again at most this often. */
  probeRetry: 60_000,
  /** After a command, the Envy is read again this much later. */
  recheckDelay: 5_000,
  /** After Wake-on-LAN: the Envy is waited for this long, the packet sent again every `wakeStep`. */
  wakeWait: 120_000,
  wakeStep: 10_000,
  /** The time of the last read attempt is written to /data at most this often. */
  attemptPersist: 60_000,
  /** Writes to /data are grouped. */
  persistDelay: 1_000,
});

export const LIMITS = Object.freeze({
  devices: 10,
  addresses: 10,
  /** Gladys admits 300 states per minute per integration. */
  statesPerMinute: 300,
  statesPerRequest: 100,
  /** Longest text published as a state. */
  text: 60,
});
