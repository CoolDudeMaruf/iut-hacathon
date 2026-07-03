// ---------------------------------------------------------------------------
// Discord bot  ->  the boss's quick-access remote control.
// Reads from the SAME simulation module as the web dashboard, so both
// interfaces always reflect the same reality.
// ---------------------------------------------------------------------------
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { humanize, llmEnabled } from './llm.js';

function resolveRoom(input = '') {
  const s = input.toLowerCase().replace(/\s+/g, '');
  if (s.includes('draw')) return 'drawing';
  if (s.includes('1') || s.includes('one')) return 'work1';
  if (s.includes('2') || s.includes('two')) return 'work2';
  return null;
}

// --- deterministic templates (always correct, work without an LLM) ---------
function statusTemplate(sim) {
  const parts = ['drawing', 'work1', 'work2'].map((id) => {
    const r = sim.getRoomSummary(id);
    if (r.fansOn === 0 && r.lightsOn === 0) return `**${r.name}**: all off (0W)`;
    const onDevs = r.devices.filter(d => d.status === 'on').map(d => d.name).join(', ');
    return `**${r.name}**: ${r.watts}W total. ON: ${onDevs}`;
  });
  return parts.join('\n');
}

function roomTemplate(r) {
  const devDetails = r.devices.map(d => `- ${d.name}: ${d.status === 'on' ? '🟢 ON' : '⚫ OFF'}`).join('\n');
  return `**${r.name} Status:**\nDrawing ${r.watts}W right now.\nFans: ${r.fansOn}/${r.fansTotal} ON | Lights: ${r.lightsOn}/${r.lightsTotal} ON\n\n**Device List:**\n${devDetails}`;
}

function usageTemplate(state) {
  return `Total power right now: ${state.usage.totalW}W. Today's estimated usage: ${state.usage.todayKWh} kWh.`;
}

