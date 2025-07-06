// index.js
import express from 'express';
import path from 'path';
import fs from 'fs';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@adiwajshing/baileys';

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// In-memory map of sockets to keep sessions alive
const sockets = {};

// 1. Start or resume WhatsApp session for a user and emit QR
app.get('/start/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(path.join('sessions', userId));
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });
    sockets[userId] = { sock, saveCreds };

    sock.ev.once('connection.update', update => {
      if (update.qr) {
        // QR code SVG string
        return res.type('svg').send(update.qr);
      }
      if (update.connection === 'open') {
        // session established
        saveCreds();
        return res.send('✅ Session established! Now submit your manifestations.');
      }
    });

    sock.ev.on('connection.update', update => {
      // handle reconnects
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const code = lastDisconnect.error?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) {
          console.log(`${userId} disconnected, reconnecting...`);
          // optionally reconnect
        } else {
          // logged out permanently
          delete sockets[userId];
          fs.rmSync(path.join('sessions', userId), { recursive: true, force: true });
        }
      }
    });
  } catch (err) {
    console.error('Error in /start:', err);
    res.status(500).send('Failed to initialize session.');
  }
});

// 2. Save manifestations list for user
app.post('/manifestations', (req, res) => {
  const { userId, items } = req.body;
  if (!userId || !Array.isArray(items)) {
    return res.status(400).send('Invalid payload');
  }
  const dataDir = path.join('data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${userId}.json`), JSON.stringify(items, null, 2));
  res.send('Manifestations saved successfully!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡️ Bot listening on port ${PORT}`));
