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
  
  if (data === 'admin_noop') {
      return bot.answerCallbackQuery(query.id);
  }

  if (data === 'delete_and_show_menu') {
      await bot.deleteMessage(chatId, messageId).catch(() => {});
      return coreHandler.sendMainMenu(bot, userId, chatId, null);
  }

  if (data === 'back_menu') {
      if (topupHandler.pendingTopupInput[userId]) delete topupHandler.pendingTopupInput[userId];
      if (adminHandler.pendingAdminAction[userId]) delete adminHandler.pendingAdminAction[userId];
      if (vpnHandler.pendingVpnAction[userId]) delete vpnHandler.pendingVpnAction[userId];
      writeLog(`[CallbackRouter] Semua status pending untuk User ID ${userId} telah dibatalkan.`);
      return coreHandler.sendMainMenu(bot, userId, chatId, messageId);
  }

  // Rute Utama
  if (data === 'topup_menu') return topupHandler.handleTopupMenu(bot, query);
  if (data === 'menu_vpn') return vpnHandler.handleVpnMenu(bot, query);
  if (data === 'menu_lain') return otherHandler.handleOtherMenu(bot, query);

  // Rute VPN
  if (data.startsWith('vpn_')) {
      if (data === 'vpn_buy_select_server') return vpnHandler.handleSelectServerForPurchase(bot, query);
      if (data.startsWith('vpn_select_protocol_')) return vpnHandler.handleSelectProtocol(bot, query);
      if (data.startsWith('vpn_select_duration_')) return vpnHandler.handleSelectDuration(bot, query);
      if (data.startsWith('vpn_enter_credentials_')) return vpnHandler.handleEnterUsername(bot, query);
      if (data === 'vpn_renew_select_account') return vpnHandler.handleSelectAccountForRenew(bot, query);
      if (data.startsWith('vpn_confirm_renew_')) return vpnHandler.handleConfirmRenew(bot, query);
      return;
  }

  // Rute Admin
  if (data.startsWith('admin_')) {
      if (data === 'admin_panel_main') return adminHandler.handleAdminPanelMain(bot, query);
      
      // Rute Kelola Server
      if (data === 'admin_manage_servers') return adminHandler.handleManageServersMenu(bot, query);
      if (data === 'admin_add_server_prompt') return adminHandler.startAddServerFlow(bot, query);
      if (data === 'admin_edit_server_select') return adminHandler.handleSelectServer(bot, query, 'edit');
      if (data === 'admin_delete_server_select') return adminHandler.handleSelectServer(bot, query, 'delete');
      if (data.startsWith('admin_edit_server_details_')) return adminHandler.handleEditServerDetails(bot, query);
      if (data.startsWith('admin_config_server_')) return adminHandler.handleConfigServer(bot, query);
      if (data.startsWith('admin_manage_protocols_')) return adminHandler.handleManageProtocols(bot, query);
      if (data.startsWith('admin_edit_servername_')) return adminHandler.promptServerDetailChange(bot, query);
      if (data.startsWith('admin_edit_servertoken_')) return adminHandler.promptServerDetailChange(bot, query);
      if (data.startsWith('admin_set_price_')) return adminHandler.promptNewPrice(bot, query);
      if (data.startsWith('admin_toggle_protocol_')) return adminHandler.toggleProtocolStatus(bot, query);

      // Rute Kelola Pengguna
      if (data === 'admin_manage_users') return adminHandler.handleManageUsers(bot, query);
      if (data.startsWith('admin_user_manage_')) {
          const targetUserId = data.split('_').pop();
          query.message.text = targetUserId;
          return adminHandler.showUserManagementMenu(bot, query.message);
      }
      if (data.startsWith('admin_user_add_balance_')) return adminHandler.promptForBalanceChange(bot, query);
      if (data.startsWith('admin_user_reduce_balance_')) return adminHandler.promptForBalanceChange(bot, query);
      if (data.startsWith('admin_user_set_balance_')) return adminHandler.promptForBalanceChange(bot, query);
      if (data.startsWith('admin_user_toggle_role_')) return adminHandler.processRoleChange(bot, query);

      // Rute Lainnya
      if (data === 'admin_broadcast_prompt') return adminHandler.handleBroadcastPrompt(bot, query);
      return;
  }

  bot.answerCallbackQuery(query.id).catch(() => {});
}

module.exports = { routeCallbackQuery };
