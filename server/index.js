// ---------------------------------------------------------------------------
// Entry point. Wires one shared backend to two interfaces:
//   [Simulated Device Layer] -> [Backend API] -> [ Web UI ] && [ Discord Bot ]
// ---------------------------------------------------------------------------
import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';

import { simulation } from './simulation.js';
import { createApiRouter } from './api.js';
import { startBot } from './bot.js';
import { startFirebaseSync } from './firebase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json());
app.use('/api', createApiRouter(simulation));
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server);

// Push a fresh snapshot to every dashboard the moment anything changes.
io.on('connection', (socket) => socket.emit('state', simulation.getState()));
simulation.on('update', () => io.emit('state', simulation.getState()));

simulation.start();

// Mirror live device state up to the Firebase Realtime Database.
startFirebaseSync(simulation);

startBot(simulation, {
  token: process.env.DISCORD_TOKEN,
  prefix: process.env.BOT_PREFIX || '!',
  alertChannelId: process.env.ALERT_CHANNEL_ID,
});

server.listen(PORT, () => {
  console.log(`[web] dashboard + API on http://localhost:${PORT}`);
});
