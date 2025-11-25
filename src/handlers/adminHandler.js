// src/handlers/adminHandler.js

const userService = require('../services/userService');
const serverService = require('../services/serverService');
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

async function handleAdminInput(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    if (!state) return;

    if (state.nextStep) {
        return state.nextStep(bot, msg);
    }
    
    switch (state.action) {
        case 'find_user':
            return showUserManagementMenu(bot, msg);
        case 'add_balance':
        case 'reduce_balance':
        case 'set_balance':
            return processBalanceChange(bot, msg);
        case 'broadcast_input':
            return handleBroadcastInput(bot, msg);
        case 'set_protocol_price':
            return processNewPriceInput(bot, msg);
        case 'edit_server_name':
        case 'edit_server_token':
            return processServerDetailChange(bot, msg);
        case 'set_trial_cooldown':
            return processTrialCooldownChange(bot, msg);
        case 'set_trial_duration':
            return processTrialDurationChange(bot, msg);
        default:
            writeLog(`[AdminHandler] Aksi pending tidak diketahui: ${state.action}`);
    }
}

async function handleAdminPanelMain(bot, queryOrMsg) {
    const userId = queryOrMsg.from.id.toString();
    if (!isAdmin(userId)) return;

    const text = `👑 *Panel Admin Utama*\n${prettyLine()}\nPilih tindakan yang ingin Anda lakukan:`;
    const keyboard = [
        [
            { text: '👤 Kelola Pengguna', callback_data: 'admin_manage_users' },
            { text: '🗄️ Kelola Server', callback_data: 'admin_manage_servers' }
        ],
        [
            { text: '🎁 Pengaturan Trial', callback_data: 'admin_trial_settings' },
            { text: '📢 Broadcast Pesan', callback_data: 'admin_broadcast_prompt' }
        ],
        [
            { text: '⚙️ Metode Pembayaran', callback_data: 'admin_payment_settings' }
        ],
        [backButton('⬅️ Kembali ke Menu', 'back_menu')]
    ];

    const options = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    };

    if (queryOrMsg.message) { 
        const chatId = queryOrMsg.message.chat.id;
        const messageId = queryOrMsg.message.message_id;
        await bot.telegram.editMessageText(chatId, messageId, null, text, options)
            .catch(err => {
                if (!err.message.includes('message is not modified')) {
                    writeLog(`[AdminHandler] Error edit di handleAdminPanelMain: ${err.message}`);
                }
            });
    } else { 
        const chatId = queryOrMsg.chat.id;
        await bot.telegram.sendMessage(chatId, text, options)
            .catch(err => writeLog(`[AdminHandler] Error send di handleAdminPanelMain: ${err.message}`));
    }
}

