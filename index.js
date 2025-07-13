// index.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode';
import {
  default as makeWASocket,
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory stores for sockets and QR data URLs
const sockets = {};
const qrStore = {};

// Initialize a WhatsApp session for a given numeric ID
async function initSession(id) {
  const jid = id.includes('@') ? id : `${id}@s.whatsapp.net`;
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'sessions', id));

  const sock = makeWASocket({ auth: state });
  sockets[id] = sock;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // When a QR is generated, turn it into a Data-URL and cache it
    if (qr) {
      try {
        qrStore[id] = await qrcode.toDataURL(qr);
      } catch (err) {
        console.error('Failed to generate QR DataURL', err);
      }
    }

    // Once fully connected, send our two welcome/confirmation messages
    if (connection === 'open') {
      try {
        await sock.sendMessage(jid, { text: `✅ Your number ${id} has been successfully linked!` });
        await sock.sendMessage(jid, { text: `✅ Your manifestation has been registered!` });
      } catch (err) {
        console.error('Error sending confirmation messages', err);
      }
    }

    // If the connection closes unexpectedly, reconnect (unless logged out)
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`Connection closed for ${id}. Reconnect?`, shouldReconnect);
      if (shouldReconnect) {
        initSession(id);
      } else {
        delete sockets[id];
        delete qrStore[id];
      }
    }
  });

  // Persist credentials any time they update
  sock.ev.on('creds.update', saveCreds);
}

// HTTP endpoint to start/link a session
app.get('/start/:id', async (req, res) => {
  const { id } = req.params;
  if (!sockets[id]) {
    try {
      await initSession(id);
      return res.json({ message: `Initializing session for ${id}` });
    } catch (err) {
      console.error('Init session error', err);
      return res.status(500).json({ error: err.toString() });
    }
  }
  return res.json({ message: `Session for ${id} is already running` });
});

// HTTP endpoint to fetch the QR code as a base64 Data-URL
app.get('/qr/:id', (req, res) => {
  const { id } = req.params;
  const qr = qrStore[id];
  if (!qr) {
    return res.status(404).json({ error: 'QR code not yet available — call /start/:id first' });
  }
  res.json({ qr });
});

// Kick off
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡️ Bot listening on port ${PORT}`));
