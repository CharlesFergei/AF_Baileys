/**
 * AF_Baileys - Pairing Guide with Error Handling
 * Contoh lengkap dengan retry logic dan proper error handling
 */

const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// Logger configuration
const logger = pino({ level: 'info' });

// Configuration
const CONFIG = {
    AUTH_FOLDER: 'auth_info',
    MAX_RETRY_ATTEMPTS: 5,
    RETRY_DELAY_MS: 5000,
    CONNECT_TIMEOUT_MS: 60000,
    KEEP_ALIVE_INTERVAL_MS: 30000,
};

class BaileysBot {
    constructor() {
        this.sock = null;
        this.retryAttempts = 0;
    }

    /**
     * Start bot connection
     */
    async start() {
        try {
            logger.info('🚀 Starting Baileys Bot...');
            
            // Ensure auth folder exists
            this.ensureAuthFolder();
            
            // Initialize auth state
            const { state, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_FOLDER);
            
            // Create socket with optimized settings
            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: true,
                browser: ['Ubuntu', 'Chrome', '20.0.04'],
                connectTimeoutMs: CONFIG.CONNECT_TIMEOUT_MS,
                defaultQueryTimeoutMs: 0,
                keepAliveIntervalMs: CONFIG.KEEP_ALIVE_INTERVAL_MS,
                retryRequestDelayMs: 250,
                logger: pino({ level: 'silent' }),
            });

            // Setup event listeners
            this.setupEventListeners(saveCreds);
            
            // Reset retry counter on successful connection
            this.sock.ev.on('connection.update', (update) => {
                if (update.connection === 'open') {
                    this.retryAttempts = 0;
                    logger.info('✅ Connection established! Retry counter reset.');
                }
            });
        } catch (error) {
            logger.error('❌ Error during startup:', error.message);
            this.handleConnectionError();
        }
    }

    /**
     * Setup all event listeners
     */
    setupEventListeners(saveCreds) {
        // Connection updates
        this.sock.ev.on('connection.update', async (update) => {
            await this.handleConnectionUpdate(update);
        });

        // Credentials update
        this.sock.ev.on('creds.update', saveCreds);

        // Messages
        this.sock.ev.on('messages.upsert', async (m) => {
            await this.handleMessages(m);
        });

        // Group updates
        this.sock.ev.on('groups.update', async (update) => {
            logger.info('📢 Group update:', update);
        });

        // Contact updates
        this.sock.ev.on('contacts.update', async (update) => {
            logger.info('👥 Contact update:', update);
        });
    }

    /**
     * Handle connection updates
     */
    async handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr, isNewLogin, isLatest } = update;

        // QR Code displayed
        if (qr) {
            logger.info('📱 QR Code generated. Scan with WhatsApp!');
        }

        // Connection states
        if (connection === 'connecting') {
            logger.info('⏳ Connecting to WhatsApp...');
        }

        if (connection === 'open') {
            logger.info('✅ Connected to WhatsApp!');
            logger.info(`🔐 Authenticated: ${isLatest ? 'Latest' : 'Old'} Session`);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;

            if (shouldReconnect) {
                if (this.retryAttempts < CONFIG.MAX_RETRY_ATTEMPTS) {
                    this.retryAttempts++;
                    const waitTime = CONFIG.RETRY_DELAY_MS * this.retryAttempts;
                    logger.warn(
                        `🔄 Reconnecting... (Attempt ${this.retryAttempts}/${CONFIG.MAX_RETRY_ATTEMPTS}) ` +
                        `Waiting ${waitTime}ms`
                    );
                    setTimeout(() => this.start(), waitTime);
                } else {
                    logger.error('❌ Max reconnection attempts reached. Stopping bot.');
                    process.exit(1);
                }
            } else {
                // Logout - remove auth
                logger.error('❌ Device logged out. Please rescan QR code.');
                this.clearAuthFolder();
                setTimeout(() => this.start(), 5000);
            }
        }
    }

    /**
     * Handle incoming messages
     */
    async handleMessages(m) {
        try {
            const message = m.messages[0];
            
            // Skip if no actual message content
            if (!message.message) return;

            const sender = message.key.remoteJid;
            const text = message.message.conversation || 
                         message.message.extendedTextMessage?.text || '';
            const senderName = message.pushName || 'Unknown';

            logger.info(`📨 Message from ${senderName}: ${text.substring(0, 50)}...`);

            // Auto reply
            if (text.toLowerCase() === 'hello') {
                await this.sock.sendMessage(sender, {
                    text: `👋 Hi ${senderName}! Thanks for reaching out.`
                });
            }
        } catch (error) {
            logger.error('Error handling message:', error.message);
        }
    }

    /**
     * Handle connection errors
     */
    async handleConnectionError() {
        if (this.retryAttempts < CONFIG.MAX_RETRY_ATTEMPTS) {
            this.retryAttempts++;
            const waitTime = CONFIG.RETRY_DELAY_MS * this.retryAttempts;
            logger.warn(
                `🔄 Retrying after error... (Attempt ${this.retryAttempts}/${CONFIG.MAX_RETRY_ATTEMPTS})`
            );
            setTimeout(() => this.start(), waitTime);
        } else {
            logger.error('❌ Failed to start after max retries.');
            process.exit(1);
        }
    }

    /**
     * Ensure auth folder exists
     */
    ensureAuthFolder() {
        if (!fs.existsSync(CONFIG.AUTH_FOLDER)) {
            fs.mkdirSync(CONFIG.AUTH_FOLDER, { recursive: true });
            logger.info(`📁 Created auth folder: ${CONFIG.AUTH_FOLDER}`);
        }
    }

    /**
     * Clear auth folder (full logout)
     */
    clearAuthFolder() {
        try {
            if (fs.existsSync(CONFIG.AUTH_FOLDER)) {
                fs.rmSync(CONFIG.AUTH_FOLDER, { recursive: true, force: true });
                logger.info('🗑️ Auth folder cleared.');
            }
        } catch (error) {
            logger.error('Error clearing auth folder:', error.message);
        }
    }

    /**
     * Send test message
     */
    async sendTestMessage(phoneNumber) {
        try {
            if (!this.sock) {
                logger.error('Bot not connected!');
                return;
            }

            const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
            
            await this.sock.sendMessage(jid, {
                text: '✅ Test message from AF_Baileys Bot!'
            });
            
            logger.info(`✉️ Message sent to ${phoneNumber}`);
        } catch (error) {
            logger.error('Error sending message:', error.message);
        }
    }
}

// Start bot
const bot = new BaileysBot();
bot.start();

// Graceful shutdown
process.on('SIGINT', () => {
    logger.info('👋 Shutting down...');
    process.exit(0);
});

module.exports = BaileysBot;
