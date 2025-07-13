// index.js
const express = require('express');
const path = require('path');
const { toDataURL } = require('qrcode');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState
} = require('@whiskeysockets/baileys');
const { webcrypto } = require('crypto');

// Provide the Web Crypto API to Baileys
globalThis.crypto = webcrypto;

const app = express();
const port = process.env.PORT || 3000;

// Serve your public/front-end (HTML/CSS/JS) out of ./public
app.use(express.static(path.join(__dirname, 'public')));

// In-memory sessions store (keyed by phone number)
const sessions = {};

/**
 * Initialize a WhatsApp session for a given phone number.
 * Generates QR → stores it, handles reconnects, and sends
 * a welcome message once paired.
 */
async function initSession(phone) {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${phone}`);
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false
    });
    sessions[phone] = { sock, qr: null };

    // Watch for connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // New QR? turn it into a base64 data-URL
      if (qr) {
        try {
          sessions[phone].qr = await toDataURL(qr);
        } catch (err) {
          console.error('Error generating QR DataURL:', err);
        }
      }

      // Once linked, send your user a confirmation
      if (connection === 'open') {
        console.log(`✅ WhatsApp session open for ${phone}`);
        try {
          await sock.sendMessage(
            `${phone}@s.whatsapp.net`,
            { text: 'Your manifestation has been registered' }
          );
        } catch (err) {
          console.error('Error sending welcome message:', err);
        }
      }

      // If it closed, decide whether to reconnect
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`⚠️ Connection closed for ${phone}, reconnect?`, shouldReconnect);
        if (shouldReconnect) initSession(phone);
      }
    });

    // Persist credentials on update
    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error('Init session error', error);
  }
}

/**
 * Endpoint to kick off QR-generation for a given phone.
 * Returns JSON { qr: dataURL } once available.
 */
app.get('/start/:phone', async (req, res) => {
  const phone = req.params.phone;
  if (!sessions[phone]) {
    await initSession(phone);
  }
  const qr = sessions[phone]?.qr;
  if (qr) {
    res.json({ qr });
  } else {
    res.status(500).json({ error: 'QR not yet generated, try again in a sec.' });
  }
});

app.listen(port, () => {
  console.log(`⚡️ Bot listening on port ${port}`);
});
