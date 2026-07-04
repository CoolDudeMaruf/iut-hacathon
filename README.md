# Office Energy Monitor — Lights, Fans, Discord

A real-time system that lets anyone monitor a small office's lights and fans, and
its electricity usage, through **both a web dashboard and a Discord bot** — backed
by **one shared backend** that is the single source of truth for device state.

Built for the **IUT Robotics Society × Techathon** hackathon (preliminary round).
Repo: <https://github.com/CoolDudeMaruf/Techathon2026-ShadowMonarch>

- 🖥️ **Live web dashboard** — device status, a power meter, alerts, and an
  animated top-view office layout that updates **with no page refresh**.
- ⏯️ **Play / Pause button** — freeze or resume the whole simulation from the
  dashboard's top bar.
- 🤖 **Discord bot** — `!status`, `!room`, `!usage`, `!alerts`, phrased like a
  friendly colleague (via Gemini or Groq), plus **proactive** after-hours alerts.
- 🔌 **Simulated device layer** — 15 devices with realistic wattages, a virtual
  clock that runs the office day on its own, and live energy accounting.
- ☁️ **Firebase mirror** — every device's on/off state is mirrored to a Firebase
  Realtime Database so external hardware (an ESP32) can read it live.
- 💾 **JSON device store** — every state change is persisted to `data/state.json`,
  so device state survives a restart.

---

## The office (fixed)

3 rooms — **Drawing Room, Work Room 1, Work Room 2** — each with **2 fans + 3
lights**. That is `3 × 5 = 15` devices (6 fans + 9 lights).

> **Note on the device count.** The problem statement is internally inconsistent:
> its headline says "15 devices total", while the layout summary lists "Total
> Fans: 6, Total Lights: 9" and calls it "18". Six fans plus nine lights is
> **15**, and the room math (2 + 3 per room × 3) also gives **15**, so this
> project models **15**. The count lives in one place (`server/simulation.js`) if
> the organisers confirm otherwise.

---

# Part 1 · Run it yourself (step by step)

You only need **Node.js 18+**. The dashboard and API run with **zero
configuration** — the Discord bot and LLM phrasing are optional add-ons.

**Step 1 — Get the code.**

```bash
git clone https://github.com/CoolDudeMaruf/Techathon2026-ShadowMonarch.git
cd Techathon2026-ShadowMonarch
```

**Step 2 — Install dependencies.**

```bash
npm install
```

**Step 3 — (Optional) add secrets.** Skip this to run dashboard-only. To enable
the Discord bot or conversational replies, copy the example env file and fill in
what you have:

```bash
cp .env.example .env      # Windows: copy .env.example .env
```

**Step 4 — Start everything (backend + dashboard + bot).**

```bash
npm start
```

**Step 5 — Open the dashboard.** Go to **<http://localhost:3000>**. Device states
begin changing every few seconds and the office clock advances on its own — no
input needed. That's it; the simulation is live.

> Prefer auto-reload while poking around? Use `npm run dev` instead of `npm start`.

---

# Part 2 · Try the Discord bot (no setup needed)

The bot is **already running and hosted** for judging. You do **not** need a token
or any configuration — just use the two links below.

**Step 1 — Join our Discord server** to see the bot and its alerts:

👉 **<https://discord.gg/fHKfckeSm>**

**Step 2 — (Optional) invite the bot to your own server** with this pre-scoped
invite link:

👉 **<https://discord.com/oauth2/authorize?client_id=1522678879486083314&permissions=68608&integration_type=0&scope=bot+applications.commands>**

**Step 3 — Talk to it.** In any channel the bot can see, type a command:

| Command | What it does |
|---------|--------------|
| `!status` | On/off state and wattage of every room |
| `!room <name>` | One room — `drawing`, `work1`, or `work2` |
| `!usage` | Current total power + today's estimated kWh |
| `!alerts` | Active anomalies right now |
| `!help` | Lists the commands |

Answers come from the **actual simulated data** (never hardcoded), so they match
the dashboard exactly. When a Gemini/Groq key is configured the LLM rephrases them
conversationally; without one, the bot uses friendly built-in templates. When an
alert condition triggers, the bot also **posts to the alert channel on its own**.

