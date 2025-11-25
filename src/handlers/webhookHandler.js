// src/handlers/webhookHandler.js
const express = require('express');
const bodyParser = require('body-parser');
const userService = require('../services/userService');
const notificationService = require('../services/notificationService');
const sqliteService = require('../services/sqliteService');
const { writeLog } = require('../utils/logger');
const config = require('../config');
const { formatRupiah } = require('../utils/helpers');

function setupWebhookListener(bot) {
  const app = express();
  app.use(bodyParser.json());

  app.post('/webhook', async (req, res) => {
    const payload = req.body;
    const notes = payload.note || '';
    const userIdMatch = notes.match(/User ID: (\d+)/);

    writeLog(`[Webhook] Menerima payload dari Gateway: ${JSON.stringify(payload)}`);

    if (payload.id && payload.status === 'PAID' && userIdMatch && userIdMatch[1]) {
        const userId = userIdMatch[1];
        const amount = payload.amount;
        const invoiceId = payload.id; 

        const existingTopup = await sqliteService.get('SELECT * FROM topup_logs WHERE invoice_id = ?', [invoiceId]);
        if (existingTopup) {
            writeLog(`[Webhook] Peringatan: Invoice ${invoiceId} sudah pernah diproses. Mengabaikan.`);
            return res.status(200).send({ status: 'success', message: 'Already processed' });
        }
        
        writeLog(`[Webhook] Pembayaran terkonfirmasi untuk UserID ${userId}, sejumlah ${amount}`);
        const { user } = userService.updateUserBalance(userId, amount, 'topup_gateway', { invoiceId });
        
        bot.telegram.sendMessage(userId, `✅ *Topup Berhasil!*\n\nSejumlah *${formatRupiah(amount)}* telah ditambahkan ke saldo Anda.`, { parse_mode: 'Markdown' });
        notificationService.sendTopupSuccessNotification(bot, userId, user.username, amount);
        res.status(200).send({ status: 'success', message: 'Webhook processed' });

    } else {
      writeLog(`[Webhook] Payload dari gateway tidak valid, status bukan PAID, atau User ID tidak ditemukan di notes.`);
      res.status(400).send({ status: 'error', message: 'Invalid payload' });
    }
  });

  app.use(bot.webhookCallback(`/bot${config.botToken}`));
  
  app.listen(config.webhook.port, () => {
    writeLog(`[Webhook] Server berjalan dan mendengarkan di port ${config.webhook.port}`);
    const webhookFullUrl = `${config.webhook.url}/bot${config.botToken}`;
    bot.telegram.setWebhook(webhookFullUrl)
      .then(() => writeLog(`[Webhook] Berhasil diatur ke: ${webhookFullUrl}`))
      .catch((error) => writeLog(`[Webhook] FATAL: Gagal mengatur webhook: ${error.message}`));
  });
}

module.exports = { setupWebhookListener };