// index.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const cron = require('node-cron');
const { webcrypto } = require('crypto');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');

// polyfill crypto for Baileys
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = webcrypto;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// — sessions & sockets —
const SESSIONS_DIR = path.join(__dirname, 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
const sockets = {};

// — store manifestations —
const STORE_FILE = path.join(SESSIONS_DIR, 'manifestations.json');
let manifestations = {};
try {
  manifestations = JSON.parse(fs.readFileSync(STORE_FILE));
} catch {}
function saveStore() {
  fs.writeFileSync(STORE_FILE, JSON.stringify(manifestations, null, 2));
}

// — init or re-init a WhatsApp session for a given id (phone) —
async function initSession(id) {
  const folder = path.join(SESSIONS_DIR, id);
  fs.mkdirSync(folder, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(folder);

  let sock = sockets[id];
  if (!sock) {
    sock = makeWASocket({ auth: state });
    sockets[id] = sock;

    // persist creds
    sock.ev.on('creds.update', saveCreds);

    // connection updates
    sock.ev.on('connection.update', async update => {
      const { qr, connection, lastDisconnect } = update;
      if (qr) sock.lastQR = qr;

      if (connection === 'open') {
        // once linked, send both welcome & confirmation of their stored manifestation
        const jid = `${id}@s.whatsapp.net`;
        await sock.sendMessage(jid, {
          text: '✅ Your number has been registered! Your manifestation has been registered.'
        });
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        delete sockets[id];

        if (loggedOut) {
          // clear session folder so next time they must re-scan
          fs.rmSync(folder, { recursive: true, force: true });
        } else {
          // otherwise just reconnect
          await initSession(id);
        }
      }
    });
  }

  if (sock.lastQR) return sock.lastQR;

  // wait up to 30s for QR to arrive
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

// — REST endpoints —

// generate & return QR for /start/:id
app.get('/start/:id', async (req, res) => {
  try {
    const qr = await initSession(req.params.id);
    const dataUrl = await qrcode.toDataURL(qr);
    res.json({ qr: dataUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// receive & store a manifestation
app.post('/manifestations', (req, res) => {
  const { id, text } = req.body;
  if (!id || !text) return res.status(400).json({ error: 'id and text required' });
  manifestations[id] = text;
  saveStore();
  res.json({ success: true });
});

// serve index.html for any other route
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡️ Bot listening on port ${PORT}`));

// — daily cron job at 09:00 server time — 
cron.schedule('0 9 * * *', async () => {
  console.log('🔔 Sending daily manifestations…');
  for (const id of Object.keys(manifestations)) {
    const sock = sockets[id];
    if (!sock) {
      console.log(` • [${id}] no active socket, skipping`);
      continue;
    }
    const jid = `${id}@s.whatsapp.net`;
    try {
      await sock.sendMessage(jid, {
        text: `📅 Here’s your daily manifestation reminder:\n\n"${manifestations[id]}"`
      });
      console.log(` • [${id}] sent`);
    } catch (e) {
      console.error(` • [${id}] failed:`, e.message);
    }
  }
});
