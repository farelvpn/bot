// src/services/serverService.js
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { writeLog } = require('../utils/logger');

const SERVERS_DIR = config.paths.serversConfigDir;
if (!fs.existsSync(SERVERS_DIR)) {
  fs.mkdirSync(SERVERS_DIR, { recursive: true });
}

function getAllAvailableServers() {
  try {
    const serverFiles = fs.readdirSync(SERVERS_DIR).filter(file => file.endsWith('.json'));
    const servers = serverFiles.map(file => {
      const serverData = JSON.parse(fs.readFileSync(path.join(SERVERS_DIR, file), 'utf-8'));
      serverData.id = path.parse(file).name;
      return serverData;
    });
    return servers;
  } catch (error) {
    writeLog(`[ServerService] ERROR: Gagal membaca daftar server: ${error.message}`);
    return [];
  }
}

function getServerDetails(serverId) {
  const serverFilePath = path.join(SERVERS_DIR, `${serverId}.json`);
  if (fs.existsSync(serverFilePath)) {
    try {
      return JSON.parse(fs.readFileSync(serverFilePath, 'utf-8'));
    } catch (error) {
      writeLog(`[ServerService] ERROR: Gagal membaca file server ${serverId}.json: ${error.message}`);
      return null;
    }
  }
  return null;
}

function saveServerDetails(serverId, serverData) {
  const serverFilePath = path.join(SERVERS_DIR, `${serverId}.json`);
  try {
    fs.writeFileSync(serverFilePath, JSON.stringify(serverData, null, 2));
    writeLog(`[ServerService] Konfigurasi server ${serverId} berhasil disimpan.`);
    return true;
  } catch (error) {
    writeLog(`[ServerService] ERROR: Gagal menyimpan konfigurasi server ${serverId}: ${error.message}`);
    return false;
  }
}

function deleteServer(serverId) {
  const serverFilePath = path.join(SERVERS_DIR, `${serverId}.json`);
  if (fs.existsSync(serverFilePath)) {
    try {
      fs.unlinkSync(serverFilePath);
      writeLog(`[ServerService] Server ${serverId} berhasil dihapus.`);
      return true;
    } catch (error) {
      writeLog(`[ServerService] ERROR: Gagal menghapus server ${serverId}: ${error.message}`);
      return false;
    }
  }
  writeLog(`[ServerService] Gagal menghapus: Server ${serverId} tidak ditemukan.`);
  return false;
}

module.exports = { getAllAvailableServers, getServerDetails, saveServerDetails, deleteServer };
