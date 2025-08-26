// src/bot.js
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { writeLog } = require('./utils/logger');
const { setupWebhookListener } = require('./handlers/webhookHandler');

// Servis
const userService = require('./services/userService');
const sqliteService = require('./services/sqliteService');

// Handlers
const { handleStartCommand, sendMainMenu } = require('./handlers/coreHandler');
const { processTopupAmount, pendingTopupInput } = require('./handlers/topupHandler');
const { handleAdminPanelMain, handleBalanceInput, handleAddServerInput, handleBroadcastInput, pendingAdminAction } = require('./handlers/adminHandler');
const { handleProcessUsername, pendingVpnAction } = require('./handlers/vpnHandler');
const { routeCallbackQuery } = require('./handlers/callbackRouter');

// Validasi konfigurasi penting
if (!config.botToken || !config.webhook.url || !config.adminId) {
    writeLog("FATAL: BOT_TOKEN, WEBHOOK_URL, dan ADMIN_USER_ID harus diatur di file .env");
    process.exit(1);
}

const bot = new TelegramBot(config.botToken);

// Atur Webhook
setupWebhookListener(bot);

/**
 * Tugas terjadwal untuk memeriksa akun VPN yang akan dan sudah kedaluwarsa.
 */
async function checkExpiredAccounts() {
    writeLog('[Scheduler] Menjalankan pemeriksaan akun kedaluwarsa...');
    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);

    try {
        // 1. Kirim pengingat untuk akun yang akan kedaluwarsa dalam 3 hari
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

        // 2. Hapus akun yang sudah kedaluwarsa dari database
        const expired = await sqliteService.all("SELECT * FROM vpn_transactions WHERE expiry_date <= ?", [now.toISOString()]);
        for (const acc of expired) {
            await sqliteService.run('DELETE FROM vpn_transactions WHERE id = ?', [acc.id]);
            writeLog(`[Scheduler] Menghapus akun expired: ${acc.username} milik User ID ${acc.telegram_id}`);
            // Di sini Anda juga bisa menambahkan pemanggilan API untuk menghapus akun dari server panel
        }
    } catch (error) {
        writeLog(`[Scheduler] ERROR: ${error.message}`);
    }
}

// Jalankan pengecekan setiap jam
setInterval(checkExpiredAccounts, 1000 * 60 * 60);
// Jalankan sekali saat bot start untuk memastikan tidak ada yang terlewat
checkExpiredAccounts();

// Listener utama untuk semua pesan teks yang masuk.
bot.on('message', async (msg) => {
    // Abaikan pesan dari grup atau channel, dan pesan tanpa teks
    if (msg.chat.type !== 'private' || !msg.text) return;

    const userId = msg.from.id.toString();
    const username = msg.from.username || `user${userId}`;
    
    // Daftarkan pengguna jika belum ada (kecuali untuk command /start)
    if (!msg.text.startsWith('/start')) {
        userService.ensureUser(userId, username);
    }
  
    // Cek apakah ada proses yang sedang menunggu input dari pengguna ini.
    if (pendingTopupInput[userId]?.active) return processTopupAmount(bot, msg);
    if (pendingVpnAction[userId]) return handleProcessUsername(bot, msg);
    if (pendingAdminAction[userId]) {
        const action = pendingAdminAction[userId].action;
        if (action === 'balance_input') return handleBalanceInput(bot, msg);
        if (action === 'add_server_input') return handleAddServerInput(bot, msg);
        if (action === 'broadcast_input') return handleBroadcastInput(bot, msg);
        // Tambahkan handler untuk input admin lainnya di sini jika ada
    }

    // Proses sebagai command jika ada
    if (msg.text.startsWith('/start')) {
        return handleStartCommand(bot, msg);
    }
    if (msg.text.startsWith('/admin')) {
         // Membuat objek 'query' palsu agar handler bisa digunakan oleh command
         return handleAdminPanelMain(bot, { from: msg.from, message: msg });
    }
  
    // Jika tidak ada kondisi di atas yang terpenuhi, kirim menu utama.
    // Ini berguna jika pengguna mengetik teks acak.
    await sendMainMenu(bot, userId, msg.chat.id, null);
});

// Listener untuk semua event callback_query (ketika pengguna menekan tombol inline).
bot.on('callback_query', (query) => {
    routeCallbackQuery(bot, query);
});

// Menangani error yang mungkin terjadi
bot.on('webhook_error', (err) => writeLog(`Webhook Error: ${err.message}`));
bot.on('polling_error', (err) => writeLog(`Polling Error: ${err.message}`));

writeLog(`Bot "${config.storeName}" berhasil dimulai dalam mode Webhook.`);