async function handlePaymentSettings(bot, query) {
    if (!isAdmin(query.from.id.toString())) return;
    
    const methods = userService.getPaymentMethods();
    const statusGateway = methods.gateway_utama ? '✅ Aktif' : '❌ Mati';
    const statusSaweria = methods.saweria ? '✅ Aktif' : '❌ Mati';

    const text = `⚙️ *Pengaturan Pembayaran*\n${prettyLine()}\n` +
                 `Atur metode pembayaran yang tersedia untuk user.\n\n` +
                 `• Gateway Utama: *${statusGateway}*\n` +
                 `• Saweria QRIS: *${statusSaweria}*`;

    const keyboard = [
        [{ text: '🔄 Toggle Gateway Utama', callback_data: 'admin_toggle_pay_gateway_utama' }],
        [{ text: '🔄 Toggle Saweria', callback_data: 'admin_toggle_pay_saweria' }],
        [backButton('⬅️ Kembali', 'admin_panel_main')]
    ];

    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function togglePaymentStatus(bot, query) {
    if (!isAdmin(query.from.id.toString())) return;
    
    const method = query.data.includes('gateway_utama') ? 'gateway_utama' : 'saweria';
    const currentMethods = userService.getPaymentMethods();
    const newStatus = !currentMethods[method];
    
    userService.togglePaymentMethod(method, newStatus);
    
    return handlePaymentSettings(bot, query);
}

async function handleTrialSettingsMenu(bot, query) {
    if (!isAdmin(query.from.id.toString())) return;

    const trialSettings = userService.getTrialSettings();
    const duration = trialSettings.duration_minutes;
    const userCooldown = trialSettings.cooldown_hours.user === -1 ? 'Unlimited' : `${trialSettings.cooldown_hours.user} Jam`;
    const resellerCooldown = trialSettings.cooldown_hours.reseller === -1 ? 'Unlimited' : `${trialSettings.cooldown_hours.reseller} Jam`;

    const text = `*🎁 Pengaturan Trial*\n${prettyLine()}\n` +
                 `Atur durasi dan batas waktu tunggu (*cooldown*) untuk fitur trial gratis.\n\n` +
                 `*Pengaturan Saat Ini:*\n` +
                 `*• Durasi Aktif:* ${duration} Menit\n` +
                 `*• Cooldown User:* ${userCooldown}\n` +
                 `*• Cooldown Reseller:* ${resellerCooldown}`;
    
    const keyboard = [
        [
            { text: 'Ubah Durasi', callback_data: 'admin_set_trial_duration' },
            { text: 'Ubah Cooldown User', callback_data: 'admin_set_trial_cooldown_user' }
        ],
        [
            { text: 'Ubah Cooldown Reseller', callback_data: 'admin_set_trial_cooldown_reseller' }
        ],
        [backButton('⬅️ Kembali', 'admin_panel_main')]
    ];

    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function promptTrialDurationChange(bot, query) {
    const adminId = query.from.id.toString();
    if (!isAdmin(adminId)) return;

    pendingAdminAction[adminId] = {
        action: 'set_trial_duration',
        messageId: query.message.message_id,
        chatId: query.message.chat.id
    };

    const text = `*Ubah Durasi Trial*\n\n` +
                 `Kirimkan durasi masa aktif trial dalam **menit**.\n\n` +
                 `*Contoh:*\n` +
                 `• \`60\` untuk 60 menit\n` +
                 `• \`120\` untuk 2 jam`;

    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backButton('Batal', 'admin_trial_settings')]] }
    });
}

async function processTrialDurationChange(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    if (!state || state.action !== 'set_trial_duration') return;

    const { chatId, messageId } = state;
    const input = msg.text.trim();
    
    await bot.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});
    delete pendingAdminAction[adminId];

    const minutes = parseInt(input, 10);
    if (isNaN(minutes) || minutes <= 0) {
        const err = await bot.telegram.sendMessage(chatId, 'Input tidak valid. Harap masukkan angka positif.');
        setTimeout(() => bot.telegram.deleteMessage(chatId, err.message_id).catch(()=>{}), 5000);
        const refreshedQuery = {
            from: { id: adminId },
            data: 'admin_trial_settings',
            message: { chat: { id: chatId }, message_id: messageId }
        };
        await handleTrialSettingsMenu(bot, refreshedQuery);
        return;
    }

    userService.updateTrialSettings('duration', minutes);

    const refreshedQuery = {
        from: { id: adminId },
        data: 'admin_trial_settings',
        message: { chat: { id: chatId }, message_id: messageId }
    };
    await handleTrialSettingsMenu(bot, refreshedQuery);
}

async function promptTrialCooldownChange(bot, query) {
    const adminId = query.from.id.toString();
    if (!isAdmin(adminId)) return;

    const role = query.data.includes('_user') ? 'user' : 'reseller';
    const roleText = role.charAt(0).toUpperCase() + role.slice(1);
    
    pendingAdminAction[adminId] = {
        action: 'set_trial_cooldown',
        role: role,
        messageId: query.message.message_id,
        chatId: query.message.chat.id
    };

    const text = `*Ubah Cooldown Trial untuk ${roleText}*\n\n` +
                 `Kirimkan durasi cooldown baru dalam **jam**.\n\n` +
                 `*Contoh:*\n` +
                 `• \`24\` untuk 24 jam\n` +
                 `• \`1\` untuk 1 jam\n` +
                 `• \`unlimited\` atau \`unli\` untuk tanpa batas.`;

    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backButton('Batal', 'admin_trial_settings')]] }
    });
}

