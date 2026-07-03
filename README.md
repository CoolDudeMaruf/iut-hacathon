# Office Energy Monitor — Lights, Fans, Discord

A real-time system that lets anyone monitor a small office's electrical devices
and electricity usage through **both a web dashboard and a Discord bot**, backed
by **one shared backend** — the single source of truth for device state.

Built for the IUT Robotics Society × Techathon hackathon (preliminary round).

- 🖥️ **Live web dashboard** — device status, power meter, alerts, and an
  animated top-view office layout that updates with **no page refresh**.
- 🧭 **Two modes via the top menu** — **📊 Dashboard** (monitoring) and
  **🎛️ Playground** (drive the simulation), switchable without a reload.
- 🎛️ **Playground** — flip switches, jump the clock, change simulation speed,
  and watch alerts (and the bot) react in real time.
- ⏱️ **Runs at 60× by default** — 30 real seconds pass 30 simulated minutes, so
  a full office day (and its alerts) plays out live while you watch.
- 💾 **JSON-file device store** — every state change is persisted to
  `data/state.json`, so device state survives a restart.
- 🤖 **Discord bot** — `!status`, `!room`, `!usage`, `!alerts`, phrased like a
  friendly colleague (optionally via Gemini or Groq), plus proactive after-hours alerts.
- 🔌 **Simulated device layer** — 15 dynamic devices with realistic wattages, a
  controllable virtual clock, and live energy accounting.

## Screenshot

Fans spin and lights glow on the top-view layout; the power meter and alerts
update live. See `docs/` for the architecture and circuit design.

---

## The office (fixed)

3 rooms — **Drawing Room, Work Room 1, Work Room 2** — each with **2 fans + 3
lights**. That's `3 × 5 = 15` devices (6 fans + 9 lights).

> **Note on device count.** The problem statement is internally inconsistent: it
> says "15 devices total" on page 1, but "18" elsewhere (its own summary lists
> "Total Fans: 6, Total Lights: 9", which sums to **15**, not 18). The math and
> the layout image support **15**, so this project models 15. It's trivial to
> change the counts in `server/simulation.js` if the organisers confirm 18.

---

## Quick start

Requirements: **Node.js 18+**.

```bash
# 1. install
npm install

# 2. (optional) configure the bot / LLM
cp .env.example .env      # then edit .env  (Windows: copy .env.example .env)

# 3. run everything (backend + dashboard + bot)
npm start
```

Open **http://localhost:3000**.

The dashboard and API run with **no configuration at all**. The Discord bot and
the LLM phrasing are optional add-ons — leave their env vars blank and
everything else still works.

---

## Configuration (`.env`)

| Variable | Default | What it does |
|----------|---------|--------------|
| `PORT` | `3000` | Web/API port |
| `DISCORD_TOKEN` | _(empty)_ | Bot token. Empty = bot disabled, dashboard still runs |
| `ALERT_CHANNEL_ID` | _(empty)_ | Channel the bot posts proactive alerts to |
| `BOT_PREFIX` | `!` | Command prefix |
| `GEMINI_API_KEY` | _(empty)_ | Enables conversational bot replies via Google Gemini (preferred if set) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model for phrasing (flash is fast/cheap for short chat replies) |
| `GROQ_API_KEY` | _(empty)_ | Fallback LLM (used only when `GEMINI_API_KEY` is empty) |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model for phrasing |

---

## Setting up the Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   → **New Application** → **Bot** → **Reset Token**, copy it into
   `DISCORD_TOKEN`.
2. Under **Bot**, enable the **Message Content Intent** (required for `!`
   commands).
3. **OAuth2 → URL Generator**: scope `bot`, permissions `Send Messages` +
   `Read Message History`. Open the URL and invite the bot to your server.
4. (For proactive alerts) enable **Developer Mode** in Discord, right-click your
   alerts channel → **Copy Channel ID**, paste into `ALERT_CHANNEL_ID`.
5. `npm start` — the console prints `logged in as <bot>`.

### Bot commands

| Command | What it does |
|---------|--------------|
| `!status` | On/off state of every room |
| `!room <name>` | One room — `drawing`, `work1`, or `work2` |
| `!usage` | Current total power + today's estimated kWh |
| `!alerts` | Active anomalies |
| `!help` | Lists the commands |

