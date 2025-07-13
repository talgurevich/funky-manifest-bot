// index.js
import { webcrypto } from 'crypto'
globalThis.crypto ??= webcrypto

import express from 'express'
import path from 'path'
import { makeWASocket, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'
import qrcode from 'qrcode'

const app = express()
app.use(express.json())
// serve your front-end assets
app.use(express.static(path.join(process.cwd(), 'public')))

const PORT = process.env.PORT || 3000
// in-memory map so you can broadcast QR → front-end via SSE/WebSocket/etc.
const qrStore = {}

async function initSession(id) {
  const dir = path.join(process.cwd(), 'sessions', id)
  const { state, saveCreds } = await useMultiFileAuthState(dir)

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  })

  // expose QR for your front-end to fetch
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      // generate a data-URL so you can inject directly into <img src="...">
      qrStore[id] = await qrcode.toDataURL(qr, { margin: 2 })
    }

    if (connection === 'open') {
      // send your welcome message
      await sock.sendMessage(
        /* your manifest number JID */ `${id}@s.whatsapp.net`,
        { text: 'Your manifestation has been registered' }
      )
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error)?.output?.statusCode
      const loggedOut = code === DisconnectReason.loggedOut
      if (!loggedOut) {
        console.log(`reconnecting session ${id}…`)
        initSession(id)
      }
    }
  })

  sock.ev.on('creds.update', saveCreds)
  return sock
}

// start/refresh a session
app.get('/start/:id', async (req, res) => {
  try {
    await initSession(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    console.error('Init session error', e)
    res.status(500).json({ error: e.message })
  }
})

// fetch the QR data-URL
app.get('/qr/:id', (req, res) => {
  const d = qrStore[req.params.id]
  if (!d) return res.status(404).send('no QR yet')
  res.type('application/json').send({ qrDataUrl: d })
})

app.listen(PORT, () => {
  console.log(`⚡️ Bot listening on port ${PORT}`)
})
