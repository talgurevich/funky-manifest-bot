// index.js
import express from 'express'
import path from 'path'
import fs from 'fs'
import { webcrypto } from 'crypto'
import { default as makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'

globalThis.crypto = webcrypto

const SESSIONS_DIR = path.join(process.cwd(), 'auth_info_baileys')
// ensure base sessions dir exists
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true })

const app = express()

// serve your static front-end
app.use(express.static(path.join(process.cwd(), 'public')))

// Helper to spin up a new WhatsApp session for a given ID
async function initSession(id) {
  const dir = path.join(SESSIONS_DIR, id)

  // wipe any old state so Baileys always emits a fresh QR
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(dir)
  const sock = makeWASocket({ auth: state })

  // once we actually open, send a welcome message
  sock.ev.once('connection.update', update => {
    if (update.connection === 'open') {
      // adjust the JID formatting if needed:
      const jid = id.includes('@') ? id : `${id}@s.whatsapp.net`
      sock.sendMessage(jid, { text: '✅ Your manifestation has been registered!' })
        .catch(console.error)
    }
  })

  // give back the first QR we get, or reject if it closes
  return new Promise((resolve, reject) => {
    sock.ev.on('connection.update', update => {
      const { qr, connection, lastDisconnect } = update
      if (qr) {
        resolve(qr)
      }
      if (connection === 'close') {
        reject(lastDisconnect?.error || new Error('Connection closed'))
      }
    })
    sock.ev.on('creds.update', saveCreds)
  })
}

app.get('/start/:id', async (req, res) => {
  // disable HTTP caching
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate')

  try {
    const qr = await initSession(req.params.id)
    res.send(qr)
  } catch (e) {
    console.error('Init session error for', req.params.id, e)
    res.status(500).send(e.message || 'Error generating QR')
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`⚡️ Bot listening on port ${PORT}`))
