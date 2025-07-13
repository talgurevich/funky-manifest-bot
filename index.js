import { webcrypto } from 'crypto';
// Polyfill Web Crypto API for Baileys
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import express from 'express';
import path from 'path';
import fs from 'fs';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Directories for session credentials and user data
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const sockets = {};

// Initialize or resume a WhatsApp session, then return the first QR (base64) or success
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
    sock.ev.on('connection.update', update => {
      console.log('connection.update →', update);
      if (!responded && update.qr) {
        responded = true;
        const svgBase64 = Buffer.from(update.qr).toString('base64');
        return res.json({ qr: svgBase64 });
      }
      if (!responded && update.connection === 'open') {
        responded = true;
        return res.json({ success: true });
      }
      if (update.connection === 'close') {
        const code = update.lastDisconnect?.error?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) connectUser(userId);
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

// Helper: reconnect user session
async function connectUser(userId) {
  const userDir = path.join(SESSIONS_DIR, userId);
  const { state, saveCreds } = await useMultiFileAuthState(userDir);
  const sock = makeWASocket({ auth: state });
  sock.ev.on('creds.update', saveCreds);
  sockets[userId] = sock;
}

// Save manifestation list
app.post('/manifestations', (req, res) => {
  const { userId, items } = req.body;
  if (!userId || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  fs.writeFileSync(path.join(DATA_DIR, `${userId}.json`), JSON.stringify(items, null, 2));
  return res.json({ success: true });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡️ Bot listening on port ${PORT}`));
