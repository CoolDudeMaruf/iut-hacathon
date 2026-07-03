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

// Fixed floor-plan positions (percent of the room box) so fans and lights sit
// where they'd hang in the real top-view office: lights in the corners + bottom,
// two ceiling fans over the desks in the middle.
const ROOM_POS = {
  light: [
    { top: '15%', left: '16%' }, // Light 1 — top-left
    { top: '15%', left: '84%' }, // Light 2 — top-right
    { top: '86%', left: '50%' }, // Light 3 — bottom-centre
  ],
  fan: [
    { top: '46%', left: '31%' }, // Fan 1 — centre-left
    { top: '46%', left: '69%' }, // Fan 2 — centre-right
  ],
};
const DESK_POS = [
  { top: '62%', left: '26%' },
  { top: '62%', left: '74%' },
];

function assetEl(d) {
  const svg = d.type === 'fan' ? FAN_SVG : LIGHT_SVG;
  const idx = Math.max(0, (parseInt(d.name.replace(/\D/g, ''), 10) || 1) - 1);
  const pos = (ROOM_POS[d.type] && ROOM_POS[d.type][idx]) || { top: '50%', left: '50%' };
  return `<div class="device asset ${d.type} ${d.status}" data-toggle="${d.id}"
      style="top:${pos.top};left:${pos.left}"
      title="${d.room} · ${d.name} · ${d.status.toUpperCase()}">
      ${svg}<span class="label">${d.name}</span>
    </div>`;
}

function renderLayout(state) {
  const alertRooms = new Set(state.alerts.map((a) => a.room));
  const desks = DESK_POS.map((p) => `<div class="desk" style="top:${p.top};left:${p.left}"></div>`).join('');
  const html = state.rooms
    .map((room) => {
      const devs = state.devices.filter((d) => d.roomId === room.id);
      const alerting = alertRooms.has(room.name) ? 'after-alert' : '';
      return `<div class="room ${alerting}">
          <div class="room-name">${room.name}</div>
          <div class="room-floor">${desks}${devs.map(assetEl).join('')}</div>
        </div>`;
    })
    .join('');
  $('office').innerHTML = html;
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
