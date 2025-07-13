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

// polyfill globalThis.crypto if missing
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = webcrypto;
}

// where we store auth folders
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// keep sockets by phone-ID
const sockets = {};

async function initSession(id) {
  const folder = path.join(SESSIONS_DIR, id);
  fs.mkdirSync(folder, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(folder);

  let sock = sockets[id];
  if (!sock) {
    sock = makeWASocket({ auth: state });
    sockets[id] = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async update => {
      const { qr, connection, lastDisconnect } = update;

      // stash QR
      if (qr) sock.lastQR = qr;

      // once open, send welcome to your number
      if (connection === 'open') {
        const userJid = `${id}@s.whatsapp.net`;
        await sock.sendMessage(userJid, {
          text: '✅ Your number has been registered! Your manifestation has been registered.'
        });
      }

      // on close: if logged out, clear creds; otherwise reconnect
      if (connection === 'close') {
        const status = lastDisconnect?.error?.output?.statusCode;
        const wasLoggedOut = status === DisconnectReason.loggedOut;
        delete sockets[id];

        if (wasLoggedOut) {
          fs.rmSync(folder, { recursive: true, force: true });
        } else {
          await initSession(id);
        }
      }
    });
  }

  if (sock.lastQR) return sock.lastQR;

  // wait up to 30s for QR
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

app.get('/start/:id', async (req, res) => {
  try {
    const qrString = await initSession(req.params.id);
    const dataUrl = await qrcode.toDataURL(qrString);
    res.json({ qr: dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`⚡️ Bot listening on port ${PORT}`)
);
