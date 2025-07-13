// index.js
import express from 'express';
import path from 'path';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
const sessions = {}; // { [userId]: { sock, res? } }

async function initSession(userId) {
  // prepare auth folder
  const authPath = path.join(SESSIONS_DIR, userId);
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  // create socket
  const sock = makeWASocket({ auth: state });
  sessions[userId].sock = sock;

  // save credential updates
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;

    // 1) send the QR data-URL back
    if (qr && sessions[userId].res) {
      try {
        const qrUrl = await QRCode.toDataURL(qr);
        sessions[userId].res.json({ qr: qrUrl });
      } catch (e) {
        sessions[userId].res.status(500).json({ error: 'Failed to generate QR' });
      }
      delete sessions[userId].res;
    }

    // 2) once open, send default welcome
    if (connection === 'open') {
      const jid = `${userId}@s.whatsapp.net`;
      await sock.sendMessage(jid, {
        text: '👋 Welcome! Your WhatsApp is now linked to the Manifestation Bot.'
      });
    }

    // 3) on close (unless logged out), reconnect
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log(`Reconnecting session ${userId} (code ${code})`);
        initSession(userId);
      }
    }
  });
}

// endpoint to start & get QR
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

// endpoint to send a manifestation and confirmation
app.post('/manifestations', async (req, res) => {
  const { id, message } = req.body;
  const entry = sessions[id];
  if (!entry?.sock) {
    return res.status(400).json({ error: 'Session not started' });
  }
  const sock = entry.sock;
  const jid = `${id}@s.whatsapp.net`;

  try {
    await sock.sendMessage(jid, { text: message });
    await sock.sendMessage(jid, { text: '✅ Your manifestation has been registered!' });
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Send message error', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡️ Bot listening on port ${PORT}`));
