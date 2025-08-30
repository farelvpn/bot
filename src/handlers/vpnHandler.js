// src/handlers/vpnHandler.js
const serverService = require('../services/serverService');
const sqliteService = require('../services/sqliteService');
const vpnApiService = require('../services/vpnApiService');
const userService = require('../services/userService');
const notificationService = require('../services/notificationService');
const config = require('../config');
const { writeLog } = require('../utils/logger');
const { prettyLine, backButton, formatRupiah } = require('../utils/helpers');
const crypto = require('crypto');

const pendingVpnAction = {};

// Opsi durasi yang bisa dipilih pengguna (dalam hari)
const DURATION_OPTIONS = [30, 60, 90]; 

// ==========================================================
// HANDLER INPUT PENGGUNA
// ==========================================================
async function handleVpnUserInput(bot, msg) {
    const userId = msg.from.id.toString();
    const state = pendingVpnAction[userId];
    if (!state || state.action !== 'create_vpn_input') return;

    if (state.step === 'get_username') {
        return handleEnterPassword(bot, msg);
    }
    if (state.step === 'get_password') {
        return handleProcessPurchase(bot, msg);
    }
}

// ==========================================================
// MENU UTAMA VPN
// ==========================================================
async function handleVpnMenu(bot, query) {
    const text = `🛡️ *Menu VPN*\n${prettyLine()}\nSilakan pilih salah satu menu di bawah ini untuk mengelola layanan VPN Anda.`;
    
    const row1 = [{ text: '🛒 Beli Akun Baru', callback_data: 'vpn_buy_select_server' }];
    
    // Tombol trial hanya muncul jika diaktifkan di .env
    if (config.trial.enabled) {
        row1.push({ text: '🎁 Trial Akun', callback_data: 'vpn_trial_select_server' });
    }

    const keyboard = [
        row1,
        [{ text: '🔄 Perpanjang Akun', callback_data: 'vpn_renew_select_account' }],
        [backButton('⬅️ Kembali', 'back_menu')]
    ];
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}


// ==========================================================
// ALUR PEMBELIAN AKUN BARU
// ==========================================================
async function handleSelectServerForPurchase(bot, query) {
    const servers = serverService.getAllAvailableServers().filter(s => Object.values(s.protocols).some(p => p.enabled));
    if (servers.length === 0) {
        return bot.answerCallbackQuery(query.id, { text: 'Saat ini belum ada server yang tersedia.', show_alert: true });
    }
    
    const keyboard = [];
    for (let i = 0; i < servers.length; i += 2) {
        keyboard.push(servers.slice(i, i + 2).map(server => ({
            text: `📍 ${server.name}`,
            callback_data: `vpn_select_protocol_${server.id}`
        })));
    }
    keyboard.push([backButton('⬅️ Kembali', 'menu_vpn')]);

    const text = `*🛒 Beli Akun VPN Baru (Langkah 1 dari 4)*\n${prettyLine()}\nSilakan pilih lokasi server yang Anda inginkan:`;
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleSelectProtocol(bot, query) {
    const serverId = query.data.split('_').pop();
    const server = serverService.getServerDetails(serverId);
    if (!server) return bot.answerCallbackQuery(query.id, { text: 'Server tidak ditemukan.', show_alert: true });

    const availableProtocols = Object.entries(server.protocols)
        .filter(([, details]) => details.enabled);

    if (availableProtocols.length === 0) {
        return bot.answerCallbackQuery(query.id, { text: 'Server ini belum memiliki protokol aktif.', show_alert: true });
    }

    const user = userService.getUser(query.from.id.toString());
    const keyboard = availableProtocols.map(([protoId, details]) => {
        const price = details.prices[user.role] || details.prices.user;
        return [{
            text: `${protoId.toUpperCase()} - (Harga mulai dari ${formatRupiah(price)})`,
            callback_data: `vpn_select_duration_${serverId}_${protoId}`
        }];
    });

    keyboard.push([backButton('⬅️ Kembali', 'vpn_buy_select_server')]);
    const text = `*Pilih Protokol di ${server.name} (Langkah 2 dari 4)*\n${prettyLine()}\nSilakan pilih jenis protokol yang Anda inginkan:`;
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleSelectDuration(bot, query) {
    const [,,, serverId, protoId] = query.data.split('_');
    const server = serverService.getServerDetails(serverId);
    const protoDetails = server.protocols[protoId];
    const user = userService.getUser(query.from.id.toString());

    if (!protoDetails || !protoDetails.enabled) {
        return bot.answerCallbackQuery(query.id, { text: 'Protokol ini tidak lagi tersedia.', show_alert: true });
    }
    
    const pricePer30Days = protoDetails.prices[user.role] || protoDetails.prices.user;

    const keyboard = DURATION_OPTIONS.map(days => {
        const price = (days / 30) * pricePer30Days;
        return [{
            text: `${days} Hari - ${formatRupiah(price)}`,
            callback_data: `vpn_enter_credentials_${serverId}_${protoId}_${days}`
        }];
    });

    keyboard.push([backButton('⬅️ Kembali', `vpn_select_protocol_${serverId}`)]);

    const text = `*Pilih Durasi untuk ${protoId.toUpperCase()} (Langkah 3 dari 4)*\n${prettyLine()}\nPilih masa aktif yang Anda inginkan:`;
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleEnterUsername(bot, query) {
    const [,,, serverId, protoId, duration] = query.data.split('_');
    const userId = query.from.id.toString();

    pendingVpnAction[userId] = {
        action: 'create_vpn_input', step: 'get_username',
        serverId, protoId, duration: parseInt(duration),
        messageId: query.message.message_id, chatId: query.message.chat.id
    };

    const text = `*Masukkan Username (Langkah 4 dari 4)*\n${prettyLine()}\nSilakan ketik username yang Anda inginkan.\n\n*(Hanya huruf kecil dan angka, tanpa spasi)*`;
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backButton('Batal', `vpn_select_duration_${serverId}_${protoId}`)]] }
    });
}

