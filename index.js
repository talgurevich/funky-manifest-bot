import express from 'express';
import path from 'path';
import fs from 'fs';
import baileys from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import cron from 'node-cron';

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public'))));

// Paths on disk
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
const DATA_DIR     = path.join(process.cwd(), 'data');
for (const dir of [SESSIONS_DIR, DATA_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// In-memory map of active sockets
const sockets = {};

/**
 * Establish (or re-establish) a WhatsApp session for a given user.
 * If `res` is passed, it will respond to the original HTTP /start request.
 */
async function initSession(userId, res = null) {
  // Clear any old socket so we don't leak
  if (sockets[userId]?.sock) {
    try { sockets[userId].sock.logout() } catch {}
  }

  // Always delete old creds so we force a QR on initial /start
  const userDir = path.join(SESSIONS_DIR, userId);
  if (fs.existsSync(userDir)) {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
  fs.mkdirSync(userDir, { recursive: true });

  // Load auth state
  const { state, saveCreds } = await useMultiFileAuthState(userDir);

  // Create the socket
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    defaultQueryTimeoutMs: 60000,  // give USync up to 60s
  });
  sockets[userId] = { sock, saveCreds };
  sock.ev.on('creds.update', saveCreds);

  let responded = false;
  sock.ev.on('connection.update', async update => {
    console.log('connection.update →', update);

    // 1) Handle QR emission
    if (!responded && update.qr && res) {
      responded = true;
      const svg = await QRCode.toString(update.qr, { type: 'svg', margin: 1 });
      const b64 = Buffer.from(svg).toString('base64');
      return res.json({ qr: b64 });
    }

    // 2) Handle successful open
    if (!responded && update.connection === 'open' && res) {
      responded = true;
      saveCreds();
      return res.json({ success: true });
    }

    // 3) Handle unexpected close → reconnect
    if (update.connection === 'close') {
      const err = update.lastDisconnect?.error;
      const code = err?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`Connection closed for ${userId}:`, err, '– loggedOut?', loggedOut);
      if (!loggedOut) {
        console.log(`Reconnecting WhatsApp for ${userId}...`);
        // No HTTP response here, just restart the socket
        await initSession(userId, null);
      }
    }
  });

  // If this was the initial /start call, enforce a 15s timeout
  if (res) {
    setTimeout(() => {
      if (!responded && !res.headersSent) {
        res.status(504).json({ error: 'Timeout generating QR; please try again.' });
      }
    }, 15000);
  }
}

// HTTP endpoint to kick off (or re-kick) a session
app.get('/start/:userId', (req, res) => {
  initSession(req.params.userId, res).catch(err => {
    console.error('Init session error', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error initializing session' });
  });
});

// Save manifestations + immediate WhatsApp confirmation
app.post('/manifestations', async (req, res) => {
  const { userId, items } = req.body;
  if (!userId || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  try {
    fs.writeFileSync(path.join(DATA_DIR, `${userId}.json`), JSON.stringify(items, null, 2));
    res.json({ success: true });

    // Send confirmation if the socket is open
    const session = sockets[userId];
    if (session) {
      try {
        await session.sock.sendMessage(`${userId}@s.whatsapp.net`, {
          text: '✅ Your manifestations have been registered!'
        });
        session.saveCreds();
      } catch (sendErr) {
        console.error('Confirmation send failed (socket closed?)', sendErr);
      }
    }
  } catch (err) {
    console.error('Error saving manifestations', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error saving manifestations' });
  }
});

// Daily manifest push at 09:00
cron.schedule('0 9 * * *', () => {
  for (const userId of fs.readdirSync(SESSIONS_DIR)) {
    const session = sockets[userId];
    if (!session) continue;
    try {
      const dataPath = path.join(DATA_DIR, `${userId}.json`);
      if (!fs.existsSync(dataPath)) continue;
      const items = JSON.parse(fs.readFileSync(dataPath));
      if (!items.length) continue;
      const pick = items[Math.floor(Math.random() * items.length)];

      session.sock.sendMessage(`${userId}@s.whatsapp.net`, {
        text: `🪄 Today's Manifestation:\n${pick}\nGo make it happen!`
      }).catch(console.error);
      session.saveCreds();
    } catch (cronErr) {
      console.error(`Daily send failed for ${userId}`, cronErr);
    }
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡️ Bot listening on port ${PORT}`));
