// src/handlers/callbackRouter.js
const { writeLog } = require('../utils/logger');
const { sendMainMenu } = require('./coreHandler');
const { handleTopupMenu } = require('./topupHandler');
const adminHandler = require('./adminHandler');
const vpnHandler = require('./vpnHandler');
const { handleOtherMenu } = require('./otherHandler');

async function routeCallbackQuery(bot, query) {
  const data = query.data;
  const userId = query.from.id.toString();

  writeLog(`[CallbackRouter] Menerima callback data: "${data}" dari User ID: ${userId}`);
  await bot.answerCallbackQuery(query.id).catch(err => writeLog(`AnswerCB Error: ${err.message}`));

  if (data === 'back_menu') return sendMainMenu(bot, userId, query.message.chat.id, query.message.message_id);
  if (data === 'topup_menu') return handleTopupMenu(bot, query);
  if (data === 'menu_vpn') return vpnHandler.handleVpnMenu(bot, query);
  if (data === 'menu_lain') return handleOtherMenu(bot, query);

  if (data.startsWith('vpn_')) {
      if (data === 'vpn_buy_select_server') return vpnHandler.handleSelectServerForPurchase(bot, query);
      if (data.startsWith('vpn_select_protocol_')) return vpnHandler.handleSelectProtocol(bot, query);
      if (data.startsWith('vpn_enter_username_')) return vpnHandler.handleEnterUsername(bot, query);
      if (data === 'vpn_renew_select_account') return vpnHandler.handleSelectAccountForRenew(bot, query);
      if (data.startsWith('vpn_confirm_renew_')) return vpnHandler.handleConfirmRenew(bot, query);
  }

  if (data.startsWith('admin_')) {
      if(data === 'admin_panel_main') return adminHandler.handleAdminPanelMain(bot, query);
      if(data === 'admin_manage_users') return adminHandler.handleManageUsers(bot, query);
      if (data === 'admin_add_balance_prompt') return adminHandler.handleBalanceActionPrompt(bot, query, 'add');
      if (data === 'admin_reduce_balance_prompt') return adminHandler.handleBalanceActionPrompt(bot, query, 'reduce');
      if (data === 'admin_set_balance_prompt') return adminHandler.handleBalanceActionPrompt(bot, query, 'set');
  }

  // Fallback untuk handler yang tidak ditemukan
  // writeLog(`[CallbackRouter] WARNING: Tidak ada handler untuk callback data: "${data}"`);
}

module.exports = { routeCallbackQuery };
