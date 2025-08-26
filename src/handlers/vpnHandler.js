// src/handlers/vpnHandler.js
const serverService = require('../services/serverService');
const sqliteService = require('../services/sqliteService');
const vpnApiService = require('../services/vpnApiService');
const userService = require('../services/userService');
const notificationService = require('../services/notificationService');
const { writeLog } = require('../utils/logger');
const { prettyLine, backButton, formatRupiah } = require('../utils/helpers');
const crypto = require('crypto');

const pendingVpnAction = {};

async function handleVpnMenu(bot, query) {
    const text = `🛡️ *Menu VPN*\n${prettyLine()}\nSilakan pilih salah satu menu di bawah ini untuk mengelola layanan VPN Anda.`;
    const keyboard = [
        [{ text: '🛒 Beli Akun VPN Baru', callback_data: 'vpn_buy_select_server' }],
        [{ text: '🔄 Perpanjang Akun VPN', callback_data: 'vpn_renew_select_account' }],
        [{ text: '📄 Akun VPN Saya', callback_data: 'vpn_my_accounts' }],
        [backButton('⬅️ Kembali', 'back_menu')]
    ];
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleSelectServerForPurchase(bot, query) {
    const servers = serverService.getAllAvailableServers();
    if (servers.length === 0) {
        return bot.answerCallbackQuery(query.id, { text: 'Saat ini belum ada server yang tersedia.', show_alert: true });
    }
    const keyboard = servers.map(server => ([{
        text: server.name,
        callback_data: `vpn_select_protocol_${server.id}`
    }]));
    keyboard.push([backButton('⬅️ Kembali', 'menu_vpn')]);
    const text = `*🛒 Beli Akun VPN Baru*\n${prettyLine()}\nSilakan pilih lokasi server yang Anda inginkan:`;
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleSelectProtocol(bot, query) {
    const serverId = query.data.split('_').pop();
    const server = serverService.getServerDetails(serverId);
    if (!server) {
        return bot.answerCallbackQuery(query.id, { text: 'Server tidak ditemukan.', show_alert: true });
    }
    const availableProtocols = Object.keys(server.protocols);
    if (availableProtocols.length === 0) {
        return bot.answerCallbackQuery(query.id, { text: 'Server ini belum memiliki protokol aktif.', show_alert: true });
    }
    const keyboard = availableProtocols.map(protoId => {
        const price = server.protocols[protoId].price_per_30_days;
        return [{
            text: `${protoId.toUpperCase()} - ${formatRupiah(price)}`,
            callback_data: `vpn_enter_username_${serverId}_${protoId}`
        }];
    });
    keyboard.push([backButton('⬅️ Kembali', 'vpn_buy_select_server')]);
    const text = `*Pilih Protokol di ${server.name}*\n${prettyLine()}\nSilakan pilih jenis protokol yang Anda inginkan:`;
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleEnterUsername(bot, query) {
    const [,,, serverId, protoId] = query.data.split('_');
    const userId = query.from.id.toString();
    pendingVpnAction[userId] = {
        action: 'create_vpn_input',
        serverId,
        protoId,
        messageId: query.message.message_id,
        chatId: query.message.chat.id
    };
    const text = `*Masukkan Username*\n${prettyLine()}\nSilakan ketik username yang Anda inginkan untuk akun VPN Anda.\n\n*(Hanya huruf kecil dan angka, tanpa spasi)*`;
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backButton('Batal', `vpn_select_protocol_${serverId}`)]] }
    });
}