async function processTrialCooldownChange(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    if (!state || state.action !== 'set_trial_cooldown') return;

    const { role, chatId, messageId } = state;
    const input = msg.text.trim().toLowerCase();
    
    await bot.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});
    delete pendingAdminAction[adminId];

    let hours;
    if (['unli', 'unlimited', 'no limit'].includes(input)) {
        hours = -1;
    } else {
        hours = parseInt(input, 10);
        if (isNaN(hours) || hours < 0) {
            const err = await bot.telegram.sendMessage(chatId, 'Input tidak valid. Harap masukkan angka atau "unlimited".');
            setTimeout(() => bot.telegram.deleteMessage(chatId, err.message_id).catch(()=>{}), 5000);
            const refreshedQuery = {
                from: { id: adminId },
                data: 'admin_trial_settings',
                message: { chat: { id: chatId }, message_id: messageId }
            };
            await handleTrialSettingsMenu(bot, refreshedQuery);
            return;
        }
    }

    userService.updateTrialSettings('cooldown', hours, role);

    const refreshedQuery = {
        from: { id: adminId },
        data: 'admin_trial_settings',
        message: { chat: { id: chatId }, message_id: messageId }
    };
    await handleTrialSettingsMenu(bot, refreshedQuery);
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
    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, text, {
        parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleSelectServer(bot, query, action) {
    if (!isAdmin(query.from.id.toString())) return;
    const allServers = serverService.getAllAvailableServers();
    if (allServers.length === 0) {
        return bot.telegram.answerCbQuery(query.id, 'Tidak ada server yang tersedia.', { show_alert: true });
    }

    let title, callbackPrefix;
    if (action === 'edit') {
        title = '✏️ Edit Server';
        callbackPrefix = 'admin_edit_server_details_';
    } else {
        title = '🗑️ Hapus Server';
        callbackPrefix = 'admin_delete_server_confirm_';
    }

    const keyboard = allServers.map(server => ([{
        text: server.name,
        callback_data: `${callbackPrefix}${server.id}`
    }]));
    keyboard.push([backButton('⬅️ Kembali', 'admin_manage_servers')]);
    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, `*${title}*\n${prettyLine()}\nPilih server yang ingin Anda ${action}.`, {
        parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    });
}

async function startAddServerFlow(bot, query) {
    const adminId = query.from.id.toString();
    if (!isAdmin(adminId)) return;
    
    const text = '➕ *Tambah Server Baru (1/4): ID Server*\n\n' +
                 'Kirimkan *ID unik* untuk server (contoh: `sg-vultr`). Hanya huruf kecil, angka, dan strip.';
    
    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backButton('Batal', 'admin_manage_servers')]] }
    });
    
    pendingAdminAction[adminId] = {
        action: 'add_server', serverData: {},
        messageId: query.message.message_id, chatId: query.message.chat.id,
        nextStep: processServerId,
    };
}

async function processServerId(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    const inputId = msg.text.trim();
    await bot.telegram.deleteMessage(state.chatId, msg.message_id).catch(() => {});

    if (!/^[a-z0-9-]+$/.test(inputId) || serverService.getServerDetails(inputId)) {
        const err = await bot.telegram.sendMessage(state.chatId, '❌ ID tidak valid atau sudah digunakan. Coba lagi.');
        setTimeout(() => bot.telegram.deleteMessage(state.chatId, err.message_id).catch(()=>{}), 5000);
        return;
    }

    state.serverData.id = inputId;
    state.nextStep = processServerName;
    const text = '*(2/4): Nama Tampilan Server*\n\nMasukkan nama untuk server ini (contoh: `SG Vultr 1`).';
    await bot.telegram.editMessageText(state.chatId, state.messageId, null, text, { parse_mode: 'Markdown' });
}

async function processServerName(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    state.serverData.name = msg.text.trim();
    await bot.telegram.deleteMessage(state.chatId, msg.message_id).catch(() => {});
    state.nextStep = processServerDomain;
    const text = '*(3/4): Domain Server*\n\nMasukkan domain API server (contoh: `api.domain.com`).';
    await bot.telegram.editMessageText(state.chatId, state.messageId, null, text, { parse_mode: 'Markdown' });
}

async function processServerDomain(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    let inputDomain = msg.text.trim();
    await bot.telegram.deleteMessage(state.chatId, msg.message_id).catch(() => {});

    if (!inputDomain.startsWith('http://') && !inputDomain.startsWith('https://')) {
        inputDomain = 'https://' + inputDomain;
    }

    state.serverData.domain = inputDomain;
    state.nextStep = processServerToken;
    const text = '*(4/4): Token API*\n\nTerakhir, masukkan *API Token* untuk server ini.';
    await bot.telegram.editMessageText(state.chatId, state.messageId, null, text, { parse_mode: 'Markdown' });
}

