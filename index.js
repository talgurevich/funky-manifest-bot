// index.js
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const qrcode  = require('qrcode');
const cron    = require('node-cron');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState
} = require('@whiskeysockets/baileys');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- session & socket storage ---
const SESSIONS_DIR = path.join(__dirname, 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
const sockets = {};

// --- manifestation store ---
const STORE_FILE = path.join(SESSIONS_DIR, 'manifestations.json');
let manifestations = {};
try {
  manifestations = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
} catch {}
function saveStore() {
  fs.writeFileSync(STORE_FILE, JSON.stringify(manifestations, null, 2));
}

// --- initialize (or re-init) a WhatsApp session ---
async function initSession(id) {
  const folder = path.join(SESSIONS_DIR, id);
  fs.mkdirSync(folder, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(folder);
  let sock = sockets[id];

  if (!sock) {
    sock = makeWASocket({ auth: state });
    sockets[id] = sock;

    // persist credentials
    sock.ev.on('creds.update', saveCreds);

    // listen for connection updates
    sock.ev.on('connection.update', async update => {
      const { qr, connection, lastDisconnect } = update;

      // cache latest QR
      if (qr) sock.lastQR = qr;

      // once paired → send welcome message
      if (connection === 'open') {
        const jid = `${id}@s.whatsapp.net`;
        await sock.sendMessage(jid, {
          text: '✅ Your number is now registered! Your manifestation has been saved.'
        });
      }

      // on close → clean up / reconnect
      if (connection === 'close') {
        const code     = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        delete sockets[id];

        if (loggedOut) {
          // force re-scan next time
          fs.rmSync(folder, { recursive: true, force: true });
        } else {
          // transient error → restart session
          await initSession(id);
        }
      }
    });
  }

  // if we already have a QR, return it immediately
  if (sock.lastQR) {
    return sock.lastQR;
  }

  // otherwise wait up to 30s for the first QR event
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.ev.off('connection.update', onUpdate);
      reject(new Error('Timed out waiting for QR'));
    }, 30_000);

    function onUpdate(u) {
      if (u.qr) {
        clearTimeout(timer);
        sock.ev.off('connection.update', onUpdate);
        resolve(u.qr);
      }
    }
    sock.ev.on('connection.update', onUpdate);
  });
}

// --- REST endpoints ---

// 1) GET /start/:id → return { qr, linked }
app.get('/start/:id', async (req, res) => {
  try {
    const qr = await initSession(req.params.id);
    if (!qr) {
      // already linked
      return res.json({ linked: true });
    }
    const dataUrl = await qrcode.toDataURL(qr);
    res.json({ qr: dataUrl, linked: false });
  } catch (e) {
    // if we simply timed out waiting for a QR, treat as “already linked”
    if (e.message.includes('Timed out')) {
      return res.json({ linked: true });
    }
    res.status(500).json({ error: e.message });
  }
});

// 2) POST /manifestations → save a user’s text
app.post('/manifestations', (req, res) => {
  const { id, text } = req.body;
  if (!id || !text) {
    return res.status(400).json({ error: 'id and text required' });
  }
  manifestations[id] = text;
  saveStore();
  res.json({ success: true });
});

// catch-all → serve front-end
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`⚡️ Bot listening on port ${PORT}`);
});

// --- daily cron job at 09:00 server time ---
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
        text: `📅 Here’s your daily manifestation:\n\n"${manifestations[id]}"`
      });
      console.log(` • [${id}] sent`);
    } catch (err) {
      console.error(` • [${id}] failed: ${err.message}`);
    }
  }
});
