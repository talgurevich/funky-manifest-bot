// index.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory stores for sockets and QR Data-URLs
const sockets = {};
const qrStore = {};

/**
 * Spin up a WhatsApp session for a given numeric ID
 */
async function initSession(id) {
  const jid = id.includes('@') ? id : `${id}@s.whatsapp.net`;
  const authDir = path.join(__dirname, 'sessions', id);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({ auth: state });
  sockets[id] = sock;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR arrived → convert to Data-URL
    if (qr) {
      try {
        qrStore[id] = await qrcode.toDataURL(qr);
      } catch (e) {
        console.error('QR → DataURL error', e);
      }
    }

    // Once fully open, send two confirmation messages
    if (connection === 'open') {
      try {
        await sock.sendMessage(jid, {
          text: `✅ Your number *${id}* has been successfully linked!`
        });
        await sock.sendMessage(jid, {
          text: `✅ Your manifestation has been registered!`
        });
      } catch (e) {
        console.error('Error sending post-link messages', e);
      }
    }

    // If closed (and not logged out) → reconnect
    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`Connection for ${id} closed. Reconnect?`, shouldReconnect);
      if (shouldReconnect) initSession(id);
      else {
        delete sockets[id];
        delete qrStore[id];
      }
    }
  });

  // Persist credentials on every update
  sock.ev.on('creds.update', saveCreds);
}

// HTTP: start/link a session
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

// HTTP: fetch the latest QR as a base64 Data-URL
app.get('/qr/:id', (req, res) => {
  const { id } = req.params;
  const qr = qrStore[id];
  if (!qr) {
    return res
      .status(404)
      .json({ error: 'QR not yet available—call /start/:id first' });
  }
  res.json({ qr });
});

// Launch
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`⚡️ Bot listening on port ${PORT}`);
});