async function processServerToken(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    await bot.telegram.deleteMessage(state.chatId, msg.message_id).catch(() => {});

    state.serverData.api_token = msg.text.trim();
    state.serverData.protocols = {};
    VPN_PROTOCOLS.forEach(p => { 
        state.serverData.protocols[p.id] = { 
            enabled: false,
            prices: { user: 0, reseller: 0 } 
        };
    });
    
    serverService.saveServerDetails(state.serverData.id, state.serverData);
    delete pendingAdminAction[adminId];
    
    const text = `✅ *Server Berhasil Ditambahkan!*\n\nServer *${state.serverData.name}* telah disimpan.\n\nSekarang, silakan aktifkan protokol dan atur harganya melalui menu *Edit Server*.`;
    await bot.telegram.editMessageText(state.chatId, state.messageId, null, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backButton('Kembali', 'admin_manage_servers')]] }
    });
}

async function handleEditServerDetails(bot, query) {
    if (!isAdmin(query.from.id.toString())) return;
    const serverId = query.data.split('_').pop();
    const server = serverService.getServerDetails(serverId);

    if (!server) {
        await bot.telegram.answerCbQuery(query.id, 'Server tidak ditemukan.', { show_alert: true });
        return handleManageServersMenu(bot, query);
    }

    const censoredToken = `${(server.api_token || '').substring(0, 4)}***********`;

    let text = `✏️ *Kelola Server: ${server.name}*\n`;
    text += `${prettyLine()}\n`;
    text += `*ID:* \`${server.id}\`\n`;
    text += `*Domain:* \`${server.domain}\`\n`;
    text += `*API Token:* \`${censoredToken}\`\n\n`;
    text += `*Ringkasan Protokol Aktif:*`;

    const keyboard = [];
    
    keyboard.push([
        { text: '✏️ Ubah Detail Server', callback_data: `admin_config_server_${serverId}` },
        { text: '⚙️ Atur Protokol & Harga', callback_data: `admin_manage_protocols_${serverId}` }
    ]);
    
    let hasActiveProtocol = false;
    VPN_PROTOCOLS.forEach(proto => {
        const protoData = server.protocols[proto.id];
        if (protoData && protoData.enabled) {
            hasActiveProtocol = true;
            text += `\n✅ *${proto.name}* (User: ${formatRupiah(protoData.prices.user)} | Reseller: ${formatRupiah(protoData.prices.reseller)})`;
        }
    });

    if (!hasActiveProtocol) {
        text += `\n\n_Belum ada protokol yang diaktifkan._`;
    }
    
    keyboard.push([backButton('⬅️ Kembali ke Daftar Server', 'admin_edit_server_select')]);
    
    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, text, {
        parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleConfigServer(bot, query) {
    if (!isAdmin(query.from.id.toString())) return;
    const serverId = query.data.split('_').pop();
    const text = `✏️ *Ubah Detail Server*\n\nPilih detail yang ingin Anda ubah:`;
    const keyboard = [
        [{ text: 'Ubah Nama Tampilan', callback_data: `admin_edit_servername_${serverId}` }],
        [{ text: 'Ubah API Key', callback_data: `admin_edit_servertoken_${serverId}` }],
        [backButton('⬅️ Kembali', `admin_edit_server_details_${serverId}`)]
    ];
    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, text, {
        parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleManageProtocols(bot, query) {
    if (!isAdmin(query.from.id.toString())) return;
    const serverId = query.data.split('_').pop();
    const server = serverService.getServerDetails(serverId);
    if (!server) return;

    let text = `⚙️ *Atur Harga & Protokol*\nServer: *${server.name}*\n${prettyLine()}`;
    const keyboard = [];

    VPN_PROTOCOLS.forEach(proto => {
        const protoData = server.protocols[proto.id] || { enabled: false, prices: { user: 0, reseller: 0 } };
        const statusIcon = protoData.enabled ? '✅' : '❌';
        const userPrice = formatRupiah(protoData.prices.user);
        const resellerPrice = formatRupiah(protoData.prices.reseller);
        const toggleText = protoData.enabled ? 'Nonaktifkan' : 'Aktifkan';

        text += `\n\n${statusIcon} *${proto.name}*`;
        text += `\n   ├─ User: ${userPrice}`;
        text += `\n   └─ Reseller: ${resellerPrice}`;
        
        keyboard.push([
            { text: `Ubah Harga ${proto.name}`, callback_data: `admin_set_price_${serverId}_${proto.id}` },
            { text: `${toggleText} ${proto.name}`, callback_data: `admin_toggle_protocol_${serverId}_${proto.id}` }
        ]);
    });

    keyboard.push([backButton('⬅️ Kembali', `admin_edit_server_details_${serverId}`)]);

    try {
        await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        if (!error.message.includes('message is not modified')) {
            writeLog(`[AdminHandler] Gagal edit pesan di handleManageProtocols: ${error.message}`);
        }
    }
}


async function promptServerDetailChange(bot, query) {
    const adminId = query.from.id.toString();
    if (!isAdmin(adminId)) return;

    const parts = query.data.split('_');
    const type = parts[2];
    const serverId = parts.pop();

    let title, promptText, action;
    if (type === 'servername') {
        title = '✏️ Ubah Nama Server';
        promptText = 'Kirimkan nama tampilan baru untuk server ini.';
        action = 'edit_server_name';
    } else {
        title = '🔑 Ubah API Key';
        promptText = 'Kirimkan API Key baru untuk server ini.';
        action = 'edit_server_token';
    }

    pendingAdminAction[adminId] = {
        action, serverId,
        messageId: query.message.message_id, chatId: query.message.chat.id
    };

    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, `*${title}*\n\n${promptText}`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backButton('Batal', `admin_config_server_${serverId}`)]] }
    });
}

