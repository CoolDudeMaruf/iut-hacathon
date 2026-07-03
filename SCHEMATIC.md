# Hardware / Electrical Schematic — Design Guide

> Deliverable #2: "A circuit design in Wokwi or Tinkercad showing how these devices would be wired and sensed in real life."
>
> This document gives you **pin-mapping tables, connection lists, and electrical reasoning** so you can build the schematic yourself in the simulator. It is a **concept/simulation only** — no real hardware, and (per the brief) you only need a **representative circuit for one room** (5 devices: 3 lights + 2 fans). Build it once; note "repeat ×5 per room, ×3 rooms."

---

## 1. Assumptions

- The system is **monitoring-only** — we *sense* device state, we don't switch the loads. (The dashboard/bot only *report*; they don't control.)
- Loads in real life are **230 V AC** mains devices: lights ≈ 15 W each, fans ≈ 60 W each (matching the software simulator).
- The microcontroller lives on a **low-voltage, isolated logic side** — it must never share a wire with mains.
- Two sensing layers:
  - **Core (required):** digital **ON/OFF state** per device.
  - **Bonus (optional):** analog **current draw** per device, so power can be measured instead of estimated.

## 2. Recommended platform: ESP32 in Wokwi

| | **Wokwi + ESP32** (recommended) | Tinkercad + Arduino Uno (fallback) |
|---|---|---|
| Wi-Fi to talk to the shared backend | ✅ built-in, Wokwi simulates it | ❌ no networking |
| ADC channels | Plenty (ADC1) | 6 (A0–A5) — still enough for 5 |
| ADC range | 0–3.3 V (needs a divider for a 5 V sensor) | 0–5 V (sensor connects directly) |
| Good for this project because… | ESP32 can push readings to the backend, matching the "[Device]→[Backend]→[Web]&&[Bot]" architecture | Simplest to wire, but the circuit is illustrative only |

**Recommendation:** use **ESP32 in Wokwi**. It lets your schematic show the *full* data path (sensor → MCU → Wi-Fi → backend), which is exactly what the system-diagram deliverable asks for. Tinkercad/Uno is a valid fallback if you prefer its part library — the pin map for it is in §6.

> **Note on the software demo:** your live demo data comes from the backend simulator (`server/simulation.js`). This circuit is the *"how it would be sensed in reality"* deliverable. Optionally, the ESP32 sketch in §8 can publish real sensed values to the backend to demonstrate the end-to-end path.

---

## 3. How each device is sensed (electrical reasoning)

Each of the 5 devices gets **one identical sensing channel**. There are two independent sub-circuits per channel:

### 3a. ON/OFF state — opto-isolated AC detector (H11AA1)
- The **H11AA1** has two anti-parallel LEDs on its input (so it works on AC) and a phototransistor output — it gives **galvanic isolation (~7.5 kV)** between mains and the MCU.
- Wire the opto **input across the load terminals**, through a series resistor. When the device is **ON**, mains voltage appears across the load → the opto's internal LED conducts → the output phototransistor pulses.
- **Series resistor sizing:** target ~1–2 mA through the LED.
  - 230 V mains → **220 kΩ, ≥1 W** (or 2×110 kΩ in series for voltage rating). Power ≈ 230²/220k ≈ 0.24 W.
  - 120 V mains → ~100 kΩ.
- The output pulses at 2× line frequency (100/120 Hz). Add an **RC low-pass (10 kΩ + 1 µF)** on the output so the MCU reads a **steady level** instead of flicker.
- Output is **active-low**: phototransistor pulls the pin toward GND when the device is ON. Use the MCU's **internal pull-up** and invert in firmware (`ON = digitalRead()==LOW`).

### 3b. Current draw — ACS712 Hall sensor (optional/bonus)
- The **ACS712** sits **in series with the load's live conductor**; its Hall element also provides isolation. Output = analog voltage centered at **VCC/2 (2.5 V at 5 V supply)**, ± sensitivity.
- Sensitivity by part: **-05B = 185 mV/A**, -20A = 100 mV/A, -30A = 66 mV/A.
- **Important reality check:** office loads draw *tiny* currents — a 60 W fan ≈ 0.26 A, a 15 W light ≈ 0.065 A at 230 V. That's near the ACS712's noise floor. So for a real build you'd either:
  1. use the **-05B (most sensitive)** part, **or**
  2. use a **current transformer (SCT-013)** with a tuned burden resistor for low current, **or**
  3. skip per-device current and compute **power = state × rated wattage** (perfectly acceptable, and what the backend already does).
