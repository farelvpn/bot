// src/handlers/callbackRouter.js

const { writeLog } = require('../utils/logger');
const { sendMainMenu } = require('./coreHandler');
const { handleTopupMenu } = require('./topupHandler');
const adminHandler = require('./adminHandler');
const vpnHandler = require('./vpnHandler');
const { handleOtherMenu } = require('./otherHandler');

/**
 * Menerima query dan mengarahkannya ke handler yang sesuai.
 * @param {object} bot Instance bot Telegram.
 * @param {object} query Objek callback_query dari Telegram.
 */
async function routeCallbackQuery(bot, query) {
  const data = query.data;
  const userId = query.from.id.toString();

  // Log setiap callback untuk debugging.
  writeLog(`[CallbackRouter] Menerima callback: "${data}" dari User ID: ${userId}`);
  // Jawab callback secepatnya untuk menghilangkan ikon loading di tombol.
  await bot.answerCallbackQuery(query.id).catch(err => writeLog(`AnswerCB Error: ${err.message}`));

  // === NAVIGASI UTAMA ===
  if (data === 'back_menu') return sendMainMenu(bot, userId, query.message.chat.id, query.message.message_id);
  if (data === 'topup_menu') return handleTopupMenu(bot, query);
  if (data === 'menu_vpn') return vpnHandler.handleVpnMenu(bot, query);
  if (data === 'menu_lain') return handleOtherMenu(bot, query);

  // === ALUR VPN ===
  if (data.startsWith('vpn_')) {
      if (data === 'vpn_buy_select_server') return vpnHandler.handleSelectServerForPurchase(bot, query);
      if (data.startsWith('vpn_select_protocol_')) return vpnHandler.handleSelectProtocol(bot, query);
      if (data.startsWith('vpn_enter_username_')) return vpnHandler.handleEnterUsername(bot, query);
      if (data === 'vpn_renew_select_account') return vpnHandler.handleSelectAccountForRenew(bot, query);
      if (data.startsWith('vpn_confirm_renew_')) return vpnHandler.handleConfirmRenew(bot, query);
      if (data === 'vpn_my_accounts') { /* Tambahkan handler untuk ini jika perlu */ }
  }

  // === PANEL ADMIN ===
  if (data.startsWith('admin_')) {
      if(data === 'admin_panel_main') return adminHandler.handleAdminPanelMain(bot, query);
      // Manajemen Pengguna
      if(data === 'admin_manage_users') return adminHandler.handleManageUsers(bot, query);
      if (data === 'admin_add_balance_prompt') return adminHandler.handleBalanceActionPrompt(bot, query, 'add');
      if (data === 'admin_reduce_balance_prompt') return adminHandler.handleBalanceActionPrompt(bot, query, 'reduce');
      if (data === 'admin_set_balance_prompt') return adminHandler.handleBalanceActionPrompt(bot, query, 'set');
      // Manajemen Server
      if(data === 'admin_manage_servers') return adminHandler.handleManageServersMenu(bot, query);
      if(data === 'admin_add_server_prompt') return adminHandler.handleAddServerPrompt(bot, query);
      if(data === 'admin_edit_server_select') return adminHandler.handleSelectServer(bot, query, 'edit');
      if(data === 'admin_delete_server_select') return adminHandler.handleSelectServer(bot, query, 'delete');
      // Broadcast & Transaksi
      if(data === 'admin_broadcast_prompt') return adminHandler.handleBroadcastPrompt(bot, query);
      if(data === 'admin_view_transactions') return adminHandler.handleViewTransactions(bot, query);
      // Callback dinamis (dengan ID)
      if (data.startsWith('admin_edit_server_details_')) { /* Tambahkan handler jika ada */ }
      if (data.startsWith('admin_delete_server_confirm_')) { /* Tambahkan handler jika ada */ }
  }

  // Jika tidak ada handler yang cocok, catat sebagai peringatan.
  // writeLog(`[CallbackRouter] WARNING: Tidak ada handler untuk callback data: "${data}"`);
}

module.exports = { routeCallbackQuery };
