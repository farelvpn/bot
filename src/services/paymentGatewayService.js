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
      username: config.paymentGateway.username,
      amount: amount,
      notes: `Topup Saldo untuk User ID: ${userId} (@${userTelegramUsername || 'none'})`
    };
    const response = await apiClient.post('/api/v2/invoices', payload);
    writeLog(`[PaymentGateway] Invoice berhasil dibuat untuk UserID ${userId}: ${response.data.id}`);
    return response.data;
  } catch (error) {
    const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    writeLog(`[PaymentGateway] FATAL: Gagal membuat invoice untuk UserID ${userId}: ${errorMsg}`);
    throw new Error('Gagal terhubung ke server pembayaran.');
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

module.exports = { createInvoice, getInvoiceQR };
