# Hardware / Electrical Schematic — Design Guide

> Deliverable #2: "A circuit design in Wokwi or Tinkercad showing how these devices would be wired and sensed in real life."
>
> This document gives the **pin-mapping tables, connection lists, and electrical reasoning** for the circuit built in **Wokwi**. It is a **concept/simulation only** — no real hardware — and (per the brief) only a **representative circuit for one room** (5 devices: 3 lights + 2 fans) is needed. Build it once; note "repeat ×5 per room, ×3 rooms."

![Wokwi ESP32 + relay circuit](img/wokwi.jpg)

---

## 1. What the circuit does

An **ESP32** reads each appliance's ON/OFF status from **Firebase** and switches
it through a **5-channel relay module**. An **ACS712 current sensor** (simulated
by a potentiometer in Wokwi) measures the room's load current. So the schematic
shows the full real-world path **Firebase → ESP32 → relay → appliance**, plus
**appliance → ACS712 → ESP32** for metering.

- Loads in real life are **230 V AC** mains devices: lights ≈ 15 W each, fans
  ≈ 60 W each (matching the software simulator).
- The microcontroller lives on a **low-voltage, isolated logic side** — the relay
  board's optocouplers are the only bridge to mains. It must never share a wire
  with mains directly.

## 2. Demo vs. real life (data direction)

