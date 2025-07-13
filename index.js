import { webcrypto } from 'crypto';
globalThis.crypto = webcrypto;

import express from 'express';
import path from 'path';
import fs from 'fs';
import baileys from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Directories for session credentials and user data
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
const DATA_DIR     = path.join(process.cwd(), 'data');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR))     fs.mkdirSync(DATA_DIR,     { recursive: true });

// In-memory sockets per user
const sockets = {};

// Initialize or resume a WhatsApp session, then return a Base64 SVG QR or success message
app.get('/start/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const userDir = path.join(SESSIONS_DIR, userId);
    // Force fresh QR by deleting any old creds
    if (fs.existsSync(userDir)) {
      fs.rmSync(userDir, { recursive: true, force: true });
    }
    fs.mkdirSync(userDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(userDir);
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false
    });
    sockets[userId] = { sock, saveCreds };

    sock.ev.on('creds.update', saveCreds);

    let responded = false;

    sock.ev.on('connection.update', async update => {
      console.log('connection.update →', update);
      if (responded) return;

      if (update.qr) {
        responded = true;
        // Generate SVG QR and encode to Base64
        const svgString = await QRCode.toString(update.qr, { type: 'svg', margin: 1 });
        const b64 = Buffer.from(svgString).toString('base64');
        return res.json({ qr: b64 });
      }

      if (update.connection === 'open') {
        responded = true;
        saveCreds();
        return res.json({ success: true });
      }
    });

    // Timeout if no QR within 15s
    setTimeout(() => {
      if (!responded && !res.headersSent) {
        res.status(504).json({ error: 'Timeout generating QR; please try again.' });
      }
    }, 15000);

  } catch (err) {
    console.error('Init session error', userId, err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server error initializing session' });
    }
  }
});

// Save manifestation list and send immediate confirmation
app.post('/manifestations', async (req, res) => {
  const { userId, items } = req.body;
  if (!userId || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  fs.writeFileSync(
    path.join(DATA_DIR, `${userId}.json`),
    JSON.stringify(items, null, 2)
  );
  res.json({ success: true });

  // Send confirmation message
  const session = sockets[userId];
  if (session) {
    const { sock, saveCreds } = session;
    try {
      await sock.sendMessage(`${userId}@s.whatsapp.net`, {
        text: '✅ Your manifestations have been registered!'
      });
      saveCreds();
    } catch (err) {
      console.error('Error sending confirmation', err);
    }
  }
});

// Daily scheduler at 9:00 AM
import cron from 'node-cron';
cron.schedule('0 9 * * *', async () => {
  const users = fs.readdirSync(SESSIONS_DIR);
  for (const userId of users) {
    const session = sockets[userId];
    if (!session) continue;

    const { sock, saveCreds } = session;
    try {
      const dataPath = path.join(DATA_DIR, `${userId}.json`);
      if (!fs.existsSync(dataPath)) continue;

      const items = JSON.parse(fs.readFileSync(dataPath));
      if (!items.length) continue;

      const pick = items[Math.floor(Math.random() * items.length)];
      await sock.sendMessage(`${userId}@s.whatsapp.net`, {
        text: `🪄 Today's Manifestation:\n${pick}\n\nNow go make it happen!`
      });
      saveCreds();
    } catch (err) {
      console.error(`Error sending daily message to ${userId}`, err);
    }
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡️ Bot listening on port ${PORT}`));
