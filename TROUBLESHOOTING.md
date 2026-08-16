# 🔧 Troubleshooting Guide - AF_Baileys

## 🔴 Common Pairing Errors

### 1. "Gagal menautkan perangkat" (Failed to pair device)

**Penyebab:**
- WhatsApp rate limiting (terlalu banyak pairing attempt)
- Nomor sudah aktif di WhatsApp lain
- Session/auth files corrupt atau expired
- Network connection unstable

**Solusi:**
```bash
# Step 1: Hapus session lama
rm -rf auth_info/

# Step 2: Tunggu 2-5 jam sebelum retry
# (WhatsApp memiliki rate limiting 6 jam per nomor)

# Step 3: Pastikan nomor TIDAK aktif di WhatsApp
# Logout dari semua perangkat WhatsApp sebelum pairing

# Step 4: Restart bot
node bot.js
```

---

### 2. "Connection Lost" / Disconnected

**Penyebab:**
- Network latency tinggi
- WebSocket timeout
- Server atau cloud menutup koneksi idle

**Solusi:**
```javascript
const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');

const startConnection = async () => {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 30000, // Keep connection alive
            retryRequestDelayMs: 250
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('📱 Scan QR Code:', qr);
            }
            
            if (connection === 'open') {
                console.log('✅ Connected successfully!');
            } else if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
                
                if (shouldReconnect) {
                    console.log('🔄 Reconnecting...');
                    // Tunggu 5 detik sebelum reconnect
                    setTimeout(startConnection, 5000);
                } else {
                    console.log('❌ Connection closed. Please rescan QR.');
                }
            } else if (connection === 'connecting') {
                console.log('⏳ Connecting...');
            }
        });

        sock.ev.on('creds.update', saveCreds);
    } catch (err) {
        console.error('❌ Error:', err?.message);
        // Retry setelah 10 detik
        setTimeout(startConnection, 10000);
    }
};

startConnection();
```

---

### 3. "Invalid Session" / Auth Credentials Error

**Penyebab:**
- File auth corrupt
- Logout dari WhatsApp Web
- Session expired (>2 minggu)

**Solusi:**
```bash
# Hapus semua auth files
rm -rf auth_info_*
rm -rf auth_info/

# Restart bot dan rescan QR code
node bot.js
```

---

### 4. "QR Code Not Displaying"

**Penyebab:**
- Terminal tidak support QR code rendering
- Library qrcode belum terinstall

**Solusi:**
```javascript
const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');

const startConnection = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // Display QR in terminal
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('connection.update', (update) => {
        const { qr } = update;
        if (qr) {
            // Manual QR handling jika perlu
            console.log('QR Code:', qr);
            
            // Atau generate manual
            const QRCode = require('qrcode');
            QRCode.toFile('qr.png', qr).catch(console.error);
            console.log('QR saved to qr.png');
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
};

startConnection();
```

---

## ⚠️ Rate Limiting Issues

### WhatsApp Rate Limit Timing

| Action | Cooldown |
|--------|----------|
| Pairing attempt failed | 6 jam |
| Sending messages (bulk) | 1 detik per pesan |
| Group creation | 5 menit |
| Contact sync | 5 menit |

### Best Practices untuk Avoid Rate Limiting:

```javascript
// ✅ Gunakan queue untuk pesan
const PQueue = require('p-queue');
const queue = new PQueue({ concurrency: 1, interval: 1000, intervalCap: 1 });

for (const number of numbers) {
    await queue.add(async () => {
        await sock.sendMessage(number + '@s.whatsapp.net', { text: 'Hello' });
        console.log('Message sent to', number);
    });
}

// ❌ Jangan lakukan ini (spam)
for (const number of numbers) {
    sock.sendMessage(number + '@s.whatsapp.net', { text: 'Hello' });
}
```

---

## 📋 Checklist Sebelum Production

- [ ] Nomor WhatsApp sudah verified
- [ ] Node.js version >= 20.0.0
- [ ] Semua dependencies terinstall (`npm install` atau `yarn`)
- [ ] Auth folder di gitignore
- [ ] Error handling & retry logic sudah implement
- [ ] Session persistence sudah setup
- [ ] Logging sudah enabled
- [ ] Rate limiting strategy sudah diterapkan
- [ ] Network connection stable
- [ ] Tested pairing & message sending

---

## 🚀 Quick Start - Copy Paste Ready

```javascript
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');

const startBot = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 30000,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) console.log('📱 QR:', qr);
        if (connection === 'open') console.log('✅ Connected');
        if (connection === 'connecting') console.log('⏳ Connecting');
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            if (shouldReconnect) setTimeout(startBot, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        if (!message.message) return;
        
        console.log('📨 Message:', message.pushName, message.message.conversation);
        
        // Reply otomatis
        await sock.sendMessage(message.key.remoteJid, {
            text: 'Thanks for your message! 👋'
        });
    });

    sock.ev.on('creds.update', saveCreds);
};

startBot().catch(console.error);
```

---

## 📞 Butuh Help?

- 📖 GitHub Issues: [AF_Baileys Issues](https://github.com/CharlesFergei/AF_Baileys/issues)
- 💬 GitHub Discussions: [AF_Baileys Discussions](https://github.com/CharlesFergei/AF_Baileys/discussions)
- 🔗 Original Repo: [Fyxzpediaa/Baileys](https://github.com/Fyxzpediaa/Baileys)
