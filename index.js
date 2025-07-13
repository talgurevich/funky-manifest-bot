import { webcrypto } from 'crypto';
// Polyfill Web Crypto API for Baileys
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import express from 'express';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import pkg from '@whiskeysockets/baileys';
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = pkg;
import cron from 'node-cron';

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Directories for session credentials and user data
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
const DATA_DIR     = path.join(process.cwd(), 'data');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR))     fs.mkdirSync(DATA_DIR,     { recursive: true });

// In-memory sockets per user
const sockets: Record<string, any> = {};

// Start or resume WhatsApp session and serve QR
app.get('/start/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const userDir = path.join(SESSIONS_DIR, userId);
    if (fs.existsSync(userDir)) fs.rmSync(userDir, { recursive: true, force: true });
    fs.mkdirSync(userDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(userDir);
    const sock = makeWASocket({ auth: state });
    sock.ev.on('creds.update', saveCreds);
    sockets[userId] = sock;

    let responded = false;
    sock.ev.on('connection.update', async update => {
      console.log('connection.update →', update);
      if (!responded && update.qr) {
        responded = true;
        const svgString = await QRCode.toString(update.qr, { type: 'svg', width: 300 });
        const svgBase64 = Buffer.from(svgString).toString('base64');
        return res.json({ qr: svgBase64 });
      }
      if (!responded && update.connection === 'open') {
        responded = true;
        return res.json({ success: true });
      }
      if (update.connection === 'close') {
        const code = update.lastDisconnect?.error?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) await connectUser(userId);
        else fs.rmSync(userDir, { recursive: true, force: true });
      }
    });

    setTimeout(() => {
      if (!responded && !res.headersSent) res.status(504).json({ error: 'Timeout generating QR; please try again.' });
    }, 15000);

  } catch (err) {
    console.error('Init session error', userId, err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error initializing session' });
  }
});

// Reconnect helper
async function connectUser(userId: string) {
  const userDir = path.join(SESSIONS_DIR, userId);
  const { state, saveCreds } = await useMultiFileAuthState(userDir);
  const sock = makeWASocket({ auth: state });
  sock.ev.on('creds.update', saveCreds);
  sockets[userId] = sock;
}

// Manifestations endpoint
app.post('/manifestations', (req, res) => {
  const { userId, items } = req.body;
  if (!userId || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const filePath = path.join(DATA_DIR, `${userId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2));

  // Send registration confirmation
  const sock = sockets[userId];
  if (sock) {
    sock.sendMessage(`${userId}@s.whatsapp.net`, { text: '✅ Your manifestations have been registered!' })
      .catch(err => console.error('Error sending registration confirmation to', userId, err));
  }

  return res.json({ success: true });
});

// Daily scheduler at 09:00
cron.schedule('0 9 * * *', async () => {
  console.log('🔔 Running daily manifest dispatch');
  for (const userId of fs.readdirSync(SESSIONS_DIR)) {
    try {
      const itemsFile = path.join(DATA_DIR, `${userId}.json`);
      if (!fs.existsSync(itemsFile)) continue;
      const items = JSON.parse(fs.readFileSync(itemsFile, 'utf8')) as string[];
      if (items.length === 0) continue;
      const choice = items[Math.floor(Math.random() * items.length)];
      const sock = sockets[userId];
      if (!sock) continue;
      await sock.sendMessage(`${userId}@s.whatsapp.net`, { text: `🌟 Your daily manifestation:\n${choice}` });
      console.log(`Sent to ${userId}: ${choice}`);
    } catch (err) {
      console.error(`Error sending to ${userId}:`, err);
    }
  }
});

// Start server
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`⚡️ Bot listening on port ${PORT}`));
