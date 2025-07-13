// index.js
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

// (1) Polyfill globalThis.crypto only if it doesn't exist
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = webcrypto;
}

// (2) Prepare sessions directory
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// keep sockets indexed by your phone‐ID
const sockets = {};

// Initialize (or re-use) a WhatsApp session for a given ID
async function initSession(id) {
  const folder = path.join(SESSIONS_DIR, id);
  fs.mkdirSync(folder, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(folder);

  // reuse socket if present
  let sock = sockets[id];
  if (!sock) {
    sock = makeWASocket({ auth: state });
    sockets[id] = sock;

    // persist credentials whenever they update
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async update => {
      const { qr, connection, lastDisconnect, me } = update;

      // stash the QR string whenever it arrives
      if (qr) sock.lastQR = qr;

      // once fully open, send your welcome/confirmation message
      if (connection === 'open') {
        if (me?.id) {
          await sock.sendMessage(me.id, {
            text: '✅ Your number has been registered! Your manifestation has been registered.'
          });
        }
      }

      // handle closes: either logged-out (clear state) or reconnect
      if (connection === 'close') {
        const status = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = status === DisconnectReason.loggedOut;

        // drop old socket
        delete sockets[id];

        if (loggedOut) {
          // fully clear your saved creds so you can re-scan next time
          fs.rmSync(folder, { recursive: true, force: true });
        } else {
          // reconnect automatically
          await initSession(id);
        }
      }
    });
  }

  // if we already have a QR, return it immediately
  if (sock.lastQR) return sock.lastQR;

  // otherwise wait up to 30s for the next QR event
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      sock.ev.off('connection.update', handler);
      reject(new Error('Timed out waiting for QR'));
    }, 30_000);

    const handler = u => {
      if (u.qr) {
        clearTimeout(to);
        sock.ev.off('connection.update', handler);
        resolve(u.qr);
      }
    };
    sock.ev.on('connection.update', handler);
  });
}

const app = express();
app.use(express.json());

// JSON API endpoint: fetch a data-URL QR for this ID
app.get('/start/:id', async (req, res) => {
  try {
    const qrString = await initSession(req.params.id);
    const dataUrl = await qrcode.toDataURL(qrString);
    res.json({ qr: dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// serve your React/HTML client
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`⚡️ Bot listening on port ${PORT}`);
});
