const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus
} = require('@discordjs/voice');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SOUND_DIR = path.join(__dirname, 'sounds');

const clients = new Map();
const botState = new Map();
const audioPlayers = new Map();

if (!fs.existsSync(SOUND_DIR)) {
  fs.mkdirSync(SOUND_DIR, { recursive: true });
}

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '25mb' }));

function ensureBotState(token) {
  if (!botState.has(token)) {
    botState.set(token, {
      volume: 100,
      joined: [],
      player: null
    });
  }
  return botState.get(token);
}

async function getClient(token) {
  if (!token || !token.includes('.')) {
    throw new Error('Invalid token format. Must be a Discord bot token.');
  }

  if (clients.has(token)) {
    const c = clients.get(token);
    if (c && c.isReady()) return c;
    clients.delete(token);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages
    ]
  });

  await client.login(token);
  clients.set(token, client);
  return client;
}

async function resolveGuildForVc(client, channelId) {
  if (!channelId || !/^[0-9]+$/.test(String(channelId))) return null;

  for (const guild of client.guilds.cache.values()) {
    let channel = guild.channels.cache.get(String(channelId));
    if (!channel) {
      channel = await guild.channels.fetch(String(channelId)).catch(() => null);
    }
    if (channel && channel.isVoiceBased?.()) {
      return guild.id;
    }
  }

  return null;
}

async function leaveAll(client, token) {
  const state = ensureBotState(token);
  const ids = [...state.joined];
  state.joined = [];

  for (const guildId of ids) {
    const conn = getVoiceConnection(guildId);
    if (conn) conn.destroy();
  }

  return { left: ids.length };
}

async function muteAll(client, token) {
  let muted = 0;
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(client.user.id);
    if (!member || !member.voice.channelId) continue;
    await member.voice.setMute(true).catch(() => {});
    muted += 1;
  }
  return { muted };
}

async function unmuteAll(client, token) {
  let unmuted = 0;
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(client.user.id);
    if (!member || !member.voice.channelId) continue;
    await member.voice.setMute(false).catch(() => {});
    unmuted += 1;
  }
  return { unmuted };
}

async function deafenAll(client, token) {
  let deafened = 0;
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(client.user.id);
    if (!member || !member.voice.channelId) continue;
    await member.voice.setDeaf(true).catch(() => {});
    deafened += 1;
  }
  return { deafened };
}

async function undeafenAll(client, token) {
  let undeafened = 0;
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(client.user.id);
    if (!member || !member.voice.channelId) continue;
    await member.voice.setDeaf(false).catch(() => {});
    undeafened += 1;
  }
  return { undeafened };
}

async function playLocalSoundForToken(token, channelId, soundPath, volume = 100) {
  const client = await getClient(token);
  const guildId = await resolveGuildForVc(client, channelId);
  if (!guildId) {
    throw new Error('Bot is not in that guild or channel is unavailable.');
  }

  const resolvedPath = path.isAbsolute(soundPath) ? soundPath : path.join(SOUND_DIR, soundPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error('Sound file does not exist on disk: ' + resolvedPath);
  }

  const connection = getVoiceConnection(guildId) || joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator: client.guilds.cache.get(guildId)?.voiceAdapterCreator
  });

  if (connection.state.status !== VoiceConnectionStatus.Ready) {
    await entersState(connection, VoiceConnectionStatus.Ready, 15000);
  }

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
  });

  const stream = fs.createReadStream(resolvedPath);
  const resource = createAudioResource(stream, {
    inputType: StreamType.Arbitrary,
    inlineVolume: true
  });

  resource.volume?.setVolume(Math.max(0, Math.min(2, volume / 100)));

  player.play(resource);
  connection.subscribe(player);
  audioPlayers.set(`${token}:${guildId}`, player);

  return { ok: true, guildId, channelId, sound: resolvedPath, volume };
}

app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'ready', port: PORT, bots: clients.size });
});

