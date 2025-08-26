// src/handlers/adminHandler.js

const userService = require('../services/userService');
const serverService = require('../services/serverService');
const sqliteService = require('../services/sqliteService');
const { writeLog } = require('../utils/logger');
const { prettyLine, backButton, formatRupiah } = require('../utils/helpers');
const config = require('../config');

const pendingAdminAction = {};

const VPN_PROTOCOLS = [
    { id: 'ssh', name: 'SSH' }, { id: 'vmess', name: 'VMess' },
    { id: 'vless', name: 'VLess' }, { id: 'trojan', name: 'Trojan' },
    { id: 'ss', name: 'ShadowSocks' }, { id: 's5', name: 'Socks5' },
    { id: 'noobzvpn', name: 'NoobzVPN' },
];

function isAdmin(userId) {
  const user = userService.getUser(userId);
  return userId === config.adminId || (user && user.role === 'admin');
}

// ==========================================================
// FUNGSI UTAMA PANEL ADMIN
// ==========================================================

async function handleAdminPanelMain(bot, query) {
  if (!isAdmin(query.from.id.toString())) return;
  const text = `👑 *Panel Admin Utama*\n${prettyLine()}\nPilih tindakan yang ingin Anda lakukan:`;
  const keyboard = [
    [{ text: '👤 Kelola Pengguna', callback_data: 'admin_manage_users' }],
    [{ text: '🗄️ Kelola Server VPN', callback_data: 'admin_manage_servers' }],
    [{ text: '📢 Broadcast Pesan', callback_data: 'admin_broadcast_prompt' }],
    [{ text: '📜 Lihat Transaksi', callback_data: 'admin_view_transactions' }],
    [backButton('⬅️ Kembali ke Menu', 'back_menu')]
  ];
  await bot.editMessageText(text, {
    chat_id: query.message.chat.id, message_id: query.message.message_id,
    parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
  }).catch(err => writeLog(`[AdminHandler] Error di handleAdminPanelMain: ${err.message}`));
}

// ==========================================================
// KELOLA SERVER (DIROMBAK)
// ==========================================================

/**
 * Handler input utama untuk semua aksi admin yang menunggu input teks.
 */
async function handleAdminInput(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];

    if (state && typeof state.nextStep === 'function') {
        state.nextStep(bot, msg);
    } else if (state && state.action === 'balance_input') {
        handleBalanceInput(bot, msg);
    } else if (state && state.action === 'broadcast_input') {
        handleBroadcastInput(bot, msg);
    }
}

// --- Langkah 1: Memulai Alur Penambahan Server ---
async function startAddServerFlow(bot, query) {
    const adminId = query.from.id.toString();
    if (!isAdmin(adminId)) return;
    
    const text = '➕ *Tambah Server Baru (1/5): ID Server*\n\n' +
                 'Kirimkan *ID unik* untuk server baru (contoh: `sg-vultr`, hanya huruf kecil, angka, dan strip). ' +
                 'ID ini tidak dapat diubah dan akan menjadi nama file.';
    
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backButton('Batal', 'admin_manage_servers')]] }
    });
    
    pendingAdminAction[adminId] = {
        action: 'add_server',
        serverData: {},
        messageId: query.message.message_id,
        chatId: query.message.chat.id,
        nextStep: processServerId,
    };
}

// --- Langkah 2: Memproses ID Server dan Meminta Nama ---
async function processServerId(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    const inputId = msg.text.trim();

    await bot.deleteMessage(state.chatId, msg.message_id).catch(() => {});

    if (!/^[a-z0-9-]+$/.test(inputId) || serverService.getServerDetails(inputId)) {
        const err = await bot.sendMessage(state.chatId, '❌ ID tidak valid atau sudah digunakan. Coba lagi.');
        setTimeout(() => bot.deleteMessage(state.chatId, err.message_id).catch(()=>{}), 5000);
        return;
    }

    state.serverData.id = inputId;
    state.nextStep = processServerName;

    const text = '*(2/5): Nama Server*\n\nMasukkan *Nama Tampilan Server* (contoh: `SG Vultr 1`).';
    await bot.editMessageText(text, { chatId: state.chatId, message_id: state.messageId, parse_mode: 'Markdown' });
}

