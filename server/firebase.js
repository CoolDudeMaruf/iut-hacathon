// ---------------------------------------------------------------------------
// Firebase Realtime Database sync (optional mirror of the live device state).
//
// The simulation stays the single source of truth; this module just mirrors
// each device's on/off status up to a Firebase Realtime Database so an external
// consumer (e.g. an ESP32 or a phone app) can read live state. It uses the RTDB
// REST API over the built-in fetch — no extra dependency, no service account.
//
// The DB tree matches the schema already set up in the console:
//   "<Room Name>": { "fan1": { status: <bool>, last_update: <epoch ms> }, ... }
// ---------------------------------------------------------------------------
import { ROOMS } from './simulation.js';

// Default to the project's DB; override with FIREBASE_DB_URL in .env if needed.
const DB_URL = (
  process.env.FIREBASE_DB_URL ||
  'https://iut-techathon-default-rtdb.asia-southeast1.firebasedatabase.app'
).replace(/\/$/, '');

// If an ID token / DB secret is provided, append it as ?auth= for locked rules.
const AUTH = process.env.FIREBASE_AUTH || '';

// drawing-fan-1 -> "fan1", drawing-light-3 -> "light3"
function fbKey(device) {
  const num = device.id.split('-').pop();
  return `${device.type}${num}`;
}

function url(path) {
  const q = AUTH ? `?auth=${encodeURIComponent(AUTH)}` : '';
  return `${DB_URL}/${path}.json${q}`;
}

export function startFirebaseSync(simulation) {
  // Remember the last status we wrote per device so we only push real changes.
  const lastPushed = new Map();
  let inFlight = false;
  let pendingForce = false;

  async function patch(updates) {
    const res = await fetch(url(''), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  }

  // Build a flat multi-path update of just the devices whose status changed.
  async function push(force = false) {
    if (inFlight) {
      pendingForce = pendingForce || force;
      return;
    }
    const updates = {};
    for (const d of simulation.devices) {
      const on = d.status === 'on';
      if (!force && lastPushed.get(d.id) === on) continue;
      lastPushed.set(d.id, on);
      const base = `${d.room.name}/${fbKey(d)}`;
      updates[`${base}/status`] = on;
      updates[`${base}/last_update`] = Date.now();
    }
    if (Object.keys(updates).length === 0) return;

    inFlight = true;
    try {
      await patch(updates);
    } catch (err) {
      // Network/permission hiccup — drop the "pushed" memory for changed
      // devices so the next tick retries them, and keep the sim running.
      for (const d of simulation.devices) lastPushed.delete(d.id);
      console.error('[firebase] sync failed:', err.message);
    } finally {
      inFlight = false;
      if (pendingForce) {
        pendingForce = false;
        push(true);
      }
    }
  }

  // Initial full push so the DB reflects every device right away, then mirror
  // each subsequent change. push() no-ops when no status actually changed, so
  // the once-a-second clock tick doesn't spam the database.
  push(true);
  simulation.on('update', () => push());

  console.log(`[firebase] mirroring live device state to ${DB_URL}`);
  console.log(`[firebase] rooms synced: ${ROOMS.map((r) => r.name).join(', ')}`);
}
