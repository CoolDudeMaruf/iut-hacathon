// ---------------------------------------------------------------------------
// Dashboard client. Live state arrives over WebSocket from the shared backend
// (the same source of truth the Discord bot reads). The office runs itself:
// device states change every 5s and the clock advances every 30s.
// ---------------------------------------------------------------------------
const socket = io();

const FAN_SVG = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  <g fill="currentColor">
    <ellipse cx="12" cy="7" rx="2" ry="5"/>
    <ellipse cx="12" cy="7" rx="2" ry="5" transform="rotate(120 12 12)"/>
    <ellipse cx="12" cy="7" rx="2" ry="5" transform="rotate(240 12 12)"/>
    <circle cx="12" cy="12" r="2.3"/>
  </g></svg>`;
const LIGHT_SVG = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="11" r="6.5" fill="currentColor"/>
  <rect x="9.5" y="17" width="5" height="3" rx="1" fill="currentColor" opacity="0.6"/></svg>`;

const $ = (id) => document.getElementById(id);

async function api(path, body) {
  await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtTime(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- renderers ------------------------------------------------------------
function render(state) {
  renderClock(state.time);
  renderLayout(state);
  renderPower(state);
  renderAlerts(state.alerts);
  renderDevices(state);
}

function renderClock(t) {
  $('sim-time').textContent = fmtTime(t.iso);
  const badge = $('office-badge');
  badge.textContent = t.officeHours ? 'office hours' : 'after hours';
  badge.classList.toggle('after', !t.officeHours);
}

// Device positions as a percent of the WHOLE floor-plan image
// (public/roomlayout.jpg, 1247×747), measured so each marker sits exactly over
// the fan/light drawn on the plan. Index 0/1 = Fan 1/2, index 0/1/2 = Light 1/2/3.
const LAYOUT = {
  drawing: {
    fan: [
      { top: '14.1%', left: '17.6%' }, // Fan 1 — top
      { top: '54.9%', left: '18.4%' }, // Fan 2 — bottom
    ],
    light: [
      { top: '11.8%', left: '10.0%' }, // Light 1 — top-left
      { top: '12.0%', left: '28.1%' }, // Light 2 — top-right
      { top: '69.3%', left: '18.6%' }, // Light 3 — bottom
    ],
  },
  work1: {
    fan: [
      { top: '14.1%', left: '50.7%' },
      { top: '50.6%', left: '50.7%' },
    ],
    light: [
      { top: '12.0%', left: '41.9%' },
      { top: '12.0%', left: '59.3%' },
      { top: '68.9%', left: '50.5%' },
    ],
  },
  work2: {
    fan: [
      { top: '13.8%', left: '82.6%' },
      { top: '50.6%', left: '82.6%' },
    ],
    light: [
      { top: '12.0%', left: '74.2%' },
      { top: '12.0%', left: '91.4%' },
      { top: '68.9%', left: '83.0%' },
    ],
  },
};

// Room interior boxes (percent of the image) — used to tint a room red on alert.
const ROOM_REGION = {
  drawing: { left: '1%', top: '2%', width: '33%', height: '77%' },
  work1: { left: '34.7%', top: '2%', width: '31.6%', height: '77%' },
  work2: { left: '67.3%', top: '2%', width: '31.4%', height: '77%' },
};

function assetEl(d, pos) {
  const svg = d.type === 'fan' ? FAN_SVG : LIGHT_SVG;
  return `<div class="asset ${d.type} ${d.status}"
      style="top:${pos.top};left:${pos.left}"
      title="${d.room} · ${d.name} · ${d.status.toUpperCase()}">
      ${svg}<span class="label">${d.name}</span>
    </div>`;
}

function renderLayout(state) {
  const alertRooms = new Set(state.alerts.map((a) => a.room));
  const regions = state.rooms
    .map((room) => {
      const r = ROOM_REGION[room.id];
      if (!r) return '';
      const alerting = alertRooms.has(room.name) ? 'alerting' : '';
      return `<div class="room-region ${alerting}"
          style="left:${r.left};top:${r.top};width:${r.width};height:${r.height}"></div>`;
    })
    .join('');
  const assets = state.devices
    .map((d) => {
      const arr = (LAYOUT[d.roomId] && LAYOUT[d.roomId][d.type]) || [];
      const idx = Math.max(0, (parseInt(d.name.replace(/\D/g, ''), 10) || 1) - 1);
      const pos = arr[idx] || { top: '50%', left: '50%' };
      return assetEl(d, pos);
    })
    .join('');
  $('office').innerHTML = regions + assets;
}

function renderPower(state) {
  $('power-total').textContent = state.power.totalW;
  $('usage-kwh').textContent = state.usage.todayKWh;
  const ceiling = 165; // per-room max: 2 fans*60W + 3 lights*15W
  $('rooms-power').innerHTML = state.power.perRoom
    .map(
      (r) => `<div class="rp">
        <div class="rp-top"><span>${r.name}</span><span>${r.watts} W · ${r.on}/${r.total} on</span></div>
        <div class="bar"><span style="width:${Math.min(100, (r.watts / ceiling) * 100)}%"></span></div>
      </div>`,
    )
    .join('');
}

function renderAlerts(alerts) {
  if (!alerts.length) {
    $('alerts').innerHTML = `<div class="all-clear">✅ All clear — nothing left running out of hours.</div>`;
    return;
  }
  $('alerts').innerHTML = alerts
    .map(
      (a) => `<div class="alert ${a.severity}">
        <div class="msg">${a.severity === 'critical' ? '🔴' : '⚠️'} ${a.message}</div>
        <div class="ts">since ${fmtTime(a.sinceIso)} · office-time</div>
      </div>`,
    )
    .join('');
}

function renderDevices(state) {
  $('devices').innerHTML = state.rooms
    .map((room) => {
      const devs = state.devices.filter((d) => d.roomId === room.id);
      const rows = devs
        .map(
          (d) => `<div class="dev-row ${d.status}" data-toggle="${d.id}">
            <span>${d.type === 'fan' ? '🌀' : '💡'} ${d.name}</span>
            <span class="state">${d.status}</span>
          </div>`,
        )
        .join('');
      return `<div class="dev-room"><h3>${room.name}</h3>${rows}</div>`;
    })
    .join('');
}

// ---- events ---------------------------------------------------------------
socket.on('state', render);

// Manual override has been removed per user request (no playground mode).

// Initial paint (in case the socket snapshot is delayed).
fetch('/api/state')
  .then((r) => r.json())
  .then(render)
  .catch(() => {});