// --- Langkah 3: Memproses Nama dan Meminta Domain ---
async function processServerName(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    const inputName = msg.text.trim();

    await bot.deleteMessage(state.chatId, msg.message_id).catch(() => {});

    state.serverData.name = inputName;
    state.nextStep = processServerDomain;

    const text = '*(3/5): Domain Server*\n\nMasukkan *Domain/Endpoint API* server.';
    await bot.editMessageText(text, { chatId: state.chatId, message_id: state.messageId, parse_mode: 'Markdown' });
}

// --- Langkah 4: Memproses Domain dan Meminta Token API ---
async function processServerDomain(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    const inputDomain = msg.text.trim();

    await bot.deleteMessage(state.chatId, msg.message_id).catch(() => {});

    state.serverData.domain = inputDomain;
    state.nextStep = processServerToken;

    const text = '*(4/5): Token API*\n\nMasukkan *API Token* untuk server ini.';
    await bot.editMessageText(text, { chatId: state.chatId, message_id: state.messageId, parse_mode: 'Markdown' });
}

// --- Langkah 5: Memproses Token dan Memulai Pengisian Harga ---
async function processServerToken(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    const inputToken = msg.text.trim();

    await bot.deleteMessage(state.chatId, msg.message_id).catch(() => {});

    state.serverData.api_token = inputToken;
    state.serverData.protocols = {};
    state.protocolIndex = 0;
    state.nextStep = processProtocolPrice;

    const firstProto = VPN_PROTOCOLS[state.protocolIndex];
    const text = `*(5/${VPN_PROTOCOLS.length + 4}): Harga ${firstProto.name}*\n\n` +
                 `Masukkan harga untuk *${firstProto.name}* (angka saja, misal: \`15000\`). Ketik \`0\` jika tidak tersedia.`;
    await bot.editMessageText(text, { chatId: state.chatId, message_id: state.messageId, parse_mode: 'Markdown' });
}

// --- Langkah 6: Memproses Harga per Protokol ---
async function processProtocolPrice(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    const inputPrice = parseInt(msg.text.trim(), 10);

    await bot.deleteMessage(state.chatId, msg.message_id).catch(() => {});

    if (isNaN(inputPrice) || inputPrice < 0) {
        const err = await bot.sendMessage(state.chatId, '❌ Harga tidak valid. Masukkan angka saja.');
        setTimeout(() => bot.deleteMessage(state.chatId, err.message_id).catch(()=>{}), 5000);
        return;
    }

    const currentProto = VPN_PROTOCOLS[state.protocolIndex];
    if (inputPrice > 0) {
        state.serverData.protocols[currentProto.id] = { price_per_30_days: inputPrice };
    }

    state.protocolIndex++;

    if (state.protocolIndex < VPN_PROTOCOLS.length) {
        const nextProto = VPN_PROTOCOLS[state.protocolIndex];
        const text = `*(${state.protocolIndex + 5}/${VPN_PROTOCOLS.length + 4}): Harga ${nextProto.name}*\n\n` +
                     `Masukkan harga untuk *${nextProto.name}* (ketik \`0\` jika tidak ada).`;
        await bot.editMessageText(text, { chatId: state.chatId, message_id: state.messageId, parse_mode: 'Markdown' });
    } else {
        serverService.saveServerDetails(state.serverData.id, state.serverData);
        delete pendingAdminAction[adminId];
        
        const text = `✅ *Server Berhasil Ditambahkan!*\n\nServer *${state.serverData.name}* telah disimpan.`;
        await bot.editMessageText(text, {
            chatId: state.chatId, message_id: state.messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[backButton('Kembali', 'admin_manage_servers')]] }
        });
    }
}

