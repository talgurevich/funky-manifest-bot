import express from 'express';
import path from 'path';
import fs from 'fs';
import baileys from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import cron from 'node-cron';

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Directories
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
const DATA_DIR     = path.join(process.cwd(), 'data');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR))     fs.mkdirSync(DATA_DIR,     { recursive: true });

// In‐memory sockets
const sockets = {};

// QR & Session endpoint
app.get('/start/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const userDir = path.join(SESSIONS_DIR, userId);
    if (fs.existsSync(userDir)) fs.rmSync(userDir, { recursive: true, force: true });
    fs.mkdirSync(userDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(userDir);
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      defaultQueryTimeoutMs: 60000       // <<< bump timeout to 60s
    });
    sockets[userId] = { sock, saveCreds };
    sock.ev.on('creds.update', saveCreds);

    let responded = false;
    sock.ev.on('connection.update', async update => {
      console.log('connection.update →', update);
      if (responded) return;

      if (update.qr) {
        responded = true;
        const svg = await QRCode.toString(update.qr, { type: 'svg', margin: 1 });
        return res.json({ qr: Buffer.from(svg).toString('base64') });
      }

      if (update.connection === 'open') {
        responded = true;
        saveCreds();
        return res.json({ success: true });
      }
    });

    setTimeout(() => {
      if (!responded && !res.headersSent) {
        res.status(504).json({ error: 'Timeout generating QR; please try again.' });
      }
    }, 15000);

  } catch (err) {
    console.error('Init session error', userId, err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error initializing session' });
  }
});

// Manifestation save + immediate WhatsApp confirmation
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
      const { sock, saveCreds } = session;
      try {
        await sock.sendMessage(`${userId}@s.whatsapp.net`, {
          text: '✅ Your manifestations have been registered!'
        });
        saveCreds();
      } catch (sendErr) {
        console.error('❌ Confirmation send failed:', sendErr);
        // we swallow this—no crash
      }
    }
  } catch (err) {
    console.error('❌ Error in /manifestations:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error saving manifestations' });
  }
});

// Daily scheduler at 09:00
cron.schedule('0 9 * * *', () => {
  const users = fs.readdirSync(SESSIONS_DIR);
  users.forEach(async userId => {
    const session = sockets[userId];
    if (!session) return;

    const { sock, saveCreds } = session;
    try {
      const dataFile = path.join(DATA_DIR, `${userId}.json`);
      if (!fs.existsSync(dataFile)) return;
      const items = JSON.parse(fs.readFileSync(dataFile));
      if (!items.length) return;

      const pick = items[Math.floor(Math.random() * items.length)];
      await sock.sendMessage(`${userId}@s.whatsapp.net`, {
        text: `🪄 Today's Manifestation:\n${pick}\nGo make it happen!`
      });
      saveCreds();
    } catch (cronErr) {
      console.error(`❌ Daily send failed for ${userId}:`, cronErr);
      // swallow
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡️ Bot listening on port ${PORT}`));
