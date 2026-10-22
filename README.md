# gladys-madvr

[Gladys Assistant](https://gladysassistant.com) external integration for
**madVR Envy video processors** (Envy Core, Pro, Extreme), on the local
network: power state, input and output signal (resolution, frame rate, HDR),
detected aspect ratio, internal temperatures, Power on (Wake-on-LAN through
Gladys), Standby and Power off (buttons, never a switch), profiles, tone
mapping and remote keys, through the madVR Envy IP control protocol (TCP
44077), without any cloud. Unofficial, not affiliated with madVR Labs.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress.** First milestone, tested against a fake Envy only,
> never with a real madVR Envy.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (EnvyApp)
                                   ├─ src/envy/client.js    one TCP session: WELCOME, commands, OK / ERROR, bounded lines (ported)
                                   ├─ src/envy/protocol.js  command lines, answers, remote keys, profiles (ported, pure)
                                   ├─ src/model.js          known Envy units -> Gladys devices and states (pure)
                                   ├─ src/budget.js         every state publication: changes only, 300 per minute in all
                                   └─ src/store.js          /data/madvr.json: Envy units, time of the last read attempt
```

- **Envy units** are added by IP address (configuration; no network
  discovery). Each one is identified by its MAC address (`GetMacAddress`):
  external id `envy:<mac>`, the address Wake-on-LAN needs anyway.
- **One short session per round and per command**: `WELCOME`, commands acked
  by `OK` (or `ERROR`), `Bye`. No connection is kept open. Each round reads
  the MAC (the address must still be this Envy's), then the incoming and
  outgoing signal, aspect and masking ratios and temperatures.
- **Never more often than the interval**: the check button, a reconnection
  to Gladys, a save of an unchanged configuration and a restart read nothing
  sooner; the time of the last attempt is written to `/data` before the read
  (at most once a minute; a restart then waits that minute more).
  A read started for an older configuration publishes nothing.
- **Commands**: validated first. Standby and Power off are protective: out of
  any queue, never behind a read, one try, they cancel a Power on waiting or
  in progress. The others are serialized per Envy, the MAC read just before,
  within a 3.5 s budget (Gladys acks in 5 s), checked again just before the
  line leaves. Power on is Wake-on-LAN through Gladys (`network_wake`), sent
  only when the Envy does not answer, repeated every 10 s for 2 minutes until
  it does. Outcomes are exact: refused (`ERROR`), "sent, without
  confirmation", or "nothing sent".
- **Features**: `button/push` (power on, standby, power off, tone mapping),
  read-only `unknown/binary` power, signal and HDR, `text/text` signal
  details and ratios, `device-temperature-sensor/decimal` in `celsius`,
  `text/select` profile and remote key. No switch.
- **Bounded input**: lines of 512 bytes at most, 64 waiting and 400 per
  session at most, printable ASCII split in one pass, every value checked
  against a strict pattern; MAC keys only in `/data`, tables without
  prototype.

## Development

```bash
npm install
npm test                                        # node --test, loopback only (fake Envy)
npm run lint && npm run format:check
npm run audit
npm run cover                                   # regenerates cover.png (800×534, no dependency)
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/fakeEnvy.js` is a fake madVR Envy on 127.0.0.1 (WELCOME, OK /
ERROR, the Get answers, notifications, power off as a refused connection,
silent, garbage, flood, late or missing acks). The end-to-end tests run the
real handlers against the SDK's fake Gladys.

## Credits

- [`py-madvr2`](https://github.com/iloveicedgreentea/py-madvr) 1.9.1 by
  iloveicedgreentea (MIT), the library behind the Home Assistant madVR Envy
  integration: the protocol, commands, answers and timeouts are ported from
  it to JavaScript. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- The app structure follows
  [LM1LC3N7/gladys-jvc-projector](https://github.com/LM1LC3N7/gladys-jvc-projector)
  (same author, Apache-2.0).

madVR and Envy are trademarks of their owner (madVR Labs), used here only to
name the compatible products.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release.

## License

Apache-2.0, see [LICENSE](LICENSE). Third-party notices (py-madvr2, MIT):
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
