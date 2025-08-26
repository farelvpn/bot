// src/handlers/webhookHandler.js
const express = require('express');
const bodyParser = require('body-parser');
const userService = require('../services/userService');
const notificationService = require('../services/notificationService');
const { writeLog } = require('../utils/logger');
const config = require('../config');
const { formatRupiah } = require('../utils/helpers');

function setupWebhookListener(bot) {
  const app = express();
  app.use(bodyParser.json());

  app.post('/webhook', (req, res) => {
    const payload = req.body;
    writeLog(`[Webhook] Menerima payload dari Gateway: ${JSON.stringify(payload)}`);

    if (payload.id && payload.status === 'PAID' && payload.notes) {
      const userIdMatch = payload.notes.match(/User ID: (\d+)/);
      if (userIdMatch && userIdMatch[1]) {
        const userId = userIdMatch[1];
        const amount = payload.amount;
        
        const { user } = userService.updateUserBalance(userId, amount, 'topup_gateway', { invoiceId: payload.id });
        
        bot.sendMessage(userId, `✅ *Topup Berhasil!*\n\nSejumlah *${formatRupiah(amount)}* telah ditambahkan ke saldo Anda.`, { parse_mode: 'Markdown' });
        notificationService.sendTopupSuccessNotification(bot, userId, user.username, amount);
        res.status(200).send({ status: 'success', message: 'Webhook processed' });

      } else {
        writeLog(`[Webhook] WARNING: Tidak dapat menemukan User ID di notes: ${payload.notes}`);
        res.status(400).send({ status: 'error', message: 'User ID not found in notes' });
      }
    } else {
      writeLog(`[Webhook] Payload dari gateway tidak valid atau status bukan PAID.`);
      res.status(400).send({ status: 'error', message: 'Invalid payload or status not PAID' });
    }
  });

  app.post(`/bot${config.botToken}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
  
  app.listen(config.webhook.port, () => {
    writeLog(`[Webhook] Server berjalan dan mendengarkan di port ${config.webhook.port}`);
    const webhookFullUrl = `${config.webhook.url}/bot${config.botToken}`;
    bot.setWebHook(webhookFullUrl)
      .then(() => writeLog(`[Webhook] Berhasil diatur ke: ${webhookFullUrl}`))
      .catch((error) => writeLog(`[Webhook] FATAL: Gagal mengatur webhook: ${error.message}`));
  });
}

module.exports = { setupWebhookListener };
