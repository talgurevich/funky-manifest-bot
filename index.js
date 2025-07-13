// Enhanced index.js with interactive commands and better functionality
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

// --- Create a Baileys-compatible logger ---
const logger = {
  level: 'silent', // 'trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'
  child: () => logger,
  trace: (...args) => console.log('[TRACE]', ...args),
  debug: (...args) => console.log('[DEBUG]', ...args),
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  fatal: (...args) => console.error('[FATAL]', ...args)
};

// --- session & socket storage ---
const SESSIONS_DIR = path.join(__dirname, 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
const sockets = {};

// --- enhanced data store ---
const STORE_FILE = path.join(SESSIONS_DIR, 'userdata.json');
let userData = {};
try {
  userData = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
} catch {}

function saveStore() {
  fs.writeFileSync(STORE_FILE, JSON.stringify(userData, null, 2));
}

// Initialize user data structure
function initUserData(id) {
  if (!userData[id]) {
    userData[id] = {
      manifestations: [],
      settings: {
        enabled: true,
        time: '09:00',
        timezone: 'UTC',
        frequency: 'daily' // daily, weekly, custom
      },
      stats: {
        joined: new Date().toISOString(),
        totalSent: 0,
        lastSent: null
      }
    };
    saveStore();
  }
}

// --- message handling ---
function handleIncomingMessage(sock, message) {
  const { remoteJid, body } = message;
  
  // Only handle messages from individual users (not groups)
  if (!body || !remoteJid || !remoteJid.endsWith('@s.whatsapp.net')) {
    console.log(`⏭️ Skipping message from ${remoteJid}: not a user message`);
    return;
  }

  const userId = remoteJid.split('@')[0];
  const text = body.toLowerCase().trim();
  
  console.log(`🔍 [${userId}] Processing message: "${text}"`);

  // Initialize user if not exists
  initUserData(userId);

  // Command routing
  if (text.startsWith('/')) {
    console.log(`🤖 [${userId}] Processing command: ${text}`);
    handleCommand(sock, userId, text, remoteJid);
  } else {
    // Handle natural language interactions
    console.log(`💬 [${userId}] Processing natural message: ${text}`);
    handleNaturalMessage(sock, userId, text, remoteJid);
  }
}

async function handleCommand(sock, userId, command, jid) {
  const user = userData[userId];
  
  console.log(`🎯 [${userId}] Executing command: ${command}`);
  
  try {
    const commandName = command.split(' ')[0];
    console.log(`📝 [${userId}] Command name: ${commandName}`);
    
    switch (commandName) {
      case '/start':
      case '/help':
        console.log(`📋 [${userId}] Sending help message`);
        await sock.sendMessage(jid, {
          text: `🌟 *Welcome to Manifest Bot!*

*Commands:*
📝 /add - Add a new manifestation
📋 /list - View your manifestations
✏️ /edit [number] - Edit a manifestation
🗑️ /delete [number] - Delete a manifestation
⏰ /time [HH:MM] - Set delivery time
🔔 /frequency [daily/weekly] - Set frequency
📊 /stats - View your stats
⏸️ /pause - Pause daily messages
▶️ /resume - Resume daily messages
❓ /help - Show this help

*Examples:*
/add I am successful and confident
/time 08:30
/frequency weekly

You can also just type your manifestation naturally!`
        });
        console.log(`✅ [${userId}] Help message sent successfully`);
        break;

      case '/add':
        const manifestText = command.substring(4).trim();
        if (!manifestText) {
          await sock.sendMessage(jid, { 
            text: '📝 Please provide your manifestation after /add\n\nExample: /add I am successful and confident' 
          });
          return;
        }
        user.manifestations.push(manifestText);
        saveStore();
        await sock.sendMessage(jid, { 
          text: `✅ Manifestation added!\n\n"${manifestText}"\n\nYou now have ${user.manifestations.length} manifestation(s).` 
        });
        break;

      case '/list':
        if (user.manifestations.length === 0) {
          await sock.sendMessage(jid, { text: '📝 You have no manifestations yet. Use /add to create one!' });
          return;
        }
        let list = '📋 *Your Manifestations:*\n\n';
        user.manifestations.forEach((m, i) => {
          list += `${i + 1}. "${m}"\n\n`;
        });
        await sock.sendMessage(jid, { text: list });
        break;

      case '/edit':
        const editArgs = command.split(' ');
        const editIndex = parseInt(editArgs[1]) - 1;
        const newText = editArgs.slice(2).join(' ');
        
        if (isNaN(editIndex) || editIndex < 0 || editIndex >= user.manifestations.length) {
          await sock.sendMessage(jid, { 
            text: '❌ Invalid manifestation number. Use /list to see your manifestations.' 
          });
          return;
        }
        
        if (!newText) {
          await sock.sendMessage(jid, { 
            text: `📝 Current manifestation ${editIndex + 1}:\n"${user.manifestations[editIndex]}"\n\nProvide new text: /edit ${editIndex + 1} [new text]` 
          });
          return;
        }
        
        const oldText = user.manifestations[editIndex];
        user.manifestations[editIndex] = newText;
        saveStore();
        await sock.sendMessage(jid, { 
          text: `✅ Manifestation updated!\n\nOld: "${oldText}"\nNew: "${newText}"` 
        });
        break;

      case '/delete':
        const deleteIndex = parseInt(command.split(' ')[1]) - 1;
        if (isNaN(deleteIndex) || deleteIndex < 0 || deleteIndex >= user.manifestations.length) {
          await sock.sendMessage(jid, { 
            text: '❌ Invalid manifestation number. Use /list to see your manifestations.' 
          });
          return;
        }
        
        const deletedText = user.manifestations.splice(deleteIndex, 1)[0];
        saveStore();
        await sock.sendMessage(jid, { 
          text: `🗑️ Manifestation deleted:\n"${deletedText}"\n\nYou now have ${user.manifestations.length} manifestation(s).` 
        });
        break;

      case '/time':
        const timeArg = command.split(' ')[1];
        if (!timeArg || !/^\d{2}:\d{2}$/.test(timeArg)) {
          await sock.sendMessage(jid, { 
            text: `⏰ Current delivery time: ${user.settings.time}\n\nTo change: /time HH:MM\nExample: /time 08:30` 
          });
          return;
        }
        
        user.settings.time = timeArg;
        saveStore();
        await sock.sendMessage(jid, { 
          text: `⏰ Delivery time updated to ${timeArg}!\n\n⚠️ Note: Currently uses server timezone. Timezone support coming soon!` 
        });
        break;

      case '/frequency':
        const freq = command.split(' ')[1];
        if (!freq || !['daily', 'weekly'].includes(freq)) {
          await sock.sendMessage(jid, { 
            text: `🔔 Current frequency: ${user.settings.frequency}\n\nOptions: daily, weekly\nExample: /frequency weekly` 
          });
          return;
        }
        
        user.settings.frequency = freq;
        saveStore();
        await sock.sendMessage(jid, { 
          text: `🔔 Frequency updated to ${freq}!` 
        });
        break;

      case '/stats':
        const stats = user.stats;
        const joinedDate = new Date(stats.joined).toLocaleDateString();
        const lastSentDate = stats.lastSent ? new Date(stats.lastSent).toLocaleDateString() : 'Never';
        
        await sock.sendMessage(jid, { 
          text: `📊 *Your Stats:*

📅 Joined: ${joinedDate}
📨 Total messages sent: ${stats.totalSent}
📬 Last sent: ${lastSentDate}
📝 Manifestations: ${user.manifestations.length}
⏰ Delivery time: ${user.settings.time}
🔔 Frequency: ${user.settings.frequency}
▶️ Status: ${user.settings.enabled ? 'Active' : 'Paused'}` 
        });
        break;

      case '/pause':
        user.settings.enabled = false;
        saveStore();
        await sock.sendMessage(jid, { 
          text: '⏸️ Daily manifestations paused. Use /resume to restart.' 
        });
        break;

      case '/resume':
        user.settings.enabled = true;
        saveStore();
        await sock.sendMessage(jid, { 
          text: '▶️ Daily manifestations resumed!' 
        });
        break;

      default:
        console.log(`❓ [${userId}] Unknown command: ${commandName}`);
        await sock.sendMessage(jid, { 
          text: '❓ Unknown command. Type /help for available commands.' 
        });
    }
  } catch (error) {
    console.error(`❌ [${userId}] Error handling command ${command}:`, error);
    try {
      await sock.sendMessage(jid, { 
        text: '❌ An error occurred processing your command. Please try again.' 
      });
    } catch (sendError) {
      console.error(`❌ [${userId}] Failed to send error message:`, sendError);
    }
  }
}

async function handleNaturalMessage(sock, userId, text, jid) {
  const user = userData[userId];
  
  // Auto-detect manifestation-like messages
  const manifestationKeywords = ['i am', 'i will', 'i manifest', 'i attract', 'i deserve', 'i have'];
  const isManifestationLike = manifestationKeywords.some(keyword => text.includes(keyword));
  
  if (isManifestationLike) {
    user.manifestations.push(text);
    saveStore();
    await sock.sendMessage(jid, { 
      text: `✨ I detected a manifestation! Added:\n\n"${text}"\n\nYou now have ${user.manifestations.length} manifestation(s). Type /help for more options.` 
    });
  } else {
    // General helpful response
    await sock.sendMessage(jid, { 
      text: `Hi! I'm your manifestation bot. 🌟

You can:
• Type your manifestation naturally (e.g., "I am successful")
• Use /add to add a manifestation
• Use /help to see all commands

What would you like to manifest today?` 
    });
  }
}

// --- enhanced session initialization ---
async function initSession(id) {
  const folder = path.join(SESSIONS_DIR, id);
  fs.mkdirSync(folder, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(folder);
  let sock = sockets[id];

  if (!sock) {
    sock = makeWASocket({ 
      auth: state,
      printQRInTerminal: false,
      logger: logger, // Use our compatible logger
      browser: ['Manifest Bot', 'Chrome', '1.0.0'] // Identify as a proper client
    });
    sockets[id] = sock;

    // Initialize user data
    initUserData(id);

    // persist credentials
    sock.ev.on('creds.update', saveCreds);

    // listen for incoming messages with comprehensive logging
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      console.log(`📬 [${id}] Messages upsert event: type=${type}, count=${messages.length}`);
      
      if (type === 'notify') {
        for (const msg of messages) {
          console.log(`📝 [${id}] Message details:`, {
            fromMe: msg.key.fromMe,
            remoteJid: msg.key.remoteJid,
            hasMessage: !!msg.message,
            messageKeys: msg.message ? Object.keys(msg.message) : []
          });
          
          if (!msg.key.fromMe && msg.message) {
            // Extract text from different message types
            let text = '';
            if (msg.message.conversation) {
              text = msg.message.conversation;
            } else if (msg.message.extendedTextMessage?.text) {
              text = msg.message.extendedTextMessage.text;
            } else if (msg.message.imageMessage?.caption) {
              text = msg.message.imageMessage.caption;
            } else if (msg.message.videoMessage?.caption) {
              text = msg.message.videoMessage.caption;
            }
            
            if (text) {
              console.log(`📩 [${id}] Received message: "${text}" from ${msg.key.remoteJid}`);
              handleIncomingMessage(sock, {
                remoteJid: msg.key.remoteJid,
                body: text
              });
            } else {
              console.log(`⚠️ [${id}] No text found in message:`, JSON.stringify(msg.message, null, 2));
            }
          }
        }
      }
    });

    // Also listen for message history sync
    sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => {
      console.log(`📚 [${id}] Message history set: ${messages.length} messages, ${chats.length} chats`);
    });

    // listen for connection updates
    sock.ev.on('connection.update', async update => {
      const { qr, connection, lastDisconnect, receivedPendingNotifications } = update;
      
      console.log(`🔄 [${id}] Connection update:`, { connection, qr: !!qr, receivedPendingNotifications });

      if (qr) {
        console.log(`📱 [${id}] QR code generated`);
        sock.lastQR = qr;
      }

      if (connection === 'connecting') {
        console.log(`🔄 [${id}] Connecting to WhatsApp...`);
      }

      if (connection === 'open') {
        console.log(`✅ [${id}] WhatsApp connected successfully`);
        console.log(`👤 [${id}] User info:`, sock.user);
        sock.isConnected = true;
        
        const jid = `${id}@s.whatsapp.net`;
        try {
          await sock.sendMessage(jid, {
            text: `🎉 *Welcome to Manifest Bot!*

Your number is now connected! I'll send you daily manifestations and you can interact with me anytime.

Type /help to see what I can do, or just send me your manifestation naturally!

✨ Ready to manifest your dreams! ✨`
          });
          console.log(`📨 [${id}] Welcome message sent`);
        } catch (error) {
          console.error(`❌ [${id}] Failed to send welcome message:`, error);
        }
      }

      if (connection === 'close') {
        console.log(`❌ [${id}] WhatsApp connection closed`);
        sock.isConnected = false;
        
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        console.log(`🔍 [${id}] Close reason: ${code}, logged out: ${loggedOut}`);
        
        delete sockets[id];

        if (loggedOut) {
          console.log(`🗑️ [${id}] Removing session files due to logout`);
          fs.rmSync(folder, { recursive: true, force: true });
        } else {
          console.log(`🔄 [${id}] Reconnecting...`);
          setTimeout(() => initSession(id), 5000); // Wait 5 seconds before reconnecting
        }
      }
    });
  }

  if (sock.lastQR) {
    return sock.lastQR;
  }

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

