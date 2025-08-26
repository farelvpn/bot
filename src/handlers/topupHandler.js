// src/handlers/topupHandler.js
const userService = require('../services/userService');
const notificationService = require('../services/notificationService');
const paymentGatewayService = require('../services/paymentGatewayService');
const { writeLog } = require('../utils/logger');
const { formatRupiah, prettyLine, backButton } = require('../utils/helpers');

const pendingTopupInput = {};
// Objek untuk melacak interval pengecekan invoice yang aktif
const activeInvoiceChecks = {};

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
            chat_id: chatId, message_id: messageId,
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
    writeLog(`[TopupHandler] Input mentah: "${rawAmount}", Setelah dibersihkan: "${cleanedAmount}", Hasil parse: ${amount}`);
    
    await bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    await bot.deleteMessage(chatId, messageId).catch(() => {});

    const { minAmount, maxAmount } = userService.getTopupSettings();
    if (isNaN(amount) || amount < minAmount || amount > maxAmount) {
        const errorText = `❌ *Input Tidak Valid*\n\nNominal harus di antara ${formatRupiah(minAmount)} dan ${formatRupiah(maxAmount)}.`;
        const sentMsg = await bot.sendMessage(chatId, errorText, { parse_mode: 'Markdown' });
        setTimeout(() => bot.deleteMessage(chatId, sentMsg.message_id).catch(() => {}), 10000);
        return;
    }

    const processingMessage = await bot.sendMessage(chatId, '⏳ Sedang membuat invoice pembayaran, mohon tunggu...');

    try {
        const invoice = await paymentGatewayService.createInvoice(amount, userId, username);
        const qrBuffer = await paymentGatewayService.getInvoiceQR(invoice.invoice_id);

        const caption = `*✅ Silakan Lakukan Pembayaran*\n\n` +
                        `Invoice ID: \`${invoice.invoice_id}\`\n` +
                        `Nominal: *${formatRupiah(invoice.amount)}*\n\n` +
                        `*PENTING*: Selesaikan pembayaran dalam 5 menit. Status akan dicek otomatis.`;

        await bot.deleteMessage(chatId, processingMessage.message_id).catch(() => {});
        
        const qrisMessage = await bot.sendPhoto(chatId, qrBuffer, {
            caption,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: 'Selesai & Kembali ke Menu', callback_data: 'delete_and_show_menu' }]]
            }
        }, { filename: 'qris.png', contentType: 'image/png' });

        const checkInterval = 2000;
        const timeout = 300000;
        const startTime = Date.now();
        
        writeLog(`[TopupHandler] Memulai pengecekan invoice ${invoice.invoice_id} setiap ${checkInterval / 1000} detik.`);

        const intervalId = setInterval(async () => {
            // [PERBAIKAN UTAMA] Jika interval sudah tidak ada di tracker, berarti sudah diproses. Langsung hentikan.
            if (!activeInvoiceChecks[invoice.invoice_id]) {
                clearInterval(intervalId);
                return;
            }

            const elapsedTime = Date.now() - startTime;
            const updatedInvoice = await paymentGatewayService.getInvoiceDetails(invoice.invoice_id);

            // Periksa lagi apakah invoice masih aktif di tracker SEBELUM memproses
            if (updatedInvoice && updatedInvoice.status === 'PAID' && activeInvoiceChecks[invoice.invoice_id]) {
                
                // [PENGUNCIAN] Hentikan dan hapus tracker SEKARANG JUGA secara sinkron
                // untuk mencegah proses ganda pada iterasi berikutnya.
                clearInterval(intervalId);
                delete activeInvoiceChecks[invoice.invoice_id];

                writeLog(`[TopupHandler] Invoice ${invoice.invoice_id} telah dibayar. Memproses penambahan saldo...`);

                // Proses selanjutnya dijamin hanya berjalan satu kali.
                // 1. Hapus pesan QRIS
                await bot.deleteMessage(chatId, qrisMessage.message_id).catch(() => {});

                // 2. Tambahkan saldo ke database
                const { user } = userService.updateUserBalance(userId, updatedInvoice.amount, 'topup_polling', { invoiceId: updatedInvoice.invoice_id });

                // 3. Beri notifikasi ke pengguna
                await bot.sendMessage(chatId, `✅ *Topup Berhasil!*\n\nSejumlah *${formatRupiah(updatedInvoice.amount)}* telah ditambahkan ke saldo Anda.\n\nSaldo baru Anda: *${formatRupiah(user.balance)}*`, { parse_mode: 'Markdown' });

                // 4. Kirim notifikasi ke grup
                notificationService.sendTopupSuccessNotification(bot, userId, user.username, updatedInvoice.amount);
                return; 
            }

            if (elapsedTime >= timeout) {
                // ... (Logika timeout tidak berubah)
                if(activeInvoiceChecks[invoice.invoice_id]) {
                    clearInterval(intervalId);
                    delete activeInvoiceChecks[invoice.invoice_id];

                    const finalCheck = await paymentGatewayService.getInvoiceDetails(invoice.invoice_id);
                    if (finalCheck && finalCheck.status !== 'PAID') {
                      await bot.deleteMessage(chatId, qrisMessage.message_id).catch(() => {});
                      const expiredMsg = await bot.sendMessage(chatId, `❌ *Pembayaran Dibatalkan*\n\nInvoice untuk topup sejumlah ${formatRupiah(amount)} telah kedaluwarsa.`);
                      setTimeout(() => bot.deleteMessage(chatId, expiredMsg.message_id).catch(() => {}), 15000);
                    }
                }
                return;
            }
        }, checkInterval);

        // Daftarkan interval ke tracker
        activeInvoiceChecks[invoice.invoice_id] = intervalId;

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
