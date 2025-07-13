const express = require('express');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const { webcrypto } = require('crypto');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');

// Polyfill globalThis.crypto if not present
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

// Where we store per-user Baileys auth state
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Keep track of active sockets
const sockets = {};

// Initialize (or re-use) a WhatsApp session for a given ID
async function initSession(id) {
  const folder = path.join(SESSIONS_DIR, id);
  const { state, saveCreds } = await useMultiFileAuthState(folder);

  // either reuse or create new socket
  let sock = sockets[id];
  if (!sock) {
    sock = makeWASocket({ auth: state });
    sockets[id] = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', update => {
      const { qr, connection, lastDisconnect } = update;

      if (qr) {
        sock.lastQR = qr;           // stash the latest QR
      }

      // once paired successfully, send a welcome text
      if (connection === 'open') {
        sock.sendMessage(
          `${id}@s.whatsapp.net`,
          { text: '✅ Your number has been registered! Your manifestation has been registered.' }
        );
      }

      // cleanup if fully closed
      if (connection === 'close') {
        const status = (lastDisconnect?.error)?.output?.statusCode;
        const loggedOut = status === DisconnectReason.loggedOut;
        if (loggedOut) {
          // removes your saved creds so you can log in again
          fs.rmSync(folder, { recursive: true, force: true });
        }
        delete sockets[id];
      }
    });
  }

  // if we already got a QR, return it immediately
  if (sock.lastQR) return sock.lastQR;

  // otherwise wait up to 30s for the next QR event
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      reject(new Error('Timed out waiting for QR'));
    }, 30_000);

    const handler = update => {
      if (update.qr) {
        clearTimeout(to);
        sock.ev.off('connection.update', handler);
        resolve(update.qr);
      }
    };
    sock.ev.on('connection.update', handler);
  });
}

const app = express();
app.use(express.json());

// JSON API: request a QR for a given ID
app.get('/start/:id', async (req, res) => {
  try {
    const qrString = await initSession(req.params.id);
    // turn it into a data-URL so the client can do `<img src="…">`
    const dataUrl = await qrcode.toDataURL(qrString);
    res.json({ qr: dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// serve your front-end
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`⚡️ Bot listening on port ${PORT}`);
});