// --- enhanced REST endpoints ---

// 1) GET /start/:id → return { qr, linked }
app.get('/start/:id', async (req, res) => {
  try {
    const sock = sockets[req.params.id];
    
    // Check if socket exists and is connected
    if (sock && (sock.isConnected || sock.user)) {
      return res.json({ linked: true });
    }
    
    const qr = await initSession(req.params.id);
    if (!qr) {
      return res.json({ linked: true });
    }
    const dataUrl = await qrcode.toDataURL(qr);
    res.json({ qr: dataUrl, linked: false });
  } catch (e) {
    if (e.message.includes('Timed out')) {
      return res.json({ linked: true });
    }
    console.error(`Error in /start/${req.params.id}:`, e);
    res.status(500).json({ error: e.message });
  }
});

// 2) POST /manifestations → save a user's text (legacy endpoint)
app.post('/manifestations', (req, res) => {
  const { id, text } = req.body;
  if (!id || !text) {
    return res.status(400).json({ error: 'id and text required' });
  }
  
  initUserData(id);
  userData[id].manifestations.push(text);
  saveStore();
  res.json({ success: true });
});

// 3) GET /user/:id → get user data
app.get('/user/:id', (req, res) => {
  const id = req.params.id;
  initUserData(id);
  res.json(userData[id]);
});

