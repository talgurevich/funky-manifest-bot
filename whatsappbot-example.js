const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// Bot configuration§
const BOT_CONFIG = {
    name: 'WhatsApp Bot',
    prefix: '!',
    owner: '972111111111@s.whatsapp.net' // Replace with your phone number
};

// Bot commands
const COMMANDS = {
    'help': {
        description: 'Show available commands',
        handler: (sock, msg, args) => {
            const helpText = `🤖 *${BOT_CONFIG.name} Commands*\n\n` +
                Object.entries(COMMANDS)
                    .filter(([cmd]) => cmd !== 'help')
                    .map(([cmd, info]) => `*${BOT_CONFIG.prefix}${cmd}* - ${info.description}`)
                    .join('\n');
            
            sock.sendMessage(msg.key.remoteJid, { text: helpText });
        }
    },
    'ping': {
        description: 'Check if bot is online',
        handler: (sock, msg, args) => {
            sock.sendMessage(msg.key.remoteJid, { text: '🏓 Pong! Bot is online and running.' });
        }
    },
    'info': {
        description: 'Get bot information',
        handler: (sock, msg, args) => {
            const infoText = `🤖 *Bot Information*\n\n` +
                `*Name:* ${BOT_CONFIG.name}\n` +
                `*Prefix:* ${BOT_CONFIG.prefix}\n` +
                `*Status:* Online\n` +
                `*Uptime:* ${process.uptime().toFixed(2)}s`;
            
            sock.sendMessage(msg.key.remoteJid, { text: infoText });
        }
    },
    'echo': {
        description: 'Echo back your message',
        handler: (sock, msg, args) => {
            const text = args.join(' ');
            if (text) {
                sock.sendMessage(msg.key.remoteJid, { text: `📢 Echo: ${text}` });
            } else {
                sock.sendMessage(msg.key.remoteJid, { text: '❌ Please provide a message to echo!' });
            }
        }
    },
    'time': {
        description: 'Get current time',
        handler: (sock, msg, args) => {
            const now = new Date();
            const timeText = `🕐 *Current Time*\n\n` +
                `*Date:* ${now.toDateString()}\n` +
                `*Time:* ${now.toTimeString()}\n` +
                `*Timezone:* ${now.toLocaleString()}`;
            
            sock.sendMessage(msg.key.remoteJid, { text: timeText });
        }
    }
};

// Auth state management
const AUTH_FOLDER = './auth_info_baileys';
if (!fs.existsSync(AUTH_FOLDER)) {
    fs.mkdirSync(AUTH_FOLDER, { recursive: true });
}

// Create WhatsApp connection
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    
    const sock = makeWASocket({
        auth: state
    });

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('🔄 QR Code received, scan it with your WhatsApp:');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
            
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Connected to WhatsApp successfully!');
            console.log(`🤖 Bot is now online and ready to respond to commands with prefix: ${BOT_CONFIG.prefix}`);
        }
    });

    // Handle credentials update
    sock.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        if (msg.message) {
            const messageType = Object.keys(msg.message)[0];
            
            if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
                const text = messageType === 'conversation' 
                    ? msg.message.conversation 
                    : msg.message.extendedTextMessage.text;
                
                await handleMessage(sock, msg, text);
            }
        }
    });

    return sock;
}

// Handle incoming messages
async function handleMessage(sock, msg, text) {
    const chatId = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    
    console.log(`📨 Message from ${sender}: ${text}`);
    
    // Check if message starts with bot prefix
    if (text.startsWith(BOT_CONFIG.prefix)) {
        const args = text.slice(BOT_CONFIG.prefix.length).trim().split(' ');
        const command = args.shift().toLowerCase();
        
        console.log(`🤖 Command received: ${command} with args:`, args);
        
        // Check if command exists
        if (COMMANDS[command]) {
            try {
                await COMMANDS[command].handler(sock, msg, args);
                console.log(`✅ Command ${command} executed successfully`);
            } catch (error) {
                console.error(`❌ Error executing command ${command}:`, error);
                sock.sendMessage(chatId, { 
                    text: '❌ An error occurred while processing your command.' 
                });
            }
        } else {
            // Unknown command
            sock.sendMessage(chatId, { 
                text: `❌ Unknown command: ${command}\n\nUse *${BOT_CONFIG.prefix}help* to see available commands.` 
            });
        }
    } else {
        // Handle non-command messages (optional)
        if (text.toLowerCase().includes('hello') || text.toLowerCase().includes('hi')) {
            sock.sendMessage(chatId, { 
                text: `👋 Hello! I'm ${BOT_CONFIG.name}. Use *${BOT_CONFIG.prefix}help* to see what I can do!` 
            });
        }
    }
}

// Error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down bot...');
    process.exit(0);
});

// Start the bot
console.log('🚀 Starting WhatsApp Bot...');
console.log(`📋 Available commands: ${Object.keys(COMMANDS).map(cmd => BOT_CONFIG.prefix + cmd).join(', ')}`);
console.log('📱 Scan the QR code when it appears to connect your WhatsApp account...\n');

connectToWhatsApp().catch(console.error);