// --- FUNGSI ADMIN LAINNYA (TIDAK BERUBAH) ---
async function handleManageUsers(bot, query) {
    if (!isAdmin(query.from.id.toString())) return;
    const text = `*👤 Kelola Pengguna*\n${prettyLine()}\nPilih aksi yang ingin Anda lakukan.`;
    const keyboard = [
        [{ text: '➕ Tambah Saldo', callback_data: 'admin_add_balance_prompt' }],
        [{ text: '➖ Kurangi Saldo', callback_data: 'admin_reduce_balance_prompt' }],
        [{ text: '✏️ Set Saldo', callback_data: 'admin_set_balance_prompt' }],
        [backButton('⬅️ Kembali', 'admin_panel_main')]
    ];
    await bot.editMessageText(text, { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
}
async function handleBalanceActionPrompt(bot, query, mode) {
    const adminId = query.from.id.toString();
    if (!isAdmin(adminId)) return;
    let title = '';
    if (mode === 'add') title = '💰 Tambah Saldo Manual';
    if (mode === 'reduce') title = '➖ Kurangi Saldo Manual';
    if (mode === 'set') title = '✏️ Set Saldo Manual';
    pendingAdminAction[adminId] = {
        action: 'balance_input', mode, step: 'userid',
        messageId: query.message.message_id, chatId: query.message.chat.id
    };
    await bot.editMessageText(`${title}\n\nKirimkan *User ID* dari pengguna yang saldonya ingin Anda ubah.`, {
        chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backButton('Batal', 'admin_manage_users')]] }
    });
}
async function handleBalanceInput(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    if (!state || state.action !== 'balance_input') return;

    const input = msg.text.trim();
    const { chatId, messageId, step, mode } = state;
    await bot.deleteMessage(chatId, msg.message_id).catch(() => {});

    if (step === 'userid') {
        const user = userService.getUser(input);
        if (!user) {
            const err = await bot.sendMessage(chatId, 'User ID tidak ditemukan. Coba lagi.');
            setTimeout(() => bot.deleteMessage(chatId, err.message_id).catch(()=>{}), 5000);
            return;
        }
        state.targetUserId = input;
        state.step = 'amount';
        await bot.editMessageText(`User ditemukan: @${user.username}\nSaldo: ${formatRupiah(user.balance)}\n\nKirimkan *jumlah nominal*.`, {
            chatId, messageId, parse_mode: 'Markdown'
        });
    } else if (step === 'amount') {
        const amount = parseInt(input);
        if (isNaN(amount) || amount < 0) {
            const err = await bot.sendMessage(chatId, 'Jumlah tidak valid.');
            setTimeout(() => bot.deleteMessage(chatId, err.message_id).catch(()=>{}), 5000);
            return;
        }
        const { targetUserId } = state;
        let actionText = '';
        if (mode === 'add') {
            actionText = 'ditambahkan';
            userService.updateUserBalance(targetUserId, amount, 'manual_admin_add');
        } else if (mode === 'reduce') {
            actionText = 'dikurangi';
            userService.updateUserBalance(targetUserId, -amount, 'manual_admin_reduce');
        } else if (mode === 'set') {
            const user = userService.getUser(targetUserId);
            const finalAmount = amount - user.balance;
            actionText = `diatur menjadi ${formatRupiah(amount)}`;
            userService.updateUserBalance(targetUserId, finalAmount, 'manual_admin_set');
        }
        const updatedUser = userService.getUser(targetUserId);
        delete pendingAdminAction[adminId];
        await bot.editMessageText(`✅ *Sukses!*\n\nSaldo User \`${targetUserId}\` telah ${actionText}.\nSaldo baru: *${formatRupiah(updatedUser.balance)}*`, {
            chatId, messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[backButton('Kembali', 'admin_manage_users')]] }
        });
    }
}
async function handleManageServersMenu(bot, query) {
    if (!isAdmin(query.from.id.toString())) return;
    const text = `*🗄️ Kelola Server VPN*\n${prettyLine()}\nPilih aksi yang ingin Anda lakukan.`;
    const keyboard = [
        [{ text: '➕ Tambah Server Baru', callback_data: 'admin_add_server_prompt' }],
        [{ text: '✏️ Edit Server', callback_data: 'admin_edit_server_select' }],
        [{ text: '🗑️ Hapus Server', callback_data: 'admin_delete_server_select' }],
        [backButton('⬅️ Kembali', 'admin_panel_main')]
    ];
    await bot.editMessageText(text, {
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    });
}
async function handleSelectServer(bot, query, action) {
    if (!isAdmin(query.from.id.toString())) return;
    const allServers = serverService.getAllAvailableServers();
    if (allServers.length === 0) {
        await bot.answerCallbackQuery(query.id, { text: 'Tidak ada server yang tersedia.', show_alert: true });
        return;
    }
    const title = action === 'edit' ? '✏️ Edit Server' : '🗑️ Hapus Server';
    const callbackPrefix = action === 'edit' ? 'admin_edit_server_details_' : 'admin_delete_server_confirm_';
    const keyboard = allServers.map(server => ([{
        text: server.name,
        callback_data: `${callbackPrefix}${server.id}`
    }]));
    keyboard.push([backButton('⬅️ Kembali', 'admin_manage_servers')]);
    await bot.editMessageText(`*${title}*\n${prettyLine()}\nPilih server yang ingin Anda ${action}.`, {
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    });
}
async function handleBroadcastPrompt(bot, query) {
    const adminId = query.from.id.toString();
    if (!isAdmin(adminId)) return;
    pendingAdminAction[adminId] = { action: 'broadcast_input', messageId: query.message.message_id, chatId: query.message.chat.id };
    await bot.editMessageText('📢 *Kirim Broadcast*\n\nKirimkan pesan yang ingin Anda siarkan ke semua pengguna. Pesan mendukung format Markdown.', {
        chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backButton('Batal', 'admin_panel_main')]] }
    });
}
async function handleBroadcastInput(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    if (!state || state.action !== 'broadcast_input') return;
    
    delete pendingAdminAction[adminId];
    const broadcastMessage = msg.text;
    const { chatId, messageId } = state;

    const allUsers = userService.loadDB().users;
    const userIds = Object.keys(allUsers);

    await bot.editMessageText(`⏳ Memulai broadcast ke *${userIds.length}* pengguna...`, { chatId, messageId, parse_mode: 'Markdown' });

    let successCount = 0;
    let failCount = 0;

    for (const userId of userIds) {
        try {
            await bot.sendMessage(userId, broadcastMessage, { parse_mode: 'Markdown' });
            successCount++;
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            failCount++;
            writeLog(`[Broadcast] Gagal mengirim ke User ID ${userId}: ${error.message}`);
        }
    }

    const report = `✅ *Broadcast Selesai!*\n\n` +
                   `Berhasil terkirim: *${successCount}*\n` +
                   `Gagal terkirim: *${failCount}*`;
    
    await bot.editMessageText(report, { chatId, messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[backButton('Kembali', 'admin_panel_main')]] } });
}
async function handleViewTransactions(bot, query) {
    if (!isAdmin(query.from.id.toString())) return;
    const topups = await sqliteService.all('SELECT * FROM topup_logs ORDER BY created_at DESC LIMIT 10');
    
    let text = `*📜 10 Transaksi Topup Terakhir*\n${prettyLine()}\n`;
    if (topups.length === 0) {
        text += '_Belum ada transaksi topup._';
    } else {
        topups.forEach(trx => {
            const date = new Date(trx.created_at).toLocaleString('id-ID');
            text += `*ID Pengguna:* \`${trx.telegram_id}\`\n` +
                    `*Jumlah:* ${formatRupiah(trx.amount)}\n` +
                    `*Invoice:* \`${trx.invoice_id || '-'}\`\n` +
                    `*Tanggal:* ${date}\n${prettyLine()}\n`;
        });
    }

    await bot.editMessageText(text, {
        chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backButton('Kembali', 'admin_panel_main')]] }
    });
}

module.exports = {
  isAdmin,
  handleAdminPanelMain,
  handleAdminInput,
  startAddServerFlow,
  handleManageUsers,
  handleBalanceActionPrompt,
  handleBalanceInput,
  handleManageServersMenu,
  handleSelectServer,
  handleBroadcastPrompt,
  handleBroadcastInput,
  handleViewTransactions,
  pendingAdminAction
};
