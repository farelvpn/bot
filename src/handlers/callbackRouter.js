// src/handlers/callbackRouter.js

const { writeLog } = require('../utils/logger');
const coreHandler = require('./coreHandler'); 
const topupHandler = require('./topupHandler');
const adminHandler = require('./adminHandler');
const vpnHandler = require('./vpnHandler');
const otherHandler = require('./otherHandler');

async function routeCallbackQuery(bot, query) {
  const data = query.data;
  const userId = query.from.id.toString();
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  writeLog(`[CallbackRouter] Menerima callback: "${data}" dari User ID: ${userId}`);
  await bot.answerCallbackQuery(query.id).catch(err => writeLog(`AnswerCB Error: ${err.message}`));

  if (data === 'delete_and_show_menu') {
      await bot.deleteMessage(chatId, messageId).catch(() => {});
      return coreHandler.sendMainMenu(bot, userId, chatId, null);
  }

  if (data === 'back_menu') {
      if (topupHandler.pendingTopupInput[userId]) {
          delete topupHandler.pendingTopupInput[userId];
          writeLog(`[CallbackRouter] Status topup untuk User ID ${userId} telah dibatalkan.`);
      }
      if (adminHandler.pendingAdminAction[userId]) {
          delete adminHandler.pendingAdminAction[userId];
          writeLog(`[CallbackRouter] Aksi admin untuk User ID ${userId} telah dibatalkan.`);
      }
      return coreHandler.sendMainMenu(bot, userId, chatId, messageId);
  }

  if (data === 'topup_menu') return topupHandler.handleTopupMenu(bot, query);
  if (data === 'menu_vpn') return vpnHandler.handleVpnMenu(bot, query);
  if (data === 'menu_lain') return otherHandler.handleOtherMenu(bot, query);

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
      if(data === 'admin_manage_servers') return adminHandler.handleManageServersMenu(bot, query);
      if(data === 'admin_add_server_prompt') return adminHandler.startAddServerFlow(bot, query);
      if(data === 'admin_edit_server_select') return adminHandler.handleSelectServer(bot, query, 'edit');
      if(data === 'admin_delete_server_select') return adminHandler.handleSelectServer(bot, query, 'delete');
      if(data === 'admin_broadcast_prompt') return adminHandler.handleBroadcastPrompt(bot, query);
      if(data === 'admin_view_transactions') return adminHandler.handleViewTransactions(bot, query);
  }
}

module.exports = { routeCallbackQuery };
