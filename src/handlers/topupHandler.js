// src/handlers/topupHandler.js
const userService = require('../services/userService');
const notificationService = require('../services/notificationService');
const paymentGatewayService = require('../services/paymentGatewayService');
const saweriaService = require('../services/saweriaService');
const { writeLog } = require('../utils/logger');
const { formatRupiah, prettyLine, backButton } = require('../utils/helpers');

const pendingTopupInput = {};
const activeInvoiceChecks = {};
const pendingPaymentSelection = {};

async function handleTopupMenu(bot, query) {
    const userId = query.from.id.toString();
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    const topupSettings = userService.getTopupSettings();
    const text = `*💳 Topup Saldo Otomatis*\n${prettyLine()}\n` +
                 `Silakan ketik dan kirim jumlah nominal yang ingin Anda topup di chat.\n\n` +
                 `*Contoh:* \`50000\`\n\n` +
                 `Minimal: *${formatRupiah(topupSettings.minAmount)}*\n` +
                 `Maksimal: *${formatRupiah(topupSettings.maxAmount)}*`;
    try {
        await bot.telegram.editMessageText(chatId, messageId, null, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[backButton('⬅️ Batalkan', 'back_menu')]] }
        });
        pendingTopupInput[userId] = { active: true, messageId, chatId };
    } catch (error) {
        writeLog(`[TopupHandler] Gagal menampilkan menu topup: ${error.message}`);
    }
}

async function processTopupAmount(bot, msg) {
    const userId = msg.from.id.toString();
    const username = msg.from.username;
    const state = pendingTopupInput[userId];
    if (!state) return;

    delete pendingTopupInput[userId];
    const { messageId, chatId } = state;

    const rawAmount = msg.text.trim();
    const cleanedAmount = rawAmount.replace(/\D/g, '');
    const amount = parseInt(cleanedAmount, 10);
    
    await bot.telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    await bot.telegram.deleteMessage(chatId, messageId).catch(() => {});

    const { minAmount, maxAmount } = userService.getTopupSettings();
    if (isNaN(amount) || amount < minAmount || amount > maxAmount) {
        const errorText = `❌ *Input Tidak Valid*\n\nNominal harus di antara ${formatRupiah(minAmount)} dan ${formatRupiah(maxAmount)}.`;
        const sentMsg = await bot.telegram.sendMessage(chatId, errorText, { parse_mode: 'Markdown' });
        setTimeout(() => bot.telegram.deleteMessage(chatId, sentMsg.message_id).catch(() => {}), 5000);
        return;
    }

    const methods = userService.getPaymentMethods();
    const availableMethods = [];
    
    if (methods.gateway_utama) availableMethods.push('gateway_utama');
    if (methods.saweria) availableMethods.push('saweria');

    if (availableMethods.length === 0) {
        return bot.telegram.sendMessage(chatId, '❌ Mohon maaf, saat ini semua metode pembayaran sedang dinonaktifkan oleh admin.');
    }

    pendingPaymentSelection[userId] = { amount: amount, chatId: chatId };

    if (availableMethods.length === 1) {
        const selectedMethod = availableMethods[0];
        return executePayment(bot, userId, selectedMethod, username);
    }

    const keyboard = [
        [
            { text: '🏦 QRIS Utama (Otomatis)', callback_data: 'pay_select_gateway_utama' },
            { text: '🐤 QRIS Saweria', callback_data: 'pay_select_saweria' }
        ],
        [backButton('❌ Batalkan', 'back_menu')]
    ];

    await bot.telegram.sendMessage(chatId, `💳 *Pilih Metode Pembayaran*\n${prettyLine()}\nNominal: *${formatRupiah(amount)}*\n\nSilakan pilih metode pembayaran yang tersedia:`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function handlePaymentSelection(bot, query) {
    const userId = query.from.id.toString();
    const selection = pendingPaymentSelection[userId];
    
    if (!selection) {
        await bot.telegram.answerCbQuery(query.id, 'Sesi pembayaran kedaluwarsa, silakan ulangi input nominal.', { show_alert: true });
        return bot.telegram.deleteMessage(query.message.chat.id, query.message.message_id).catch(()=>{});
    }

    const method = query.data.replace('pay_select_', '');
    await bot.telegram.deleteMessage(selection.chatId, query.message.message_id).catch(()=>{});
    
    await executePayment(bot, userId, method, query.from.username);
    
    delete pendingPaymentSelection[userId]; 
}

async function executePayment(bot, userId, method, username) {
    const selection = pendingPaymentSelection[userId];
    if (!selection) {
        return bot.telegram.sendMessage(userId, '❌ Terjadi kesalahan sesi. Silakan ulangi.');
    }
    
    const { amount, chatId } = selection;
    const processingMessage = await bot.telegram.sendMessage(chatId, '⏳ Sedang membuat invoice pembayaran...');

    try {
        if (method === 'gateway_utama') {
            const invoice = await paymentGatewayService.createInvoice(amount, userId, username);
            const qrBuffer = await paymentGatewayService.getInvoiceQR(invoice.invoice_id);
            
            await bot.telegram.deleteMessage(chatId, processingMessage.message_id).catch(() => {});
            
            const caption = `*✅ Invoice Gateway Utama*\nID: \`${invoice.invoice_id}\`\nNominal: *${formatRupiah(amount)}*\n\nSilakan scan QRIS di atas. Bayar sebelum 5 menit.`;
            
            const msg = await bot.telegram.sendPhoto(chatId, { source: qrBuffer }, {
                caption: caption,
                parse_mode: 'Markdown',
                 reply_markup: {
                    inline_keyboard: [[{ text: 'Batal / Selesai', callback_data: `cancel_pay_${invoice.invoice_id}` }]]
                }
            });

            startPolling(bot, userId, 'gateway_utama', invoice.invoice_id, amount, msg.message_id, chatId);

        } else if (method === 'saweria') {
            const result = await saweriaService.createQr(amount, userId);
            
            await bot.telegram.deleteMessage(chatId, processingMessage.message_id).catch(() => {});
            
            const caption = `*✅ Invoice Saweria*\nNominal: *${formatRupiah(amount)}*\n\nSilakan scan QRIS di atas menggunakan E-Wallet/M-Banking.\nSistem akan mengecek pembayaran otomatis setiap 3 detik.`;

            const msg = await bot.telegram.sendPhoto(chatId, { source: result.qrImagePath }, {
                caption: caption,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: 'Batal / Selesai', callback_data: `cancel_pay_${result.transactionId}` }]]
                }
            });

            saweriaService.deleteQrImage(result.qrImagePath);

            startPolling(bot, userId, 'saweria', result.transactionId, amount, msg.message_id, chatId);
        }

    } catch (error) {
        await bot.telegram.deleteMessage(chatId, processingMessage.message_id).catch(() => {});
        await bot.telegram.sendMessage(chatId, `❌ Gagal membuat invoice: ${error.message}`);
        writeLog(`[Topup] Error executePayment: ${error.message}`);
    }
}

