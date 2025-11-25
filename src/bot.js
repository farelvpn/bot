// src/bot.js
require('dotenv').config();

const { Telegraf } = require('telegraf');
const config = require('./config');
const { writeLog } = require('./utils/logger');

const userService = require('./services/userService');
const sqliteService = require('./services/sqliteService');
const vpnApiService = require('./services/vpnApiService'); 
const serverService = require('./services/serverService'); 

const coreHandler = require('./handlers/coreHandler');
const topupHandler = require('./handlers/topupHandler');
const adminHandler = require('./handlers/adminHandler');
const vpnHandler = require('./handlers/vpnHandler');
const callbackRouter = require('./handlers/callbackRouter');

if (!config.botToken || !config.adminId) {
    writeLog("FATAL: BOT_TOKEN dan ADMIN_USER_ID harus diatur di file .env");
    process.exit(1);
}

const bot = new Telegraf(config.botToken);

if (config.webhook.url) {
    const { setupWebhookListener } = require('./handlers/webhookHandler');
    setupWebhookListener(bot);
    writeLog(`Bot "${config.storeName}" berhasil dimulai dalam mode WEBHOOK.`);
} else {
    bot.launch();
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
            await bot.telegram.sendMessage(acc.telegram_id, msg, { parse_mode: 'Markdown' }).catch(e => writeLog(`Gagal kirim pengingat ke ${acc.telegram_id}: ${e.message}`));
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

async function checkExpiredTrials() {
    const now = new Date().toISOString();
    try {
        const expiredTrials = await sqliteService.all('SELECT * FROM active_trials WHERE expiry_timestamp <= ?', [now]);
        if (expiredTrials.length > 0) {
            writeLog(`[TrialScheduler] Ditemukan ${expiredTrials.length} akun trial kedaluwarsa.`);
        }
        for (const trial of expiredTrials) {
            const server = serverService.getAllAvailableServers().find(s => s.name === trial.server_name);
            if (server) {
                try {
                    await vpnApiService.deleteAccount(server, trial.protocol, trial.username);
                    await sqliteService.run('DELETE FROM active_trials WHERE id = ?', [trial.id]);
                    writeLog(`[TrialScheduler] Berhasil menghapus akun trial ${trial.username} dari server ${server.name}.`);
                    
                    const message = `🔔 *Trial Berakhir*\n\nAkun trial Anda (\`${trial.username}\` di server *${trial.server_name}*) telah kedaluwarsa dan berhasil dihapus.`;
                    bot.telegram.sendMessage(trial.telegram_id, message, { parse_mode: 'Markdown' }).catch(e => {
                        writeLog(`[TrialScheduler] Gagal mengirim notifikasi expired ke ${trial.telegram_id}: ${e.message}`);
                    });

                } catch (deleteError) {
                    writeLog(`[TrialScheduler] FATAL: Gagal menghapus akun trial ${trial.username}: ${deleteError.message}`);
                    await sqliteService.run('DELETE FROM active_trials WHERE id = ?', [trial.id]);
                }
            } else {
                 writeLog(`[TrialScheduler] Server "${trial.server_name}" untuk akun trial ${trial.username} tidak ditemukan. Menghapus dari DB.`);
                 await sqliteService.run('DELETE FROM active_trials WHERE id = ?', [trial.id]);
            }
        }
    } catch (error) {
        writeLog(`[TrialScheduler] ERROR: ${error.message}`);
    }
}

setInterval(checkExpiredAccounts, 1000 * 60 * 60);
checkExpiredAccounts();

if (config.trial.enabled) {
    setInterval(checkExpiredTrials, 1000 * 60);
    checkExpiredTrials();
    writeLog('[Init] Fitur Trial diaktifkan.');
} else {
    writeLog('[Init] Fitur Trial dinonaktifkan.');
}

bot.on('text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;

    const msg = ctx.message;
    const userId = msg.from.id.toString();
    const username = msg.from.username || `user${userId}`;
    
    userService.ensureUser(userId, username);
  
    if (topupHandler.pendingTopupInput[userId]) {
        return topupHandler.processTopupAmount(bot, msg);
    }
    if (vpnHandler.pendingVpnAction[userId]) {
        return vpnHandler.handleVpnUserInput(bot, msg);
    }
    if (adminHandler.pendingAdminAction[userId]) {
        return adminHandler.handleAdminInput(bot, msg);
    }

    if (msg.text.startsWith('/start')) {
        return coreHandler.handleStartCommand(bot, msg);
    }
    if (msg.text.startsWith('/admin')) {
        return adminHandler.handleAdminPanelMain(bot, msg);
    }
  
    await coreHandler.sendMainMenu(bot, userId, msg.chat.id, null);
});

bot.on('callback_query', (ctx) => {
    const query = ctx.callbackQuery;
    if (!query.message) return;

    const userId = query.from.id.toString();
    const username = query.from.username || `user${userId}`;
    userService.ensureUser(userId, username);
    
    callbackRouter.routeCallbackQuery(bot, query);
});

bot.catch((err, ctx) => {
    writeLog(`[Telegraf Error] ${ctx.updateType}: ${err.message}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));