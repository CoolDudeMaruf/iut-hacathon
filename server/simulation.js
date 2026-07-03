// ---------------------------------------------------------------------------
// Simulated Device Layer  ->  the single source of truth.
// Both the web dashboard (via REST + WebSocket) and the Discord bot read
// device state, power and alerts from this one module.
//
// The office day runs itself: device states change every 5s and the simulated
// clock advances by a random step every 30s, so alerts arise on their own.
// ---------------------------------------------------------------------------
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The JSON "device data store" state is persisted to (survives restarts).
const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');

const ROOMS = [
  { id: 'drawing', name: 'Drawing Room' },
  { id: 'work1', name: 'Work Room 1' },
  { id: 'work2', name: 'Work Room 2' },
];

// Realistic wattages: a ceiling fan ~60W, an LED tube/light ~15W.
const FAN_WATTS = 60;
const LIGHT_WATTS = 15;

// Office hours (local time). Anything ON outside this window is "forgotten".
const OFFICE_OPEN_HOUR = 9; // 9 AM
const OFFICE_CLOSE_HOUR = 17; // 5 PM
const DEVICE_ON_ALERT_HOURS = 2; // a single device ON for >2h -> alert

const DEVICE_TICK_MS = 3000; // device states change every 3 seconds
const FAST_CLOCK_TICK_MS = 1000; // smooth clock ticks every 1 second
const TIME_TICK_MS = 30000; // the simulated clock randomizes every 30 seconds

// The random jump every 30s
const TIME_STEP_MIN_MIN = 30; 
const TIME_STEP_MAX_MIN = 120;
// Don't auto-switch-off a device that's clearly been left running: once it has
// been ON this long, let it ride past 2h so its per-device alert can fire.
const KEEP_ON_AFTER_MIN = 90;

function isOfficeHours(ms) {
  const h = new Date(ms).getHours();
  return h >= OFFICE_OPEN_HOUR && h < OFFICE_CLOSE_HOUR;
}

function makeDevice(id, name, type, room, powerW, status, now) {
  return {
    id,
    name,
    type, // 'fan' | 'light'
    room, // { id, name }
    powerW,
    status, // 'on' | 'off'
    onSince: status === 'on' ? now : null,
    lastChanged: now,
  };
}

function buildDevices(now) {
  const devices = [];
  for (const room of ROOMS) {
    for (let i = 1; i <= 2; i++) {
      const on = Math.random() < 0.5;
      devices.push(makeDevice(`${room.id}-fan-${i}`, `Fan ${i}`, 'fan', room, FAN_WATTS, on ? 'on' : 'off', now));
    }
    for (let i = 1; i <= 3; i++) {
      const on = Math.random() < 0.5;
      devices.push(makeDevice(`${room.id}-light-${i}`, `Light ${i}`, 'light', room, LIGHT_WATTS, on ? 'on' : 'off', now));
    }
  }
  return devices;
}

// The simulated office day starts at 9 AM (office open).
function defaultStartMs() {
  const d = new Date();
  d.setHours(OFFICE_OPEN_HOUR, 0, 0, 0);
  return d.getTime();
}

class Simulation extends EventEmitter {
  constructor() {
    super();
    this._init(true); // rehydrate device state saved by a previous run, if any
    // Persist to the JSON store (throttled) whenever anything changes.
    this.on('update', () => this._scheduleSave());
    this._save();
  }

  _init(load = false) {
    this.simTime = defaultStartMs(); // the simulated clock (ms epoch)
    this.paused = false;
    this.devices = buildDevices(this.simTime);
    this.alertFirstSeen = new Map(); // alertId -> sim ts first observed
    this.alerts = [];
    this.energyWhToday = 0;
    this.lastEnergyDay = new Date(this.simTime).getDate();
    if (load) this._load();
    this.recomputeAlerts();
  }

  now() {
    return this.simTime;
  }

  start() {
    if (this._deviceTimer) return;
    this._deviceTimer = setInterval(() => this._deviceTick(), DEVICE_TICK_MS);
    this._fastClockTimer = setInterval(() => this._fastClockTick(), FAST_CLOCK_TICK_MS);
    this._timeTimer = setInterval(() => this._timeTick(), TIME_TICK_MS);
    this._deviceTimer.unref?.();
    this._fastClockTimer.unref?.();
    this._timeTimer.unref?.();
  }

