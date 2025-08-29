// src/utils/logger.js
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Ambil path file log dari konfigurasi
const logFile = config.paths.logFile;
// Dapatkan nama direktori dari path file log
const logDir = path.dirname(logFile);

// Periksa dan buat direktori log jika belum ada
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

function writeLog(message) {
  const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const logMessage = `[${timestamp}] ${message}\n`;
  
  // Tampilkan log di konsol
  console.log(logMessage.trim());
  
  // Tulis log ke file yang sudah ditentukan
  fs.appendFileSync(logFile, logMessage);
}

module.exports = { writeLog };