- **ESP32 3.3 V ADC:** the 2.5 V bias + swing can exceed 3.3 V, so add a **voltage divider (e.g., 10 kΩ / 20 kΩ ⇒ ×0.667)** on the OUT line and multiply back in firmware. On a 5 V Arduino Uno this divider is **not needed**.
- For AC, sample OUT over a full mains cycle and compute **RMS**; for the DC-motor stand-in in the simulator it's a steady offset.

### 3c. Isolation & power (the safety-critical part)
- **Two power domains:** mains (loads) and an **isolated 5 V DC supply** (e.g., an HLK-PM01 in a real build) for the MCU + sensors.
- The opto and the ACS712 are the **only bridges** across the isolation barrier — and both are isolating parts. **Never** connect mains neutral to MCU ground.

---

## 4. Bill of Materials — one room (5 channels)

**Real-world (what your schematic depicts):**

| Qty | Part | Purpose |
|---|---|---|
| 1 | ESP32 DevKit v1 | MCU, reads pins, Wi-Fi to backend |
| 5 | H11AA1 AC opto-isolator | ON/OFF state sensing (isolated) |
| 5 | 220 kΩ 1 W resistor | opto input series resistor (mains side) |
| 5 | 1 µF capacitor + 10 kΩ | RC smoothing on opto output |
| 5 | ACS712-05B module *(optional)* | current sensing (isolated) |
| 10 | 10 kΩ / 20 kΩ resistors *(optional)* | ADC divider for ESP32 3.3 V |
| 5 | AC loads: 3× 15 W lamp, 2× 60 W fan | the monitored devices |
| 1 | Isolated 5 V DC supply | powers MCU + sensors |

