// src/handlers/topupHandler.js
const userService = require('../services/userService');
const paymentGatewayService = require('../services/paymentGatewayService');
const { writeLog } = require('../utils/logger');
const { formatRupiah, prettyLine, backButton } = require('../utils/helpers');

const pendingTopupInput = {};

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
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
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
    const amount = parseInt(msg.text.trim().replace(/\D/g, ''));
    await bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    await bot.deleteMessage(chatId, messageId).catch(() => {});

    const { minAmount, maxAmount } = userService.getTopupSettings();
    if (isNaN(amount) || amount < minAmount || amount > maxAmount) {
        const errorText = `❌ *Input Tidak Valid*\n\nNominal harus di antara ${formatRupiah(minAmount)} dan ${formatRupiah(maxAmount)}.`;
        await bot.sendMessage(chatId, errorText, { parse_mode: 'Markdown' });
        return;
    }

    const processingMessage = await bot.sendMessage(chatId, '⏳ Sedang membuat invoice pembayaran, mohon tunggu...');

    try {
        const invoice = await paymentGatewayService.createInvoice(amount, userId, username);
        const qrBuffer = await paymentGatewayService.getInvoiceQR(invoice.id);
        const caption = `*✅ Silakan Lakukan Pembayaran*\n\n` +
                        `Invoice ID: \`${invoice.id}\`\n` +
                        `Nominal: *${formatRupiah(amount)}*\n\n` +
                        `*PENTING*: Saldo akan ditambahkan secara otomatis setelah pembayaran berhasil.\n\n` +
                        `_Jika saldo tidak bertambah dalam 5 menit, hubungi Customer Service._`;

        await bot.deleteMessage(chatId, processingMessage.message_id).catch(() => {});
        await bot.sendPhoto(chatId, qrBuffer, {
            caption,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[backButton('Selesai & Kembali ke Menu', 'back_menu')]]
            }
        });

    } catch (error) {
        await bot.editMessageText(`❌ *Terjadi Kesalahan*\n\n${error.message}`, {
            chat_id: chatId,
            message_id: processingMessage.message_id,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[backButton('Kembali ke Menu', 'back_menu')]] }
        });
    }
}

module.exports = { handleTopupMenu, processTopupAmount, pendingTopupInput };