async function processServerDetailChange(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    if (!state) return;

    const { serverId, chatId, messageId, action } = state;
    const newValue = msg.text.trim();
    
    await bot.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});
    delete pendingAdminAction[adminId];

    const server = serverService.getServerDetails(serverId);
    if (action === 'edit_server_name') {
        server.name = newValue;
    } else {
        server.api_token = newValue;
    }
    serverService.saveServerDetails(serverId, server);

    const refreshedQuery = {
        from: { id: adminId },
        data: `admin_edit_server_details_${serverId}`,
        message: { chat: { id: chatId }, message_id: messageId }
    };
    await handleEditServerDetails(bot, refreshedQuery);
}


async function promptNewPrice(bot, query) {
    const adminId = query.from.id.toString();
    if (!isAdmin(adminId)) return;
    const [,,, serverId, protoId] = query.data.split('_');
    const protoName = VPN_PROTOCOLS.find(p => p.id === protoId)?.name || protoId.toUpperCase();

    pendingAdminAction[adminId] = {
        action: 'set_protocol_price', serverId, protoId,
        step: 'get_user_price',
        messageId: query.message.message_id,
        chatId: query.message.chat.id
    };

    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, `✏️ *Ubah Harga ${protoName} (1/2)*\n\nKirimkan harga baru untuk *User* (contoh: \`15000\`).`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backButton('Batal', `admin_manage_protocols_${serverId}`)]] }
    });
}

async function processNewPriceInput(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    if (!state || state.action !== 'set_protocol_price') return;

    const { serverId, protoId, chatId, messageId, step } = state;
    const newPrice = parseInt(msg.text.trim(), 10);
    await bot.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});

    if (isNaN(newPrice) || newPrice < 0) {
        delete pendingAdminAction[adminId];
        return;
    }

    if (step === 'get_user_price') {
        state.userPrice = newPrice;
        state.step = 'get_reseller_price';
        const protoName = VPN_PROTOCOLS.find(p => p.id === protoId)?.name || protoId.toUpperCase();
        await bot.telegram.editMessageText(chatId, messageId, null, `✏️ *Ubah Harga ${protoName} (2/2)*\n\nSekarang kirimkan harga baru untuk *Reseller* (contoh: \`10000\`).`, {
            parse_mode: 'Markdown'
        });
    } else if (step === 'get_reseller_price') {
        const server = serverService.getServerDetails(serverId);
        if (!server.protocols[protoId]) server.protocols[protoId] = { prices: {} };
        
        server.protocols[protoId].prices = {
            user: state.userPrice,
            reseller: newPrice
        };
        serverService.saveServerDetails(serverId, server);
        delete pendingAdminAction[adminId];

        const refreshedQuery = {
            from: { id: adminId },
            data: `admin_manage_protocols_${serverId}`,
            message: { chat: { id: chatId }, message_id: messageId }
        };
        await handleManageProtocols(bot, refreshedQuery);
    }
}