**Simulator stand-ins (Wokwi/Tinkercad can't do 230 V AC):**

| Real part | Simulator substitute |
|---|---|
| 15 W light | **LED + 220 Ω** resistor |
| 60 W fan | **DC motor** (via transistor/relay, or a supply) |
| Manual on/off of a load | **slide switch** (also feeds the state pin) |
| H11AA1 state signal | the slide-switch line into the state GPIO |
| ACS712 analog current | **potentiometer** (wiper → ADC pin) — slide it to emulate varying current |

---

## 5. Pin map — ESP32 (Wokwi)

State pins use general GPIOs with internal pull-ups. Current pins use **ADC1 only** (ADC2 is unavailable while Wi-Fi is on). Pins 34/35/36/39 are input-only — perfect for analog.

| Device | State (digital in) | Current (ADC1 in) |
|---|---|---|
| Light 1 | GPIO 13 | GPIO 36 (ADC1_CH0 / VP) |
| Light 2 | GPIO 14 | GPIO 39 (ADC1_CH3 / VN) |
| Light 3 | GPIO 16 | GPIO 34 (ADC1_CH6) |
| Fan 1  | GPIO 17 | GPIO 35 (ADC1_CH7) |
| Fan 2  | GPIO 18 | GPIO 32 (ADC1_CH4) |

Power rails: `3V3` → opto pull-ups / pots; `5V (VIN)` → ACS712 modules; `GND` common to all logic-side parts.

## 6. Pin map — Arduino Uno (Tinkercad fallback)

Uno's 5 V ADC means the ACS712 connects **directly** (no divider).

| Device | State (digital) | Current (analog) |
|---|---|---|
| Light 1 | D2 | A0 |
| Light 2 | D3 | A1 |
| Light 3 | D4 | A2 |
| Fan 1  | D5 | A3 |
| Fan 2  | D6 | A4 |

---

## 7. Connection list (net list)

### 7a. Real-world — one representative channel (repeat ×5)
```
Load power:
  MAINS_L ── [wall switch] ── ACS712 IP+          (current in series)
  ACS712 IP- ── LOAD terminal A
  LOAD terminal B ── MAINS_N

State detect (across the load):
  LOAD terminal A ── [220kΩ 1W] ── H11AA1 pin1 (AC in)
  LOAD terminal B ──────────────── H11AA1 pin2 (AC in)
  H11AA1 pin4 (emitter)  ── MCU GND
  H11AA1 pin5 (collector) ── MCU state GPIO  (internal pull-up)
  H11AA1 pin5 ── [1µF] ── GND                 (RC smoothing, with the pull-up)

Current sense (optional):
  ACS712 VCC ── +5V (isolated)
  ACS712 GND ── MCU GND
  ACS712 OUT ── [10kΩ]─┬─ MCU ADC pin         (divider top)
                        └─ [20kΩ] ── GND       (divider bottom; omit on Uno)
```

### 7b. Simulator (Wokwi ESP32) — one channel (repeat ×5)
```
Light channel (LED stand-in):
  3V3 ── slide-switch common
  slide-switch out ─┬─ [220Ω] ── LED anode ; LED cathode ── GND   (visualizes ON)
                    └─ state GPIO (e.g. GPIO13)                    (reads ON/OFF)

Fan channel (DC-motor stand-in): same, but drive a DC motor
  (via an NPN transistor + flyback diode from the switched line) instead of the LED.

Current emulation (per device):
  potentiometer: end1 ── 3V3 , end2 ── GND , wiper ── ADC pin (e.g. GPIO36)
  (turn the pot to fake current; tie "off" ⇒ pot at 0 in firmware if you like)
```
> Tip: instead of 5 slide switches you can let the **ESP32 firmware itself toggle the loads on a timer** — that makes the simulator produce *dynamic* data on its own, matching the brief's "data should change over time."

---

## 8. Firmware skeleton (reads pins → watts)

Teaching skeleton — the same logic works in the simulator (digitalRead from a switch, analogRead from a pot) and on real hardware (from the opto and ACS712).

```cpp
const int STATE_PINS[5]   = {13, 14, 16, 17, 18};   // opto output, active-low
const int CURRENT_PINS[5] = {36, 39, 34, 35, 32};   // ACS712 via ADC1
const char* NAMES[5] = {"Light 1","Light 2","Light 3","Fan 1","Fan 2"};
const float RATED_W[5] = {15, 15, 15, 60, 60};      // fallback if not metering current

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 5; i++) pinMode(STATE_PINS[i], INPUT_PULLUP);
  analogReadResolution(12);                          // ESP32 ADC: 0..4095
}

float readAmps(int adcPin) {                         // ACS712-05B, 5V, 2:3 divider
  const float VREF = 3.3, DIV = 1.5, SENS = 0.185, BIAS = 2.5;
  float v = (analogRead(adcPin) / 4095.0) * VREF * DIV;
  return fabs((v - BIAS) / SENS);
}

void loop() {
  for (int i = 0; i < 5; i++) {
    bool on = (digitalRead(STATE_PINS[i]) == LOW);   // opto is active-low
    // Prefer measured power; fall back to rated wattage when current is negligible:
    float watts = on ? RATED_W[i] : 0.0;             // or: readAmps(CURRENT_PINS[i]) * 230.0
    Serial.printf("%-8s %-3s  %5.1f W\n", NAMES[i], on ? "ON" : "OFF", watts);
  }
  Serial.println("----");
  delay(1000);
  // Optional: package as JSON and POST to the shared backend over Wi-Fi.
}
```

---

## 9. Safety notes (call these out in your writeup)
- Mains is lethal — this is a **concept schematic**; do not build the 230 V side for real without proper training.
- The **only** components crossing the mains↔logic boundary are the **opto-isolator and the Hall sensor**, both galvanically isolated.
- Fuse each mains branch; keep mains and logic grounds separate.

## 10. Validation approach
- **Simulator:** toggle each switch (or let firmware toggle) and confirm the serial log flips ON/OFF and watts update; sweep each pot and confirm the current reading tracks.
- **Logic check:** verify active-low inversion (open switch ⇒ "OFF"), and that total watts = sum of ON devices.
- **End-to-end (bonus):** confirm the ESP32's posted values appear on the dashboard and via the Discord `!status`/`!usage` commands — proving one shared source of truth.

## 11. What to put in the repo for this deliverable
1. The Wokwi (or Tinkercad) schematic screenshot / share link.
2. This document (pin maps + reasoning).
3. A one-line note that the channel is representative and repeats ×5 per room, ×3 rooms.
