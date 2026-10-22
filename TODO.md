# TODO — madVR Envy v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only.

## Status

- [x] **Milestone 1 — local control** (2026-10-22): Envy units added by IP
      address, identified by MAC address; one short TCP session per round and
      per command; power state, signal, HDR, input and output signal details,
      aspect and masking ratios, temperatures; Power on (Wake-on-LAN through
      Gladys), Standby, Power off, profiles, tone mapping, remote keys;
      "Check the Envy units" button; docs en/fr. Tested against a fake Envy
      on the loopback interface only, never with a real device. The store
      validator could not be run from the development session (no access to
      it there): to run before the first release.
- [ ] **Milestone 2 — real devices** (testers with an Envy). To check first:
  - whether the Envy keeps TCP 44077 open in standby (today: not answering
    = "Off or standby"), and whether `Standby` / `PowerOff` are acked by
    `OK` before the connection closes;
  - the exact answer of `GetIncomingSignalInfo`, `GetOutgoingSignalInfo` and
    `GetAspectRatio` without a signal (today `NoSignal` is expected, any
    other answer keeps the last values);
  - the profile groups and numbers the `ActivateProfile` command takes on a
    real setup, and a way to read the active profile and the profile names;
  - Wake-on-LAN from Gladys (`network_wake`) on a real network, and the
    broadcast address option;
  - the rendering on the Gladys dashboard (not checked here).
- [ ] **Milestone 3 — more**: active profile (read), profile names, restart /
      reload software (sensitive: button, off by default behind an option),
      on-screen messages, menus, a "forget an Envy" action.
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, then the store validator once the image is published.

## Decisions

- Forum: no dedicated topic, no post from this module's work; one recap per
  wave in /t/10385, posted by the main session.
- Reuse: iloveicedgreentea/py-madvr 1.9.1 (PyPI `py_madvr2`, commit
  `2f961cc` of 2025-12-30, the library of the Home Assistant madVR Envy
  integration; LICENSE file read: MIT, with the copyright line of the
  packaging template, "Copyright (c) 2022 The Python Packaging Authority",
  reproduced as is) is Python (asyncio), so its protocol, commands, answer
  parsing and timeouts are ported to JavaScript (`src/envy/`); MIT notice in
  `THIRD_PARTY_NOTICES.md`, copied into the image. No runtime dependency
  besides the SDK (`node:net`). Neighbour module followed:
  LM1LC3N7/gladys-jvc-projector (read only).
- Version 0.1.0 in `package.json`, `package-lock.json`, the manifest and the
  `docker_image` tag, set by hand at milestone 1: the one exception to
  "versions belong to the Release workflow", because the template's 1.0.0 and
  its image were someone else's. The first patch release gives 0.1.1. The
  manifest test checks only that they agree (semver form), never a fixed
  value.
- External ids: `gladys.externalIds('envy', <mac>)`, the MAC of
  `GetMacAddress` as 12 lowercase hex digits (fixed rule; the device name is
  "madVR Envy" + its last 6 hex digits), never the address. Zero, broadcast
  and multicast MACs are no identity. Feature keys are frozen: `power`,
  `power_status`, `power_on`, `standby`, `power_off`, `signal`, `hdr`,
  `incoming_resolution`, `incoming_frame_rate`, `incoming_dynamic_range`,
  `incoming_color`, `incoming_aspect`, `outgoing_resolution`,
  `outgoing_frame_rate`, `outgoing_dynamic_range`, `aspect_ratio`,
  `masking_ratio`, `temperature_gpu`, `temperature_hdmi`, `temperature_cpu`,
  `temperature_mainboard`, `profile`, `tone_map_on`, `tone_map_off`,
  `remote_key`. Every publication carries the full, fixed list.
- **Power: read-only state + `button/push`, not a `switch`** (lesson of lot
  6): an "everything off / on" must never reach an Envy. `power` is
  `unknown/binary`: 1 when a session opens (WELCOME), 0 when the connection
  fails ("Off or standby", the two cannot be told apart). A `PowerOff` /
  `Standby` notification seen during a read also gives 0.
