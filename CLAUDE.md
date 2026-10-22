# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for madVR Envy video processors
(local IP control protocol, TCP 44077, no password): a Node.js service (Node
22+, ESM, no build step) that runs in its own sandboxed Docker container and
talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
See `TODO.md` for the status and the decisions.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "Standby" # tests whose name matches
npm run cover                             # regenerate cover.png (800×534)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: src/handlers.js registered before connect()
src/handlers.js                   the SDK handlers -> EnvyApp (shared with the tests)
src/app.js                        EnvyApp: known Envy units, rounds, commands, Wake-on-LAN, status
src/envy/client.js                one TCP session: WELCOME, commands, OK / ERROR, bounded lines
src/envy/protocol.js              command lines, answers, remote keys, profiles (pure, ported)
src/model.js                      known Envy units -> Gladys devices and states (pure)
src/budget.js                     state publications: changes only, 300 per minute in all
src/store.js                      /data/madvr.json (Envy units, time of the last read attempt)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/constants.js, src/i18n.js     frozen keys, limits, timings; texts in English and French
scripts/cover.mjs                 cover.png generator (plain Node)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys and a fake Envy (loopback)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the MAC address
  of the Envy (12 lowercase hex digits), never its address or a label. The
  same goes for every key users store: manifest `config_schema`, `actions`,
  feature keys. A device published again carries the full, fixed feature
  list: never remove a feature.
- **No switch.** Power on, Standby and Power off are `button/push`; the power
  state is read only. An "everything off" must never reach an Envy.
- **Protective commands** (Standby, Power off): out of any queue, never behind
  a read, one try, never blocked; they cancel every queued command and a
  Power on in progress (`epochs`, checked at the start and just before the
  line or the Wake-on-LAN leaves). An Envy not answering is acked only when a
  recent read already said so; within the wake window they are refused and
  sent once when it answers (`reaffirms`).
- **Commands**: validated before queueing; the MAC read from the Envy just
  before acting (only a valid, different MAC is another Envy; a MAC not
  answered in time stops the non-protective commands); the deadline
  checked again just before the line leaves; the answer to Gladys within the
  3.5 s budget, never waiting for a publication; exact outcomes: refused,
  "sent, without confirmation", "nothing sent".
- **Never read more often than the interval**: not on `connected`, a save of
  an unchanged configuration, the check button, device creation or a
  restart (`lastAttempt` in `/data`, written before the read, at most once a
  minute). A read for an older configuration (`generation`) publishes nothing.
- **States** go through `StatePublisher` only (300 per minute for the whole
  integration); never `undefined`, `NaN` or an empty text.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. The protocol has no secret; never write that something is
  "encrypted".
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`.
  The catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code: change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only).
- **Encoding.** Every file is UTF-8 without BOM; `test/encoding.test.js`
  refuses mojibake and control bytes.
- **Untrusted input.** Everything the Envy sends is bounded and checked
  against strict patterns; values are mapped through fixed tables.