> Running your own instance instead? Put your `DISCORD_TOKEN`, `ALERT_CHANNEL_ID`
> and (optionally) `GEMINI_API_KEY` in `.env` — see
> [Configuration](#configuration-env) below. The hosted links above are the fast
> path for evaluation.

---

# Part 3 · What to look at on the dashboard

A quick tour of the live UI, top to bottom:

1. **Top bar** — the **simulated clock** and an **office-hours / after-hours**
   badge, plus the **⏸ Pause / ▶ Play** button. Click it to freeze the whole
   simulation (clock and devices stop); click again to resume.
2. **Office layout — top view** — the real floor plan with a live marker over
   every fan and light. **Lights glow** when ON and **fans spin** when running.
   A room tints **red** when it has an active alert.
3. **Power consumption** — total watts across the office right now, today's
   running **kWh**, and a **per-room** bar breakdown.
4. **Active alerts** — anomalies as they arise, each **timestamped** on the
   simulated clock.
5. **Device status** — the on/off state of all 15 devices, grouped by room.

Everything updates in real time over **Socket.IO** — no refresh, ever.

---

## Alerts

The system raises three kinds of alert, all timestamped on the simulated clock and
shown on both the dashboard and via `!alerts`:

- **After hours** — any device left ON outside office hours (**9 AM–5 PM**),
  reported per room with fan/light counts.
- **Device overrun** — a single device ON for **more than 2 hours** straight.
- **Room overrun** — a room whose devices have **all** been ON for **> 2 hours**
  continuously.

---

# Part 4 · Architecture (system diagram)

The web dashboard and the Discord bot **share one backend**. There is exactly one
source of truth for device state — `server/simulation.js` — and every interface
reads from it.

![High-level system architecture](img/architecture.png)

> Editable source: **[Excalidraw board](https://excalidraw.com/#json=B4qrCWff0wl3qTcqR-rfL,uBgLJQbULb5L3jZun-qX8g)**
> · a hand-built SVG copy also lives at `docs/system-diagram.svg`.

```
[Simulated Device Layer]  →  [Shared Node.js Backend]  →  [ Web Dashboard ]
   (server/simulation.js)        (Express + Socket.IO)   →  [ Discord Bot  ]
                                                          →  [ Firebase RTDB ]
```

The simulation owns the live device state, the virtual clock, power totals, energy
usage, and alerts. It emits an `update` event on every change; the backend pushes a
fresh snapshot to all dashboards over WebSocket, the bot answers from the same data,
and each on/off change is mirrored up to Firebase. See `docs/ARCHITECTURE.md` for a
deeper walkthrough.

---

# Part 5 · Hardware / electrical schematic

This is a **concept/simulation** — no real hardware is needed to run the project.
The circuit was built in **Wokwi** to show how a real office would be wired and
sensed. A representative circuit for **one room** (2 fans + 3 lights = 5 devices)
is enough; the other two rooms are identical copies.

![Wokwi ESP32 + relay circuit](img/wokwi.jpg)

### How the demo differs from real life (important)

In a **real** installation the data flows **sensor → cloud → dashboard**:

- An **ACS712 current sensor** measures each appliance's real current draw and the
  ESP32 **writes** that live state up to **Firebase**.
- The backend/dashboard then just **read** the true device state from Firebase.

For the hackathon demo we **reverse the last hop**, because Wokwi cannot simulate
real AC current through a sensor:

- The **backend generates the dynamic simulation data** (the random on/off changes
  you see) and writes it to **Firebase**.
- The **ESP32 reads** each device's status from Firebase and **drives the matching
  relay** — so a relay physically clicks ON/OFF in step with the dashboard.
- The **ACS712 is simulated with a potentiometer** in Wokwi (its output voltage
  stands in for the sensor's analog output), since actual current flow cannot be
  simulated.

So in the demo the relay module is the *consumer* of Firebase data; in real life the
ACS712 would be the *producer* of it. Everything else stays the same.

### ACS712 current sensor connection

Presented as an **ACS712 Current Sensor** (internally a potentiometer in Wokwi):

| ACS712 Pin | Connected To       | ESP32 Pin | Description                                  |
| ---------- | ------------------ | --------- | -------------------------------------------- |
| VCC        | ESP32 5V (VIN)     | VIN       | Powers the ACS712 module                     |
| GND        | ESP32 GND          | GND       | Common ground                                |
| OUT        | ESP32 Analog Input | GPIO34    | Sends analog current measurement to ESP32    |
| IP+        | AC Load Input      | —         | Current input terminal (simulated in Wokwi)  |
| IP−        | AC Load Output     | —         | Current output terminal (simulated in Wokwi) |

> **Note:** In Wokwi the ACS712 is simulated using a potentiometer because actual
> current flow through the sensor cannot be simulated. The potentiometer's output
> voltage emulates the ACS712 analog output.

### ESP32 device control mapping

Each relay is driven by an ESP32 GPIO that follows a Firebase path (one room shown;
repeat per room):

| Firebase Path                | ESP32 GPIO | Relay   | Connected Appliance |
| ---------------------------- | ---------- | ------- | ------------------- |
| `Drawing Room/fan1/status`   | GPIO19     | Relay 1 | Fan 1               |
| `Drawing Room/fan2/status`   | GPIO18     | Relay 2 | Fan 2               |
| `Drawing Room/light1/status` | GPIO5      | Relay 3 | Light 1             |
| `Drawing Room/light2/status` | GPIO17     | Relay 4 | Light 2             |
| `Drawing Room/light3/status` | GPIO16     | Relay 5 | Light 3             |

### System operation

| Component                  | Function                                                                        |
| -------------------------- | ------------------------------------------------------------------------------- |
| Firebase Realtime Database | Stores the ON/OFF status of each appliance.                                     |
| ESP32                      | Reads appliance status from Firebase and controls the corresponding relay.      |
| Relay Module               | Switches the connected appliance ON or OFF.                                      |
| ACS712 Current Sensor      | Measures the load current of the connected appliance (simulated in Wokwi).      |
| Frontend Dashboard         | Displays appliance status and reflects device state driven through Firebase.    |

Extended electrical reasoning (opto-isolation, ADC notes, BOM) is in
`docs/CIRCUIT.md` and `SCHEMATIC.md`.

---

## Configuration (`.env`)

Everything below is optional. With no `.env` at all, the dashboard and API still
run — only the Discord bot and LLM phrasing are gated behind these.

| Variable | Default | What it does |
|----------|---------|--------------|
| `PORT` | `3000` | Web/API port |
| `FIREBASE_DB_URL` | project RTDB | Realtime Database the live state is mirrored to |
| `FIREBASE_AUTH` | _(empty)_ | ID token / DB secret, only if your DB rules require auth |
| `DISCORD_TOKEN` | _(empty)_ | Bot token. Empty = bot disabled, dashboard still runs |
| `ALERT_CHANNEL_ID` | _(empty)_ | Channel the bot posts proactive alerts to |
| `BOT_PREFIX` | `!` | Command prefix |
| `GEMINI_API_KEY` | _(empty)_ | Enables conversational replies via Google Gemini (comma-separate multiple keys to round-robin) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model used for phrasing |
| `GROQ_API_KEY` | _(empty)_ | Fallback LLM, used only when `GEMINI_API_KEY` is empty |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model used for phrasing |

---

## HTTP API (the shared backend)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/state` | Full snapshot (devices, power, usage, alerts, clock) |
| GET | `/api/rooms/:room` | One room's summary (`drawing` · `work1` · `work2`) |
| GET | `/api/usage` | Total power + today's kWh + per-room breakdown |
| GET | `/api/alerts` | Active alerts |
| POST | `/api/pause` | Freeze the simulation (clock + device changes) |
| POST | `/api/resume` | Resume the simulation |

Live updates are pushed to every connected dashboard over **Socket.IO**.

---

## Project structure

```
server/
  index.js        # wires backend → dashboard (WebSocket) + Discord bot + Firebase
  simulation.js   # THE source of truth: 15 devices, clock, power, alerts, JSON store
  api.js          # REST API (read endpoints + pause/resume)
  bot.js          # Discord bot (commands + proactive alerts)
  llm.js          # optional Gemini/Groq phrasing, with template fallback
  firebase.js     # mirrors live device state to the Firebase Realtime Database
public/
  index.html · styles.css · app.js   # real-time dashboard (Socket.IO + play/pause)
data/
  state.json      # persisted device data (auto-generated; git-ignored)
img/
  architecture.png · wokwi.jpg        # system diagram + Wokwi circuit
docs/
  ARCHITECTURE.md · system-diagram.svg # how the shared backend works
  CIRCUIT.md                           # ESP32 wiring detail + reasoning
```

---

## How it maps to the problem statement

| Deliverable | Where |
|-------------|-------|
| High-level system diagram | `img/architecture.png` + `docs/ARCHITECTURE.md` |
| Hardware/electrical schematic | Wokwi (`img/wokwi.jpg`) + tables above + `docs/CIRCUIT.md` |
| Simulated device data (status, power, room, timestamps, dynamic) | `server/simulation.js` |
| Real-time web dashboard | `public/` — live device panel, power meter, alerts, animated layout |
| Discord bot on real data | `server/bot.js` — `!status` / `!room` / `!usage`, humanised, proactive alerts |
| Single shared backend | one Node process; dashboard **and** bot read `simulation` |

Every evaluation criterion is covered: real-time dashboard (20%), Discord bot on
real data (10%), dashboard UX (10%), system diagram (15%), circuit schematic (15%),
demo & dummy-data quality (15%), and a documented, well-structured codebase (15%).

---

## Notes

- **No physical hardware is required** to run or judge this — the device data is
  simulated. The Wokwi circuit and tables show exactly how a real ESP32 would drive
  the same Firebase-backed state.
- Any language/library/LLM is allowed by the brief; this uses **Node.js** with
  **Gemini (or Groq)** for the conversational bot layer.
