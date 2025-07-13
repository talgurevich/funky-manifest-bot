// index.js
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const qrcode  = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const app  = express();
const PORT = process.env.PORT || 3000;

// Serve front-end from /public
app.use(express.static(path.join(__dirname, 'public')));

// Ensure sessions directory exists
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR);

const sockets = {};   // track active sockets per target
const qrStore = {};   // track latest QR data-URL per target

// 1) Initialize a WhatsApp session for a phone number
app.get('/start/:target', async (req, res) => {
  const target = req.params.target;
  if (sockets[target]) {
    return res.status(200).json({ message: `Session already running for ${target}` });
  }

  try {
    // prepare per-target auth folder
    const authFolder = path.join(SESSIONS_DIR, target);
    if (!fs.existsSync(authFolder)) {
      fs.mkdirSync(authFolder, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,  // we’ll serve it via HTTP
    });

    sockets[target] = sock;

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // whenever a fresh QR arrives, convert to base64 data-URL
      if (qr) {
        try {
          qrStore[target] = await qrcode.toDataURL(qr);
        } catch (e) {
          console.error('Failed to generate QR Data-URL', e);
        }
      }

      // on close: drop socket so client can re-/start
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        console.warn(`Connection for ${target} closed (loggedOut=${loggedOut})`);
        delete sockets[target];
      }

      // once fully open (paired!), send two confirmation messages
      if (connection === 'open') {
        const jid = `${target}@s.whatsapp.net`;
        try {
          // first, confirm the manifestation registration
          await sock.sendMessage(jid, {
            text: '✅ Your manifestation has been registered!'
          });
          // then, confirm the number itself is linked
          await sock.sendMessage(jid, {
            text: `📲 Number *${target}* has been successfully linked.`
          });
        } catch (e) {
          console.error('Error sending confirmation messages', e);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    return res.status(200).json({ message: `Initializing session for ${target}` });
  } catch (err) {
    console.error('Init session error', err);
    return res.status(500).json({ error: err.toString() });
  }
});

// 2) Retrieve the latest QR code for that target
app.get('/qr/:target', (req, res) => {
  const dataUrl = qrStore[req.params.target];
  if (!dataUrl) {
    return res.status(404).json({ error: 'No QR code available yet' });
  }
  res.json({ qr: dataUrl });
});

app.listen(PORT, () => {
  console.log(`⚡️ Bot listening on port ${PORT}`);
});
