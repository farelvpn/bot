// src/services/paymentGatewayService.js
const axios = require('axios');
const config = require('../config');
const { writeLog } = require('../utils/logger');

const apiClient = axios.create({
  baseURL: config.paymentGateway.baseUrl,
  headers: {
    'Authorization': `Bearer ${config.paymentGateway.apiToken}`,
    'Content-Type': 'application/json'
  }
});

async function createInvoice(amount, userId, userTelegramUsername) {
  try {
    const payload = {
      notes: `Topup Saldo untuk User ID: ${userId} (@${userTelegramUsername || 'none'})`,
      amount: amount,
      expires_at: 3600 // Kedaluwarsa dalam 1 jam
    };
    const response = await apiClient.post('/api/v2/invoices/create', payload);
    writeLog(`[PaymentGateway] Invoice berhasil dibuat untuk UserID ${userId}: ${response.data.invoice_id}`);
    return response.data;
  } catch (error) {
    const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    writeLog(`[PaymentGateway] FATAL: Gagal membuat invoice untuk UserID ${userId}: ${errorMsg}`);
    throw new Error('Gagal terhubung ke server pembayaran. Pastikan token API valid.');
  }
}

async function getInvoiceQR(invoiceId) {
  try {
    const response = await apiClient.get(`/api/v2/invoices/qris/${invoiceId}`, {
      responseType: 'arraybuffer'
    });
    return Buffer.from(response.data, 'binary');
  } catch (error) {
    const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    writeLog(`[PaymentGateway] FATAL: Gagal mengambil QRIS untuk Invoice ${invoiceId}: ${errorMsg}`);
    throw new Error('Gagal memuat gambar QRIS.');
  }
}

/**
 * [FUNGSI BARU] Mendapatkan detail sebuah invoice untuk memeriksa statusnya.
 * @param {string} invoiceId ID invoice yang akan diperiksa.
 * @returns {Promise<Object>} Objek detail invoice.
 */
async function getInvoiceDetails(invoiceId) {
  try {
    const response = await apiClient.get(`/api/v2/invoices/details/${invoiceId}`);
    return response.data;
  } catch (error) {
    const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    writeLog(`[PaymentGateway] Gagal memeriksa detail invoice ${invoiceId}: ${errorMsg}`);
    // Kembalikan null agar alur bisa lanjut tanpa error fatal
    return null;
  }
}


module.exports = { createInvoice, getInvoiceQR, getInvoiceDetails };
