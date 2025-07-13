// index.js
import express from 'express';
import path from 'path';
import { default as makeWASocket, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
// keep track of each user’s socket and pending QR‐response
const sessions = {};

/**
 * Initialize (or re‐init) a WhatsApp session for a given userId.
 */
async function initSession(userId) {
  const authPath = path.join(SESSIONS_DIR, userId);
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const sock = makeWASocket({ auth: state });
  sessions[userId].sock = sock;

  // persist creds
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;

    // 1) send QR back to front end as a data-URL
    if (qr && sessions[userId].res) {
      try {
        const qrUrl = await QRCode.toDataURL(qr);
        sessions[userId].res.json({ qr: qrUrl });
      } catch (e) {
        sessions[userId].res.status(500).json({ error: 'Failed to generate QR' });
      }
      delete sessions[userId].res;
    }

    // 2) once connected, send a default welcome
    if (connection === 'open') {
      const jid = `${userId}@s.whatsapp.net`;
      await sock.sendMessage(jid, {
        text: '👋 Welcome! Your WhatsApp is now linked to the Manifestation Bot.'
      });
    }

    // 3) on unexpected close, reconnect
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log(`Reconnecting session ${userId} (code ${code})`);
        initSession(userId);
      }
    }
  });
}

// Kick off a session and return QR
app.get('/start/:userId', async (req, res) => {
  const { userId } = req.params;
  sessions[userId] = { res };
  try {
    await initSession(userId);
  } catch (err) {
    console.error('Init session error', err);
    res.status(500).json({ error: 'Session init failed' });
  }
});

/**
 * Front-end posts here to send a manifestation.
 * Expects JSON { id: '9725…', message: 'I will …' }
 */
app.post('/manifestations', async (req, res) => {
  const { id, message } = req.body;
  const entry = sessions[id];
  if (!entry?.sock) {
    return res.status(400).json({ error: 'Session not started' });
  }
  const sock = entry.sock;
  const jid = `${id}@s.whatsapp.net`;

  try {
    // send user’s manifestation
    await sock.sendMessage(jid, { text: message });

    // send confirmation
    await sock.sendMessage(jid, {
      text: '✅ Your manifestation has been registered!'
    });

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Send message error', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`⚡️ Bot listening on port ${PORT}`);
});