// 4) POST /user/:id/settings → update user settings
app.post('/user/:id/settings', (req, res) => {
  const id = req.params.id;
  const settings = req.body;
  
  initUserData(id);
  Object.assign(userData[id].settings, settings);
  saveStore();
  res.json({ success: true });
});

// 5) POST /test/:id → test message sending
app.post('/test/:id', async (req, res) => {
  const id = req.params.id;
  const { message } = req.body;
  
  const sock = sockets[id];
  if (!sock) {
    return res.status(404).json({ error: 'No active session' });
  }
  
  try {
    const jid = `${id}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message || 'Test message from bot!' });
    res.json({ success: true });
  } catch (error) {
    console.error(`Test message error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// catch-all → serve front-end
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`⚡️ Enhanced Manifest Bot listening on port ${PORT}`);
});

// --- enhanced daily cron job ---
cron.schedule('0 * * * *', async () => { // Run every hour to check custom times
  const currentTime = new Date();
  const currentHour = currentTime.getHours().toString().padStart(2, '0');
  const currentMinute = currentTime.getMinutes().toString().padStart(2, '0');
  const currentTimeString = `${currentHour}:${currentMinute}`;
  
  console.log(`🔔 Checking for scheduled manifestations at ${currentTimeString}...`);
  
  for (const id of Object.keys(userData)) {
    const user = userData[id];
    
    // Skip if disabled or no manifestations
    if (!user.settings.enabled || user.manifestations.length === 0) {
      continue;
    }
    
    // Check if it's time to send
    const shouldSend = user.settings.time === currentTimeString;
    
    // For weekly frequency, also check if it's the right day
    if (user.settings.frequency === 'weekly' && shouldSend) {
      const dayOfWeek = currentTime.getDay();
      if (dayOfWeek !== 1) { // Only Monday for weekly
        continue;
      }
    }
    
    if (!shouldSend) continue;
    
    const sock = sockets[id];
    if (!sock) {
      console.log(`  • [${id}] no active socket, skipping`);
      continue;
    }
    
    const jid = `${id}@s.whatsapp.net`;
    try {
      // Pick a random manifestation if multiple exist
      const randomIndex = Math.floor(Math.random() * user.manifestations.length);
      const manifestation = user.manifestations[randomIndex];
      
      await sock.sendMessage(jid, {
        text: `✨ *Daily Manifestation* ✨

"${manifestation}"

🌟 Believe it, feel it, manifest it! 🌟

Type /help for more options or /pause to stop daily messages.`
      });
      
      // Update stats
      user.stats.totalSent++;
      user.stats.lastSent = new Date().toISOString();
      saveStore();
      
      console.log(`  • [${id}] sent manifestation: "${manifestation}"`);
    } catch (err) {
      console.error(`  • [${id}] failed: ${err.message}`);
    }
  }
});

// --- cleanup inactive sessions (daily at 2 AM) ---
cron.schedule('0 2 * * *', () => {
  console.log('🧹 Cleaning up inactive sessions...');
  
  const activeSockets = Object.keys(sockets);
  const userDataKeys = Object.keys(userData);
  
  // Remove user data for users without active sockets (after 30 days)
  userDataKeys.forEach(id => {
    if (!activeSockets.includes(id)) {
      const user = userData[id];
      const joinedDate = new Date(user.stats.joined);
      const daysSinceJoined = (Date.now() - joinedDate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysSinceJoined > 30) {
        delete userData[id];
        console.log(`  • Removed inactive user: ${id}`);
      }
    }
  });
  
  saveStore();
});