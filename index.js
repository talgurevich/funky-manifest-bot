import express from 'express';
import path from 'path';
import fs from 'fs';
import baileys from '@adiwajshing/baileys';
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Ensure session and data directories exist
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const sockets = {};

// Start or resume session and emit first QR/update
app.get('/start/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const userDir = path.join(SESSIONS_DIR, userId);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(userDir);
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });
    sockets[userId] = { sock, saveCreds };

    let responded = false;

    // Listen for connection updates
    sock.ev.on('connection.update', update => {
      if (!responded) {
        if (update.qr) {
          responded = true;
          return res.type('svg').send(update.qr);
        } else if (update.connection === 'open') {
          responded = true;
          saveCreds();
          return res.send('✅ Session established! Now submit your manifestations.');
        }
      }
    });

    // Timeout fallback after 15 seconds
    setTimeout(() => {
      if (!responded && !res.headersSent) {
        res.status(504).send('Timeout generating QR; please try again.');
      }
    }, 15000);

  } catch (err) {
    console.error('Init session error', userId, err);
    if (!res.headersSent) res.status(500).send('Server error initializing session');
  }
});

// Save manifestations
app.post('/manifestations', (req, res) => {
  const { userId, items } = req.body;
  if (!userId || !Array.isArray(items)) return res.status(400).send('Invalid payload');
  const file = path.join(DATA_DIR, `${userId}.json`);
  fs.writeFileSync(file, JSON.stringify(items, null, 2));
  return res.send('Manifestations saved!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡️ Bot listening on port ${PORT}`));
