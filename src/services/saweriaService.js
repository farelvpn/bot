// src/services/saweriaService.js
const saweriaQris = require('qris-saweria');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { writeLog } = require('../utils/logger');

const qrDir = path.join(__dirname, '../../temp_qr');
if (!fs.existsSync(qrDir)) {
    fs.mkdirSync(qrDir, { recursive: true });
}

const firstNames = ['aditya', 'agung', 'ahmad', 'aisyah', 'andi', 'anisa', 'bagus', 'bayu', 'budi', 'cahya', 'citra', 'dewi', 'dimas', 'dina', 'eka', 'fajar', 'gilang', 'hana', 'hendra', 'indah', 'intan', 'joko', 'kartika', 'lestari', 'linda', 'maya', 'mega', 'muhammad', 'nanda', 'novi', 'nur', 'putra', 'putri', 'rama', 'rani', 'ratna', 'reza', 'rian', 'rizki', 'rudi', 'sari', 'setiawan', 'siti', 'surya', 'tiara', 'tri', 'wahyu', 'wulan', 'yoga', 'yudi', 'yulia'];
const lastNames = ['pratama', 'saputra', 'hidayat', 'wijaya', 'santoso', 'ramadhan', 'kurniawan', 'prakoso', 'wibowo', 'lesmana', 'nugroho', 'utami', 'kusuma', 'putri', 'yuliana', 'anggraini', 'susanti', 'handayani', 'permata', 'siregar', 'fauzi', 'maulana', 'iskandar', 'setiawan', 'budiman'];

function generateRandomEmail() {
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const randomNum = Math.floor(Math.random() * 9990) + 10;
    const separator = ['.', '_', ''][Math.floor(Math.random() * 3)];
    return `${firstName}${separator}${lastName}${randomNum}@gmail.com`;
}

async function createQr(amount, userId) {
    try {
        // 1. Siapkan Path & Data
        const filename = `qris_${userId}_${uuidv4()}.png`;
        const outputPath = path.join(qrDir, filename);
        const randomEmail = generateRandomEmail();
        
        const saweriaUsername = config.saweria.name;

        writeLog(`[Saweria] Membuat QR via Library untuk user ${userId}. Nominal: ${amount}. Email: ${randomEmail}`);

        const [qrString, transactionId, qrImagePath] = await saweriaQris.createPaymentQr(
            saweriaUsername,
            amount,
            randomEmail,
            outputPath,
            true 
        );

        writeLog(`[Saweria] Berhasil. TRX ID: ${transactionId}`);
        
        return {
            qrString,
            transactionId,
            qrImagePath
        };

    } catch (error) {

        let errorMsg = error.message;
        if (error.response) {
            errorMsg = `Status ${error.response.status} - ${JSON.stringify(error.response.data)}`;
        }
        
        writeLog(`[Saweria] Gagal membuat QR: ${errorMsg}`);
        
        if (errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
            throw new Error('Gagal koneksi ke Saweria (IP Blokir/403). Coba gunakan IP Residential atau VPN.');
        }
        
        throw new Error('Gagal membuat QRIS Saweria.');
    }
}

async function checkStatus(transactionId) {
    try {
        const isPaid = await saweriaQris.paidStatus(transactionId);
        return isPaid;
    } catch (error) {
        writeLog(`[Saweria] Error cek status ${transactionId}: ${error.message}`);
        return false;
    }
}

function deleteQrImage(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        writeLog(`[Saweria] Gagal menghapus file QR: ${error.message}`);
    }
}

module.exports = { createQr, checkStatus, deleteQrImage };