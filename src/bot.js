// src/bot.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { writeLog } = require('./utils/logger');
const { setupWebhookListener } = require('./handlers/webhookHandler');
const userService = require('./services/userService');
const sqliteService = require('./services/sqliteService');
const { processTopupAmount, pendingTopupInput } = require('./handlers/topupHandler');
const { handleBalanceInput, pendingAdminAction } = require('./handlers/adminHandler');
const { handleProcessUsername, pendingVpnAction } = require('./handlers/vpnHandler');
const { routeCallbackQuery } = require('./handlers/callbackRouter');

if (!config.botToken || !config.webhook.url || !config.adminId) {
    writeLog("FATAL: BOT_TOKEN, WEBHOOK_URL, dan ADMIN_USER_ID harus diatur di file .env");
    process.exit(1);
}

const bot = new TelegramBot(config.botToken);
setupWebhookListener(bot);

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
            const msg = `🔔 *Pengingat Perpanjangan*\n\nAkun VPN Anda (\`${acc.username}\` di server *${acc.server_name}*) akan kedaluwarsa dalam *${timeLeft} hari*.\n\nSegera lakukan perpanjangan melalui menu "Perpanjang Akun VPN" untuk menghindari penonaktifan akun.`;
            await bot.sendMessage(acc.telegram_id, msg, { parse_mode: 'Markdown' }).catch(e => writeLog(`Gagal kirim pengingat ke ${acc.telegram_id}: ${e.message}`));
            await sqliteService.run('UPDATE vpn_transactions SET reminder_sent = 1 WHERE id = ?', [acc.id]);
            writeLog(`[Scheduler] Mengirim pengingat ke User ID ${acc.telegram_id} untuk akun ${acc.username}`);
        }

        const expired = await sqliteService.all("SELECT * FROM vpn_transactions WHERE expiry_date <= ?", [now.toISOString()]);
        for (const acc of expired) {
            await sqliteService.run('DELETE FROM vpn_transactions WHERE id = ?', [acc.id]);
            writeLog(`[Scheduler] Menghapus akun expired: ${acc.username} milik User ID ${acc.telegram_id}`);
        }
    } catch (error) {
        writeLog(`[Scheduler] ERROR: ${error.message}`);
    }
}

// Jalankan pengecekan setiap jam
setInterval(checkExpiredAccounts, 1000 * 60 * 60);
// Jalankan sekali saat bot start
checkExpiredAccounts();

bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private' || !msg.text) return;
    const userId = msg.from.id.toString();
    const username = msg.from.username || `user${userId}`;
    
    if (!msg.text.startsWith('/start')) {
        userService.ensureUser(userId, username);
    }
  
    if (pendingTopupInput[userId]?.active) return processTopupAmount(bot, msg);
    if (pendingVpnAction[userId]) return handleProcessUsername(bot, msg);
    if (pendingAdminAction[userId]) {
        const action = pendingAdminAction[userId].action;
        if (action === 'balance_input') return handleBalanceInput(bot, msg);
        // Tambahkan handler untuk input admin lainnya di sini jika ada
    }

    if (msg.text.startsWith('/start')) {
        const { handleStartCommand } = require('./handlers/coreHandler');
        return handleStartCommand(bot, msg);
    }
    if (msg.text.startsWith('/admin')) {
         const { handleAdminPanelMain } = require('./handlers/adminHandler');
         return handleAdminPanelMain(bot, { from: msg.from, message: msg });
    }
  
    // Jika tidak ada kondisi yang terpenuhi, jangan lakukan apa-apa
    // atau bisa juga kirim menu utama lagi jika diinginkan.
    // const { sendMainMenu } = require('./handlers/coreHandler');
    // await sendMainMenu(bot, userId, msg.chat.id, null);
});

bot.on('callback_query', (query) => {
    routeCallbackQuery(bot, query);
});

bot.on('webhook_error', (err) => writeLog(`Webhook Error: ${err.message}`));
bot.on('polling_error', (err) => writeLog(`Polling Error: ${err.message}`));

writeLog(`Bot "${config.storeName}" berhasil dimulai dalam mode Webhook.`);