Answers come from the **actual simulated data** (never hardcoded). With an
Gemini (or Groq) key set, the LLM rephrases them conversationally; without one,
the bot uses friendly built-in templates.

---

## Using the playground

Click **🎛️ Playground** in the top menu. The Playground mode drives the
simulation so you can demo everything (a live readout at the top shows the
current watts, kWh and alert count as you play):

- **Click any device** (on the layout or the device panel) to toggle it.
- **All on / All off** per room.
- **Time of day** slider + quick jumps (9 AM open, 5 PM close, 10 PM night).
- **Speed** — 1× / 60× / 600× so a 2-hour condition plays out in seconds.
- **Pause**, **Randomize**, **Reset**.

**Try this:** set speed to 600×, turn a whole room **All on**, and the
"all 5 devices ON for >2h" alert fires within seconds. Jump to **10 PM** to
trigger the after-hours alerts — and, if the bot is configured, its proactive
message.

---

## Alerts

- **After hours** — any device left ON outside office hours (**9 AM–5 PM**),
  reported per room with fan/light counts.
- **Room overrun** — a room whose 5 devices have all been ON for **> 2 hours**
  continuously.

Every alert is timestamped (on the simulated clock) and shown on both the
dashboard and via `!alerts`.

---

## HTTP API (the shared backend)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/state` | Full snapshot (devices, power, usage, alerts, clock) |
| GET | `/api/rooms/:room` | One room's summary |
| GET | `/api/usage` | Total power + today's kWh + per-room |
| GET | `/api/alerts` | Active alerts |
| POST | `/api/devices/:id/toggle` | Toggle a device |
| POST | `/api/devices/:id` | `{ "status": "on"\|"off" }` |
| POST | `/api/rooms/:room` | `{ "status": "on"\|"off" }` (whole room) |
| POST | `/api/sim/time` | `{ "hour": 0-23 }` |
| POST | `/api/sim/scale` | `{ "scale": number }` |
| POST | `/api/sim/pause` · `/resume` · `/randomize` · `/reset` | clock/state control |

Live updates are pushed to dashboards over **Socket.IO**.

---

## Project structure

```
server/
  index.js        # wires backend → dashboard (WebSocket) + Discord bot
  simulation.js   # THE source of truth: 15 devices, clock, power, alerts, JSON store
data/
  state.json      # persisted device data (auto-generated; git-ignored)
  api.js          # REST API (read + playground mutations)
  bot.js          # Discord bot (commands + proactive alerts)
  llm.js          # optional Gemini/Groq phrasing, with template fallback
public/
  index.html · styles.css · app.js   # real-time dashboard + playground
docs/
  system-diagram.svg   # architecture (SVG, not Mermaid)
  ARCHITECTURE.md      # how the shared backend works
  CIRCUIT.md           # ESP32 wiring: pin map, connections, reasoning
```

---

## How the pieces map to the brief

| Deliverable | Where |
|-------------|-------|
| High-level system diagram | `docs/system-diagram.svg` + `docs/ARCHITECTURE.md` |
| Hardware/electrical schematic | `docs/CIRCUIT.md` (ESP32 pin map + reasoning) |
| Simulated device data | `server/simulation.js` (status, power, room, timestamps, dynamic) |
| Web dashboard | `public/` (live panel, power meter, alerts, animated layout) |
| Discord bot | `server/bot.js` (real data, humanised, proactive alerts) |
| Shared single backend | one Node process; both interfaces read `simulation` |

---

## Video demo checklist (≤ 3 min)

1. Open the dashboard — point out live device panel, power meter, alerts.
2. Toggle a few devices from the layout → watch power update instantly.
3. Playground: jump to 10 PM → after-hours alerts appear → bot posts proactively.
4. Speed 600× + "All on" a room → the >2h alert fires.
5. In Discord: `!status`, `!room work2`, `!usage` — same numbers as the screen.
6. 20-second walkthrough of the architecture diagram.

---

## Notes

- No physical hardware is needed — device data is simulated, but the schematic
  in `docs/CIRCUIT.md` shows exactly how a real ESP32 would feed the same API.
- Any language/library/LLM is allowed by the brief; this uses Node.js + Gemini (or Groq).
