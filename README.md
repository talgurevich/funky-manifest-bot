# 🌟 Funky Manifest Bot

An AI-powered WhatsApp manifestation bot that sends daily affirmations straight to your phone. Built for fun during an employment break to explore WhatsApp automation and practice manifestation!

## 🚀 Live Demo
**Try it live:** [funky-manifest.com](https://funky-manifest.com)

## ✨ What It Does

Connect your WhatsApp and receive personalized daily manifestations. Simply text your goals and affirmations naturally ("I am successful and confident"), and the AI will help you stay consistent with your manifestation practice. Set your preferred delivery time and let the universe work its magic! 🌟

## 🎯 Key Features

- 📱 **WhatsApp Integration** - QR code scanning for seamless connection
- 🤖 **Natural Language Processing** - Automatically detects manifestation phrases
- ⏰ **Custom Scheduling** - Set your preferred delivery time and frequency
- 💬 **Interactive Commands** - Full command system with real-time responses
- 📊 **Personal Analytics** - Track your manifestation journey and stats
- 🔒 **Multi-User Support** - Each user gets their own isolated bot instance
- 🌐 **Web Interface** - Beautiful step-by-step onboarding experience

## 🛠️ Tech Stack

- **Backend:** Node.js + Express
- **WhatsApp API:** [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) (unofficial WhatsApp library)
- **Frontend:** Vanilla HTML/CSS/JavaScript
- **Hosting:** Heroku with custom domain
- **Analytics:** Google Analytics with custom event tracking
- **Scheduling:** Node-cron for daily message delivery
- **Storage:** JSON file-based data persistence

## 📱 Available Commands

Once connected to WhatsApp, you can use these commands:

- `/help` - Show all available commands
- `/add [text]` - Add a new manifestation
- `/list` - View all your manifestations
- `/edit [number] [new text]` - Edit an existing manifestation
- `/delete [number]` - Delete a manifestation
- `/time [HH:MM]` - Set daily delivery time
- `/frequency [daily/weekly]` - Set delivery frequency
- `/stats` - View your manifestation statistics
- `/pause` - Pause daily messages
- `/resume` - Resume daily messages

## 🏗️ Architecture

This is a **self-bot** architecture where:
1. Users text their own WhatsApp number through the bot interface
2. Each user gets their own isolated session and data storage
3. The bot runs on the user's WhatsApp account (not a business account)
4. Natural language detection automatically saves manifestation-like messages

## 🚀 Getting Started

### Prerequisites
- Node.js 16+ 
- WhatsApp account
- Heroku account (for deployment)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/talgurevich/funky-manifest-bot.git
   cd funky-manifest-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm start
   ```

4. **Open your browser**
   ```
   http://localhost:3000
   ```

### Environment Variables

Create a `.env` file with:
```env
PORT=3000
NODE_ENV=development
```

## 📂 Project Structure

```
funky-manifest-bot/
├── index.js              # Main server file with WhatsApp integration
├── public/
│   └── index.html        # Frontend interface
├── sessions/             # WhatsApp session storage (auto-generated)
├── package.json          # Dependencies and scripts
└── README.md            # This file
```

## 🎨 Features Deep Dive

### WhatsApp Integration
- Uses Baileys library for unofficial WhatsApp Web API
- QR code generation for easy mobile scanning
- Persistent sessions with automatic reconnection
- Message event handling with comprehensive logging

### Natural Language Processing
- Automatic detection of manifestation keywords
- Supports phrases like "I am", "I will", "I manifest", "I attract"
- Smart command parsing with error handling
- Rate limiting to prevent spam

### User Experience
- Step-by-step onboarding flow
- Real-time connection status updates
- Mobile-responsive design
- Error handling with helpful messages

### Analytics & Tracking
- Google Analytics integration
- Custom events for conversion funnel
- User engagement metrics
- Error tracking and debugging

## 🚀 Deployment

The app is deployed on Heroku with:
- Automatic SSL certificates
- Custom domain (funky-manifest.com)
- Environment-based configuration
- Automatic daily manifestation scheduling

## 🤖 How It Works

1. **User visits the web interface**
2. **Enters their phone number** with country code
3. **Scans QR code** with WhatsApp mobile app
4. **Sets up manifestations** and preferences
5. **Receives daily messages** at their chosen time
6. **Can interact** with the bot using natural language or commands

## 📈 Analytics

The bot tracks:
- User registration and setup completion
- Daily manifestation delivery success rates
- Command usage patterns
- User engagement and retention
- Error rates and debugging information

## 🎯 Learnings & Fun Facts

- Built during an employment break as a creative coding project
- Explored WhatsApp automation without expensive Business API
- Learned about persistent WebSocket connections and session management
- Discovered the quirky world of self-bot applications
- Practice with full-stack development and deployment

## 🔮 Future Enhancements

- [ ] Multiple manifestation categories (health, wealth, relationships)
- [ ] Voice message manifestations
- [ ] Manifestation streaks and gamification
- [ ] Integration with calendar for event-based manifestations
- [ ] Export manifestation journal to PDF
- [ ] Timezone support for global users

## 🤝 Contributing

This is a personal fun project, but feel free to:
- Open issues for bugs or suggestions
- Fork and create your own version
- Share your manifestation success stories!

## ⚠️ Disclaimer

This bot uses an unofficial WhatsApp library and is intended for personal use and learning purposes. Use responsibly and in accordance with WhatsApp's Terms of Service.

## 📧 Contact

Built with ❤️ by [Tal Gurevich](https://linkedin.com/in/talgurevich)

**Live Demo:** [funky-manifest.com](https://funky-manifest.com)

---

*"The real manifestation was the code we wrote along the way" ✨*
