import express from 'express';
import path from 'path';
import fs from 'fs';
import baileys from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import cron from 'node-cron';

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));    // ← fixed here



// Ensure data directories exist
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
const DATA_DIR     = path.join(process.cwd(), 'data');
for (const dir of [SESSIONS_DIR, DATA_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// In-memory map of user sockets
const sockets = {};

/**
 * Initialize (or re-initialize) a WhatsApp session for userId.
 * If `res` is provided, it will reply to the HTTP /start call.
 */
async function initSession(userId, res = null) {
  // Drop old socket reference (we won’t explicitly logout to avoid errors)
  delete sockets[userId];

  // Force fresh credentials for a new QR
  const userDir = path.join(SESSIONS_DIR, userId);
  if (fs.existsSync(userDir)) fs.rmSync(userDir, { recursive: true, force: true });
  fs.mkdirSync(userDir, { recursive: true });

  // Load auth state
  const { state, saveCreds } = await useMultiFileAuthState(userDir);
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    defaultQueryTimeoutMs: 60000,  // extend USync timeout
  });
  sockets[userId] = { sock, saveCreds };
  sock.ev.on('creds.update', saveCreds);

  let responded = false;
  sock.ev.on('connection.update', async update => {
    console.log('connection.update →', update);

    // 1) QR ready → HTTP response
    if (!responded && update.qr && res) {
      responded = true;
      const svg = await QRCode.toString(update.qr, { type: 'svg', margin: 1 });
      return res.json({ qr: Buffer.from(svg).toString('base64') });
    }

    // 2) Connection open → HTTP success
    if (!responded && update.connection === 'open' && res) {
      responded = true;
      saveCreds();
      return res.json({ success: true });
    }

    // 3) Unexpected close → reconnect
    if (update.connection === 'close') {
      const err = update.lastDisconnect?.error;
      const code = err?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`Connection closed for ${userId}:`, err, 'loggedOut?', loggedOut);

      if (!loggedOut) {
        console.log(`Reconnecting for ${userId}…`);
        try {
          await initSession(userId, null);
        } catch (e) {
          console.error('Re-init session error', e);
        }
      }
    }
  });

  // 15s timeout for QR
  if (res) {
    setTimeout(() => {
      if (!responded && !res.headersSent) {
        res.status(504).json({ error: 'Timeout generating QR; please try again.' });
      }
    }, 15000);
  }
}

// Kick off or re-kick a session
app.get('/start/:userId', (req, res) => {
  initSession(req.params.userId, res).catch(err => {
    console.error('Init session error', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error initializing session' });
  });
});

// Store manifestations + immediate confirmation
app.post('/manifestations', async (req, res) => {
  const { userId, items } = req.body;
  if (!userId || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  try {
    fs.writeFileSync(
      path.join(DATA_DIR, `${userId}.json`),
      JSON.stringify(items, null, 2)
    );
    res.json({ success: true });

    const session = sockets[userId];
    if (session) {
      try {
        await session.sock.sendMessage(`${userId}@s.whatsapp.net`, {
          text: '✅ Your manifestations have been registered!'
        });
        session.saveCreds();
      } catch (sendErr) {
        console.error('Confirmation send failed:', sendErr);
      }
    }
  } catch (err) {
    console.error('Error saving manifestations', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error saving manifestations' });
  }
});

// Daily push at 09:00
cron.schedule('0 9 * * *', () => {
  for (const userId of fs.readdirSync(SESSIONS_DIR)) {
    const session = sockets[userId];
    if (!session) continue;
    try {
      const file = path.join(DATA_DIR, `${userId}.json`);
      if (!fs.existsSync(file)) continue;
      const items = JSON.parse(fs.readFileSync(file));
      if (!items.length) continue;
      const pick = items[Math.floor(Math.random() * items.length)];

      session.sock
        .sendMessage(`${userId}@s.whatsapp.net`, {
          text: `🪄 Today's Manifestation:\n${pick}\nGo make it happen!`
        })
        .catch(console.error);

      session.saveCreds();
    } catch (cronErr) {
      console.error(`Daily send failed for ${userId}`, cronErr);
    }
  }
});

// Start HTTP server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡️ Bot listening on port ${PORT}`));