async function toggleProtocolStatus(bot, query) {
    const adminId = query.from.id.toString();
    if (!isAdmin(adminId)) return;

    const [,,, serverId, protoId] = query.data.split('_');
    const server = serverService.getServerDetails(serverId);
    if (!server) {
        return bot.telegram.answerCbQuery(query.id, 'Server tidak ditemukan.');
    }

    if (!server.protocols[protoId]) {
        server.protocols[protoId] = { enabled: false, prices: { user: 0, reseller: 0 } };
    }
    server.protocols[protoId].enabled = !server.protocols[protoId].enabled;
    serverService.saveServerDetails(serverId, server);
    
    const statusText = server.protocols[protoId].enabled ? 'diaktifkan' : 'dinonaktifkan';
    
    const refreshedQuery = {
        from: query.from,
        message: query.message,
        data: `admin_manage_protocols_${serverId}`
    };

    try {
        await handleManageProtocols(bot, refreshedQuery);
    } catch (error) {
        writeLog(`[AdminHandler] Gagal me-refresh UI di toggleProtocolStatus: ${error.message}`);
    } finally {
        await bot.telegram.answerCbQuery(query.id, `Protokol ${protoId.toUpperCase()} telah ${statusText}`);
    }
}

async function handleManageUsers(bot, query) {
    if (!isAdmin(query.from.id.toString())) return;

    const adminId = query.from.id.toString();
    pendingAdminAction[adminId] = {
        action: 'find_user',
        messageId: query.message.message_id,
        chatId: query.message.chat.id
    };

    const text = `*👤 Kelola Pengguna*\n\nSilakan kirimkan *User ID* dari pengguna yang ingin Anda kelola.`;
    const keyboard = [[backButton('⬅️ Kembali', 'admin_panel_main')]];

    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function showUserManagementMenu(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId] || { chatId: msg.chat.id, messageId: msg.message_id };
    const targetUserId = msg.text.trim();
    
    if (state.action === 'find_user') {
        await bot.telegram.deleteMessage(state.chatId, msg.message_id).catch(() => {});
    }
    
    const user = userService.getUser(targetUserId);

    if (!user) {
        delete pendingAdminAction[adminId];
        const errText = `❌ User ID \`${targetUserId}\` tidak ditemukan.`;
        await bot.telegram.editMessageText(state.chatId, state.messageId, null, errText, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[backButton('Coba Lagi', 'admin_manage_users')]]}
        });
        return;
    }

    delete pendingAdminAction[adminId];
    const roleText = user.role.charAt(0).toUpperCase() + user.role.slice(1);
    const toggleRoleTarget = user.role === 'user' ? 'reseller' : 'user';
    const toggleRoleText = `Jadikan ${toggleRoleTarget.charAt(0).toUpperCase() + toggleRoleTarget.slice(1)}`;

    let text = `*👤 Mengelola Pengguna*\n${prettyLine()}\n`;
    text += `*ID:* \`${targetUserId}\`\n`;
    text += `*Username:* @${user.username || 'tidak_ada'}\n`;
    text += `*Role:* ${roleText}\n`;
    text += `*Saldo:* ${formatRupiah(user.balance)}\n\n`;
    text += `Pilih tindakan yang ingin Anda lakukan:`;

    const keyboard = [
        [{ text: '➕ Tambah Saldo', callback_data: `admin_user_add_balance_${targetUserId}` }, { text: '➖ Kurangi Saldo', callback_data: `admin_user_reduce_balance_${targetUserId}` }],
        [{ text: '✏️ Set Saldo', callback_data: `admin_user_set_balance_${targetUserId}` }],
        [{ text: `🔄 ${toggleRoleText}`, callback_data: `admin_user_toggle_role_${targetUserId}` }],
        [backButton('⬅️ Cari User Lain', 'admin_manage_users')]
    ];

    await bot.telegram.editMessageText(state.chatId, state.messageId, null, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function promptForBalanceChange(bot, query) {
    const adminId = query.from.id.toString();
    if (!isAdmin(adminId)) return;

    const parts = query.data.split('_');
    const mode = parts[2];
    const targetUserId = parts.pop();
    
    let title = '';
    if (mode === 'add') title = '➕ Tambah Saldo';
    if (mode === 'reduce') title = '➖ Kurangi Saldo';
    if (mode === 'set') title = '✏️ Set Saldo';

    pendingAdminAction[adminId] = {
        action: `${mode}_balance`,
        targetUserId,
        messageId: query.message.message_id,
        chatId: query.message.chat.id
    };

    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, `*${title}*\n\nKirimkan jumlah nominal untuk User ID \`${targetUserId}\`.`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[backButton('Batal', `admin_user_manage_${targetUserId}`)]] }
    });
}

