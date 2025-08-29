// src/services/userService.js
const fs = require('fs');
const config = require('../config');
const { writeLog } = require('../utils/logger');
const sqliteService = require('./sqliteService');

const DB_PATH = config.paths.db;

function loadDB() {
  const defaultDB = {
    users: {},
    settings: { topup: { minAmount: 10000, maxAmount: 1000000 } },
  };

  if (!fs.existsSync(DB_PATH)) return defaultDB;
  
  try {
    const fileContent = fs.readFileSync(DB_PATH, 'utf-8');
    if (!fileContent.trim()) return defaultDB;
    const data = JSON.parse(fileContent);
    return { ...defaultDB, ...data, users: data.users || {}, settings: data.settings || defaultDB.settings };
  } catch (error) {
    writeLog(`[UserService] Error membaca database.json: ${error.message}. Menggunakan DB default.`);
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
      role: 'user', // Peran default adalah 'user'
      registered_at: new Date().toISOString(),
      topup_history: [],
    };
    saveDB(db);
    writeLog(`[UserService] Pengguna baru terdaftar: ID ${userId}, Username @${username}, Role: user`);
    return true;
  }
  // Memastikan pengguna lama memiliki properti role
  if (!db.users[userId].role) {
    db.users[userId].role = 'user';
    saveDB(db);
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

function updateUserRole(userId, newRole) {
    const db = loadDB();
    if (!db.users[userId]) return false;
    if (newRole !== 'user' && newRole !== 'reseller') return false;
    
    db.users[userId].role = newRole;
    saveDB(db);
    writeLog(`[UserService] Role untuk User ID ${userId} telah diubah menjadi ${newRole}.`);
    return true;
}

function getTopupSettings() {
    return loadDB().settings?.topup || { minAmount: 10000, maxAmount: 1000000 };
}

function getAllUsers() {
    return loadDB().users;
}

module.exports = { ensureUser, updateUserBalance, getUser, updateUserRole, getTopupSettings, getAllUsers };
