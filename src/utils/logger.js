// src/utils/logger.js
const fs = require('fs');
const path = require('path');
const config = require('../config');

const logDir = config.paths.logs;
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFile = path.join(logDir, 'bot.log');

function writeLog(message) {
  const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage.trim());
  fs.appendFileSync(logFile, logMessage);
}

module.exports = { writeLog };