async function handleEnterPassword(bot, msg) {
    const userId = msg.from.id.toString();
    const state = pendingVpnAction[userId];
    const username = msg.text.trim();
    
    await bot.deleteMessage(state.chatId, msg.message_id).catch(() => {});

    if (!/^[a-z0-9]+$/.test(username)) {
        delete pendingVpnAction[userId];
        await bot.editMessageText('❌ Username tidak valid. Proses dibatalkan.', { chat_id: state.chatId, message_id: state.messageId, parse_mode: 'Markdown' });
        return;
    }
    
    state.username = username;

    if (state.protoId === 'ssh' || state.protoId === 's5') {
        state.step = 'get_password';
        const text = `*Masukkan Password*\n${prettyLine()}\nSekarang, masukkan password untuk akun Anda.`;
        await bot.editMessageText(text, { chat_id: state.chatId, message_id: state.messageId, parse_mode: 'Markdown' });
    } else {
        await handleProcessPurchase(bot, msg);
    }
}

async function handleProcessPurchase(bot, msg) {
    const userId = msg.from.id.toString();
    const state = pendingVpnAction[userId];
    if (!state) return;

    const { serverId, protoId, duration, chatId, messageId, username } = state;
    const password = (state.step === 'get_password') ? msg.text.trim() : crypto.randomBytes(4).toString('hex');
    
    await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    delete pendingVpnAction[userId];

    const server = serverService.getServerDetails(serverId);
    const user = userService.getUser(userId);
    const pricePer30Days = server.protocols[protoId]?.prices[user.role] || server.protocols[protoId]?.prices['user'] || 0;
    const finalPrice = (duration / 30) * pricePer30Days;

    if (user.balance < finalPrice) {
        await bot.editMessageText(`❌ Saldo Anda tidak mencukupi. Dibutuhkan ${formatRupiah(finalPrice)}.`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        return;
    }

    await bot.editMessageText('⏳ Sedang membuat akun VPN Anda, mohon tunggu...\n\n_(Proses ini dapat memakan waktu hingga 1 menit)_', { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });

    try {
        const result = await vpnApiService.createAccount(server, protoId, username, password, duration);
        const { user: updatedUser, oldBalance } = userService.updateUserBalance(userId, -finalPrice, 'pembelian_vpn', { server: server.name, username });
        
        const purchaseDate = new Date();
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + duration);

        await sqliteService.run(
            `INSERT INTO vpn_transactions (idtrx, telegram_id, buyer_telegram_username, server_name, protocol, username, password, price, duration_days, purchase_date, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [result.trx_id, userId, msg.from.username, server.name, protoId, username, result.password, finalPrice, duration, purchaseDate.toISOString(), expiryDate.toISOString()]
        );
        
        await bot.editMessageText(result.details, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });

        const summaryText = `
📄 *Ringkasan Pembelian*
------------------------------------------
✅ Transaksi Berhasil!
        
*Produk:* Akun ${protoId.toUpperCase()} (${duration} Hari)
*Server:* ${server.name}
*Username:* \`${username}\`
*Harga:* ${formatRupiah(finalPrice)}
------------------------------------------
*Saldo Awal:* ${formatRupiah(oldBalance)}
*Saldo Akhir:* *${formatRupiah(updatedUser.balance)}*
        `;
        
        await bot.sendMessage(chatId, summaryText, { 
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[backButton('⬅️ Kembali ke Menu', 'back_menu')]]
            }
        });

        notificationService.sendNewVpnPurchaseNotification(bot, msg.from, {
            serverName: server.name, protocol: protoId, username: username, price: finalPrice
        });

    } catch (error) {
        let errorMessage = error.message;
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            errorMessage = "Server tidak merespons dalam 1 menit. Proses dibatalkan dan saldo Anda tidak dipotong. Silakan coba lagi nanti.";
        }
        await bot.editMessageText(`❌ *Gagal Membuat Akun*\n\n${errorMessage}`, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[backButton('Kembali', 'menu_vpn')]] }
        });
    }
}