async function handleProcessUsername(bot, msg) {
    const userId = msg.from.id.toString();
    const state = pendingVpnAction[userId];
    if (!state || state.action !== 'create_vpn_input') return;

    const username = msg.text.trim();
    const { serverId, protoId, chatId, messageId } = state;
    await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    delete pendingVpnAction[userId];

    if (!/^[a-z0-9]+$/.test(username)) {
        await bot.editMessageText('❌ Username tidak valid. Proses dibatalkan.', { chatId, messageId, parse_mode: 'Markdown' });
        return;
    }

    const server = serverService.getServerDetails(serverId);
    const user = userService.getUser(userId);
    const price = server.protocols[protoId]?.price_per_30_days || 0;

    if (user.balance < price) {
        await bot.editMessageText(`❌ Saldo Anda tidak mencukupi. Dibutuhkan ${formatRupiah(price)}.`, { chatId, messageId, parse_mode: 'Markdown' });
        return;
    }

    await bot.editMessageText('⏳ Sedang membuat akun VPN Anda, mohon tunggu...', { chatId, messageId });

    try {
        const password = crypto.randomBytes(4).toString('hex');
        const result = await vpnApiService.createAccount(server, protoId, username, password);
        userService.updateUserBalance(userId, -price, 'pembelian_vpn', { server: server.name, username });
        const purchaseDate = new Date();
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        await sqliteService.run(
            `INSERT INTO vpn_transactions (idtrx, telegram_id, buyer_telegram_username, server_name, protocol, username, password, price, duration_days, purchase_date, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [result.trx_id, userId, msg.from.username, server.name, protoId, username, result.password, price, 30, purchaseDate.toISOString(), expiryDate.toISOString()]
        );
        
        await bot.editMessageText(result.details, { chatId, messageId, parse_mode: 'HTML' });
        notificationService.sendNewVpnPurchaseNotification(bot, msg.from, {
            serverName: server.name,
            protocol: protoId,
            username: username,
            price: price
        });
    } catch (error) {
        await bot.editMessageText(`❌ *Gagal Membuat Akun*\n\n${error.message}`, {
            chatId, messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[backButton('Kembali', 'menu_vpn')]] }
        });
    }
}

async function handleSelectAccountForRenew(bot, query) {
    const userId = query.from.id.toString();
    const accounts = await sqliteService.all('SELECT * FROM vpn_transactions WHERE telegram_id = ? ORDER BY expiry_date ASC', [userId]);
    if (accounts.length === 0) {
        return bot.answerCallbackQuery(query.id, { text: 'Anda tidak memiliki akun VPN aktif.', show_alert: true });
    }

    let text = `🔄 *Perpanjang Akun VPN*\n${prettyLine()}\nBerikut adalah daftar akun aktif Anda. Silakan pilih akun yang ingin diperpanjang.\n\n`;
    const keyboard = [];
    accounts.forEach(acc => {
        const expiry = new Date(acc.expiry_date);
        const now = new Date();
        const timeLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        text += `• Server: *${acc.server_name}*\n`;
        text += `• User: \`${acc.username}\`\n`;
        text += `• Protokol: *${acc.protocol.toUpperCase()}*\n`;
        text += `• Sisa Aktif: *${timeLeft > 0 ? timeLeft : 0} hari*\n${prettyLine()}\n`;
        keyboard.push([{ text: `${acc.server_name} - ${acc.username}`, callback_data: `vpn_confirm_renew_${acc.id}` }]);
    });
    keyboard.push([backButton('⬅️ Kembali', 'menu_vpn')]);
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleConfirmRenew(bot, query) {
    const userId = query.from.id.toString();
    const accountId = query.data.split('_').pop();
    const account = await sqliteService.get('SELECT * FROM vpn_transactions WHERE id = ? AND telegram_id = ?', [accountId, userId]);

    if (!account) {
        return bot.answerCallbackQuery(query.id, { text: 'Akun tidak ditemukan.', show_alert: true });
    }

    const server = serverService.getAllAvailableServers().find(s => s.name === account.server_name);
    if (!server) {
        return bot.answerCallbackQuery(query.id, { text: 'Server untuk akun ini sudah tidak tersedia.', show_alert: true });
    }
    const price = server.protocols[account.protocol]?.price_per_30_days || 0;

    if (query.data.includes('_dorenew_')) {
        const user = userService.getUser(userId);
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
                serverName: server.name,
                protocol: account.protocol,
                username: account.username,
                price: price
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
            `• Biaya: *${formatRupiah(price)}*\n\n` +
            `Saldo Anda saat ini: *${formatRupiah(userService.getUser(userId).balance)}*\n\n` +
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

module.exports = { handleVpnMenu, handleSelectServerForPurchase, handleSelectProtocol, handleEnterUsername, handleProcessUsername, handleSelectAccountForRenew, handleConfirmRenew, pendingVpnAction };
