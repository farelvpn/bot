// src/config/index.js
require('dotenv').config();
const path = require('path');

module.exports = {
  botToken: process.env.BOT_TOKEN,
  adminId: process.env.ADMIN_USER_ID,
  storeName: process.env.STORE_NAME || 'RERECHAN STORE',
  
  paymentGateway: {
    baseUrl: process.env.PAYMENT_GATEWAY_BASE_URL,
    username: process.env.PAYMENT_GATEWAY_USERNAME,
    apiToken: process.env.PAYMENT_GATEWAY_API_TOKEN,
  },

  // [BARU] Konfigurasi Saweria
  saweria: {
    name: process.env.SAWERIA_NAME || 'Melon3D',
  },

  trial: {
    enabled: process.env.TRIAL_ENABLED === 'true'
  },
  
  webhook: {
    url: process.env.WEBHOOK_URL,
    port: process.env.WEBHOOK_PORT || 3000,
  },
  
  groupNotification: {
    enabled: process.env.GROUP_NOTIFICATION_ENABLED === 'true',
    chatId: process.env.GROUP_NOTIFICATION_CHAT_ID,
    topicId: process.env.GROUP_NOTIFICATION_TOPIC_ID || null,
  },
  
  links: {
    telegramChannel: process.env.LINK_TELEGRAM_CHANNEL,
    telegramGroup: process.env.LINK_TELEGRAM_GROUP,
    whatsappGroup: process.env.LINK_WHATSAPP_GROUP,
  },
  
  paths: {
    db: path.join(__dirname, '../../database.json'),
    serversConfigDir: path.join(__dirname, '../../servers'),
    logFile: process.env.LOG_PATH || path.join(__dirname, '../../logs/bot.log'),
    sqlite: path.join(__dirname, '../../transactions.sqlite3')
  },
};