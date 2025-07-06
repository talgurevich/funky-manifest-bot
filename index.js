// index.js
import express from 'express';
import path from 'path';
import fs from 'fs';
import pkg from '@adiwajshing/baileys';
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = pkg;

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Ensure data and session directories exist
dconst SESSIONS_DIR = path.join(process.cwd(), 'sessions');
const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// In-memory map for active sockets per user
const sockets = {};

// Route: initialize or resume a WhatsApp session and return the QR
app.get('/start/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    // Prepare user session directory
    const userDir = path.join(SESSIONS_DIR, userId);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(userDir);
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });
    sockets[userId] = { sock, saveCreds };

    let qrSent = false;

    sock.ev.on('connection.update', update => {
      if (update.qr && !qrSent) {
        qrSent = true;
        return res.type('svg').send(update.qr);
      }
      if (update.connection === 'open' && !qrSent) {
        qrSent = true;
        saveCreds();
        return res.send('✅ Session established! Now submit your manifestations.');
      }
      if (update.connection === 'close' && !qrSent) {
        const code = update.lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          delete sockets[userId];
          fs.rmSync(userDir, { recursive: true, force: true });
          return res.status(400).send('Session logged out. Please restart.');
        }
      }
    });

    // Safety timeout: if no QR/open within 30s, give up
    setTimeout(() => {
      if (!qrSent && !res.headersSent) {
        res.status(504).send('QR generation timed out, please try again.');
      }
    }, 30000);

  } catch (err) {
    console.error('Error initializing session for', userId, err);
    if (!res.headersSent) res.status(500).send('Failed to initialize WhatsApp session.');
  }
});

// Route: save manifestations for a user
app.post('/manifestations', (req, res) => {
  const { userId, items } = req.body;
  if (!userId || !Array.isArray(items)) {
    return res.status(400).send('Invalid payload');
  }
  const file = path.join(DATA_DIR, `${userId}.json`);
  fs.writeFileSync(file, JSON.stringify(items, null, 2));
  res.send('Manifestations saved successfully!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡️ Manifestation bot listening on port ${PORT}`));