export function startBot(simulation, { token, prefix = '!', alertChannelId } = {}) {
  if (!token) {
    console.log('[bot] DISCORD_TOKEN not set — Discord bot disabled (dashboard + API still run).');
    return null;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  // ClientReady is handled below, after the alert queue is set up.

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.content.startsWith(prefix)) return;
    const [cmd, ...args] = message.content.slice(prefix.length).trim().split(/\s+/);
    const command = cmd.toLowerCase();

    try {
      if (command === 'status') {
        const template = statusTemplate(simulation);
        const facts = { rooms: ['drawing', 'work1', 'work2'].map((id) => simulation.getRoomSummary(id)) };
        const reply = (await humanize('Give the boss a highly detailed breakdown of every room. List exactly how many watts each room is drawing, and state exactly which devices (by name) are currently ON in each room. Format it nicely.', facts)) || template;
        await message.reply(reply);
      } else if (command === 'room') {
        const roomId = resolveRoom(args.join(' '));
        if (!roomId) return void message.reply('Which room? Try `!room drawing`, `!room work1`, or `!room work2`.');
        const summary = simulation.getRoomSummary(roomId);
        const reply = (await humanize(`Give the boss a highly detailed update for ${summary.name}. List exactly which fans and lights are ON or OFF by name, and state the exact total wattage the room is currently drawing. Make it easy to read.`, summary)) || roomTemplate(summary);
        await message.reply(reply);
      } else if (command === 'usage') {
        const state = simulation.getState();
        const facts = { totalW: state.usage.totalW, todayKWh: state.usage.todayKWh, perRoom: state.power.perRoom };
        const reply = (await humanize('Tell the boss the current power draw and today\'s estimated usage.', facts)) || usageTemplate(state);
        await message.reply(reply);
      } else if (command === 'alerts') {
        const alerts = simulation.getState().alerts;
        if (alerts.length === 0) return void message.reply('✅ All clear — no active alerts right now.');
        const emoji = { after_hours: '⚠️', device_on: '🔴', room_all_on: '🚨' };
        const reply =
          (await humanize('Summarise these active alerts for the boss, friendly but a nudge to act.', alerts)) ||
          alerts.map((a) => `${emoji[a.type] || '⚠️'} ${a.message}`).join('\n');
        await message.reply(reply);
      } else if (command === 'help') {
        await message.reply(
          [
            '**Office energy bot — commands**',
            `\`${prefix}status\` — on/off state of every room`,
            `\`${prefix}room <name>\` — one room (drawing / work1 / work2)`,
            `\`${prefix}usage\` — current power + today's kWh`,
            `\`${prefix}alerts\` — active anomalies`,
          ].join('\n'),
        );
      }
    } catch (err) {
      console.error('[bot] command error:', err);
      await message.reply('Something went sideways handling that — check the server logs.');
    }
  });

  // --- proactive alerts: push alerts to the designated Discord channel -------
  // Two mechanisms ensure alerts are NEVER missed:
  //   1. Event-driven: the 'newAlert' event fires the instant a new alert appears.
  //   2. Periodic polling: every 30s, scan active alerts and post any unsent ones.
  // A Set tracks which alert IDs have already been posted to avoid duplicates.

  function alertFallback(alert) {
    switch (alert.type) {
      case 'after_hours':
        return `⚠️ **After-Hours Alert** — ${alert.message}\nIt's past office hours (9 AM–5 PM). Someone might have forgotten to switch off!`;
      case 'device_on':
        return `🔴 **Device Alert** — ${alert.message}\nThis device has been running continuously for over 2 hours. Consider turning it off to save energy.`;
      case 'room_all_on':
        return `🚨 **Room Alert** — ${alert.message}\nEvery single device in this room has been drawing power non-stop. Please check if anyone is still there.`;
      default:
        return `⚠️ ${alert.message}`;
    }
  }

  const postedAlertIds = new Set();

  async function sendAlertToChannel(alert) {
    if (!alertChannelId) return;
    if (postedAlertIds.has(alert.id)) return; // already posted
    try {
      const channel = await client.channels.fetch(alertChannelId);
      if (!channel?.isTextBased()) return;
      const text =
        (await humanize(
          `Post a short, friendly but urgent proactive alert about this. Type: ${alert.type}, severity: ${alert.severity}.`,
          alert,
        )) || alertFallback(alert);
      await channel.send(text);
      postedAlertIds.add(alert.id);
      console.log(`[bot] ✅ proactive alert sent → #${channel.name}: ${alert.type} / ${alert.id}`);
    } catch (err) {
      console.warn('[bot] ❌ could not post proactive alert:', err.message);
    }
  }

  // Clean up posted IDs that are no longer active (so they can fire again later).
  function prunePostedAlerts() {
    const activeIds = new Set(simulation.getState().alerts.map((a) => a.id));
    for (const id of postedAlertIds) {
      if (!activeIds.has(id)) postedAlertIds.delete(id);
    }
  }

  // Queue alerts that arrive before the bot is ready.
  let botReady = false;
  const pendingAlerts = [];

  // (1) Event-driven: catch the instant a new alert appears.
  simulation.on('newAlert', (alert) => {
    if (botReady && alertChannelId) {
      sendAlertToChannel(alert);
    } else if (alertChannelId) {
      console.log(`[bot] alert queued (bot not ready yet): [${alert.type}] ${alert.message}`);
      pendingAlerts.push(alert);
    } else {
      console.log(`[bot] new alert (no channel configured): [${alert.type}] ${alert.message}`);
    }
  });

  // When the bot is fully logged in, flush queued alerts and start the periodic poller.
  client.once(Events.ClientReady, async (c) => {
    console.log(`[bot] logged in as ${c.user.tag}. LLM phrasing: ${llmEnabled ? 'on' : 'off (templates)'}.`);
    botReady = true;

    // Flush any alerts that fired before the bot was connected.
    if (alertChannelId && pendingAlerts.length > 0) {
      console.log(`[bot] flushing ${pendingAlerts.length} queued alert(s)…`);
      for (const alert of pendingAlerts) {
        await sendAlertToChannel(alert);
      }
      pendingAlerts.length = 0;
    }

    // (2) Periodic polling: every 30s, check for any active alerts we haven't posted.
    if (alertChannelId) {
      setInterval(async () => {
        prunePostedAlerts();
        const alerts = simulation.getState().alerts;
        for (const alert of alerts) {
          await sendAlertToChannel(alert);
        }
      }, 30_000).unref?.();
      console.log(`[bot] periodic alert polling started (every 30s) → channel ${alertChannelId}`);
    }
  });

  client.login(token).catch((err) => console.error('[bot] login failed:', err.message));
  return client;
}
