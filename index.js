// index.js
import express from 'express';
import path from 'path';
import fs from 'fs';
import pkg from '@adiwajshing/baileys';
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = pkg;

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// In-memory map to track active sockets per user
const sockets = {};

// Route: initialize or resume a WhatsApp session and return the QR
app.get('/start/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(path.join('sessions', userId));
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });
    sockets[userId] = { sock, saveCreds };

    sock.ev.once('connection.update', update => {
      if (update.qr) {
        // Send back the QR SVG for scanning
        return res.type('svg').send(update.qr);
      }
      if (update.connection === 'open') {
        // Auth successful, save credentials
        saveCreds();
        return res.send('✅ Session established! Now submit your manifestations.');
      }
    });

    sock.ev.on('connection.update', update => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const code = lastDisconnect.error?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) {
          console.warn(`${userId} disconnected unexpectedly. Reconnecting...`);
          // Could optionally recreate the socket here
        } else {
          // Logged out permanently; clean up
          delete sockets[userId];
          fs.rmSync(path.join('sessions', userId), { recursive: true, force: true });
        }
      }
    });
  } catch (err) {
    console.error('Error initializing session for', userId, err);
    res.status(500).send('Failed to initialize WhatsApp session.');
  }
});

// Route: save manifestations for a user
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
app.listen(PORT, () => console.log(`⚡️ Manifestation bot listening on port ${PORT}`));
