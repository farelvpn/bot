// src/handlers/trialHandler.js
const serverService = require('../services/serverService');
const sqliteService = require('../services/sqliteService');
const vpnApiService = require('../services/vpnApiService');
const { writeLog } = require('../utils/logger');
const { backButton, prettyLine } = require('../utils/helpers');
const crypto = require('crypto');

const TRIAL_DURATION_MINUTES = 60;
const TRIAL_COOLDOWN_HOURS = 24;

async function handleTrialMenu(bot, query) {
    const userId = query.from.id.toString();
    const lastTrial = await sqliteService.get('SELECT * FROM trial_logs WHERE telegram_id = ?', [userId]);

    if (lastTrial) {
        const now = new Date();
        const lastTrialTime = new Date(lastTrial.timestamp);
        const cooldownEndTime = new Date(lastTrialTime.getTime() + TRIAL_COOLDOWN_HOURS * 60 * 60 * 1000);

        if (now < cooldownEndTime) {
            const timeLeft = Math.ceil((cooldownEndTime - now) / (1000 * 60 * 60));
            await bot.answerCallbackQuery(query.id, {
                text: `Anda sudah mengklaim trial. Coba lagi dalam ${timeLeft} jam.`,
                show_alert: true,
            });
            return;
        }
    }

    const servers = serverService.getAllAvailableServers().filter(s => {
        return Object.values(s.protocols).some(p => p.enabled);
    });

    if (servers.length === 0) {
        return bot.answerCallbackQuery(query.id, { text: 'Saat ini tidak ada server yang tersedia untuk trial.', show_alert: true });
    }

    const text = `🎁 *Ambil Akun Trial Gratis*\n${prettyLine()}\n` +
                 `Anda bisa mendapatkan akun trial gratis dengan masa aktif *${TRIAL_DURATION_MINUTES} menit*.\n\n` +
                 `Akun trial hanya bisa diklaim *satu kali setiap ${TRIAL_COOLDOWN_HOURS} jam*.\n\n` +
                 `Bot akan memilih server dan protokol secara acak untuk Anda.\n\n` +
                 `Tekan tombol di bawah untuk mengklaim.`;

    const keyboard = [
        [{ text: '🚀 Klaim Akun Trial Sekarang', callback_data: 'trial_claim' }],
        [backButton('⬅️ Kembali', 'back_menu')]
    ];

    await bot.editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function processTrialClaim(bot, query) {
    const userId = query.from.id.toString();
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    // Double check cooldown just in case
    const lastTrial = await sqliteService.get('SELECT * FROM trial_logs WHERE telegram_id = ?', [userId]);
    if (lastTrial) {
        const now = new Date();
        const lastTrialTime = new Date(lastTrial.timestamp);
        const cooldownEndTime = new Date(lastTrialTime.getTime() + TRIAL_COOLDOWN_HOURS * 60 * 60 * 1000);
        if (now < cooldownEndTime) {
            return bot.answerCallbackQuery(query.id, { text: `Anda baru saja mengklaim trial.`, show_alert: true });
        }
    }

    await bot.editMessageText('⏳ Sedang menyiapkan akun trial Anda, mohon tunggu...', {
        chat_id: chatId, message_id: messageId
    });

    try {
        const servers = serverService.getAllAvailableServers().filter(s => Object.values(s.protocols).some(p => p.enabled));
        if (servers.length === 0) throw new Error('Tidak ada server trial yang tersedia.');

        const randomServer = servers[Math.floor(Math.random() * servers.length)];
        const availableProtocols = Object.entries(randomServer.protocols)
            .filter(([, details]) => details.enabled)
            .map(([protoId]) => protoId);
        
        if (availableProtocols.length === 0) throw new Error('Tidak ada protokol yang aktif di server terpilih.');

        const randomProtocol = availableProtocols[Math.floor(Math.random() * availableProtocols.length)];
        const username = `trial-${crypto.randomBytes(4).toString('hex')}`;
        const password = crypto.randomBytes(6).toString('hex');
        const duration = 1; // Create account for 1 day on panel

        const result = await vpnApiService.createAccount(randomServer, randomProtocol, username, password, duration);

        const now = new Date();
        const expiryDate = new Date(now.getTime() + TRIAL_DURATION_MINUTES * 60 * 1000);

        // Store to active_trials for deletion scheduler
        await sqliteService.run(
            'INSERT INTO active_trials (telegram_id, server_name, protocol, username, expiry_timestamp) VALUES (?, ?, ?, ?, ?)',
            [userId, randomServer.name, randomProtocol, username, expiryDate.toISOString()]
        );
        
        // Update trial_logs to enforce cooldown
        await sqliteService.run(
            'INSERT OR REPLACE INTO trial_logs (telegram_id, timestamp) VALUES (?, ?)',
            [userId, now.toISOString()]
        );

        await bot.editMessageText(result.details, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[backButton('Selesai', 'back_menu')]]
            }
        });

        writeLog(`[TrialHandler] Akun trial ${randomProtocol} ${username} berhasil dibuat untuk User ID ${userId}`);

    } catch (error) {
        writeLog(`[TrialHandler] Gagal membuat akun trial untuk ${userId}: ${error.message}`);
        await bot.editMessageText(`❌ *Gagal Membuat Akun Trial*\n\n${error.message}`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[backButton('Kembali', 'back_menu')]] }
        });
    }
}

module.exports = { handleTrialMenu, processTrialClaim };
