// src/handlers/topupHandler.js
const userService = require('../services/userService');
const notificationService = require('../services/notificationService');
const paymentGatewayService = require('../services/paymentGatewayService');
const saweriaService = require('../services/saweriaService');
const { writeLog } = require('../utils/logger');
const { formatRupiah, prettyLine, backButton } = require('../utils/helpers');

// State management
const pendingTopupInput = {};
const activeInvoiceChecks = {};
const pendingPaymentSelection = {};

// 1. Handler Menu Topup
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

// 2. Proses Input Nominal & Logika Pemilihan Otomatis
async function processTopupAmount(bot, msg) {
    const userId = msg.from.id.toString();
    const username = msg.from.username;
    const state = pendingTopupInput[userId];
    if (!state) return;

    delete pendingTopupInput[userId];
    const { messageId, chatId } = state;

    // Validasi Input Angka
    const rawAmount = msg.text.trim();
    const cleanedAmount = rawAmount.replace(/\D/g, '');
    const amount = parseInt(cleanedAmount, 10);
    
    // Hapus pesan input user dan pesan menu sebelumnya agar rapi
    await bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    await bot.deleteMessage(chatId, messageId).catch(() => {});

    const { minAmount, maxAmount } = userService.getTopupSettings();
    if (isNaN(amount) || amount < minAmount || amount > maxAmount) {
        const errorText = `❌ *Input Tidak Valid*\n\nNominal harus di antara ${formatRupiah(minAmount)} dan ${formatRupiah(maxAmount)}.`;
        const sentMsg = await bot.sendMessage(chatId, errorText, { parse_mode: 'Markdown' });
        setTimeout(() => bot.deleteMessage(chatId, sentMsg.message_id).catch(() => {}), 5000);
        return;
    }

    // --- LOGIKA UTAMA PEMILIHAN METODE ---
    
    // 1. Ambil status metode dari database
    const methods = userService.getPaymentMethods(); // { gateway_utama: true/false, saweria: true/false }
    const availableMethods = [];
    
    if (methods.gateway_utama) availableMethods.push('gateway_utama');
    if (methods.saweria) availableMethods.push('saweria');

    // 2. Jika tidak ada metode aktif
    if (availableMethods.length === 0) {
        return bot.sendMessage(chatId, '❌ Mohon maaf, saat ini semua metode pembayaran sedang dinonaktifkan oleh admin.');
    }

    // 3. Simpan data amount sementara (penting untuk langkah selanjutnya)
    pendingPaymentSelection[userId] = { amount: amount, chatId: chatId };

    // 4. JIKA HANYA 1 METODE AKTIF -> LANGSUNG EKSEKUSI (AUTO)
    if (availableMethods.length === 1) {
        const selectedMethod = availableMethods[0];
        // Langsung panggil fungsi eksekusi tanpa menampilkan menu tombol
        return executePayment(bot, userId, selectedMethod, username);
    }

    // 5. JIKA KEDUANYA AKTIF -> TAMPILKAN TOMBOL PILIHAN
    const keyboard = [
        [
            { text: '🏦 QRIS Utama (Otomatis)', callback_data: 'pay_select_gateway_utama' },
            { text: '🐤 QRIS Saweria', callback_data: 'pay_select_saweria' }
        ],
        [backButton('❌ Batalkan', 'back_menu')]
    ];

    await bot.sendMessage(chatId, `💳 *Pilih Metode Pembayaran*\n${prettyLine()}\nNominal: *${formatRupiah(amount)}*\n\nSilakan pilih metode pembayaran yang tersedia:`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

// 3. Handler ketika User Klik Tombol Pilihan (Jika mode manual)
async function handlePaymentSelection(bot, query) {
    const userId = query.from.id.toString();
    const selection = pendingPaymentSelection[userId];
    
    if (!selection) {
        await bot.answerCallbackQuery(query.id, { text: 'Sesi pembayaran kedaluwarsa, silakan ulangi input nominal.', show_alert: true });
        return bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(()=>{});
    }

    const method = query.data.replace('pay_select_', '');
    await bot.deleteMessage(selection.chatId, query.message.message_id).catch(()=>{});
    
    // Eksekusi pembayaran sesuai tombol yang diklik
    await executePayment(bot, userId, method, query.from.username);
    
    // Hapus data pending setelah diproses
    delete pendingPaymentSelection[userId]; 
}

// 4. Fungsi Eksekutor Pembayaran (Inti Proses)
async function executePayment(bot, userId, method, username) {
    const selection = pendingPaymentSelection[userId];
    // Safety check
    if (!selection) {
        return bot.sendMessage(userId, '❌ Terjadi kesalahan sesi. Silakan ulangi.');
    }
    
    const { amount, chatId } = selection;
    const processingMessage = await bot.sendMessage(chatId, '⏳ Sedang membuat invoice pembayaran...');

    try {
        if (method === 'gateway_utama') {
            // --- PROSES GATEWAY UTAMA ---
            const invoice = await paymentGatewayService.createInvoice(amount, userId, username);
            const qrBuffer = await paymentGatewayService.getInvoiceQR(invoice.invoice_id);
            
            await bot.deleteMessage(chatId, processingMessage.message_id).catch(() => {});
            
            const caption = `*✅ Invoice Gateway Utama*\nID: \`${invoice.invoice_id}\`\nNominal: *${formatRupiah(amount)}*\n\nSilakan scan QRIS di atas. Bayar sebelum 5 menit.`;
            
            const msg = await bot.sendPhoto(chatId, qrBuffer, {
                caption: caption,
                parse_mode: 'Markdown',
                 reply_markup: {
                    inline_keyboard: [[{ text: 'Batal / Selesai', callback_data: 'delete_and_show_menu' }]]
                }
            });

            startPolling(bot, userId, 'gateway_utama', invoice.invoice_id, amount, msg.message_id, chatId);

        } else if (method === 'saweria') {
            // --- PROSES SAWERIA ---
            const result = await saweriaService.createQr(amount, userId);
            
            await bot.deleteMessage(chatId, processingMessage.message_id).catch(() => {});
            
            const caption = `*✅ Invoice Saweria*\nNominal: *${formatRupiah(amount)}*\n\nSilakan scan QRIS di atas menggunakan E-Wallet/M-Banking.\nSistem akan mengecek pembayaran otomatis setiap 5 detik.`;

            const msg = await bot.sendPhoto(chatId, result.qrImagePath, {
                caption: caption,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: 'Batal / Selesai', callback_data: 'delete_and_show_menu' }]]
                }
            });

            // Hapus file gambar lokal untuk menghemat penyimpanan
            saweriaService.deleteQrImage(result.qrImagePath);

            startPolling(bot, userId, 'saweria', result.transactionId, amount, msg.message_id, chatId);
        }

    } catch (error) {
        await bot.deleteMessage(chatId, processingMessage.message_id).catch(() => {});
        await bot.sendMessage(chatId, `❌ Gagal membuat invoice: ${error.message}`);
        writeLog(`[Topup] Error executePayment: ${error.message}`);
    }
}