// ==========================================================
// ALUR PERPANJANGAN AKUN
// ==========================================================
async function handleSelectAccountForRenew(bot, query) {
    const userId = query.from.id.toString();
    const accounts = await sqliteService.all('SELECT * FROM vpn_transactions WHERE telegram_id = ? ORDER BY expiry_date ASC', [userId]);
    if (accounts.length === 0) {
        return bot.answerCallbackQuery(query.id, { text: 'Anda tidak memiliki akun VPN aktif.', show_alert: true });
    }

    let text = `🔄 *Perpanjang Akun VPN*\n${prettyLine()}\nBerikut adalah daftar akun aktif Anda. Silakan pilih akun yang ingin diperpanjang.\n\n`;
    const keyboard = [];
    for (const acc of accounts) {
        const expiry = new Date(acc.expiry_date);
        const now = new Date();
        const timeLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        text += `• Server: *${acc.server_name}*\n`;
        text += `• User: \`${acc.username}\`\n`;
        text += `• Protokol: *${acc.protocol.toUpperCase()}*\n`;
        text += `• Sisa Aktif: *${timeLeft > 0 ? timeLeft : 0} hari*\n${prettyLine()}\n`;
        keyboard.push([{ text: `${acc.server_name} - ${acc.username}`, callback_data: `vpn_confirm_renew_${acc.id}` }]);
    }
    keyboard.push([backButton('⬅️ Kembali', 'menu_vpn')]);
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleConfirmRenew(bot, query) {
    const userId = query.from.id.toString();
    const accountId = query.data.split('_').pop();
    const account = await sqliteService.get('SELECT * FROM vpn_transactions WHERE id = ? AND telegram_id = ?', [accountId, userId]);

    if (!account) return bot.answerCallbackQuery(query.id, { text: 'Akun tidak ditemukan.', show_alert: true });

    const server = serverService.getAllAvailableServers().find(s => s.name === account.server_name);
    if (!server) return bot.answerCallbackQuery(query.id, { text: 'Server untuk akun ini sudah tidak tersedia.', show_alert: true });
    
    const user = userService.getUser(userId);
    const price = server.protocols[account.protocol]?.prices[user.role] || server.protocols[account.protocol]?.prices.user || 0;

    if (query.data.includes('_dorenew_')) {
        if (user.balance < price) {
            return bot.answerCallbackQuery(query.id, { text: `Saldo tidak cukup! Dibutuhkan ${formatRupiah(price)}.`, show_alert: true });
        }
        await bot.editMessageText('⏳ Memperpanjang akun, mohon tunggu...', {
            chat_id: query.message.chat.id, message_id: query.message.message_id
        });
        try {
            await vpnApiService.renewAccount(server, account.protocol, account.username);
            userService.updateUserBalance(userId, -price, 'perpanjang_vpn', { username: account.username });
            const newExpiry = new Date(account.expiry_date);
            newExpiry.setDate(newExpiry.getDate() + 30);
            await sqliteService.run('UPDATE vpn_transactions SET expiry_date = ? WHERE id = ?', [newExpiry.toISOString(), accountId]);
            await bot.editMessageText(`✅ *Perpanjangan Berhasil!*\n\nAkun \`${account.username}\` telah diperpanjang selama 30 hari.`, {
                chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[backButton('Kembali ke Menu VPN', 'menu_vpn')]] }
            });
            notificationService.sendVpnRenewNotification(bot, query.from, {
                serverName: server.name, protocol: account.protocol, username: account.username, price: price
            });
        } catch (error) {
            await bot.editMessageText(`❌ *Gagal Memperpanjang*\n\n${error.message}`, {
                chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'Markdown'
            });
        }
    } else {
        const text = `*Konfirmasi Perpanjangan*\n${prettyLine()}\n` +
            `Anda akan memperpanjang akun:\n` +
            `• User: \`${account.username}\`\n` +
            `• Server: *${account.server_name}*\n` +
            `• Biaya: *${formatRupiah(price)}* (30 Hari)\n\n` +
            `Saldo Anda saat ini: *${formatRupiah(user.balance)}*\n\n` +
            `Apakah Anda yakin?`;
        const keyboard = [
            [{ text: '✅ Ya, Perpanjang Sekarang', callback_data: `vpn_confirm_renew__dorenew_${accountId}` }],
            [backButton('Batalkan', 'vpn_renew_select_account')]
        ];
        await bot.editMessageText(text, {
            chat_id: query.message.chat.id, message_id: query.message.message_id,
            parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
        });
    }
}