async function processBalanceChange(bot, msg) {
    const adminId = msg.from.id.toString();
    const state = pendingAdminAction[adminId];
    if (!state) return;

    const { targetUserId, chatId, messageId, action } = state;
    const amount = parseInt(msg.text.trim());

    await bot.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});
    delete pendingAdminAction[adminId];

    if (isNaN(amount) || amount < 0) return;

    if (action === 'add_balance') {
        userService.updateUserBalance(targetUserId, amount, 'manual_admin_add');
    } else if (action === 'reduce_balance') {
        userService.updateUserBalance(targetUserId, -amount, 'manual_admin_reduce');
    } else if (action === 'set_balance') {
        const user = userService.getUser(targetUserId);
        const diff = amount - user.balance;
        userService.updateUserBalance(targetUserId, diff, 'manual_admin_set');
    }
    
    const refreshedMsg = {
        from: { id: adminId },
        chat: { id: chatId },
        message_id: messageId,
        text: targetUserId
    };
    await showUserManagementMenu(bot, refreshedMsg);
}

async function processRoleChange(bot, query) {
    const adminId = query.from.id.toString();
    if (!isAdmin(adminId)) return;

    const targetUserId = query.data.split('_').pop();
    const user = userService.getUser(targetUserId);
    if (!user) return;

    const newRole = user.role === 'user' ? 'reseller' : 'user';
    userService.updateUserRole(targetUserId, newRole);
    
    await bot.telegram.answerCbQuery(query.id, `Role pengguna telah diubah menjadi ${newRole}`);
    
    const refreshedMsg = {
        ...query.message,
        text: targetUserId
    };
    await showUserManagementMenu(bot, refreshedMsg);
}

async function handleBroadcastPrompt(bot, query) {
    const adminId = query.from.id.toString();
    if (!isAdmin(adminId)) return;
    pendingAdminAction[adminId] = { action: 'broadcast_input', messageId: query.message.message_id, chatId: query.message.chat.id };
    await bot.telegram.editMessageText(query.message.chat.id, query.message.message_id, null, '📢 *Kirim Broadcast*\n\nKirimkan pesan yang ingin Anda siarkan ke semua pengguna. Mendukung format Markdown.', {
        parse_mode: 'Markdown',
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

    const allUsers = userService.getAllUsers();
    const userIds = Object.keys(allUsers);

    await bot.telegram.editMessageText(chatId, messageId, null, `⏳ Memulai broadcast ke *${userIds.length}* pengguna...`, { parse_mode: 'Markdown' });

    let successCount = 0;
    let failCount = 0;

    for (const userId of userIds) {
        try {
            await bot.telegram.sendMessage(userId, broadcastMessage, { parse_mode: 'Markdown' });
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
    
    await bot.telegram.editMessageText(chatId, messageId, null, report, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[backButton('Kembali', 'admin_panel_main')]] } });
}


module.exports = {
  isAdmin,
  handleAdminInput,
  handleAdminPanelMain,
  handlePaymentSettings,
  togglePaymentStatus,
  handleManageServersMenu,
  handleSelectServer,
  startAddServerFlow,
  handleEditServerDetails,
  handleConfigServer,
  handleManageProtocols,
  promptNewPrice,
  toggleProtocolStatus,
  promptServerDetailChange,
  handleManageUsers,
  showUserManagementMenu,
  promptForBalanceChange,
  processRoleChange,
  handleBroadcastPrompt,
  handleBroadcastInput,
  handleTrialSettingsMenu,
  promptTrialCooldownChange,
  promptTrialDurationChange,
  pendingAdminAction
};