// 5. Fungsi Polling Status Pembayaran
function startPolling(bot, userId, method, trxId, amount, messageId, chatId) {
    const checkInterval = 5000; // 5 Detik
    const timeout = 300000; // 5 Menit
    const startTime = Date.now();
    
    writeLog(`[Topup] Memulai polling ${method} ID: ${trxId} untuk User ${userId}`);

    const intervalId = setInterval(async () => {
        // Cek apakah polling ini sudah dibatalkan/selesai
        if (!activeInvoiceChecks[trxId]) { 
            clearInterval(intervalId); 
            return; 
        }

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
            // PEMBAYARAN SUKSES
            clearInterval(intervalId);
            delete activeInvoiceChecks[trxId];

            // Hapus pesan QRIS
            await bot.deleteMessage(chatId, messageId).catch(() => {});
            
            // Tambah Saldo ke Database
            const { user } = userService.updateUserBalance(userId, amount, `topup_${method}`, { invoiceId: trxId });
            
            // Kirim Notifikasi ke User
            await bot.sendMessage(chatId, `✅ *Topup Berhasil via ${method === 'saweria' ? 'Saweria' : 'Gateway'}!*\n\nSejumlah *${formatRupiah(amount)}* telah ditambahkan ke saldo Anda.\nSaldo sekarang: *${formatRupiah(user.balance)}*`, { parse_mode: 'Markdown' });
            
            // Kirim Notifikasi ke Grup Admin
            notificationService.sendTopupSuccessNotification(bot, userId, user.username, amount);
            return;
        }

        // JIKA WAKTU HABIS (TIMEOUT)
        if (elapsedTime >= timeout) {
            clearInterval(intervalId);
            delete activeInvoiceChecks[trxId];
            await bot.deleteMessage(chatId, messageId).catch(() => {});
            await bot.sendMessage(chatId, `❌ *Waktu Habis*\nInvoice sebesar ${formatRupiah(amount)} telah kedaluwarsa.`);
        }

    }, checkInterval);

    // Simpan ID interval agar bisa dihentikan nanti
    activeInvoiceChecks[trxId] = intervalId;
}

module.exports = { 
    handleTopupMenu, 
    processTopupAmount, 
    pendingTopupInput, 
    handlePaymentSelection 
};