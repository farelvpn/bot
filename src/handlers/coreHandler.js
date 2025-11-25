// src/handlers/coreHandler.js
const userService = require('../services/userService');
const serverService = require('../services/serverService');
const config = require('../config');
const { formatRupiah, prettyLine, escapeMarkdown } = require('../utils/helpers'); // [UPDATE] Import escapeMarkdown
const { writeLog } = require('../utils/logger');
const os = require('os');
const adminHandler = require('./adminHandler');

async function handleStartCommand(bot, msg) {
  const userId = msg.from.id.toString();
  const username = msg.from.username;
  const isNewUser = userService.ensureUser(userId, username);
  if (isNewUser) {
    await bot.telegram.sendMessage(userId, 'Selamat datang! Akun Anda telah berhasil dibuat.');
  }
  await sendMainMenu(bot, userId, msg.chat.id);
}

async function sendMainMenu(bot, userId, chatId, messageIdToEdit = null) {
  try {
    const user = userService.getUser(userId);
    if (!user) {
        writeLog(`[CoreHandler] Gagal sendMainMenu: User ${userId} tidak ditemukan di DB.`);
        return;
    }
    const allServers = serverService.getAllAvailableServers();
    const uptimeSec = os.uptime();
    const uptimeH = Math.floor(uptimeSec / 3600);
    const uptimeM = Math.floor((uptimeSec % 3600) / 60);
    const uptimeStr = `${uptimeH}j ${uptimeM}m`;

    // [FIX] Escape nama toko dan username
    const safeStoreName = escapeMarkdown(config.storeName);
    const safeUsername = escapeMarkdown(user.username || 'tidak_ada');

    const messageText =
      `🛒 *${safeStoreName}*\n${prettyLine()}\n` +
      `*Statistik Bot:*\n` +
      `• 🗄️ Server Tersedia: *${allServers.length}*\n` +
      `• ⏱️ Uptime: *${uptimeStr}*\n` +
      `${prettyLine()}\n` +
      `*Akun Anda:*\n` +
      `• 🆔 ID: \`${userId}\`\n` +
      `• 👤 Username: @${safeUsername}\n` +
      `• 💰 Saldo: *${formatRupiah(user.balance)}*\n` +
      `${prettyLine()}\n` +
      `Silakan pilih menu di bawah ini:`;

    const inline_keyboard = [
      [
        { text: '🛡️ Menu VPN', callback_data: 'menu_vpn' },
        { text: '💳 Topup Saldo', callback_data: 'topup_menu' }
      ],
      [
        { text: '📦 Menu Lainnya', callback_data: 'menu_lain' }
      ]
    ];
    
    if (adminHandler.isAdmin(userId)) {
      inline_keyboard.push([{ text: '👑 Panel Admin', callback_data: 'admin_panel_main' }]);
    }

    const extra = {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    };

    if (messageIdToEdit) {
      await bot.telegram.editMessageText(chatId, messageIdToEdit, null, messageText, extra).catch(err => {
        if(!err.message.includes('message is not modified')) {
          writeLog(`[CoreHandler] Edit Error: ${err.message}`);
        }
      });
    } else {
      await bot.telegram.sendMessage(chatId, messageText, extra);
    }
  } catch (error) {
    writeLog(`[CoreHandler] ERROR di sendMainMenu: ${error.message}`);
  }
}

module.exports = { handleStartCommand, sendMainMenu };
