// src/services/notificationService.js
const config = require('../config');
const { censorUsername, censorBalance } = require('../utils/helpers');
const { writeLog } = require('../utils/logger');

async function sendNotificationToGroup(bot, message) {
  if (!config.groupNotification.enabled || !config.groupNotification.chatId) {
    return;
  }
  try {
    const options = {
      parse_mode: 'HTML',
      message_thread_id: config.groupNotification.topicId,
    };
    await bot.sendMessage(config.groupNotification.chatId, message, options);
  } catch (error) {
    writeLog(`[Notification] Gagal mengirim notifikasi ke grup ${config.groupNotification.chatId}: ${error.message}`);
  }
}

async function sendTopupSuccessNotification(bot, userId, username, amount) {
  const censoredUser = censorUsername(username || `user${userId}`);
  const censoredAmount = censorBalance(amount);
  const message = `
✅ <b>Topup Saldo Berhasil</b>
------------------------------------------
👤 <b>User:</b> ${censoredUser} (<code>${userId}</code>)
💰 <b>Jumlah:</b> ${censoredAmount}
------------------------------------------
  `;
  await sendNotificationToGroup(bot, message);
}

async function sendNewVpnPurchaseNotification(bot, user, purchaseData) {
    const { serverName, protocol, username, price } = purchaseData;
    const censoredUser = censorUsername(user.username || `user${user.id}`);
    const censoredPrice = censorBalance(price);
    const message = `
🛒 <b>Pembelian Akun Baru</b>
------------------------------------------
👤 <b>Pembeli:</b> ${censoredUser} (<code>${user.id}</code>)
🗄️ <b>Server:</b> ${serverName}
🛡️ <b>Protokol:</b> ${protocol.toUpperCase()}
🤵 <b>Username:</b> <code>${username}</code>
💸 <b>Harga:</b> ${censoredPrice}
------------------------------------------
    `;
    await sendNotificationToGroup(bot, message);
}

async function sendVpnRenewNotification(bot, user, renewData) {
    const { serverName, protocol, username, price } = renewData;
    const censoredUser = censorUsername(user.username || `user${user.id}`);
    const censoredPrice = censorBalance(price);
    const message = `
🔄 <b>Perpanjangan Akun</b>
------------------------------------------
👤 <b>Pelanggan:</b> ${censoredUser} (<code>${user.id}</code>)
🗄️ <b>Server:</b> ${serverName}
🛡️ <b>Protokol:</b> ${protocol.toUpperCase()}
🤵 <b>Username:</b> <code>${username}</code>
💸 <b>Biaya:</b> ${censoredPrice}
------------------------------------------
    `;
    await sendNotificationToGroup(bot, message);
}

module.exports = { sendTopupSuccessNotification, sendNewVpnPurchaseNotification, sendVpnRenewNotification };
