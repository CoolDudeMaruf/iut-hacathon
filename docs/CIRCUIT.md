# Hardware / Electrical Schematic (concept)

This is a **simulation/concept only** — no real hardware is required for the
demo, and the running system uses simulated data. This document gives you
everything needed to build a physically-sensible schematic yourself in
**Wokwi** or **Tinkercad**. (A representative circuit for **one room** — 2 fans
+ 3 lights = 5 devices — is enough; the other two rooms are identical copies.)

## Design goal

A microcontroller must (a) **know the ON/OFF state** of each light and fan and
(b) **optionally sense current draw** so the backend can report real power. We
use an **ESP32** because it has Wi-Fi to reach the backend API, plenty of GPIO,
and multiple ADC channels.

Two things happen per device:

- **Control / actuation** — an MCU GPIO drives a **relay** that switches mains
  to the device. This is how the boss can turn things on/off remotely.
- **State sensing** — so the reported state stays correct even if someone flips
  a physical wall switch, each device's live wire passes an **opto-isolated AC
  detector** (e.g. a PC817 through a dropping resistor, or an off-the-shelf
  "AC detection" module) whose output is a clean digital HIGH/LOW into a GPIO.
- **Current sensing (optional)** — one **ACS712** hall-effect sensor on the
  room's mains feed gives total room current → the ADC → power in watts.

## Bill of materials (one room)

| Qty | Part | Purpose |
|----:|------|---------|
| 1 | ESP32 DevKit v1 | controller + Wi-Fi |
| 1 | 5-channel relay module (opto-isolated, 5 V) | switch the 5 devices |
| 5 | Opto AC-detect module (PC817 based) | sense true ON/OFF per device |
| 1 | ACS712 (20 A/30 A) current sensor | measure room current draw |
| 2 | Fans (mains AC) | the 2 fans |
| 3 | Lights (mains AC) | the 3 lights |
| — | 5 V supply, jumper wires | power + wiring |

## Pin mapping (ESP32 → peripherals)

Chosen to avoid the ESP32 boot/strapping pins (GPIO0, 2, 5, 12, 15) and to use
input-only ADC1 pins for analog sensing (ADC2 is unavailable while Wi-Fi is on).

| ESP32 GPIO | Direction | Connects to | Represents |
|-----------:|-----------|-------------|------------|
| GPIO13 | OUT | Relay IN1 | **Fan 1** control |
| GPIO14 | OUT | Relay IN2 | **Fan 2** control |
| GPIO27 | OUT | Relay IN3 | **Light 1** control |
| GPIO26 | OUT | Relay IN4 | **Light 2** control |
| GPIO25 | OUT | Relay IN5 | **Light 3** control |
| GPIO32 | IN (pull-down) | Opto-detect Fan 1 | **Fan 1** state |
| GPIO33 | IN (pull-down) | Opto-detect Fan 2 | **Fan 2** state |
| GPIO35 | IN (input-only) | Opto-detect Light 1 | **Light 1** state |
| GPIO39 | IN (input-only) | Opto-detect Light 2 | **Light 2** state |
| GPIO36 | IN (input-only) | Opto-detect Light 3 | **Light 3** state |
| GPIO34 | ADC1_CH6 (input-only) | ACS712 OUT | Room **current draw** |
| 5V / GND | power | Relay VCC/GND, sensor VCC/GND | common rails |

## Connection list

- **ESP32 5V → Relay module VCC**, **ESP32 GND → Relay GND** (add a jumper on
  the relay's JD-VCC/VCC isolation header per your module).
- **GPIO13/14/27/26/25 → Relay IN1..IN5** (active-LOW on most modules — drive
  LOW to energise).
- **Mains Live → each relay COM**; **relay NO → the device's live terminal**;
  **Neutral → device neutral** (common). Each relay switches exactly one device.
- **Opto AC-detect modules**: input side across each device's live/neutral;
  output side (collector) → the matching sense GPIO, emitter → GND. Enable the
  internal pull-down (or add a 10 kΩ to GND) so an un-lit device reads a clean
  LOW.
- **ACS712**: cut the room's mains **live** feed and pass it through the
  sensor's screw terminals (in → out); **VCC → 5V, GND → GND, OUT → GPIO34**.
- **Common ground**: all module grounds tie to ESP32 GND.

## Electrical reasoning

- **Opto-isolation everywhere that touches mains.** Both the relay board and the
  AC-detect modules use optocouplers so the 3.3 V ESP32 logic is galvanically
  isolated from mains — safety, and it protects the MCU.
- **Sense separately from control.** Reading the relay's commanded state would
  lie if someone used a wall switch. A dedicated opto-detector on each device's
  live wire reports the _actual_ state, matching the software model's
  `status` field exactly.
- **Input-only pins for sensing.** GPIO34/35/36/39 have no internal pull-ups, so
  the opto module (or an external 10 kΩ to GND) must define the idle level.
- **ADC2 vs ADC1.** Wi-Fi disables ADC2, so all analog (ACS712) reads use
  **ADC1** (GPIO32–39). The ESP32 ADC is 12-bit over 0–3.3 V; the ACS712 outputs
  ~2.5 V at 0 A and swings ±(66–185 mV/A). Level-shift/scale so the swing stays
  within 0–3.3 V, and compute `I_rms` from the AC waveform, then
  `P = V_mains × I_rms × PF`.
- **Flyback / inrush.** Relay coils get the module's on-board flyback diode;
  keep motor (fan) and MCU supplies on separate rails with a common ground to
  avoid brown-outs on inrush.

## Sensing ON/OFF — two levels

- **Level 1 (minimum for the brief):** the MCU knows state because it drives the
  relay — reflect the commanded state up to the backend. Simplest to wire.
- **Level 2 (what the pin map above shows):** true opto-sensing per device, so
  manual switches and faults are also detected. This is the physically honest
  version.

## Building it in Wokwi / Tinkercad

Neither simulator models mains AC, so mock the physical devices:

- **Lights → LEDs** (with 220 Ω resistors) driven by the relay/GPIO; LED lit =
  ON, matching the dashboard's "glow when ON".
- **Fans → small DC motors** (via the relay or an NPN transistor + flyback
  diode); spinning = ON, matching the dashboard's animated fans.
- **Current sensor → a potentiometer** into GPIO34 to emulate the ACS712's
  analog output, or drop in an ACS712 breakout if your simulator has one.
- Wire one room (5 devices) per the pin map; duplicate the block for the other
  two rooms if you want the full 15.

> Per the brief, this repo intentionally does **not** ship an exported
> Wokwi/Tinkercad project JSON — the tables above are enough to reproduce the
> schematic yourself, which is the point of the exercise.

## How the hardware maps to the software

| Hardware signal | Software field (`simulation.js`) |
|-----------------|----------------------------------|
| Opto-detect GPIO HIGH/LOW | `device.status` (`on`/`off`) |
| Relay drive GPIO | the toggle action (`toggleDevice`) |
| ACS712 → power calc | `device.powerW` / room `watts` |
| Firmware sample timestamp | `device.lastChanged` / `onSince` |

In the live demo these signals are **simulated** in software, but the mapping
above is exactly what a real ESP32 firmware would `POST` to the same backend
API.
