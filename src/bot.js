// src/bot.js
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { writeLog } = require('./utils/logger');

// Servis
const userService = require('./services/userService');
const sqliteService = require('./services/sqliteService');

// Handlers
const coreHandler = require('./handlers/coreHandler');
const topupHandler = require('./handlers/topupHandler');
const adminHandler = require('./handlers/adminHandler');
const vpnHandler = require('./handlers/vpnHandler');
const callbackRouter = require('./handlers/callbackRouter');

if (!config.botToken || !config.adminId) {
    writeLog("FATAL: BOT_TOKEN dan ADMIN_USER_ID harus diatur di file .env");
    process.exit(1);
}

let bot;

if (config.webhook.url) {
    bot = new TelegramBot(config.botToken);
    const { setupWebhookListener } = require('./handlers/webhookHandler');
    setupWebhookListener(bot);
    writeLog(`Bot "${config.storeName}" berhasil dimulai dalam mode WEBHOOK.`);
} else {
    bot = new TelegramBot(config.botToken, { polling: true });
    writeLog(`Bot "${config.storeName}" berhasil dimulai dalam mode POLLING.`);
    if(config.paymentGateway.baseUrl) {
        writeLog("PERINGATAN: Fitur Topup Otomatis (Payment Gateway) tidak akan berfungsi penuh dalam mode polling.");
    }
}

async function checkExpiredAccounts() {
    writeLog('[Scheduler] Menjalankan pemeriksaan akun kedaluwarsa...');
    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);

    try {
        const expiringSoon = await sqliteService.all(
            "SELECT * FROM vpn_transactions WHERE expiry_date <= ? AND expiry_date > ? AND reminder_sent = 0",
            [threeDaysFromNow.toISOString(), now.toISOString()]
        );
        for (const acc of expiringSoon) {
            const expiry = new Date(acc.expiry_date);
            const timeLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
            const msg = `🔔 *Pengingat Perpanjangan*\n\nAkun VPN Anda (\`${acc.username}\` di server *${acc.server_name}*) akan kedaluwarsa dalam *${timeLeft} hari*.\n\nSegera lakukan perpanjangan.`;
            await bot.sendMessage(acc.telegram_id, msg, { parse_mode: 'Markdown' }).catch(e => writeLog(`Gagal kirim pengingat ke ${acc.telegram_id}: ${e.message}`));
            await sqliteService.run('UPDATE vpn_transactions SET reminder_sent = 1 WHERE id = ?', [acc.id]);
            writeLog(`[Scheduler] Mengirim pengingat ke User ID ${acc.telegram_id} untuk akun ${acc.username}`);
        }
        const expired = await sqliteService.all("SELECT * FROM vpn_transactions WHERE expiry_date <= ?", [now.toISOString()]);
        for (const acc of expired) {
            await sqliteService.run('DELETE FROM vpn_transactions WHERE id = ?', [acc.id]);
            writeLog(`[Scheduler] Menghapus akun expired: ${acc.username} dari User ID ${acc.telegram_id}`);
        }
    } catch (error) {
        writeLog(`[Scheduler] ERROR: ${error.message}`);
    }
}

setInterval(checkExpiredAccounts, 1000 * 60 * 60);
checkExpiredAccounts();

bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private' || !msg.text) return;
    const userId = msg.from.id.toString();
    const username = msg.from.username || `user${userId}`;
    
    userService.ensureUser(userId, username);
  
    if (topupHandler.pendingTopupInput[userId]?.active) return topupHandler.processTopupAmount(bot, msg);
    if (vpnHandler.pendingVpnAction[userId]) return vpnHandler.handleProcessUsername(bot, msg);
    if (adminHandler.pendingAdminAction[userId]) {
        return adminHandler.handleAdminInput(bot, msg);
    }

    if (msg.text.startsWith('/start')) return coreHandler.handleStartCommand(bot, msg);
    if (msg.text.startsWith('/admin')) return adminHandler.handleAdminPanelMain(bot, { from: msg.from, message: msg });
  
    await coreHandler.sendMainMenu(bot, userId, msg.chat.id, null);
});

bot.on('callback_query', (query) => {
    const userId = query.from.id.toString();
    const username = query.from.username || `user${userId}`;
    userService.ensureUser(userId, username);
    callbackRouter.routeCallbackQuery(bot, query);
});

bot.on('webhook_error', (err) => writeLog(`Webhook Error: ${err.message}`));
bot.on('polling_error', (err) => writeLog(`Polling Error: ${err.message}`));
