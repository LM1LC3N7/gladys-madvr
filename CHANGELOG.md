# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-23

### Fixed

- A Standby or Power off asked while the Envy starts after Wake-on-LAN is
  sent once it answers only within 1 minute of the request: an Envy turned on
  again later with its remote or front panel is no longer put in standby. The
  docs say that turning it on outside Gladys within that minute does not
  cancel it.
- A Standby or Power off is no longer acked "already off" when the Envy
  opened a connection during the command (its address answering, then
  silent): it is reported "does not answer, nothing sent".

## [0.1.1] - 2026-10-22

### Added

- madVR Envy video processors over their local IP control protocol (TCP
  44077), without any cloud: added by IP address, identified by their MAC
  address.
- Power state (read only) and power status (On, Off or standby), input
  signal, HDR, input and output resolution, frame rate and dynamic range,
  input color format and aspect ratio, detected aspect and masking ratios,
  GPU, HDMI, CPU and mainboard temperatures.
- "Power on" (Wake-on-LAN sent by Gladys, only when the Envy does not answer,
  repeated until it does), "Standby" and "Power off" buttons (no switch),
  profiles, tone mapping on / off and remote keys (never Power).
- Standby and Power off never wait behind a read or a command and cancel the
  commands waiting and a Power on in progress; asked while the Envy starts
  after Wake-on-LAN, they are sent once it answers. A Power on asked right
  after a read found the Envy off goes straight to Wake-on-LAN.
  Every command is checked against the MAC address of the Envy just before it
  leaves, and answered to Gladys within 4 seconds: refused, "sent, without confirmation" or "nothing sent".
- Reads never more often than the refresh interval (30 s by default), even
  after a restart, a reconnection or with the "Check the Envy units" button;
  at most 300 states per minute in all.

### Security

- Answers bounded (512-byte lines, 64 waiting, 400 per session), printable
  ASCII only, every value checked against a strict pattern; only MAC
  addresses are keys in `/data`, and its tables have no prototype.

[Unreleased]: https://github.com/LM1LC3N7/gladys-madvr/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-madvr/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-madvr/releases/tag/v0.1.1