function startPolling(bot, userId, method, trxId, amount, messageId, chatId) {
    const checkInterval = 3000; 
    const timeout = 300000; 
    const startTime = Date.now();
    
    writeLog(`[Topup] Memulai polling ${method} ID: ${trxId} untuk User ${userId}`);

    const intervalId = setInterval(async () => {
        if (!activeInvoiceChecks[trxId]) { 
            clearInterval(intervalId); 
            writeLog(`[Polling] Loop dihentikan untuk ID: ${trxId}`);
            return; 
        }

        writeLog(`[Polling Debug] Mengecek status pembayaran ${method} ID: ${trxId} ...`);

        const elapsedTime = Date.now() - startTime;
        let isPaid = false;

        try {
            if (method === 'gateway_utama') {
                const invoice = await paymentGatewayService.getInvoiceDetails(trxId);
                if (invoice && invoice.status === 'PAID') isPaid = true;
            } else if (method === 'saweria') {
                isPaid = await saweriaService.checkStatus(trxId);
            }
        } catch (err) {
            writeLog(`[Polling] Error cek status ${trxId}: ${err.message}`);
        }

        if (isPaid) {
            clearInterval(intervalId);
            delete activeInvoiceChecks[trxId];

            await bot.telegram.deleteMessage(chatId, messageId).catch(() => {});
            
            const { user } = userService.updateUserBalance(userId, amount, `topup_${method}`, { invoiceId: trxId });
            
            await bot.telegram.sendMessage(chatId, `✅ *Topup Berhasil via ${method === 'saweria' ? 'Saweria' : 'Gateway'}!*\n\nSejumlah *${formatRupiah(amount)}* telah ditambahkan ke saldo Anda.\nSaldo sekarang: *${formatRupiah(user.balance)}*`, { parse_mode: 'Markdown' });
            
            notificationService.sendTopupSuccessNotification(bot, userId, user.username, amount);
            return;
        }

        if (elapsedTime >= timeout) {
            clearInterval(intervalId);
            delete activeInvoiceChecks[trxId];
            await bot.telegram.deleteMessage(chatId, messageId).catch(() => {});
            await bot.telegram.sendMessage(chatId, `❌ *Waktu Habis*\nInvoice sebesar ${formatRupiah(amount)} telah kedaluwarsa.`);
        }

    }, checkInterval);

    activeInvoiceChecks[trxId] = intervalId;
}

function cancelPolling(trxId) {
    if (activeInvoiceChecks[trxId]) {
        clearInterval(activeInvoiceChecks[trxId]);
        delete activeInvoiceChecks[trxId];
        writeLog(`[Topup] Polling dihentikan manual oleh user untuk ID: ${trxId}`);
        return true;
    }
    return false;
}

module.exports = { 
    handleTopupMenu, 
    processTopupAmount, 
    pendingTopupInput, 
    handlePaymentSelection,
    cancelPolling
};