// src/services/sqliteService.js
const sqlite3 = require('sqlite3').verbose();
const config = require('../config');
const { writeLog } = require('../utils/logger');

const DB_PATH = config.paths.sqlite;
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    writeLog(`[SQLite] FATAL: Gagal terhubung ke database: ${err.message}`);
  } else {
    writeLog('[SQLite] Berhasil terhubung ke database.');
    initializeTables();
  }
});

function initializeTables() {
  const createVpnTransactionsTable = `
    CREATE TABLE IF NOT EXISTS vpn_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idtrx TEXT NOT NULL UNIQUE,
      telegram_id TEXT NOT NULL,
      buyer_telegram_username TEXT,
      server_name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT,
      price INTEGER NOT NULL,
      duration_days INTEGER NOT NULL,
      purchase_date TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      reminder_sent INTEGER DEFAULT 0
    );
  `;
  const createTopupLogsTable = `
    CREATE TABLE IF NOT EXISTS topup_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id TEXT UNIQUE,
        telegram_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL,
        payment_method TEXT,
        created_at TEXT NOT NULL
    );
  `;
  const createTrialLogsTable = `
    CREATE TABLE IF NOT EXISTS trial_logs (
        telegram_id TEXT NOT NULL,
        server_id TEXT NOT NULL,
        protocol_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        PRIMARY KEY (telegram_id, server_id, protocol_id)
    );
  `;
  const createActiveTrialsTable = `
    CREATE TABLE IF NOT EXISTS active_trials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        protocol TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        expiry_timestamp TEXT NOT NULL
    );
  `;

  db.exec(createVpnTransactionsTable, handleDbError);
  db.exec(createTopupLogsTable, handleDbError);
  db.exec(createTrialLogsTable, handleDbError);
  db.exec(createActiveTrialsTable, handleDbError);
}

function handleDbError(err) {
  if (err) {
    writeLog(`[SQLite] Error eksekusi query: ${err.message}`);
  }
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        writeLog(`[SQLite] Error RUN query: ${sql} | ${err.message}`);
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, result) => {
      if (err) {
        writeLog(`[SQLite] Error GET query: ${sql} | ${err.message}`);
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        writeLog(`[SQLite] Error ALL query: ${sql} | ${err.message}`);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

module.exports = { run, get, all, db };
