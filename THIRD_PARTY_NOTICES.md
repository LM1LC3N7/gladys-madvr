# Third-party notices

This integration ports to JavaScript the logic of the following project: the
madVR Envy IP control protocol as it implements it (TCP 44077, the `WELCOME`
greeting, `OK` / `ERROR` acks, the command names and their parameters, the
remote keys and profile groups, the answers and notifications
`IncomingSignalInfo`, `OutgoingSignalInfo`, `AspectRatio`, `MaskingRatio`,
`Temperatures`, `MacAddress`, `NoSignal`, `PowerOff`, `Standby`, and how their
values are read), its timeouts, the use of Wake-on-LAN to power the Envy on,
and the list of the reads made when it is on (`src/envy/`). Nothing of it is
installed at runtime; its notice is reproduced below.

## py-madvr2 1.9.1

<https://github.com/iloveicedgreentea/py-madvr> (the library behind the Home
Assistant madVR Envy integration), version 1.9.1 of 2025-12-30 (commit
`2f961cc4e4a443fc9a62c3318ea640a4ea40c060`). Its LICENSE file is the MIT
License with the copyright line of the packaging template it started from,
reproduced as is:

```
Copyright (c) 2022 The Python Packaging Authority

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## LM1LC3N7/gladys-jvc-projector

The structure of the app, the `/data` store, the command queue and budget,
the identity check by MAC address and the handler wiring follow this
integration of the same author, under the Apache License 2.0 of this
repository.
