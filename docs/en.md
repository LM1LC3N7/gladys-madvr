# madVR Envy for Gladys

Follow and control your **madVR Envy** video processors (Envy Core, Pro,
Extreme) from Gladys, locally, without any cloud: power state, input and
output signal (resolution, frame rate, HDR), detected aspect ratio, internal
temperatures, power on, standby, power off, profiles, tone mapping and remote
keys.

> **Important.** This integration has never been tested with a real
> device: it was written from the `py-madvr2` library (the one of Home
> Assistant) and tested against a fake Envy only. Your feedback is welcome.
> Unofficial integration, not affiliated with madVR Labs.

## Installation

1. Connect the Envy to your network and give it a **fixed IP address** in your
   router (reserved DHCP lease).
2. Turn the Envy on: it listens on the network (TCP port 44077) only when on.
3. In Gladys, install the **madVR Envy** integration and accept the
   **Wake-on-LAN** permission (Gladys sends the wake packet on your network
   itself).
4. Open its configuration and type the IP addresses, separated by commas (for
   example `192.168.1.60`; port 44077 by default, another one as
   `192.168.1.60:44078`).
5. The Envy appears in the **Discovery** tab: create it.

The first time, the Envy must be on: the integration reads its MAC address,
which identifies it from then on (and is used for Wake-on-LAN); its IP
address may change: type the new one.

## What you get

| Feature                                  | Gladys type               | Note                                                    |
| ---------------------------------------- | ------------------------- | ------------------------------------------------------- |
| Power                                    | binary state (read only)  | 1 when the Envy answers, 0 otherwise (off or standby)   |
| Power status                             | text (read only)          | On, Off or standby                                      |
| Power on (Wake-on-LAN)                   | button                    | sent only when the Envy does not answer                 |
| Standby, Power off                       | buttons                   | never blocked, see below                                |
| Input signal, HDR input                  | binary states (read only) | HDR: HDR10, HLG...                                      |
| Input resolution, rate, range, color, AR | texts (read only)         | for example 3840x2160, 23.976p, HDR10, 422 10bit, 16:9  |
| Output resolution, frame rate, range     | texts (read only)         |                                                         |
| Detected aspect ratio, masking ratio     | texts (read only)         | for example 2.40:1 (Panavision)                         |
| GPU, HDMI, CPU, mainboard temperatures   | device temperature, °C    | kept out of the room averages                           |
| Activate a profile                       | dropdown                  | Source, Display or Custom profiles 1 to 9               |
| Tone mapping on / off                    | buttons                   |                                                         |
| Remote key                               | dropdown                  | Menu, arrows, OK, Input, Settings, colors (never Power) |

On purpose, no **switch**: an "everything off" or "everything on" from a voice
assistant or a scene never turns your Envy on or off. Use the buttons in your
scenes.

## Commands

- **Standby** and **Power off** are the protective commands: they leave at
  once, without waiting for a read or another command, in a single try. They
  cancel every command in progress or waiting (Power on and its repeated
  Wake-on-LAN included): nothing queued leaves after them. When the Envy
  does not answer:
  - within 2 minutes of a Wake-on-LAN (it may be starting): the command is
    refused "does not answer yet: Standby will be sent once it answers,
    nothing sent yet", and the integration sends it once, as soon as the Envy
    answers, within 1 minute of the request (and the 2 minutes of the
    Wake-on-LAN). A new Power on from Gladys drops it; turning the Envy on with
    its remote or front panel does not: if you do it within that minute, the
    Envy may be put in standby as soon as it answers;
  - otherwise: it succeeds (nothing to send) only when the last read, made
    within the refresh interval, already found the Envy not answering; else
    it is refused "does not answer, nothing sent".
- **Power on** reads the Envy first: when it answers, nothing is sent;
  otherwise Gladys sends a Wake-on-LAN packet to its MAC address, then again
  every 10 seconds for 2 minutes, until it answers. When the read that just
  ended (5 seconds at most) found it not answering, or its address is
  unknown, Wake-on-LAN goes at once (only the MAC is needed). When Gladys
  answers "too many requests", the packet is asked once more 2 seconds later;
  when Gladys does not answer or fails, the command is reported "Wake-on-LAN
  maybe sent, without confirmation from Gladys" and the repeats go on.
- **Profile**, **tone mapping** and **remote key** are sent only when the
  Envy answers.

Before each command, the integration reads the MAC address of the Envy again:
when another Envy answers at that IP address, nothing is sent and the address
is forgotten. A MAC address answered but unreadable (or refused with `ERROR`)
does not count as another device: the command goes. A MAC address not
answered in time stops a profile, tone mapping or key command ("nothing
sent"), but never Standby nor Power off (sent in a new connection). A read
whose MAC address is not answered publishes nothing and keeps the known
values.

Every command is answered within 4 seconds (Gladys waits 5 seconds). A
command that left without a confirmation from the Envy in time is reported
"sent, without confirmation"; a command the Envy refused (`ERROR`) is
reported refused; a command that could not leave is reported "nothing sent".
The Envy is read again 5 seconds after the last of a series of commands, and
not at all when nothing left.

## Configuration button

- **Check the Envy units**: reads each Envy when the refresh interval has
  passed, otherwise shows the last read and when the next one comes.

## Refresh, status and limits

- Each Envy is read every 30 seconds by default (10 to 300), in one short
  connection closed at once. Never more often: neither a reconnection to
  Gladys, a save of an unchanged configuration, the button, nor a restart of
  the container (the time of the last attempt is kept in `/data`) reads
  sooner.
- An Envy that does not answer shows power 0 and "Off or standby", and is
  listed in the status of the integration.
- When another Envy answers at the address of a created one (address
  changed), that one also shows power 0 and "Off or standby": an assumption
  (it may be on at its new address), until you type its new address.
- Gladys admits 300 states per minute per integration: only the values that
  change are sent, and beyond that, the latest value of each feature waits
  for the next minute.

## Data and privacy

The integration keeps in `/data/madvr.json` the known Envy units (MAC address,
IP address, port) and the time of the last read. The protocol has no
password: no secret is asked nor kept. Nothing leaves your local network.

## Known limits

- The Envy answers only when on: off or in standby, the integration cannot
  tell them apart ("Off or standby").
- The active profile is not read yet; the profiles offered are the numbers 1
  to 9 of each group, without their names.
- No restart, on-screen message or menus yet.
- Never tested with a real device: the real answers may differ.
