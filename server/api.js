// ---------------------------------------------------------------------------
// REST API  ->  the [Backend API] layer.
// The web dashboard and (indirectly) the Discord bot both act through here,
// so there is exactly one source of truth for device state.
// ---------------------------------------------------------------------------
import { Router } from 'express';

export function createApiRouter(simulation) {
  const router = Router();

  // Full snapshot (devices, power, usage, alerts, sim clock).
  router.get('/state', (_req, res) => res.json(simulation.getState()));

  // Status of one room, e.g. /api/rooms/work1
  router.get('/rooms/:room', (req, res) => {
    const summary = simulation.getRoomSummary(req.params.room);
    if (!summary) return res.status(404).json({ error: 'unknown room' });
    res.json(summary);
  });

  // Live power / today's estimated usage.
  router.get('/usage', (_req, res) => {
    const s = simulation.getState();
    res.json({ totalW: s.usage.totalW, todayKWh: s.usage.todayKWh, perRoom: s.power.perRoom });
  });

  router.get('/alerts', (_req, res) => res.json(simulation.getState().alerts));

  return router;
}

function respond(res, ok, simulation) {
  if (!ok) return res.status(400).json({ error: 'invalid request' });
  res.json(simulation.getState());
}