| | Real installation | Hackathon demo (this build) |
|---|---|---|
| Who produces state | **ACS712 + ESP32** sense real current and **write** to Firebase | **Backend** (`server/simulation.js`) generates dynamic data and **writes** to Firebase |
| Who consumes state | Backend / dashboard **read** from Firebase | **ESP32 reads** from Firebase and drives the relays |
| ACS712 | Real hall-effect current sensor | **Simulated with a potentiometer** (Wokwi can't push real AC through it) |

The last hop is reversed only because Wokwi cannot simulate real current flow.
Everything upstream of Firebase is identical.

## 3. Why ESP32 in Wokwi

| | **Wokwi + ESP32** (used here) | Tinkercad + Arduino Uno (fallback) |
|---|---|---|
| Wi-Fi to reach Firebase | ✅ built-in, Wokwi simulates it | ❌ no networking |
| GPIO for 5 relays + ADC | ✅ plenty | ✅ enough (D2–D6 + A0) |
| ADC range | 0–3.3 V (scale a 5 V sensor) | 0–5 V (sensor connects directly) |

**ESP32 in Wokwi** lets the schematic show the full data path (Firebase → MCU →
relay), which is exactly what the system-diagram deliverable asks for.

---

## 4. Bill of Materials — one room (5 channels)

**Real-world (what the schematic depicts):**

| Qty | Part | Purpose |
|---|---|---|
| 1 | ESP32 DevKit v1 | MCU, Wi-Fi to Firebase, drives relays, reads ADC |
| 1 | 5-channel relay module (opto-isolated, 5 V) | switch the 5 devices |
| 1 | ACS712-20A current sensor module | current sensing (isolated) |
| 5 | AC loads: 3× 15 W lamp, 2× 60 W fan | the controlled devices |
| 1 | Isolated 5 V DC supply | powers MCU + relay + sensor |

**Simulator stand-ins (Wokwi can't do 230 V AC):**

| Real part | Simulator substitute |
|---|---|
| 15 W light | **LED + 220 Ω** resistor (driven by the relay/GPIO) |
| 60 W fan | **DC motor** (via the relay, or transistor + flyback diode) |
| ACS712 analog current | **potentiometer** (wiper → GPIO34) — slide it to emulate current |

---

## 5. ACS712 current sensor connection

| ACS712 Pin | Connected To       | ESP32 Pin | Description                                  |
| ---------- | ------------------ | --------- | -------------------------------------------- |
| VCC        | ESP32 5V (VIN)     | VIN       | Powers the ACS712 module                     |
| GND        | ESP32 GND          | GND       | Common ground                                |
| OUT        | ESP32 Analog Input | GPIO34    | Sends analog current measurement to ESP32    |
| IP+        | AC Load Input      | —         | Current input terminal (simulated in Wokwi)  |
| IP−        | AC Load Output     | —         | Current output terminal (simulated in Wokwi) |

> **Note:** In Wokwi the ACS712 is simulated using a potentiometer because actual
> current flow through the sensor cannot be simulated. The potentiometer's output
> voltage emulates the ACS712 analog output. GPIO34 is on **ADC1** (ADC2 is
> unavailable while Wi-Fi is on) and is input-only — ideal for analog.

## 6. ESP32 device control mapping (Firebase → relay)

Drawing Room shown; repeat the block per room. Relay inputs are typically
active-LOW.

| Firebase Path                | ESP32 GPIO | Relay   | Connected Appliance |
| ---------------------------- | ---------- | ------- | ------------------- |
| `Drawing Room/fan1/status`   | GPIO19     | Relay 1 | Fan 1               |
| `Drawing Room/fan2/status`   | GPIO18     | Relay 2 | Fan 2               |
| `Drawing Room/light1/status` | GPIO5      | Relay 3 | Light 1             |
| `Drawing Room/light2/status` | GPIO17     | Relay 4 | Light 2             |
| `Drawing Room/light3/status` | GPIO16     | Relay 5 | Light 3             |

## 7. System operation

| Component                  | Function                                                                        |
| -------------------------- | ------------------------------------------------------------------------------- |
| Firebase Realtime Database | Stores the ON/OFF status of each appliance.                                     |
| ESP32                      | Reads appliance status from Firebase and controls the corresponding relay.      |
| Relay Module               | Switches the connected appliance ON or OFF.                                      |
| ACS712 Current Sensor      | Measures the load current of the connected appliance (simulated in Wokwi).      |
| Frontend Dashboard         | Displays appliance status and reflects device state driven through Firebase.    |

---

## 8. Connection list (net list)

### 8a. Real-world — one representative channel (repeat ×5 for control)
```
Control (one relay per device):
  ESP32 GPIO (e.g. GPIO19) ── Relay INx        (active-LOW: drive LOW to energise)
  ESP32 5V ── Relay VCC ; ESP32 GND ── Relay GND
  MAINS_L ── Relay COM ; Relay NO ── LOAD live ; LOAD neutral ── MAINS_N

Current sense (whole room, one sensor):
  MAINS_L ── ACS712 IP+ ── IP- ── (room load bus)   (sensor in series with live)
  ACS712 VCC ── 5V ; ACS712 GND ── GND ; ACS712 OUT ── GPIO34
```

### 8b. Simulator (Wokwi ESP32) — one channel (repeat ×5)
```
Light channel (LED stand-in):
  ESP32 GPIO (e.g. GPIO5) ── relay IN ; relay NO ── [220Ω] ── LED anode ; LED cathode ── GND
  (LED lit ⇒ appliance ON, matching the dashboard glow)

Fan channel (DC-motor stand-in): same, but the relay switches a DC motor
  (add a flyback diode) instead of the LED.

Current emulation (per room):
  potentiometer: end1 ── 3V3 , end2 ── GND , wiper ── GPIO34
  (turn the pot to fake varying current)
```
> The relays are driven by the value the ESP32 reads from Firebase, which the
> backend simulator updates over time — so the circuit produces *dynamic* behaviour
> on its own, matching the brief's "data should change over time."

---

## 9. Firmware skeleton (Firebase → relay + ACS712 → watts)

Teaching skeleton — the same logic works in the simulator (relay drives an LED /
motor, analogRead from a pot) and on real hardware (relay drives mains, analogRead
from the ACS712).

```cpp
const int RELAY_PINS[5] = {19, 18, 5, 17, 16};        // Fan1, Fan2, Light1, Light2, Light3
const int CURRENT_PIN   = 34;                          // ACS712 OUT via ADC1
const char* PATHS[5] = {
  "Drawing Room/fan1/status",  "Drawing Room/fan2/status",
  "Drawing Room/light1/status","Drawing Room/light2/status","Drawing Room/light3/status"
};

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 5; i++) { pinMode(RELAY_PINS[i], OUTPUT); digitalWrite(RELAY_PINS[i], HIGH); } // HIGH = off (active-LOW)
  analogReadResolution(12);                            // ESP32 ADC: 0..4095
  // connectWiFi(); beginFirebase();
}

float readAmps() {                                     // ACS712-20A, scaled into 0..3.3V
  const float VREF = 3.3, SENS = 0.100, BIAS = 1.65;   // 100 mV/A, mid-rail bias after scaling
  float v = (analogRead(CURRENT_PIN) / 4095.0) * VREF;
  return fabs((v - BIAS) / SENS);
}

void loop() {
  for (int i = 0; i < 5; i++) {
    bool on = Firebase.getBool(PATHS[i]);              // read desired state from the cloud
    digitalWrite(RELAY_PINS[i], on ? LOW : HIGH);      // active-LOW relay drive
  }
  float amps = readAmps();                             // room current (simulated by the pot)
  Serial.printf("room current ~ %.2f A\n", amps);
  delay(500);
}
```

---

## 10. Safety notes (call these out in your writeup)
- Mains is lethal — this is a **concept schematic**; do not build the 230 V side for real without proper training.
- The **relay board's optocouplers** and the **ACS712's Hall element** are the only components crossing the mains↔logic boundary; both are isolating parts.
- Fuse each mains branch; keep mains and logic grounds separate; add flyback protection for the fan motors.

## 11. Validation approach
- **Simulator:** flip a Firebase `status` value and confirm the matching relay (and its LED/motor) switches; sweep the pot and confirm the current reading tracks.
- **Logic check:** verify active-LOW relay drive (Firebase `false` ⇒ relay off ⇒ LED dark), and that total watts = sum of ON devices.
- **End-to-end:** confirm the dashboard and Discord `!status`/`!usage` show the same state that drives the relays — proving one shared source of truth.

## 12. What to put in the repo for this deliverable
1. The Wokwi schematic screenshot (`img/wokwi.jpg`) / share link.
2. This document (pin maps + reasoning).
3. A one-line note that the channel is representative and repeats ×5 per room, ×3 rooms.