// ==========================================================
// ALUR TRIAL AKUN
// ==========================================================
async function handleSelectServerForTrial(bot, query) {
    const servers = serverService.getAllAvailableServers().filter(s => Object.values(s.protocols).some(p => p.enabled));
    if (servers.length === 0) {
        return bot.answerCallbackQuery(query.id, { text: 'Saat ini belum ada server yang tersedia untuk trial.', show_alert: true });
    }

    const keyboard = servers.map(server => ([{
        text: `📍 ${server.name}`,
        callback_data: `vpn_trial_select_protocol_${server.id}`
    }]));
    keyboard.push([backButton('⬅️ Kembali', 'menu_vpn')]);

    const text = `*🎁 Trial Akun VPN (Langkah 1 dari 2)*\n${prettyLine()}\nSilakan pilih server yang ingin Anda coba:`;
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleSelectProtocolForTrial(bot, query) {
    const userId = query.from.id.toString();
    const serverId = query.data.split('_').pop();
    const server = serverService.getServerDetails(serverId);
    if (!server) return bot.answerCallbackQuery(query.id, { text: 'Server tidak ditemukan.', show_alert: true });

    const availableProtocols = Object.entries(server.protocols)
        .filter(([, details]) => details.enabled);
    if (availableProtocols.length === 0) {
        return bot.answerCallbackQuery(query.id, { text: 'Server ini belum memiliki protokol aktif.', show_alert: true });
    }

    const user = userService.getUser(userId);
    const trialSettings = userService.getTrialSettings();
    const userCooldownHours = trialSettings.cooldown_hours[user.role] || trialSettings.cooldown_hours.user;

    const keyboard = [];
    const now = new Date();

    for (const [protoId] of availableProtocols) {
        let buttonText = `🛡️ ${protoId.toUpperCase()}`;
        let callback_data = `vpn_trial_claim_${serverId}_${protoId}`;
        
        if (userCooldownHours !== -1) {
            const lastTrial = await sqliteService.get(
                'SELECT timestamp FROM trial_logs WHERE telegram_id = ? AND server_id = ? AND protocol_id = ?',
                [userId, serverId, protoId]
            );

            if (lastTrial) {
                const lastTrialTime = new Date(lastTrial.timestamp);
                const cooldownEndTime = new Date(lastTrialTime.getTime() + userCooldownHours * 60 * 60 * 1000);

                if (now < cooldownEndTime) {
                    const timeLeft = Math.ceil((cooldownEndTime - now) / (1000 * 60 * 60));
                    buttonText = `⏳ ${protoId.toUpperCase()} (Tunggu ${timeLeft} jam)`;
                    callback_data = 'noop';
                }
            }
        }
        keyboard.push([{ text: buttonText, callback_data }]);
    }

    keyboard.push([backButton('⬅️ Kembali', 'vpn_trial_select_server')]);
    const text = `*Pilih Protokol Trial di ${server.name} (Langkah 2 dari 2)*\n${prettyLine()}\nPilih protokol yang ingin Anda coba.`;
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    });
}

