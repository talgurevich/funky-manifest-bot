// index.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode';
import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(express.json());
// serve front-end from public/
app.use(express.static(path.join(__dirname, 'public')));

// keep one socket per unique ID
const sockets = new Map();

// initialize (or re-init) a Baileys connection for a given id
async function initSession(id) {
  const authDir = path.join(__dirname, 'sessions', id);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sockets.set(id, sock);

  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect, qr, isNewLogin } = update;

    // once we get a new login (i.e. QR scanned & phone linked)
    if (isNewLogin) {
      const jid = `${id}@s.whatsapp.net`;
      try {
        await sock.sendMessage(jid, {
          text: '✅ Your manifestation has been registered'
        });
      } catch (e) {
        console.error('Error sending welcome message', e);
      }
    }

    // if the socket closed unexpectedly, reconnect
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log(`Reconnecting session ${id}...`);
        sockets.delete(id);
        await initSession(id);
      }
    }
  });

  // persist credentials on every update
  sock.ev.on('creds.update', saveCreds);

  return sock;
}

// endpoint to kick off (or re-use) a session and grab its next QR
app.get('/start/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) {
    return res.status(400).send('Invalid ID');
  }

  try {
    let sock = sockets.get(id);
    if (!sock) {
      sock = await initSession(id);
    }

    // wait for the very next QR update
    const { qr } = await new Promise((resolve, reject) => {
      const handler = up => {
        if (up.qr) {
          sock.ev.off('connection.update', handler);
          resolve(up);
        }
      };
      sock.ev.on('connection.update', handler);

      setTimeout(() => {
        sock.ev.off('connection.update', handler);
        reject(new Error('QR timeout'));
      }, 30_000);
    });

    // render as base64‐PNG
    const dataUrl = await qrcode.toDataURL(qr);
    res.json({ qr: dataUrl });
  } catch (e) {
    console.error('Init session error', e);
    res.status(500).send('Error generating QR; please try again.');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`⚡️ Bot listening on port ${PORT}`)
);