app.post('/api/action', async (req, res) => {
  try {
    const body = req.body || {};
    const { action, token, vcId, soundPath, volume, mode } = body;
    const requestedTokens = Array.isArray(body.tokens) ? body.tokens.filter(Boolean) : [];
    const tokensToRun = requestedTokens.length ? requestedTokens : (token ? [token] : []);

    if (!action) return res.status(400).json({ ok: false, error: 'Missing action' });
    if (!tokensToRun.length && action !== 'setVolume' && action !== 'clearTokens') {
      return res.status(400).json({ ok: false, error: 'Missing token' });
    }

    if (action === 'loadSound' && body.name && body.data) {
      const fileName = String(body.name).replace(/[^a-zA-Z0-9_.-]/g, '_');
      const target = path.join(SOUND_DIR, fileName || 'sound.wav');
      const data = Buffer.from(String(body.data), 'base64');
      fs.writeFileSync(target, data);
      if (token) {
        botState.set(token, { ...(botState.get(token) || {}), lastSoundPath: target, volume: Number(volume || 100) });
      }
      return res.json({ ok: true, saved: target, name: fileName, size: data.length });
    }

    if (action === 'setVolume') {
      const tokenValue = token || (requestedTokens[0] || '');
      if (!tokenValue) return res.json({ ok: true, volume: Number(volume || 100) });
      const state = ensureBotState(tokenValue);
      const volumeValue = Number(volume || 100);
      state.volume = Number.isFinite(volumeValue) ? Math.max(0, Math.min(200, volumeValue)) : 100;
      return res.json({ ok: true, volume: state.volume });
    }

    if (action === 'connect' || action === 'botOnline') {
      const results = [];
      for (const currentToken of tokensToRun) {
        try {
          const client = await getClient(currentToken);
          results.push({ token: currentToken, ok: true, status: client.isReady() ? 'online' : 'connecting', guilds: client.guilds.cache.size });
        } catch (error) {
          results.push({ token: currentToken, ok: false, error: String(error.message || error) });
        }
      }
      return res.json({ ok: results.some(r => r.ok), results, connected: results.filter(r => r.ok).length });
    }

    if (action === 'join' || action === 'joinAll') {
      if (!vcId || !/^[0-9]+$/.test(String(vcId))) {
        return res.status(400).json({ ok: false, error: 'Invalid VC ID', skipped: true });
      }

      const results = [];
      const activeTokens = action === 'join' ? tokensToRun.slice(0, 1) : tokensToRun;
      for (const currentToken of activeTokens) {
        try {
          const client = await getClient(currentToken);
          const guildId = await resolveGuildForVc(client, vcId);
          if (!guildId) {
            results.push({ token: currentToken, ok: false, skipped: true, reason: 'Bot is not in that server/channel' });
            continue;
          }

          const guild = client.guilds.cache.get(guildId);
          const connection = joinVoiceChannel({
            channelId: String(vcId),
            guildId,
            adapterCreator: guild?.voiceAdapterCreator ?? client.guilds.cache.get(guildId)?.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
          });

          await entersState(connection, VoiceConnectionStatus.Ready, 15000).catch(() => {});
          const state = ensureBotState(currentToken);
          state.joined = [...new Set([...state.joined, guildId])];
          results.push({ token: currentToken, ok: true, guildId, channelId: vcId, mode });
        } catch (error) {
          results.push({ token: currentToken, ok: false, error: String(error.message || error) });
        }
      }
      return res.json({ ok: results.some(r => r.ok), results, joined: results.filter(r => r.ok).length, skipped: results.filter(r => r.skipped).length });
    }

    if (action === 'leaveAll' || action === 'muteAll' || action === 'unmuteAll' || action === 'deafenAll' || action === 'undeafenAll') {
      const results = [];
      for (const currentToken of tokensToRun) {
        try {
          const client = await getClient(currentToken);
          const state = ensureBotState(currentToken);
          let result;
          switch (action) {
            case 'leaveAll': result = await leaveAll(client, currentToken); break;
            case 'muteAll': result = await muteAll(client, currentToken); break;
            case 'unmuteAll': result = await unmuteAll(client, currentToken); break;
            case 'deafenAll': result = await deafenAll(client, currentToken); break;
            case 'undeafenAll': result = await undeafenAll(client, currentToken); break;
            default: result = { ok: true };
          }
          results.push({ token: currentToken, ok: true, ...result, state: state.volume });
        } catch (error) {
          results.push({ token: currentToken, ok: false, error: String(error.message || error) });
        }
      }
      return res.json({ ok: results.some(r => r.ok), results });
    }

    if (action === 'playAll') {
      if (!vcId) return res.status(400).json({ ok: false, error: 'Missing VC ID for sound playback' });
      const results = [];
      for (const currentToken of tokensToRun) {
        try {
          const currentState = ensureBotState(currentToken);
          const soundFile = soundPath || currentState.lastSoundPath || path.join(SOUND_DIR, 'default.mp3');
          const result = await playLocalSoundForToken(currentToken, vcId, soundFile, currentState.volume || 100);
          results.push({ token: currentToken, ok: true, ...result });
        } catch (error) {
          results.push({ token: currentToken, ok: false, error: String(error.message || error) });
        }
      }
      return res.json({ ok: results.some(r => r.ok), results });
    }

    if (action === 'stopAll') {
      const results = [];
      for (const currentToken of tokensToRun) {
        try {
          const client = await getClient(currentToken);
          const state = ensureBotState(currentToken);
          const guildId = Array.from(client.guilds.cache.keys())[0] || 'default';
          const player = audioPlayers.get(`${currentToken}:${guildId}`);
          if (player) player.stop();
          results.push({ token: currentToken, ok: true, stopped: true });
        } catch (error) {
          results.push({ token: currentToken, ok: false, error: String(error.message || error) });
        }
      }
      return res.json({ ok: results.some(r => r.ok), results });
    }

    return res.json({ ok: false, error: `Unsupported action: ${action}` });
  } catch (error) {
    console.error('Action failure:', error);
    return res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Discord voice backend listening on http://${HOST}:${PORT}`);
  console.log(`Local access: http://localhost:${PORT}`);
  console.log(`LAN access: http://<your-pc-ip>:${PORT}`);
});