- Power on: Wake-on-LAN through `gladys.wakeOnLan` (manifest
  `network_wake: true`; a bridge container cannot broadcast on the LAN),
  sent only when the Envy does not answer at the read made just before;
  acked once the packet is emitted (Gladys confirms the emission, not the
  wake-up), then sent again every 10 s and the Envy read until it answers
  (2 minutes at most). A 403 says in the status that Gladys refused it.
  Restart / ReloadSoftware are not offered in v1.
- Standby / Power off: protective. Never queued, never behind a read (the
  Envy accepts several connections, py-madvr uses several), one try, even
  while another command waits. They bump a per-Envy epoch: a Power on
  queued or in progress checks it just before Wake-on-LAN and is dropped
  ("Cancelled by a standby or power off, nothing sent"), and the Wake-on-LAN
  chain stops. An Envy that does not answer is already off or in standby:
  nothing sent, acked as a success (logged). The MAC is read first: another
  valid MAC refuses (nothing sent, address forgotten); an unread one does not
  block (the command goes in a new session, time allowing). No automatic
  re-sending of a standby (no reaffirmation chain to keep).
- Other commands (profile `ActivateProfile <SOURCE|DISPLAY|CUSTOM> <1..9>`,
  `ToneMapOn` / `ToneMapOff`, `KeyPress <key>` without POWER): validated
  before queueing (no connection for an invalid one), serialized per Envy,
  budget 3.5 s from the Gladys request (wait in the queue included), the MAC
  read just before (an unread MAC refuses them: nothing sent), the deadline
  checked again just before the line leaves. `OK` = done, `ERROR` = refused
  (exact message), no answer in time = "Sent, without confirmation from the
  madVR Envy". There is no readable value to confirm them against (the Envy
  reports no tone mapping state, the profile is not read in v1): the `OK` is
  the confirmation. The Envy is read again 5 s after each command.
- Sessions: one per read and per command, closed with `Bye` (no heartbeat
  needed, nothing kept open); connection 2 s, each answer 1.5 s (py-madvr:
  1 s / 0.5 s on a local network, more margin here).
- Reads: `poll_interval` 10..300 s (30 by default), one round at a time (a
  round asked during another shares it; a reconnection never starts one).
  Never more often than the interval: not on `connected` (devices, states
  from memory and status republished, caches cleared), a save of an
  unchanged configuration (`configKey`), the check button (it reads only
  when the interval passed, else answers from memory with the time of the
  next read), device creation (states from memory). `lastAttempt` is written
  to `/data` before the read, at most once a minute; after a restart the
  next read waits for that time + one minute + the interval. A changed
  configuration bumps `generation`: a read started before publishes nothing
  and sets no status; new typed addresses are probed at once (never asked
  before). Typed addresses without a known Envy: every minute at most.
- Each read: `GetMacAddress` first (only a valid, different MAC is another
  Envy: the old one loses its address, the new one is remembered), then
  `GetIncomingSignalInfo`, `GetOutgoingSignalInfo`, `GetAspectRatio`,
  `GetMaskingRatio`, `GetTemperatures`; every line received (answers and
  notifications) folded in arrival order. A secondary request that fails
  never drops the power state; an unknown outcome (timeout, garbage) keeps
  what was known.
- States: through `StatePublisher` only: changed values only, at most 300
  per minute for the whole integration (simultaneous publications counted
  together); beyond, the latest value of each feature waits for room. Never
  `undefined`, `NaN` or an empty text; texts of 60 characters at most.
  No `publishSceneEvent`.
- Units: `celsius` for `device-temperature-sensor` (in
  `DEVICE_FEATURE_UNITS_BY_CATEGORY`; the category keeps them out of room
  averages); no unit for `button`, `unknown`, `text`. Store category
  `multimedia`. No energy index.
- No secret: the protocol has no password; the manifest has no `secret`
  field. Nothing personal in `/data` (MAC and IP of the Envy, attempt time).
- Hostile input: lines of 512 bytes at most, 64 waiting, 400 per session
  (else the session is closed), printable ASCII split in one linear pass,
  16 tokens at most, every value matched against a strict pattern;
  `/data` keys are MAC addresses only, tables without prototype; a future
  `lastAttempt` is capped at now.
- No network discovery: the Envy announces nothing py-madvr or Home Assistant
  browses; the addresses are typed. No Bluetooth.