  stop() {
    clearInterval(this._deviceTimer);
    clearInterval(this._fastClockTimer);
    clearInterval(this._timeTimer);
    this._deviceTimer = null;
    this._fastClockTimer = null;
    this._timeTimer = null;
  }

  // --- internal helpers ----------------------------------------------------
  _device(id) {
    return this.devices.find((d) => d.id === id);
  }

  _applyStatus(device, status) {
    if (!device || device.status === status) return false;
    const now = this.simTime;
    device.status = status;
    device.lastChanged = now;
    device.onSince = status === 'on' ? now : null;
    return true;
  }

  _accumulateEnergy(dtMs) {
    if (dtMs > 0 && dtMs < 12 * 3600000) {
      this.energyWhToday += this.totalWatts() * (dtMs / 3600000);
    }
  }

  totalWatts() {
    return this.devices.reduce((sum, d) => sum + (d.status === 'on' ? d.powerW : 0), 0);
  }

  // --- JSON persistence: the on-disk device-data store ---------------------
  _load() {
    try {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (!Array.isArray(saved?.devices)) return;
      
      if (saved.simTime) this.simTime = Date.parse(saved.simTime);
      const now = this.simTime;
      
      const byId = new Map(saved.devices.map((d) => [d.id, d]));
      for (const d of this.devices) {
        const s = byId.get(d.id);
        if (!s || (s.status !== 'on' && s.status !== 'off')) continue;
        d.status = s.status;
        d.lastChanged = s.lastChanged ? Date.parse(s.lastChanged) : now;
        d.onSince = s.onSince ? Date.parse(s.onSince) : (d.status === 'on' ? now : null);
      }
      if (typeof saved.energyWhToday === 'number') this.energyWhToday = saved.energyWhToday;
      
      if (saved.alertFirstSeen) {
        for (const [k, v] of Object.entries(saved.alertFirstSeen)) {
          this.alertFirstSeen.set(k, Date.parse(v));
        }
      }
    } catch {
      // No (or unreadable) saved state — start fresh. Expected on the first run.
    }
  }