async function processTrialClaim(bot, query) {
    const userId = query.from.id.toString();
    const [,,, serverId, protoId] = query.data.split('_');
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    const user = userService.getUser(userId);
    const trialSettings = userService.getTrialSettings();
    const userCooldownHours = trialSettings.cooldown_hours[user.role] || trialSettings.cooldown_hours.user;

    if (userCooldownHours !== -1) {
        const lastTrial = await sqliteService.get('SELECT * FROM trial_logs WHERE telegram_id = ? AND server_id = ? AND protocol_id = ?', [userId, serverId, protoId]);
        if (lastTrial) {
            const now = new Date();
            const lastTrialTime = new Date(lastTrial.timestamp);
            const cooldownEndTime = new Date(lastTrialTime.getTime() + userCooldownHours * 60 * 60 * 1000);
            if (now < cooldownEndTime) {
                return bot.answerCallbackQuery(query.id, { text: `Anda baru saja mengklaim trial untuk protokol ini.`, show_alert: true });
            }
        }
    }
    
    await bot.editMessageText('⏳ Sedang menyiapkan akun trial Anda, mohon tunggu...', {
        chat_id: chatId, message_id: messageId
    });

    try {
        const server = serverService.getServerDetails(serverId);
        if (!server || !server.protocols[protoId]?.enabled) {
            throw new Error('Server atau protokol ini tidak lagi tersedia.');
        }

        const username = `trial-${crypto.randomBytes(4).toString('hex')}`;
        const password = crypto.randomBytes(6).toString('hex');
        const duration = 1; 
        const trialDurationMinutes = trialSettings.duration_minutes;

        const result = await vpnApiService.createAccount(server, protoId, username, password, duration);

        const now = new Date();
        const expiryDate = new Date(now.getTime() + trialDurationMinutes * 60 * 1000);

        await sqliteService.run(
            'INSERT INTO active_trials (telegram_id, server_name, protocol, username, expiry_timestamp) VALUES (?, ?, ?, ?, ?)',
            [userId, server.name, protoId, username, expiryDate.toISOString()]
        );
        
        await sqliteService.run(
            'INSERT OR REPLACE INTO trial_logs (telegram_id, server_id, protocol_id, timestamp) VALUES (?, ?, ?, ?)',
            [userId, serverId, protoId, now.toISOString()]
        );

        await bot.editMessageText(result.details, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
        });

        const cooldownText = userCooldownHours === -1 ? 'Unlimited' : `${userCooldownHours} Jam`;
        const infoText = `*Informasi Trial*\n` +
                         `*• Kuota Trial:* 1x\n` +
                         `*• Cooldown:* ${cooldownText}\n\n` +
                         `Akun ini akan otomatis dihapus setelah *${trialDurationMinutes} menit*.`;

        await bot.sendMessage(chatId, infoText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '✅ Selesai', callback_data: 'delete_and_show_menu' }]]
            }
        });

        writeLog(`[VpnHandler] Akun trial ${protoId} ${username} berhasil dibuat untuk User ID ${userId}`);

    } catch (error) {
        writeLog(`[VpnHandler] Gagal membuat akun trial untuk ${userId}: ${error.message}`);
        await bot.editMessageText(`❌ *Gagal Membuat Akun Trial*\n\n${error.message}`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[backButton('Kembali', 'menu_vpn')]] }
        });
    }
}


module.exports = { 
    handleVpnMenu, 
    handleSelectServerForPurchase, 
    handleSelectProtocol, 
    handleSelectDuration,
    handleEnterUsername, 
    handleVpnUserInput, 
    handleSelectAccountForRenew, 
    handleConfirmRenew, 
    handleSelectServerForTrial,
    handleSelectProtocolForTrial,
    processTrialClaim,
    pendingVpnAction 
};
