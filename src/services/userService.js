// src/services/userService.js
const fs = require('fs');
const config = require('../config');
const { writeLog } = require('../utils/logger');
const sqliteService = require('./sqliteService');

const DB_PATH = config.paths.db;

/**
 * [FUNGSI DIPERBAIKI]
 * Memuat database dari file JSON dengan aman.
 * Jika file kosong, rusak, atau tidak ada, akan membuat struktur default.
 */
function loadDB() {
  const defaultDB = {
    users: {},
    settings: {
      topup: {
        minAmount: 10000,
        maxAmount: 1000000,
      }
    },
  };

  // Jika file tidak ada, langsung kembalikan struktur default
  if (!fs.existsSync(DB_PATH)) {
    return defaultDB;
  }
  
  try {
    const fileContent = fs.readFileSync(DB_PATH, 'utf-8');
    // Jika file ada tapi kosong, kembalikan struktur default
    if (!fileContent.trim()) {
        return defaultDB;
    }
    const data = JSON.parse(fileContent);
    
    // Pastikan properti 'users' dan 'settings' selalu ada
    // Ini mencegah error jika file JSON hanya berisi {}
    return {
        ...defaultDB,
        ...data,
        users: data.users || {},
        settings: data.settings || defaultDB.settings
    };
  } catch (error) {
    writeLog(`[UserService] Error membaca atau parsing database.json: ${error.message}. Menggunakan struktur DB default.`);
    // Jika terjadi error saat parsing, kembalikan struktur default
    return defaultDB;
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function ensureUser(userId, username) {
  const db = loadDB();
  if (!db.users[userId]) {
    db.users[userId] = {
      username: username || `user${userId}`,
      balance: 0,
      role: 'user',
      registered_at: new Date().toISOString(),
      topup_history: [],
    };
    saveDB(db);
    writeLog(`[UserService] Pengguna baru terdaftar: ID ${userId}, Username @${username}`);
    return true;
  }
  return false;
}

function updateUserBalance(userId, amount, type, metadata = {}) {
  const db = loadDB();
  if (!db.users[userId]) {
    writeLog(`[UserService] WARNING: Gagal update saldo. User ID ${userId} tidak ditemukan.`);
    return null;
  }
  
  const oldBalance = db.users[userId].balance;
  db.users[userId].balance += amount;
  
  if (type.startsWith('topup')) {
      db.users[userId].topup_history.push({
          amount, type, ...metadata, date: new Date().toISOString(), new_balance: db.users[userId].balance,
      });
      sqliteService.run(
          `INSERT INTO topup_logs (invoice_id, telegram_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)`,
          [metadata.invoiceId || null, userId, amount, 'PAID', new Date().toISOString()]
      ).catch(err => {
          writeLog(`[UserService] Gagal mencatat topup ke SQLite: ${err.message}`);
      });
  }

  saveDB(db);
  writeLog(`[UserService] Saldo User ID ${userId} diperbarui. Lama: ${oldBalance}, Baru: ${db.users[userId].balance}, Tipe: ${type}`);
  return { user: db.users[userId], oldBalance };
}

function getUser(userId) {
  const db = loadDB();
  return db.users[userId] || null;
}

function getTopupSettings() {
    const db = loadDB();
    return db.settings?.topup || { minAmount: 10000, maxAmount: 1000000 };
}

module.exports = { loadDB, saveDB, ensureUser, updateUserBalance, getUser, getTopupSettings };