  _snapshotForDisk() {
    return {
      savedAt: new Date().toISOString(),
      simTime: new Date(this.simTime).toISOString(),
      energyWhToday: +this.energyWhToday.toFixed(3),
      alertFirstSeen: Object.fromEntries([...this.alertFirstSeen.entries()].map(([k, v]) => [k, new Date(v).toISOString()])),
      // Each device carries exactly what the brief asks for: status, power draw,
      // room, and the timestamp it last changed.
      devices: this.devices.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        room: d.room.name,
        roomId: d.room.id,
        status: d.status,
        powerW: d.powerW,
        lastChanged: new Date(d.lastChanged).toISOString(),
        onSince: d.onSince ? new Date(d.onSince).toISOString() : null,
      })),
    };
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(this._snapshotForDisk(), null, 2));
    } catch {
      // Disk not writable — the simulation keeps running from memory.
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save();
    }, 1000);
    this._saveTimer.unref?.();
  }

  // Every 5s: evaluate all devices to see if they change state.
  _deviceTick() {
    if (this.paused) return;
    const office = isOfficeHours(this.simTime);
    
    // Evaluate every device, but only change state 20% of the time per tick
    // so it doesn't look like a crazy disco party on the dashboard.
    for (const d of this.devices) {
      if (Math.random() > 0.2) continue; // 80% chance to just stay as-is this tick
      
      // During office hours people switch things on; after hours they trend off
      const target = office ? (Math.random() < 0.65 ? 'on' : 'off') : Math.random() < 0.7 ? 'off' : 'on';
      this._applyStatus(d, target);
    }
    
    this.recomputeAlerts();
    this.emit('update');
  }

  // Every 1s: smoothly advance the clock by 60 seconds (60x real-time speed).
  _fastClockTick() {
    if (this.paused) return;
    const prev = this.simTime;
    const next = prev + 60000; // +1 minute
    if (new Date(next).getDate() !== new Date(prev).getDate()) {
      this.energyWhToday = 0;
      this.lastEnergyDay = new Date(next).getDate();
    } else {
      this._accumulateEnergy(next - prev);
    }
    this.simTime = next;
    this.recomputeAlerts();
    this.emit('update');
  }

  // Every 30s: advance the simulated clock by a random forward step, so the
  // office day moves unpredictably and both alert types arise on their own.
  _timeTick() {
    if (this.paused) return;
    const prev = this.simTime;
    const stepMin = TIME_STEP_MIN_MIN + Math.floor(Math.random() * (TIME_STEP_MAX_MIN - TIME_STEP_MIN_MIN + 1));
    const next = prev + stepMin * 60000;
    if (new Date(next).getDate() !== new Date(prev).getDate()) {
      this.energyWhToday = 0; // new day -> reset the running kWh total
      this.lastEnergyDay = new Date(next).getDate();
    } else {
      this._accumulateEnergy(next - prev);
    }
    this.simTime = next;
    this.recomputeAlerts();
    this.emit('update');
  }

  // --- alerts --------------------------------------------------------------
  recomputeAlerts() {
    const now = this.simTime;
    const office = isOfficeHours(now);
    const active = new Map();

    // (1) After-hours notification: any device left ON outside 9 AM–5 PM,
    // reported per room with fan/light counts.
    for (const room of ROOMS) {
      const devs = this.devices.filter((d) => d.room.id === room.id);
      const on = devs.filter((d) => d.status === 'on');
      if (!office && on.length > 0) {
        const fans = on.filter((d) => d.type === 'fan').length;
        const lights = on.filter((d) => d.type === 'light').length;
        // Include counts in the ID so when the state changes, a fresh alert is triggered!
        const id = `afterhours-${room.id}-f${fans}-l${lights}`;
        active.set(id, {
          id,
          type: 'after_hours',
          severity: 'warning',
          room: room.name,
          message: `${room.name} still has ${fans} fan(s) and ${lights} light(s) ON after office hours (9 AM–5 PM).`,
        });
      }
    }

    // (2) Per-device: a single device ON for more than 2 hours straight.
    for (const d of this.devices) {
      if (d.status !== 'on' || d.onSince == null) continue;
      const hrs = (now - d.onSince) / 3600000;
      if (hrs >= DEVICE_ON_ALERT_HOURS) {
        const id = `deviceon-${d.id}`;
        active.set(id, {
          id,
          type: 'device_on',
          severity: 'critical',
          room: d.room.name,
          device: d.name,
          message: `${d.name} in ${d.room.name} has been ON for ${hrs.toFixed(1)}h straight.`,
        });
      }
    }

    // (3) Room-level: ALL devices in a room have been ON for more than 2 hours.
    for (const room of ROOMS) {
      const devs = this.devices.filter((d) => d.room.id === room.id);
      const allOn = devs.every((d) => d.status === 'on' && d.onSince != null);
      if (allOn && devs.length > 0) {
        const minOnHrs = Math.min(...devs.map((d) => (now - d.onSince) / 3600000));
        if (minOnHrs >= DEVICE_ON_ALERT_HOURS) {
          const id = `roomallon-${room.id}`;
          active.set(id, {
            id,
            type: 'room_all_on',
            severity: 'critical',
            room: room.name,
            message: `All devices in ${room.name} have been ON for over ${minOnHrs.toFixed(1)}h — the entire room is drawing power continuously.`,
          });
        }
      }
    }

    const newlyRaised = [];
    for (const [id, a] of active) {
      if (!this.alertFirstSeen.has(id)) {
        this.alertFirstSeen.set(id, now);
        newlyRaised.push(a);
      }
      a.since = this.alertFirstSeen.get(id);
      a.timestamp = now;
    }
    for (const id of [...this.alertFirstSeen.keys()]) {
      if (!active.has(id)) this.alertFirstSeen.delete(id);
    }
    this.alerts = [...active.values()].sort((x, y) => x.since - y.since);

    for (const a of newlyRaised) {
      this.emit('newAlert', { ...a, since: this.alertFirstSeen.get(a.id) });
    }
  }

  // --- public actions (called by REST API + Discord bot) -------------------
  toggleDevice(id) {
    const d = this._device(id);
    if (!d) return false;
    this._applyStatus(d, d.status === 'on' ? 'off' : 'on');
    this.recomputeAlerts();
    this.emit('update');
    return true;
  }

  setDevice(id, status) {
    const d = this._device(id);
    if (!d || (status !== 'on' && status !== 'off')) return false;
    this._applyStatus(d, status);
    this.recomputeAlerts();
    this.emit('update');
    return true;
  }

  setRoom(roomId, status) {
    if (status !== 'on' && status !== 'off') return false;
    const devs = this.devices.filter((d) => d.room.id === roomId);
    if (devs.length === 0) return false;
    for (const d of devs) this._applyStatus(d, status);
    this.recomputeAlerts();
    this.emit('update');
    return true;
  }

  setTimeHour(hour) {
    if (typeof hour !== 'number' || hour < 0 || hour > 23) return false;
    const d = new Date(this.simTime);
    d.setHours(hour, 0, 0, 0);
    this.simTime = d.getTime();
    this.recomputeAlerts();
    this.emit('update');
    return true;
  }

  pause() {
    this.paused = true;
    this.emit('update');
    return true;
  }

  resume() {
    this.paused = false;
    this.emit('update');
    return true;
  }

  randomize() {
    for (const d of this.devices) this._applyStatus(d, Math.random() < 0.5 ? 'on' : 'off');
    this.recomputeAlerts();
    this.emit('update');
    return true;
  }

  reset() {
    this._init(false); // fresh random state — ignore the saved file
    this._save(); // and overwrite the store so the reset persists
    this.emit('update');
    return true;
  }

  // --- read models ---------------------------------------------------------
  getState() {
    const now = this.simTime;
    const perRoom = {};
    for (const room of ROOMS) perRoom[room.id] = { id: room.id, name: room.name, watts: 0, on: 0, total: 0 };
    let totalW = 0;
    for (const d of this.devices) {
      const r = perRoom[d.room.id];
      r.total++;
      if (d.status === 'on') {
        r.on++;
        r.watts += d.powerW;
        totalW += d.powerW;
      }
    }
    return {
      time: {
        iso: new Date(now).toISOString(),
        epoch: now,
        hour: new Date(now).getHours(),
        officeHours: isOfficeHours(now),
        officeOpen: OFFICE_OPEN_HOUR,
        officeClose: OFFICE_CLOSE_HOUR,
        paused: this.paused,
      },
      devices: this.devices.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        roomId: d.room.id,
        room: d.room.name,
        status: d.status,
        powerW: d.powerW,
        onSince: d.onSince ? new Date(d.onSince).toISOString() : null,
        lastChanged: new Date(d.lastChanged).toISOString(),
      })),
      power: { totalW, perRoom: Object.values(perRoom) },
      usage: { totalW, todayKWh: +(this.energyWhToday / 1000).toFixed(3) },
      alerts: this.alerts.map((a) => ({
        ...a,
        sinceIso: new Date(a.since).toISOString(),
        timestampIso: new Date(a.timestamp).toISOString(),
      })),
      rooms: ROOMS.map((r) => ({ id: r.id, name: r.name })),
    };
  }

  getRoomSummary(roomId) {
    const room = ROOMS.find((r) => r.id === roomId);
    if (!room) return null;
    const devs = this.devices.filter((d) => d.room.id === roomId);
    return {
      id: room.id,
      name: room.name,
      fansOn: devs.filter((d) => d.type === 'fan' && d.status === 'on').length,
      fansTotal: devs.filter((d) => d.type === 'fan').length,
      lightsOn: devs.filter((d) => d.type === 'light' && d.status === 'on').length,
      lightsTotal: devs.filter((d) => d.type === 'light').length,
      watts: devs.reduce((s, d) => s + (d.status === 'on' ? d.powerW : 0), 0),
      devices: devs.map((d) => ({ name: d.name, type: d.type, status: d.status })),
    };
  }
}

export const simulation = new Simulation();
export { ROOMS };
